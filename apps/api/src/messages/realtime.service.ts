import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { Client } from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { RateLimiter } from "../common/rate-limit.js";

/** Soket olayı: yalnızca hangi yazışmanın değiştiği. İstemci mesajları REST
 *  uçlarından çeker; içerik sokete hiç çıkmaz. */
export type MessageEvent = {
  t: "message" | "read";
  /** Çalışma alanı. */
  w: string;
  /** Yazışma (portal bağlantısı). */
  l: string;
  /** Okundu olayında okuyan hesap; olay yalnızca ona gider. */
  u?: string;
};

const CHANNEL = "derslik_messages";
/** İstemci bu alt protokolü ve `ticket.<bilet>` alt protokolünü birlikte sunar. */
export const SOCKET_PROTOCOL = "derslik.v1";
export const SOCKET_PATH = "/v1/socket";
const PER_USER = 10,
  TOTAL = 10_000,
  // Vekiller (Cloudflare ~100 sn, Nginx 60 sn) boştaki bağlantıyı keser.
  HEARTBEAT = 25_000,
  // Bilet oturumun o anki geçerliliğini kanıtlar; bağlantı en fazla bu kadar
  // yaşar, istemci yeni biletle döner (çıkış yapmış hesap dönemez).
  LIFETIME = 60 * 60_000,
  TICKET_SECONDS = 30;

const uuid = z.string().uuid();
const notifySchema = z.object({
  t: z.enum(["message", "read"]),
  w: uuid,
  l: uuid,
  u: uuid.nullish(),
  o: z.string().nullish(),
});
const ticketPattern = /^[a-f0-9]{64}$/;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type Live = WebSocket & { alive?: boolean };

/**
 * Anlık mesajlaşma. İstemci REST ile tek kullanımlık bir bilet alır ve
 * `/v1/socket`'e onunla bağlanır. Mesaj ya da okundu bilgisi yazılınca alıcılar
 * veritabanından o anda bulunur ve soketlerine yazışmanın kimliği gider.
 *
 * Olay iki yoldan gelir: isteği işleyen süreç commit'ten sonra olayı hemen
 * kendisi dağıtır (publish); veritabanı tetikleyicisi de NOTIFY yayınlar ve
 * başka API kopyaları onu LISTEN ile alır. Süreç kendi yazdığı bildirimi
 * application_name'den tanıyıp atlar, olay iki kez gitmez.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly sockets = new Map<string, Set<Live>>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
    handleProtocols: (offered) =>
      offered.has(SOCKET_PROTOCOL) ? SOCKET_PROTOCOL : false,
  });
  private readonly ticketLimiter = new RateLimiter(30);
  private listener: Client | null = null;
  private retry = 1_000;
  private heartbeat: NodeJS.Timeout | null = null;
  private relistenTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private count = 0;

  constructor(
    private readonly db: DatabaseService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  /** HTTP sunucusuna bağlanır: soket isteklerini karşılar, LISTEN'i başlatır. */
  attach(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head) => {
      socket.on("error", () => socket.destroy());
      this.upgrade(req, socket, head).catch(() => reject(socket, 500));
    });
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT);
    this.heartbeat.unref();
    void this.listen();
  }

  /** Oturumlu kullanıcıya 30 saniyelik, tek kullanımlık bilet. */
  async ticket(actor: Actor) {
    if (this.ticketLimiter.take(actor.id))
      throw new HttpException(
        "api.tooManyRequests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const ticket = randomBytes(32).toString("hex");
    try {
      await this.db.transaction(actor, null, (tx) =>
        tx.query("SELECT derslik.issue_socket_ticket($1)", [sha256(ticket)]),
      );
    } catch (error) {
      if ((error as { hint?: string }).hint === "ticket_limit")
        throw new HttpException(
          "api.tooManyRequests",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw error;
    }
    return { data: { ticket, expiresIn: TICKET_SECONDS } };
  }

  /** İsteği işleyen süreç, commit'ten sonra olayı hemen dağıtır. */
  publish(event: MessageEvent) {
    this.dispatch(event).catch((error) =>
      console.error("Derslik realtime dispatch failed", {
        code: (error as { code?: string }).code,
      }),
    );
  }

  /** Bağlı soket sayısı (testler ve sağlık denetimi için). */
  connections(user?: string) {
    return user ? (this.sockets.get(user)?.size ?? 0) : this.count;
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    let path: string;
    try {
      path = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      return reject(socket, 400);
    }
    if (path !== SOCKET_PATH) return reject(socket, 404);
    if (!this.allowedOrigin(req)) return reject(socket, 403);
    const offered = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim());
    const ticket = offered.find((p) => p.startsWith("ticket."))?.slice(7);
    // Biçimi tutmayan bilet veritabanına hiç ulaşmaz.
    if (
      !offered.includes(SOCKET_PROTOCOL) ||
      !ticket ||
      !ticketPattern.test(ticket)
    )
      return reject(socket, 401);
    if (this.closed || this.count >= TOTAL) return reject(socket, 503);
    const user: string | null = (
      await this.db.pool.query(
        "SELECT derslik.redeem_socket_ticket($1) AS user_id",
        [sha256(ticket)],
      )
    ).rows[0]?.user_id;
    if (!user) return reject(socket, 401);
    if (this.connections(user) >= PER_USER) return reject(socket, 429);
    if (socket.destroyed) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.register(user, ws));
  }

  /** Kimlik bilet ile doğrulanır, çerezle değil; bu yüzden başka bir sitenin
   *  kullanıcı adına soket açması (CSWSH) mümkün değildir. Origin yine de
   *  denetlenir: tarayıcıdan yalnızca izinli adresler bağlanır. Origin
   *  göndermeyen istemciler ve React Native (bağlandığı adresin, yani API'nin
   *  kökenini yazar) geçer. */
  private allowedOrigin(req: IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = [
      ...this.config.origins,
      this.config.WEB_ORIGIN,
      this.config.API_PUBLIC_URL,
    ].flatMap((value) => {
      try {
        return value ? [new URL(value).origin] : [];
      } catch {
        return [];
      }
    });
    if (allowed.includes(origin)) return true;
    try {
      const host = new URL(origin).host;
      const forwarded = String(req.headers["x-forwarded-host"] ?? "")
        .split(",")
        .map((h) => h.trim());
      return host === req.headers.host || forwarded.includes(host);
    } catch {
      return false;
    }
  }

  private register(user: string, ws: Live) {
    const set = this.sockets.get(user) ?? new Set<Live>();
    set.add(ws);
    this.sockets.set(user, set);
    this.count += 1;
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    // İstemciden mesaj beklenmez; gelen yok sayılır (en fazla 1 KB).
    ws.on("message", () => undefined);
    ws.on("error", () => ws.terminate());
    const expiry = setTimeout(() => ws.close(4000, "reauth"), LIFETIME);
    expiry.unref();
    ws.on("close", () => {
      clearTimeout(expiry);
      set.delete(ws);
      if (!set.size && this.sockets.get(user) === set)
        this.sockets.delete(user);
      this.count -= 1;
    });
    send(ws, { type: "ready" });
  }

  /** Yanıt vermeyen bağlantı kapanır. İstemci de 25 sn'de bir `ping` alır;
   *  uzun süre hiçbir şey gelmezse bağlantıyı kopmuş sayıp yeniden kurar. */
  private beat() {
    for (const set of this.sockets.values())
      for (const ws of set) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
        send(ws, { type: "ping" });
      }
  }

  private async dispatch(event: MessageEvent) {
    if (!this.sockets.size) return;
    const rows = (
      await this.db.pool.query<{
        user_id: string;
        workspace_id: string;
        student_id: string;
      }>("SELECT * FROM derslik.message_recipients($1)", [event.l])
    ).rows;
    for (const row of rows) {
      if (event.t === "read" && row.user_id !== event.u) continue;
      const targets = this.sockets.get(row.user_id);
      if (!targets) continue;
      const payload = {
        type: event.t,
        workspace: row.workspace_id,
        student: row.student_id,
        thread: event.l,
      };
      for (const ws of targets) send(ws, payload);
    }
  }

  private notified(payload: string | undefined) {
    let event: z.infer<typeof notifySchema>;
    try {
      event = notifySchema.parse(JSON.parse(payload ?? ""));
    } catch {
      return;
    }
    if (event.o === this.db.instance) return;
    this.publish({
      t: event.t,
      w: event.w,
      l: event.l,
      u: event.u ?? undefined,
    });
  }

  private async listen() {
    if (this.closed) return;
    const client = new Client({
      connectionString:
        this.config.DATABASE_LISTEN_URL ?? this.config.DATABASE_URL,
      application_name: this.db.instance + "-listen",
      ...(this.config.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: true } }
        : {}),
    });
    let dropped = false;
    const drop = () => {
      if (dropped) return;
      dropped = true;
      if (this.listener === client) this.listener = null;
      client.removeAllListeners();
      client.on("error", () => undefined);
      client.end().catch(() => undefined);
      this.relisten();
    };
    client.on("notification", (n) => this.notified(n.payload));
    client.on("error", drop);
    client.on("end", drop);
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      if (!this.closed)
        console.error("Derslik realtime listener failed", {
          code: (error as { code?: string }).code,
        });
      return drop();
    }
    if (this.closed) return void client.end().catch(() => undefined);
    this.listener = client;
    // Bağlantı koptuğu sürede kaçan bildirimler için istemciler bir kez yenilenir.
    if (this.retry > 1_000) this.broadcast({ type: "resync" });
    this.retry = 1_000;
  }

  private relisten() {
    if (this.closed || this.relistenTimer) return;
    const wait = this.retry;
    this.retry = Math.min(this.retry * 2, 30_000);
    this.relistenTimer = setTimeout(() => {
      this.relistenTimer = null;
      void this.listen();
    }, wait);
    this.relistenTimer.unref();
  }

  private broadcast(payload: object) {
    for (const set of this.sockets.values())
      for (const ws of set) send(ws, payload);
  }

  async onModuleDestroy() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.relistenTimer) clearTimeout(this.relistenTimer);
    for (const set of this.sockets.values())
      for (const ws of set) ws.close(1001, "shutdown");
    this.wss.close();
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      listener.removeAllListeners();
      listener.on("error", () => undefined);
      await listener.end().catch(() => undefined);
    }
  }
}

function send(ws: WebSocket, payload: object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function reject(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

// Anlık mesajlaşma soketi: web ve mobil aynı istemciyi kullanır. Soket yalnızca
// "şu yazışma değişti" der; mesajlar her zamanki REST uçlarından çekilir.
// Bağlantı koparsa artan aralıklarla yeniden kurulur; kurulunca istemciye
// `resync` gider (aradaki olaylar kaçmış olabilir, bir kez yenilenir).

export type MessageSocketEvent =
  | {
      type: "message" | "read";
      workspace: string;
      student: string;
      /** Yazışmanın (portal bağlantısının) kimliği. */
      thread: string;
    }
  | { type: "resync" };

export type SocketTicket = { ticket: string; url: string };

/** Ortamların (tarayıcı, React Native, Node) WebSocket'inden kullanılan kısım. */
type SocketLike = {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
};
type SocketFactory = new (url: string, protocols: string[]) => SocketLike;

/** Sunucu 25 sn'de bir `ping` gönderir; bu kadar süre hiçbir şey gelmezse
 *  bağlantı kopmuş sayılır. */
const SILENCE = 70_000;
/** Bilet alınamıyorsa (soket kapalı ya da oturum yok) bu aralıkla yeniden
 *  denenir; arada yoklama (REST) çalışmaya devam eder. */
const UNAVAILABLE = 5 * 60_000;
const MAX_WAIT = 30_000;

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

function parse(data: unknown): MessageSocketEvent | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    if (value.type === "resync") return { type: "resync" };
    if (
      (value.type === "message" || value.type === "read") &&
      isId(value.workspace) &&
      isId(value.student) &&
      isId(value.thread)
    )
      return {
        type: value.type,
        workspace: value.workspace,
        student: value.student,
        thread: value.thread,
      };
  } catch {
    // Bozuk ileti yok sayılır.
  }
  return null;
}

/** Olay bu yazışma listesini ilgilendiriyor mu? Öğretmen listesi
 *  `/workspaces/<ws>/messages`, portal listesi `/portal/<ws>/<öğrenci>/messages`
 *  yolundadır. `resync` herkesi ilgilendirir. */
export function eventConcerns(path: string, event: MessageSocketEvent) {
  if (event.type === "resync") return true;
  return path.startsWith("/portal/")
    ? path.startsWith(`/portal/${event.workspace}/${event.student}/`)
    : path.startsWith(`/workspaces/${event.workspace}/`);
}

export class MessageSocket {
  private socket: SocketLike | null = null;
  private readonly listeners = new Set<(event: MessageSocketEvent) => void>();
  private readonly liveListeners = new Set<() => void>();
  private running = false;
  /** Every start/stop invalidates ticket requests from an earlier session. */
  private generation = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelTicket: (() => void) | null = null;
  /** Bağlantı açık mı? Açıkken yoklama seyrekleşir. */
  live = false;

  constructor(
    private readonly options: {
      /** Yeni bilet ve soket adresi. Soket kullanılamıyorsa (ayarlanmamış,
       *  oturum yok) null döner, geçici hatada fırlatır. */
      ticket: (signal: AbortSignal) => Promise<SocketTicket | null>;
      WebSocket?: SocketFactory;
    },
  ) {}

  subscribe(listener: (event: MessageSocketEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** `live` değişince çağrılır (React'te useSyncExternalStore için). */
  onLive(listener: () => void) {
    this.liveListeners.add(listener);
    return () => void this.liveListeners.delete(listener);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.attempt = 0;
    void this.connect();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    this.cancelTicket?.();
    this.cancelTicket = null;
    this.clearTimers();
    this.drop(1000);
  }

  private async connect() {
    if (!this.running || this.socket) return;
    const generation = this.generation;
    const controller = new AbortController();
    let onAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Socket ticket request cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const deadline = setTimeout(() => controller.abort(), SILENCE);
    const cancel = () => {
      clearTimeout(deadline);
      controller.abort();
    };
    this.cancelTicket = cancel;
    let ticket: SocketTicket | null;
    try {
      // The ticket provider may never settle (or may ignore cancellation).
      // Bound this phase as well as the WebSocket handshake itself.
      ticket = await Promise.race([
        this.options.ticket(controller.signal),
        interrupted,
      ]);
    } catch {
      // Geçici hata (ağ, sunucu): artan aralıkla yeniden denenir.
      if (this.running && generation === this.generation && !this.socket)
        this.schedule();
      return;
    } finally {
      clearTimeout(deadline);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      if (this.cancelTicket === cancel) this.cancelTicket = null;
    }
    if (!this.running || generation !== this.generation || this.socket) return;
    if (!ticket) return this.schedule(UNAVAILABLE);
    const Factory =
      this.options.WebSocket ??
      (globalThis as { WebSocket?: SocketFactory }).WebSocket;
    if (!Factory) return;
    let socket: SocketLike;
    try {
      socket = new Factory(ticket.url, [
        "derslik.v1",
        "ticket." + ticket.ticket,
      ]);
    } catch {
      return this.schedule();
    }
    this.socket = socket;
    // A handshake can hang without an open/close event; it needs the same
    // deadline as an established connection.
    this.heard();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.heard();
      this.setLive(true);
      this.emit({ type: "resync" });
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      this.heard();
      const event = parse(message.data);
      if (event) this.emit(event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setLive(false);
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      if (this.running) this.schedule();
    };
    socket.onerror = () => undefined; // Ardından onclose gelir.
  }

  /** Bir şey duyuldu: sessizlik sayacı baştan başlar. */
  private heard() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // Yarı açık bağlantı: kapatıp hemen yenisini kur.
      this.drop(4001);
      if (this.running) this.schedule();
    }, SILENCE);
  }

  /** Bağlantıyı bırakır; geç gelen olayları yok sayar. */
  private drop(code: number) {
    const socket = this.socket;
    this.socket = null;
    this.setLive(false);
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code);
    } catch {
      // Zaten kapalı.
    }
  }

  /** Yeniden deneme: 1, 2, 4 … en fazla 30 sn, rastgele kısaltılarak
   *  (sunucu yeniden başlayınca herkes aynı anda gelmesin). */
  private schedule(wait?: number) {
    if (!this.running || this.retryTimer) return;
    const delay =
      wait ??
      Math.min(MAX_WAIT, 1000 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.retryTimer = this.silenceTimer = null;
  }

  private setLive(live: boolean) {
    if (this.live === live) return;
    this.live = live;
    for (const listener of this.liveListeners) {
      try {
        listener();
      } catch {
        // Bir dinleyicinin hatası bağlantıyı ve ötekileri durdurmaz.
      }
    }
  }

  private emit(event: MessageSocketEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Bir dinleyicinin hatası ötekileri durdurmaz.
      }
    }
  }
}

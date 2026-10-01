import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService, toDto } from "../common/command.service.js";
import { RateLimiter } from "../common/rate-limit.js";
import { uuid } from "../contracts.js";
import { messageSchema } from "../../../../packages/contracts/src/messages.js";

const listQuery = z.object({ student: uuid.optional() });
/** İstemcinin geri gönderdiği mesaj zamanı. PostgreSQL'in kabul etmediği
 *  biçimler (ör. +16:00 farkı, 0 yılı) 500 değil 400 döner. */
const messageTime = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1)
  .transform((d) => d.toISOString());
const pageQuery = z.object({
  before: messageTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const readBody = z.object({ upTo: messageTime.optional() });

/** Uygulama içi mesajlaşma. Yazışma bir portal bağlantısıdır; erişim
 *  kuralları veritabanındaki `derslik.message_access` fonksiyonundadır.
 *  `student` boşsa öğretmen rotası, doluysa öğrenci/veli (portal) rotasıdır. */
@Injectable()
export class MessagesService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
    @Inject(CONFIG) config: ApiConfig,
  ) {
    this.limiter = new RateLimiter(config.RATE_LIMIT_MESSAGES_PER_MINUTE);
  }

  /** Öğretmen rotasında çalışma alanı sahipliği (403 api.noWorkspaceAccess),
   *  portal rotasında öğrenciye erişim (403 api.noStudentAccess) önce denetlenir;
   *  erişimi kaldırılmış bağlantı ve arşivlenmiş öğrenci portalda burada durur. */
  private run<T>(
    actor: Actor,
    ws: string,
    student: string | null,
    fn: (tx: PoolClient) => Promise<T>,
  ) {
    return student
      ? this.db.portalTransaction(actor, ws, student, "lessons", fn)
      : this.db.transaction(actor, ws, fn);
  }

  private side(student: string | null) {
    return student ? "PORTAL" : "OWNER";
  }

  /** Yazışma listesi. Öğretmen `?student=` ile tek öğrencinin yazışmalarını alır. */
  threads(actor: Actor, ws: string, student: string | null, query: unknown) {
    const forStudent = student
      ? null
      : (listQuery.parse(query).student ?? null);
    return this.run(actor, ws, student, async (tx) => ({
      data: toDto(
        (
          await tx.query(
            "SELECT * FROM derslik.message_threads($1,$2::uuid,NULL,$3::uuid)",
            [ws, student, forStudent],
          )
        ).rows,
      ),
    }));
  }

  /** Bir yazışma ve mesajları (eskiden yeniye). `before` önceki sayfayı alır:
   *  en eski mesajın zamanı olduğu gibi geri gönderilir. */
  thread(
    actor: Actor,
    ws: string,
    student: string | null,
    link: string,
    query: unknown,
  ) {
    const { before, limit } = pageQuery.parse(query);
    const side = this.side(student);
    return this.run(actor, ws, student, async (tx) => {
      const thread = (
        await tx.query(
          "SELECT * FROM derslik.message_threads($1,$2::uuid,$3,NULL)",
          [ws, student, link],
        )
      ).rows[0];
      if (!thread) throw new NotFoundException("api.messageNotFound");
      const page = (
        await tx.query(
          "SELECT * FROM derslik.message_thread($1,$2::uuid,$3,$4,$5::timestamptz,$6)",
          [ws, student, link, side, before ?? null, limit],
        )
      ).rows;
      // Mesaj zamanları yazışmada benzersizdir; en eski mesajdan önce bir mesaj
      // daha varsa sayfa devam eder.
      const more =
        page.length === limit &&
        !!(
          await tx.query(
            "SELECT 1 FROM derslik.message_thread($1,$2::uuid,$3,$4,$5,1)",
            [ws, student, link, side, page[page.length - 1].created_at],
          )
        ).rowCount;
      return {
        data: toDto({ thread, messages: page.reverse(), more }),
      };
    });
  }

  /** Mesaj gönderir. Metin komut kaydına ve denetim kaydına yazılmaz. */
  async send(
    actor: Actor,
    ws: string,
    student: string | null,
    link: string,
    key: string,
    input: unknown,
  ) {
    const parsed = messageSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("api.messageInvalid");
    const side = this.side(student);
    const body = parsed.data.body;
    try {
      return await this.commands.run(
        actor,
        ws,
        key,
        { action: "message.send", linkId: link, body },
        async (tx) => {
          const access = (
            await tx.query(
              "SELECT can_send FROM derslik.message_access($1,$2::uuid,$3,$4)",
              [ws, student, link, side],
            )
          ).rows[0];
          if (!access) throw new NotFoundException("api.messageNotFound");
          if (!access.can_send)
            throw new ForbiddenException("api.messageClosed");
          // Sınır yalnızca yeni gönderimde sayılır: aynı anahtarla tekrar
          // (yanıtı kaybolan gönderim) ve reddedilen istekler sayılmaz.
          if (this.limiter.take(actor.id))
            throw new HttpException(
              "api.messageRateLimit",
              HttpStatus.TOO_MANY_REQUESTS,
            );
          const data = (
            await tx.query(
              "SELECT * FROM derslik.send_message($1,$2::uuid,$3,$4,$5)",
              [ws, student, link, side, body],
            )
          ).rows[0];
          return { data, audit: { linkId: link } };
        },
        student
          ? { studentId: student, permission: "lessons", write: false }
          : undefined,
      );
    } catch (error) {
      // Erişim, ilk denetimle kilit arasında kalktıysa (erişim kaldırma,
      // arşivleme) send_message aynı kararı verir.
      const { code, hint } = error as { code?: string; hint?: string };
      if (code === "42501" && hint === "closed")
        throw new ForbiddenException("api.messageClosed");
      if (code === "42501" && hint === "not_found")
        throw new NotFoundException("api.messageNotFound");
      throw error;
    }
  }

  /** Yazışmayı `upTo` anına (istemcinin gördüğü en yeni mesaj) kadar okundu
   *  sayar; karşı taraftan okunmamış mesaj kalmadıysa bildirimi de okunur. */
  read(
    actor: Actor,
    ws: string,
    student: string | null,
    link: string,
    input: unknown,
  ) {
    const { upTo } = readBody.parse(input ?? {});
    return this.run(actor, ws, student, async (tx) => {
      const read = (
        await tx.query(
          "SELECT derslik.read_messages($1,$2::uuid,$3,$4,$5::timestamptz) AS read",
          [ws, student, link, this.side(student), upTo ?? null],
        )
      ).rows[0]?.read;
      if (!read) throw new NotFoundException("api.messageNotFound");
      return { data: { read: true } };
    });
  }
}

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { lockAccountRole } from "../common/account-role.js";
import { CommandService, toDto } from "../common/command.service.js";
import { MediaProviders } from "../media/providers.js";
import { MailService } from "./mail.js";
import { confirmedEmail } from "../auth/confirmed-email.js";
import { lockStudent } from "../students/students.service.js";
import { currentLocale } from "../common/i18n.js";

const INVITES_PER_HOUR = 20,
  INVITES_PER_DAY = 60;
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class AccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
    private readonly providers: MediaProviders,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}
  list(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => {
      const owners = (
        await tx.query(
          "SELECT id,name,'OWNER' AS role FROM derslik.workspaces WHERE owner_id=$1",
          [actor.id],
        )
      ).rows;
      const links = (
        await tx.query(
          "SELECT workspace_id,student_id,role FROM derslik.portal_links WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at",
          [actor.id],
        )
      ).rows;
      const portals = [];
      for (const l of links) {
        // eslint-disable-next-line no-await-in-loop -- her tur önce set_config ile bu transaction'ın çalışma alanı bağlamını kurar, sonraki sorgu (RLS) o bağlama bağlıdır; sıra bozulamaz.
        await tx.query("SELECT set_config('app.workspace_id',$1,true)", [ // NOSONAR: her tur önce set_config ile bu transaction'ın çalışma alanı bağlamını kurar, sonraki sorgu (RLS) o bağlama bağlıdır; sıra bozulamaz
          l.workspace_id,
        ]);
        const row = (
          // eslint-disable-next-line no-await-in-loop -- sorgu, hemen yukarıdaki set_config'in kurduğu çalışma alanı bağlamına (RLS) bağlı; sıra bozulamaz.
          await tx.query( // NOSONAR: sorgu, hemen yukarıdaki set_config'in kurduğu çalışma alanı bağlamına (RLS) bağlı; sıra bozulamaz
            "SELECT w.id,w.name,s.name AS student_name FROM derslik.workspaces w JOIN derslik.students s ON s.workspace_id=w.id WHERE w.id=$1 AND s.id=$2 AND s.active",
            [l.workspace_id, l.student_id],
          )
        ).rows[0];
        if (row)
          portals.push({ ...row, role: l.role, student_id: l.student_id });
      }
      return { data: toDto([...owners, ...portals]) };
    });
  }
  async invite(
    actor: Actor,
    ws: string,
    student: string,
    key: string,
    input: unknown,
  ) {
    const c = z
      .object({
        email: z
          .string()
          .email()
          .max(200)
          .transform((v) => v.toLowerCase()),
        role: z.enum(["STUDENT", "GUARDIAN"]),
        permissions: z
          .array(
            z.enum(["lessons", "assignments", "videos", "notes", "payments"]),
          )
          .min(1)
          .max(5)
          .refine(
            (v) => v.includes("lessons"),
            "api.lessonsPermissionRequired",
          ),
      })
      .strict()
      .parse(input);
    let studentName = "",
      token = "";
    const result = await this.commands.run(
      actor,
      ws,
      key,
      { action: "invitation.create", studentId: student, ...c },
      async (tx) => {
        studentName = (await lockStudent(tx, ws, student, true)).name;
        // Öğrenci kilidi yalnızca aynı öğrenciyi sıraya sokar; farklı
        // öğrencilere aynı anda gelen davetler sayımı birlikte geçmesin diye
        // sayım çalışma alanı kilidi altında yapılır.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `invitations:${ws}`,
        ]);
        // Davet e-postası öğretmenin yazdığı adla bizim alan adımızdan gider;
        // sınırsız olursa spam aracına döner.
        const sent = (
          await tx.query(
            `SELECT count(*) FILTER (WHERE created_at>now()-interval '1 hour')::int AS hour,
               count(*)::int AS day
             FROM derslik.invitations WHERE workspace_id=$1 AND created_at>now()-interval '1 day'`,
            [ws],
          )
        ).rows[0];
        if (sent.hour >= INVITES_PER_HOUR || sent.day >= INVITES_PER_DAY)
          throw new HttpException(
            "api.inviteRateLimit",
            HttpStatus.TOO_MANY_REQUESTS,
          );
        token = randomBytes(32).toString("hex");
        const invite = (
          await tx.query(
            "INSERT INTO derslik.invitations(workspace_id,student_id,email,role,permissions,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING id,email,role,expires_at",
            [
              ws,
              student,
              c.email,
              c.role,
              [...new Set(c.permissions)],
              tokenHash(token),
            ],
          )
        ).rows[0];
        // Bağlantı yanıta commit'ten sonra eklenir: api_commands.response
        // tekrar için saklanır ve orada açık token durmamalı.
        return {
          data: invite,
          audit: { role: c.role, studentId: student },
        };
      },
    );
    if (result.replayed) {
      // Aynı anahtarla tekrar (ilk yanıt istemciye ulaşmamış olabilir):
      // saklı yanıtta bağlantı yok, bu yüzden token yenilenir. Eski bağlantı
      // hiç görülmediği için geçersiz kalması sorun değil.
      const fresh = randomBytes(32).toString("hex");
      const rotated = await this.db.transaction(
        actor,
        ws,
        async (tx) =>
          (
            await tx.query(
              "UPDATE derslik.invitations SET token_hash=$3 WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id",
              [ws, result.data.id, tokenHash(fresh)],
            )
          ).rowCount,
      );
      return rotated
        ? { ...result, data: { ...result.data, url: this.inviteUrl(fresh) } }
        : result;
    }
    const url = this.inviteUrl(token);
    // Gönderim commit'ten sonra: sağlayıcı hata verirse davet yine de durur ve
    // öğretmen bağlantıyı kopyalayarak iletebilir. Aynı anahtarla tekrar
    // gelen istek (replayed) ikinci bir e-posta doğurmaz.
    const emailed = await this.mail.sendInvite({
      to: c.email,
      url,
      studentName,
      role: c.role,
    });
    return { ...result, data: { ...result.data, url, emailed } };
  }
  private inviteUrl(token: string) {
    return new URL(`/invite/${token}`, this.config.WEB_ORIGIN).href;
  }
  async accept(actor: Actor, authorization: string, input: unknown) {
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    // Confirm the bound email with Auth; a token's unconfirmed email alone is insufficient.
    const email = await confirmedEmail(this.config, authorization, actor.id);
    if (!email) throw new ForbiddenException("api.verifyEmailForInvite");
    const hash = tokenHash(token);
    try {
      return await this.db.transaction(actor, null, async (tx) => {
        // Bir e-posta ya öğretmen ya öğrencidir: öğretmen hesabı öğrenci
        // davetini kabul edemez (veli daveti serbest).
        await lockAccountRole(tx, actor.id);
        const check = (
          await tx.query(
            "SELECT derslik.invitation_role($1,$2) AS role, derslik.is_teacher_account($3) AS teacher",
            [hash, email, actor.id],
          )
        ).rows[0];
        if (check.role === "STUDENT" && check.teacher)
          throw new ConflictException("api.accountIsTeacher");
        const accepted = (
          await tx.query("SELECT derslik.accept_invitation($1,$2) AS data", [
            hash,
            email,
          ])
        ).rows[0].data;
        // Onaylı adres: ders hatırlatması e-postası buraya gider.
        await tx.query(
          "UPDATE derslik.users SET email=$2, locale=$3 WHERE id=$1",
          [actor.id, email, currentLocale()],
        );
        return { data: accepted };
      });
    } catch (error) {
      // accept_invitation raises one error for every refusal. The usual cause
      // is being signed in with another account than the invited address, and
      // the generic constraint message gave the invitee no hint of that.
      if (
        (error as { code?: string })?.code === "23514" &&
        (error as Error).message?.includes("Invitation unavailable")
      )
        throw new ConflictException("api.inviteWrongAccount");
      throw error;
    }
  }
  links(actor: Actor, ws: string, student: string) {
    return this.db.transaction(actor, ws, async (tx) => ({
      data: toDto(
        (
          await tx.query(
            "SELECT id,role,permissions,revoked_at,created_at FROM derslik.portal_links WHERE workspace_id=$1 AND student_id=$2 ORDER BY created_at DESC",
            [ws, student],
          )
        ).rows,
      ),
      invitations: toDto(
        (
          await tx.query(
            "SELECT id,email,role,expires_at,accepted_at,revoked_at FROM derslik.invitations WHERE workspace_id=$1 AND student_id=$2 ORDER BY created_at DESC",
            [ws, student],
          )
        ).rows,
      ),
    }));
  }
  revoke(
    actor: Actor,
    ws: string,
    student: string,
    key: string,
    input: unknown,
  ) {
    const c = z
      .object({ id: z.string().uuid(), kind: z.enum(["link", "invitation"]) })
      .parse(input);
    return this.commands.run(
      actor,
      ws,
      key,
      { action: "access.revoke", studentId: student, ...c },
      async (tx) => {
        await lockStudent(tx, ws, student);
        const table = c.kind === "link" ? "portal_links" : "invitations";
        const data = (
          await tx.query(
            `UPDATE derslik.${table} SET revoked_at=COALESCE(revoked_at,now()) WHERE workspace_id=$1 AND student_id=$2 AND id=$3 RETURNING id,revoked_at`,
            [ws, student, c.id],
          )
        ).rows[0];
        if (!data) throw new ConflictException("api.accessNotFound");
        return { data };
      },
    );
  }
  limits(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      await tx.query(
        "INSERT INTO derslik.workspace_limits(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
        [ws],
      );
      const limits = (
        await tx.query(
          "SELECT * FROM derslik.workspace_limits WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0];
      const used = (
        await tx.query(
          `SELECT
   (SELECT count(*) FROM derslik.students WHERE workspace_id=$1 AND active) AS students,
   (SELECT COALESCE(sum(COALESCE(duration_seconds,reserved_seconds)),0) FROM derslik.videos WHERE workspace_id=$1 AND status NOT IN ('FAILED','DELETED')) AS video_seconds,
   (SELECT COALESCE(sum(size_bytes),0) FROM derslik.materials WHERE workspace_id=$1 AND status<>'DELETED') AS material_bytes`,
          [ws],
        )
      ).rows[0];
      return {
        data: toDto({
          limits,
          used,
          capabilities: {
            videoUploads: this.providers.videosConfigured(),
            attachments: this.providers.attachmentsConfigured(),
          },
        }),
      };
    });
  }
  async inbox(actor: Actor, authorization?: string) {
    const { contact, data } = await this.db.transaction(
      actor,
      null,
      async (tx) => {
        // Süresi dolan ders istekleri önce kapanır; öğrencinin bildirimi hemen düşer.
        await tx.query("SELECT derslik.expire_requests()");
        // Ders hatırlatması e-postası uygulamada seçili dilde yazılır. Web ve
        // mobil zil sayacı için bildirimleri her açılışta okur.
        const contact = (
          await tx.query(
            `WITH changed AS (
               UPDATE derslik.users SET locale=$2 WHERE id=$1 AND locale<>$2
             )
             SELECT email, EXISTS(SELECT 1 FROM derslik.portal_links WHERE user_id=$1 AND revoked_at IS NULL) AS linked
             FROM derslik.users WHERE id=$1`,
            [actor.id, currentLocale()],
          )
        ).rows[0] as { email: string; linked: boolean } | undefined;
        return {
          contact,
          data: toDto(
            (
              await tx.query(
                "SELECT id,workspace_id,student_id,title,body,kind,target_id,read_at,created_at FROM derslik.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
                [actor.id],
              )
            ).rows,
          ),
        };
      },
    );
    // Hatırlatma e-postası yalnızca öğrenci ve velilere gider. Adres Auth'tan,
    // yalnızca onaylıysa alınır (JWT'deki email onaysız olabilir); oturumdaki
    // adres kayıtlıyla aynıysa Auth'a hiç sorulmaz.
    if (contact?.linked && actor.email && actor.email !== contact.email)
      await this.rememberEmail(actor, authorization).catch(() => undefined);
    return { data };
  }
  private async rememberEmail(actor: Actor, authorization?: string) {
    const email = await confirmedEmail(this.config, authorization, actor.id);
    if (!email) return;
    await this.db.transaction(actor, null, (tx) =>
      tx.query("UPDATE derslik.users SET email=$2 WHERE id=$1", [
        actor.id,
        email,
      ]),
    );
  }
  readNotification(actor: Actor, id: string) {
    return this.db.transaction(actor, null, async (tx) => ({
      data: toDto(
        (
          await tx.query(
            "UPDATE derslik.notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at",
            [z.string().uuid().parse(id), actor.id],
          )
        ).rows[0] || null,
      ),
    }));
  }
}

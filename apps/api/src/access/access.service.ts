import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService, toDto } from "../common/command.service.js";
import { MediaProviders } from "../media/providers.js";
import { MailService } from "./mail.js";
import { lockStudent } from "../students/students.service.js";

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
        await tx.query("SELECT set_config('app.workspace_id',$1,true)", [
          l.workspace_id,
        ]);
        const row = (
          await tx.query(
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
          .refine((v) => v.includes("lessons"), "Ders erişimi gerekli."),
      })
      .strict()
      .parse(input);
    let studentName = "";
    const result = await this.commands.run(
      actor,
      ws,
      key,
      { action: "invitation.create", studentId: student, ...c },
      async (tx) => {
        studentName = (await lockStudent(tx, ws, student, true)).name;
        const token = randomBytes(32).toString("hex"),
          hash = createHash("sha256").update(token).digest("hex");
        const invite = (
          await tx.query(
            "INSERT INTO derslik.invitations(workspace_id,student_id,email,role,permissions,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING id,email,role,expires_at",
            [ws, student, c.email, c.role, [...new Set(c.permissions)], hash],
          )
        ).rows[0];
        return {
          data: {
            ...invite,
            url: new URL(`/invite/${token}`, this.config.WEB_ORIGIN).href,
          },
          audit: { role: c.role, studentId: student },
        };
      },
    );
    // Gönderim commit'ten sonra: sağlayıcı hata verirse davet yine de durur ve
    // öğretmen bağlantıyı kopyalayarak iletebilir. Aynı anahtarla tekrar
    // gelen istek (replayed) ikinci bir e-posta doğurmaz.
    if (result.replayed) return result;
    const emailed = await this.mail.sendInvite({
      to: c.email,
      url: result.data.url as string,
      studentName,
      role: c.role,
    });
    return { ...result, data: { ...result.data, emailed } };
  }
  async accept(actor: Actor, authorization: string, input: unknown) {
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    // Confirm the bound email with Auth; a token's unconfirmed email alone is insufficient.
    const response = await fetch(this.config.AUTH_ISSUER + "/user", {
      headers: {
        Authorization: authorization,
        ...(this.config.SUPABASE_PUBLISHABLE_KEY
          ? { apikey: this.config.SUPABASE_PUBLISHABLE_KEY }
          : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new UnauthorizedException("Oturumunuzu yenileyin.");
    const user = (await response.json()) as {
      id?: string;
      email?: string;
      email_confirmed_at?: string;
    };
    if (user.id !== actor.id || !user.email_confirmed_at || !user.email)
      throw new ForbiddenException(
        "Daveti kabul etmek için e-posta adresinizi doğrulayın.",
      );
    const hash = createHash("sha256").update(token).digest("hex");
    return this.db.transaction(actor, null, async (tx) => ({
      data: (
        await tx.query("SELECT derslik.accept_invitation($1,$2) AS data", [
          hash,
          user.email!.toLowerCase(),
        ])
      ).rows[0].data,
    }));
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
        if (!data) throw new ConflictException("Erişim kaydı bulunamadı.");
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
  inbox(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => ({
      data: toDto(
        (
          await tx.query(
            "SELECT id,workspace_id,student_id,title,body,read_at,created_at FROM derslik.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
            [actor.id],
          )
        ).rows,
      ),
    }));
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

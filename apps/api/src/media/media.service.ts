import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { CONFIG, type ApiConfig } from "../config.js";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService } from "../common/command.service.js";
import { lockStudent } from "../students/students.service.js";
import { notify } from "../learning/learning.service.js";
import { MediaProviders } from "./providers.js";

const uuid = z.string().uuid();
const uploadSchema = z
  .object({
    assignmentId: uuid.nullable().default(null),
    purpose: z.enum(["ASSIGNMENT", "SUBMISSION", "RESOURCE"]),
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((v) => !/[\x00-\x1f]/.test(v)),
    mimeType: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict()
  .refine((v) => v.purpose === "RESOURCE" || v.assignmentId !== null, {
    message: "Ödev veya teslim dosyası için ödev seçin.",
    path: ["assignmentId"],
  });
const videoSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    lessonId: uuid.nullable().default(null),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 ** 3),
    maxDurationSeconds: z.number().int().min(1).max(7200),
  })
  .strict();

@Injectable()
export class MediaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
    private readonly providers: MediaProviders,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}
  private access<T>(
    actor: Actor,
    ws: string,
    student: string,
    permission: string,
    fn: (tx: PoolClient) => Promise<T>,
    write = false,
  ) {
    return this.db.portalTransaction(actor, ws, student, permission, fn, write);
  }
  async reserveFile(
    actor: Actor,
    ws: string,
    student: string,
    key: string,
    input: unknown,
  ) {
    const c = uploadSchema.parse(input);
    this.providers.storageReady();
    const result = await this.commands.run(
      actor,
      ws,
      key,
      { action: "material.reserve", studentId: student, ...c },
      async (tx) => {
        const owner = (
          await tx.query("SELECT derslik.is_owner($1) AS yes", [ws])
        ).rows[0].yes;
        if (!owner && c.purpose !== "SUBMISSION")
          throw new ForbiddenException(
            "Öğrenci yalnızca ödev teslimi ekleyebilir.",
          );
        if (owner) await lockStudent(tx, ws, student, true);
        if (c.assignmentId)
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [ws + ":" + c.assignmentId],
          );
        const assignment =
          c.assignmentId &&
          (
            await tx.query(
              "SELECT id,status FROM derslik.assignments WHERE workspace_id=$1 AND student_id=$2 AND id=$3",
              [ws, student, c.assignmentId],
            )
          ).rows[0];
        if (c.assignmentId && !assignment)
          throw new NotFoundException("Ödev bulunamadı.");
        if (!owner && assignment?.status !== "OPEN")
          throw new ConflictException("Bu ödev teslimlere kapalı.");
        await tx.query("SELECT derslik.expire_subscription($1)", [ws]);
        await tx.query("SELECT derslik.reserve_material_quota($1,$2,$3)", [
          ws,
          student,
          c.sizeBytes,
        ]);
        const id = randomUUID(),
          objectKey = `${ws}/${student}/${id}`;
        await tx.query(
          "INSERT INTO derslik.materials(id,workspace_id,student_id,assignment_id,user_id,purpose,name,mime_type,size_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            ws,
            student,
            c.assignmentId,
            actor.id,
            c.purpose,
            c.name,
            c.mimeType,
            c.sizeBytes,
            objectKey,
          ],
        );
        return { data: { id } };
      },
      { studentId: student, permission: "assignments", write: true },
    );
    const file = await this.file(actor, ws, student, result.data.id, true);
    if (file.status !== "PENDING")
      return { data: { id: file.id, status: file.status } };
    return {
      data: {
        id: file.id,
        status: file.status,
        uploadUrl: await this.providers.uploadFileUrl(file.object_key),
        mimeType: file.mime_type,
      },
    };
  }
  private async file(
    actor: Actor,
    ws: string,
    student: string,
    id: string,
    write = false,
  ) {
    return this.access(
      actor,
      ws,
      student,
      "assignments",
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT *,derslik.is_owner($1) AS owner FROM derslik.materials WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND status<>'DELETED' AND NOT delete_requested",
            [ws, student, uuid.parse(id)],
          )
        ).rows[0];
        if (!row) throw new NotFoundException("Dosya bulunamadı.");
        if (write && !row.owner && row.user_id !== actor.id)
          throw new ForbiddenException("Bu dosyayı değiştiremezsiniz.");
        return row;
      },
      write,
    );
  }
  async finishFile(actor: Actor, ws: string, student: string, id: string) {
    const file = await this.file(actor, ws, student, id, true);
    if (file.status === "READY") return { data: { id, status: "READY" } };
    const info = await this.providers.fileInfo(file.object_key);
    const size = Number(info.size ?? info.metadata?.size),
      mime = info.content_type ?? info.metadata?.mimetype;
    if (size !== Number(file.size_bytes) || mime !== file.mime_type)
      throw new BadRequestException(
        "Dosya boyutu veya türü bildirilen değerle eşleşmiyor.",
      );
    const bytes = await this.providers.fileSignature(file.object_key);
    const signatures: Record<string, boolean> = {
      "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
      "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/png": bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/webp":
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP",
    };
    if (!signatures[file.mime_type])
      throw new BadRequestException("Dosya içeriği seçilen türle eşleşmiyor.");
    return this.access(
      actor,
      ws,
      student,
      "assignments",
      async (tx) => {
        const data = (
          await tx.query(
            "UPDATE derslik.materials SET status='READY' WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND status='PENDING' AND NOT delete_requested RETURNING id,status",
            [ws, student, id],
          )
        ).rows[0];
        if (!data)
          throw new ConflictException("Dosya durumu değişti. Yenileyin.");
        return { data };
      },
      true,
    );
  }
  async downloadFile(
    actor: Actor,
    ws: string,
    student: string,
    id: string,
    inline = false,
  ) {
    const f = await this.file(actor, ws, student, id);
    if (f.status !== "READY")
      throw new ConflictException("Dosya henüz hazır değil.");
    return {
      data: {
        url: await this.providers.downloadFileUrl(f.object_key, inline),
        expiresIn: 120,
        name: f.name,
      },
    };
  }
  async deleteFile(actor: Actor, ws: string, student: string, id: string) {
    // Hide immediately; release quota only after the object deletion succeeds.
    // A provider outage leaves a retryable record, never a working download.
    const file = await this.access(
      actor,
      ws,
      student,
      "assignments",
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT *,derslik.is_owner($1) AS owner FROM derslik.materials WHERE workspace_id=$1 AND student_id=$2 AND id=$3 FOR UPDATE",
            [ws, student, uuid.parse(id)],
          )
        ).rows[0];
        if (!row) throw new NotFoundException("Dosya bulunamadı.");
        if (!row.owner && row.user_id !== actor.id)
          throw new ForbiddenException("Bu dosyayı değiştiremezsiniz.");
        await tx.query(
          "UPDATE derslik.materials SET delete_requested=true WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        );
        return row;
      },
      true,
    );
    if (file.status !== "DELETED")
      await this.providers.deleteFile(file.object_key);
    return this.access(
      actor,
      ws,
      student,
      "assignments",
      async (tx) => ({
        data: (
          await tx.query(
            "UPDATE derslik.materials SET status='DELETED' WHERE workspace_id=$1 AND student_id=$2 AND id=$3 RETURNING id,status",
            [ws, student, id],
          )
        ).rows[0],
      }),
      true,
    );
  }
  async reserveVideo(
    actor: Actor,
    ws: string,
    student: string,
    key: string,
    input: unknown,
  ) {
    const c = videoSchema.parse(input);
    this.providers.streamReady();
    const result = await this.commands.run(
      actor,
      ws,
      key,
      { action: "video.reserve", studentId: student, ...c },
      async (tx) => {
        await lockStudent(tx, ws, student, true);
        if (
          c.lessonId &&
          !(
            await tx.query(
              "SELECT id FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 AND id=$3",
              [ws, student, c.lessonId],
            )
          ).rowCount
        )
          throw new NotFoundException("Ders bulunamadı.");
        await tx.query(
          "INSERT INTO derslik.workspace_limits(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
          [ws],
        );
        const limit = (
          await tx.query(
            "SELECT video_seconds FROM derslik.workspace_limits WHERE workspace_id=$1 FOR UPDATE",
            [ws],
          )
        ).rows[0].video_seconds;
        const used = Number(
          (
            await tx.query(
              "SELECT COALESCE(sum(COALESCE(duration_seconds,reserved_seconds)),0) AS n FROM derslik.videos WHERE workspace_id=$1 AND status NOT IN ('FAILED','DELETED')",
              [ws],
            )
          ).rows[0].n,
        );
        if (used + c.maxDurationSeconds > limit)
          throw new ConflictException(
            "Video depolama sınırı dolu. Eski videoları silerek yer açın.",
          );
        const video = (
          await tx.query(
            "INSERT INTO derslik.videos(workspace_id,student_id,lesson_id,title,reserved_seconds,size_bytes,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour') RETURNING id",
            [
              ws,
              student,
              c.lessonId,
              c.title,
              c.maxDurationSeconds,
              c.sizeBytes,
            ],
          )
        ).rows[0];
        return { data: video };
      },
    );
    const claimed = await this.db.transaction(
      actor,
      ws,
      async (tx) =>
        (
          await tx.query(
            "UPDATE derslik.videos SET status='UPLOADING',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='RESERVED' AND NOT delete_requested RETURNING *",
            [ws, result.data.id],
          )
        ).rows[0],
    );
    if (claimed) {
      // The reservation commits before calling Stream. Ambiguous failures retain quota
      // and cannot create a second provider upload by replaying the same command.
      const meta = `maxDurationSeconds ${Buffer.from(String(claimed.reserved_seconds)).toString("base64")},requiresignedurls,expiry ${Buffer.from(claimed.upload_expires_at.toISOString()).toString("base64")},name ${Buffer.from(claimed.id).toString("base64")}`;
      const r = await this.providers.stream("?direct_user=true", {
        method: "POST",
        headers: {
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(claimed.size_bytes),
          "Upload-Metadata": meta,
        },
      });
      const upload = r.headers.get("location"),
        uid = r.headers.get("stream-media-id");
      if (!upload || !uid || !/^[a-f0-9]{32}$/.test(uid))
        throw new ServiceUnavailableException(
          "Video bağlantısı hazırlanamadı. Kaydı iptal edip yeniden yükleyin.",
        );
      const url = new URL(upload);
      if (
        url.protocol !== "https:" ||
        !/(^|\.)videodelivery\.net$|(^|\.)cloudflarestream\.com$/.test(
          url.hostname,
        )
      )
        throw new ServiceUnavailableException("Video yükleme adresi geçersiz.");
      const stored = await this.db.transaction(
        actor,
        ws,
        async (tx) =>
          (
            await tx.query(
              "UPDATE derslik.videos SET provider_uid=$3,upload_url=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND NOT delete_requested RETURNING id",
              [ws, claimed.id, uid, upload],
            )
          ).rowCount,
      );
      if (!stored) {
        await this.providers.stream("/" + uid, { method: "DELETE" });
        throw new ConflictException("Yükleme iptal edilmiş.");
      }
    }
    return this.db.transaction(actor, ws, async (tx) => {
      const v = (
        await tx.query(
          "SELECT id,status,upload_url,upload_expires_at FROM derslik.videos WHERE workspace_id=$1 AND id=$2 AND NOT delete_requested",
          [ws, result.data.id],
        )
      ).rows[0];
      if (!v?.upload_url)
        throw new ConflictException(
          "Yükleme bağlantısı hazırlanıyor veya kesintiye uğradı. Videolar listesinden kaydı iptal edebilirsiniz.",
        );
      if (v.upload_expires_at < new Date())
        throw new ConflictException(
          "Yükleme bağlantısının süresi doldu. Kaydı silip yeniden yükleyin.",
        );
      return {
        data: {
          id: v.id,
          status: v.status,
          uploadUrl: v.upload_url,
          expiresAt: v.upload_expires_at,
        },
      };
    });
  }
  async playback(actor: Actor, ws: string, student: string, id: string) {
    const v = await this.access(
      actor,
      ws,
      student,
      "videos",
      async (tx) =>
        (
          await tx.query(
            "SELECT provider_uid FROM derslik.videos WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND status='READY' AND NOT delete_requested",
            [ws, student, uuid.parse(id)],
          )
        ).rows[0],
    );
    if (!v?.provider_uid)
      throw new NotFoundException("İzlenebilir video bulunamadı.");
    const exp = Math.floor(Date.now() / 1000) + 300;
    const r = (await (
      await this.providers.stream(`/${v.provider_uid}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exp }),
      })
    ).json()) as { result: { token: string } };
    if (!r.result?.token || !/^[a-zA-Z0-9_.-]+$/.test(r.result.token))
      throw new ServiceUnavailableException(
        "İzleme bağlantısı oluşturulamadı.",
      );
    return {
      data: {
        url: `https://videodelivery.net/${r.result.token}/manifest/video.m3u8`,
        expiresAt: exp * 1000,
      },
    };
  }
  async deleteVideo(actor: Actor, ws: string, student: string, id: string) {
    const v = await this.db.transaction(
      actor,
      ws,
      async (tx) =>
        (
          await tx.query(
            "UPDATE derslik.videos SET delete_requested=true,updated_at=now() WHERE workspace_id=$1 AND student_id=$2 AND id=$3 RETURNING provider_uid,status",
            [ws, student, uuid.parse(id)],
          )
        ).rows[0],
    );
    if (!v) throw new NotFoundException("Video bulunamadı.");
    if (v.status !== "DELETED" && v.provider_uid)
      await this.providers.stream("/" + v.provider_uid, { method: "DELETE" });
    return this.db.transaction(actor, ws, async (tx) => ({
      data: (
        await tx.query(
          "UPDATE derslik.videos SET status='DELETED',upload_url=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id,status",
          [ws, id],
        )
      ).rows[0],
    }));
  }
  async refreshVideo(actor: Actor, ws: string, student: string, id: string) {
    const v = await this.db.transaction(
      actor,
      ws,
      async (tx) =>
        (
          await tx.query(
            "SELECT * FROM derslik.videos WHERE workspace_id=$1 AND student_id=$2 AND id=$3",
            [ws, student, uuid.parse(id)],
          )
        ).rows[0],
    );
    if (!v) throw new NotFoundException("Video bulunamadı.");
    if (v.delete_requested) return this.deleteVideo(actor, ws, student, id);
    if (!v.provider_uid) {
      if (v.upload_expires_at < new Date())
        return this.deleteVideo(actor, ws, student, id);
      return { data: { id, status: v.status } };
    }
    const data = (await (
      await this.providers.stream("/" + v.provider_uid)
    ).json()) as { result: unknown };
    await this.applyEvent(data.result);
    return { data: { id } };
  }
  async webhook(signature: string | undefined, raw: Buffer | undefined) {
    const secret = this.config.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
    if (!secret || !raw || !signature) throw new UnauthorizedException();
    const fields = Object.fromEntries(
      signature.split(",").map((x) => x.trim().split("=")),
    );
    if (
      !/^\d+$/.test(fields.time || "") ||
      Math.abs(Date.now() / 1000 - Number(fields.time)) > 300 ||
      !/^[a-f0-9]{64}$/.test(fields.sig1 || "")
    )
      throw new UnauthorizedException();
    const expected = createHmac("sha256", secret)
      .update(fields.time + ".")
      .update(raw)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(fields.sig1, "hex")))
      throw new UnauthorizedException();
    let event: unknown;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      throw new BadRequestException();
    }
    return this.applyEvent(event);
  }
  private async applyEvent(input: unknown) {
    const e = z
      .object({
        uid: z.string().regex(/^[a-f0-9]{32}$/),
        readyToStream: z.boolean().optional(),
        requireSignedURLs: z.boolean().optional(),
        duration: z.number().nonnegative().optional(),
        status: z.object({ state: z.string() }),
      })
      .passthrough()
      .parse(input);
    const mapping = (
      await this.db.pool.query("SELECT * FROM derslik.video_owner($1)", [e.uid])
    ).rows[0];
    if (!mapping) return { received: true };
    const hash = createHash("sha256").update(JSON.stringify(e)).digest("hex");
    return this.db.transaction(
      { id: mapping.owner_id },
      mapping.workspace_id,
      async (tx) => {
        const v = (
          await tx.query(
            "SELECT * FROM derslik.videos WHERE workspace_id=$1 AND provider_uid=$2 FOR UPDATE",
            [mapping.workspace_id, e.uid],
          )
        ).rows[0];
        if (!v || v.status === "DELETED" || v.delete_requested)
          return { received: true };
        if (
          !(
            await tx.query(
              "INSERT INTO derslik.webhook_events(workspace_id,event_hash,provider_uid) VALUES($1,$2,$3) ON CONFLICT(event_hash) DO NOTHING RETURNING id",
              [mapping.workspace_id, hash, e.uid],
            )
          ).rowCount
        )
          return { received: true };
        const ready =
          e.readyToStream &&
          e.status.state === "ready" &&
          e.requireSignedURLs === true &&
          Number(e.duration) > 0 &&
          Math.ceil(e.duration!) <= v.reserved_seconds;
        if (v.status === "READY") return { received: true };
        const next = ready
          ? "READY"
          : e.status.state === "error"
            ? "FAILED"
            : "PROCESSING";
        // A ready event without privacy protection is never made visible.
        await tx.query(
          "UPDATE derslik.videos SET status=$3,duration_seconds=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [
            mapping.workspace_id,
            v.id,
            next,
            ready ? Math.ceil(e.duration!) : null,
          ],
        );
        if (ready)
          await notify(tx, mapping.workspace_id, v.student_id, {
            title: "Ders videosu hazır",
            body: v.title,
            kind: "VIDEO",
            targetId: v.id,
          });
        return { received: true };
      },
    );
  }
}

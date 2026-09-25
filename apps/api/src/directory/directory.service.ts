import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { toDto } from "../common/command.service.js";
import { apiText } from "../common/i18n.js";
import {
  DECLINE_COOLDOWN_DAYS,
  PHOTO_MAX_BYTES,
  REQUESTS_PER_DAY,
  TEACHERS_PER_PAGE,
  lessonRequestSchema,
  photoSchema,
  reviewSchema,
  shortName,
  teacherFilterSchema,
  teacherProfileSchema,
} from "../../../../packages/contracts/src/directory.js";

const uuid = z.string().uuid();
const REQUEST_COLUMNS =
  "id,workspace_id,student_name,subject,level,phone,email,message,status,student_id,created_at,decided_at";
const PROFILE_COLUMNS =
  "display_name,headline,bio,subjects,levels,lesson_modes,city,hourly_price,currency,languages,experience_years,CASE WHEN photo IS NULL THEN NULL ELSE photo_version END AS photo_version,published,published_at";

/** numeric (ortalama puan) pg'den metin gelir; istemciye sayı gider. */
function teacherDto(row: Record<string, unknown>) {
  return toDto({
    ...row,
    rating_average:
      row.rating_average === null || row.rating_average === undefined
        ? null
        : Number(row.rating_average),
  }) as Record<string, unknown>;
}

const SORTS = {
  recommended:
    "(photo_version IS NOT NULL) DESC, rating_average DESC NULLS LAST, rating_count DESC, published_at DESC",
  price: "hourly_price ASC NULLS LAST, published_at DESC",
  rating:
    "rating_average DESC NULLS LAST, rating_count DESC, published_at DESC",
  new: "published_at DESC",
} as const;

/** Dosyanın ilk baytları bildirilen türle eşleşmeli. */
function imageMatches(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

@Injectable()
export class DirectoryService {
  constructor(private readonly db: DatabaseService) {}

  // --- Herkese açık vitrin ---------------------------------------------

  list(query: unknown) {
    const f = teacherFilterSchema.parse(query);
    const where: string[] = [],
      values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replaceAll("$?", "$" + values.length));
    };
    if (f.q)
      add(
        "(display_name ILIKE $? OR headline ILIKE $? OR bio ILIKE $?)",
        "%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%",
      );
    if (f.subject) add("$? = ANY(subjects)", f.subject);
    if (f.level) add("$? = ANY(levels)", f.level);
    if (f.mode) add("$? = ANY(lesson_modes)", f.mode);
    if (f.city) add("lower(city) = lower($?)", f.city.normalize("NFC"));
    if (f.maxPrice !== undefined)
      add("hourly_price IS NOT NULL AND hourly_price <= $?", f.maxPrice);
    const filter = where.length ? "WHERE " + where.join(" AND ") : "";
    return this.db.publicQuery(async (tx) => {
      const total = Number(
        (
          await tx.query(
            `SELECT count(*) AS n FROM derslik.public_teachers() ${filter}`,
            values,
          )
        ).rows[0].n,
      );
      const rows = (
        await tx.query(
          `SELECT * FROM derslik.public_teachers() ${filter} ORDER BY ${SORTS[f.sort]} LIMIT ${TEACHERS_PER_PAGE} OFFSET ${(f.page - 1) * TEACHERS_PER_PAGE}`,
          values,
        )
      ).rows;
      const cities = (
        await tx.query(
          "SELECT DISTINCT city FROM derslik.public_teachers() WHERE city<>'' AND 'IN_PERSON'=ANY(lesson_modes) ORDER BY city LIMIT 200",
        )
      ).rows.map((r) => r.city as string);
      return {
        data: rows.map(teacherDto),
        total,
        page: f.page,
        perPage: TEACHERS_PER_PAGE,
        cities,
      };
    });
  }

  get(id: string) {
    const ws = uuid.parse(id);
    return this.db.publicQuery(async (tx) => {
      const row = (
        await tx.query("SELECT * FROM derslik.public_teachers() WHERE id=$1", [
          ws,
        ])
      ).rows[0];
      if (!row) throw new NotFoundException("api.teacherNotFound");
      const reviews = (
        await tx.query("SELECT * FROM derslik.public_reviews($1)", [ws])
      ).rows;
      return { data: teacherDto(row), reviews: toDto(reviews) };
    });
  }

  async photo(actor: Actor | null, id: string) {
    const ws = uuid.parse(id);
    const read = async (tx: PoolClient) =>
      (await tx.query("SELECT * FROM derslik.public_photo($1)", [ws])).rows[0];
    const row = actor
      ? await this.db.transaction(actor, null, read)
      : await this.db.publicQuery(read);
    if (!row) throw new NotFoundException("api.photoNotFound");
    return {
      bytes: row.photo as Buffer,
      type: row.photo_type as string,
      version: row.photo_version as number,
    };
  }

  // --- Öğrenci -----------------------------------------------------------

  relation(actor: Actor, id: string) {
    const ws = uuid.parse(id);
    return this.db.transaction(actor, null, async (tx) => {
      const flags = (
        await tx.query(
          `SELECT EXISTS(SELECT 1 FROM derslik.workspaces WHERE id=$1 AND owner_id=$2) AS own,
            derslik.is_linked_student($1) AS student,
            derslik.review_author($1) IS NOT NULL AS can_review`,
          [ws, actor.id],
        )
      ).rows[0];
      const request = (
        await tx.query(
          `SELECT ${REQUEST_COLUMNS} FROM derslik.lesson_requests WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`,
          [ws, actor.id],
        )
      ).rows[0];
      const review = (
        await tx.query(
          "SELECT id,rating,comment,author_name,created_at,updated_at FROM derslik.teacher_reviews WHERE workspace_id=$1 AND user_id=$2",
          [ws, actor.id],
        )
      ).rows[0];
      const retryAfter =
        request?.status === "DECLINED" && request.decided_at
          ? new Date(
              request.decided_at.getTime() + DECLINE_COOLDOWN_DAYS * 86_400_000,
            )
          : null;
      return {
        data: toDto({
          is_own: flags.own,
          is_student: flags.student,
          can_review: flags.can_review,
          request: request ?? null,
          review: review ?? null,
          retry_after:
            retryAfter && retryAfter > new Date() ? retryAfter : null,
        }),
      };
    });
  }

  sendRequest(actor: Actor, id: string, input: unknown) {
    const ws = uuid.parse(id);
    const c = lessonRequestSchema.parse(input);
    return this.db.transaction(actor, null, async (tx) => {
      await tx.query(
        "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT (id) DO NOTHING",
        [actor.id],
      );
      // Aynı kişinin eşzamanlı iki isteği aynı sıraya girer; sayım doğru kalır.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "request:" + actor.id,
      ]);
      const state = (
        await tx.query(
          `SELECT derslik.is_listed($1) AS listed,
            EXISTS(SELECT 1 FROM derslik.workspaces WHERE id=$1 AND owner_id=$2) AS own,
            derslik.is_linked_student($1) AS student,
            EXISTS(SELECT 1 FROM derslik.lesson_requests WHERE workspace_id=$1 AND user_id=$2 AND status='PENDING') AS pending,
            EXISTS(SELECT 1 FROM derslik.lesson_requests WHERE workspace_id=$1 AND user_id=$2 AND status='DECLINED'
              AND decided_at > now() - make_interval(days => $3)) AS cooling,
            (SELECT count(*) FROM derslik.lesson_requests WHERE user_id=$2 AND created_at > now() - interval '1 day')::int AS today`,
          [ws, actor.id, DECLINE_COOLDOWN_DAYS],
        )
      ).rows[0];
      if (!state.listed) throw new NotFoundException("api.teacherNotFound");
      if (state.own) throw new ConflictException("api.requestOwn");
      if (state.student)
        throw new ConflictException("api.requestAlreadyStudent");
      if (state.pending) throw new ConflictException("api.requestPending");
      if (state.cooling) throw new ConflictException("api.requestCooldown");
      if (state.today >= REQUESTS_PER_DAY)
        throw new HttpException(
          "api.requestDailyLimit",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      const row = (
        await tx.query(
          `INSERT INTO derslik.lesson_requests(workspace_id,user_id,student_name,subject,level,phone,email,message)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REQUEST_COLUMNS}`,
          [
            ws,
            actor.id,
            c.studentName,
            c.subject,
            c.level,
            c.phone,
            actor.email ?? "",
            c.message,
          ],
        )
      ).rows[0];
      await tx.query("SELECT derslik.request_notice($1,$2,$3)", [
        row.id,
        "notice.requestNew",
        c.studentName,
      ]);
      return { data: toDto(row) };
    });
  }

  myRequests(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => {
      const rows = (
        await tx.query(
          `SELECT ${REQUEST_COLUMNS.split(",")
            .map((c) => "q." + c)
            .join(
              ",",
            )},t.display_name AS teacher_name,t.photo_version AS teacher_photo_version
           FROM derslik.lesson_requests q CROSS JOIN LATERAL derslik.request_teacher(q.workspace_id) t
           WHERE q.user_id=$1 ORDER BY q.created_at DESC LIMIT 100`,
          [actor.id],
        )
      ).rows;
      return { data: toDto(rows) };
    });
  }

  cancelRequest(actor: Actor, id: string) {
    return this.db.transaction(actor, null, async (tx) => {
      const row = (
        await tx.query(
          `UPDATE derslik.lesson_requests SET status='CANCELLED',decided_at=now()
           WHERE id=$1 AND user_id=$2 AND status='PENDING' RETURNING ${REQUEST_COLUMNS}`,
          [uuid.parse(id), actor.id],
        )
      ).rows[0];
      if (!row) throw new ConflictException("api.requestDecided");
      return { data: toDto(row) };
    });
  }

  saveReview(actor: Actor, id: string, input: unknown) {
    const ws = uuid.parse(id);
    const c = reviewSchema.parse(input);
    return this.db.transaction(actor, null, async (tx) => {
      const author = (
        await tx.query("SELECT derslik.review_author($1) AS name", [ws])
      ).rows[0].name as string | null;
      if (!author) throw new ForbiddenException("api.reviewNotAllowed");
      const row = (
        await tx.query(
          `INSERT INTO derslik.teacher_reviews(workspace_id,user_id,author_name,rating,comment)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(workspace_id,user_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,
             author_name=EXCLUDED.author_name,updated_at=now()
           RETURNING id,rating,comment,author_name,created_at,updated_at`,
          [ws, actor.id, shortName(author), c.rating, c.comment],
        )
      ).rows[0];
      return { data: toDto(row) };
    });
  }

  deleteReview(actor: Actor, id: string) {
    return this.db.transaction(actor, null, async (tx) => {
      const row = (
        await tx.query(
          "DELETE FROM derslik.teacher_reviews WHERE workspace_id=$1 AND user_id=$2 RETURNING id",
          [uuid.parse(id), actor.id],
        )
      ).rows[0];
      return { data: toDto(row ?? null) };
    });
  }

  // --- Öğretmen ----------------------------------------------------------

  showcase(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      const profile = (
        await tx.query(
          `SELECT ${PROFILE_COLUMNS} FROM derslik.teacher_profiles WHERE workspace_id=$1`,
          [ws],
        )
      ).rows[0];
      const requests = (
        await tx.query(
          `SELECT ${REQUEST_COLUMNS} FROM derslik.lesson_requests WHERE workspace_id=$1
           ORDER BY status='PENDING' DESC, created_at DESC LIMIT 200`,
          [ws],
        )
      ).rows;
      const reviews = (
        await tx.query(
          "SELECT id,rating,comment,author_name,created_at,updated_at FROM derslik.teacher_reviews WHERE workspace_id=$1 ORDER BY updated_at DESC",
          [ws],
        )
      ).rows;
      const ratingCount = reviews.length;
      return {
        data: toDto({
          profile: profile ?? null,
          requests,
          reviews,
          rating_average: ratingCount
            ? Math.round(
                (reviews.reduce((sum, r) => sum + r.rating, 0) / ratingCount) *
                  10,
              ) / 10
            : null,
          rating_count: ratingCount,
        }),
      };
    });
  }

  saveProfile(actor: Actor, ws: string, input: unknown) {
    const c = teacherProfileSchema.parse(input);
    return this.db.transaction(actor, ws, async (tx) => {
      const row = (
        await tx.query(
          `INSERT INTO derslik.teacher_profiles(workspace_id,display_name,headline,bio,subjects,levels,lesson_modes,city,
             hourly_price,currency,languages,experience_years,published,published_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13 THEN now() END)
           ON CONFLICT(workspace_id) DO UPDATE SET display_name=EXCLUDED.display_name,headline=EXCLUDED.headline,bio=EXCLUDED.bio,
             subjects=EXCLUDED.subjects,levels=EXCLUDED.levels,lesson_modes=EXCLUDED.lesson_modes,city=EXCLUDED.city,
             hourly_price=EXCLUDED.hourly_price,currency=EXCLUDED.currency,languages=EXCLUDED.languages,
             experience_years=EXCLUDED.experience_years,published=EXCLUDED.published,
             published_at=CASE WHEN EXCLUDED.published THEN COALESCE(teacher_profiles.published_at,now()) END,
             updated_at=now()
           RETURNING ${PROFILE_COLUMNS}`,
          [
            ws,
            c.displayName,
            c.headline,
            c.bio,
            c.subjects,
            c.levels,
            c.lessonModes,
            c.lessonModes.includes("IN_PERSON") ? c.city : "",
            c.hourlyPrice,
            c.currency,
            c.languages,
            c.experienceYears,
            c.published,
          ],
        )
      ).rows[0];
      await this.audit(tx, ws, actor, "showcase.save", ws, {
        published: c.published,
      });
      return { data: toDto(row) };
    });
  }

  savePhoto(actor: Actor, ws: string, input: unknown) {
    const c = photoSchema.parse(input);
    const bytes = Buffer.from(c.data, "base64");
    if (!bytes.length || bytes.length > PHOTO_MAX_BYTES)
      throw new BadRequestException("api.photoTooLarge");
    if (!imageMatches(bytes, c.mimeType))
      throw new BadRequestException("api.fileContentMismatch");
    return this.db.transaction(actor, ws, async (tx) => {
      const row = (
        await tx.query(
          `UPDATE derslik.teacher_profiles SET photo=$2,photo_type=$3,photo_version=photo_version+1,updated_at=now()
           WHERE workspace_id=$1 RETURNING photo_version`,
          [ws, bytes, c.mimeType],
        )
      ).rows[0];
      if (!row) throw new ConflictException("api.profileFirst");
      return { data: toDto(row) };
    });
  }

  deletePhoto(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      await tx.query(
        "UPDATE derslik.teacher_profiles SET photo=NULL,photo_type=NULL,updated_at=now() WHERE workspace_id=$1",
        [ws],
      );
      return { data: { photoVersion: null } };
    });
  }

  decide(actor: Actor, ws: string, id: string, decision: "accept" | "decline") {
    const request = uuid.parse(id);
    return this.db.transaction(actor, ws, async (tx) => {
      const row = (
        await tx.query(
          `SELECT ${REQUEST_COLUMNS} FROM derslik.lesson_requests WHERE workspace_id=$1 AND id=$2`,
          [ws, request],
        )
      ).rows[0];
      if (!row) throw new NotFoundException("api.requestNotFound");
      if (row.status !== "PENDING")
        throw new ConflictException("api.requestDecided");
      let result: Record<string, unknown>;
      if (decision === "accept") {
        const label = /^[a-z]+$/.test(row.subject)
          ? apiText(`dir.subject.${row.subject}` as never)
          : row.subject;
        try {
          // Aynı işlem içindeki hata tüm işlemi geri alır; savepoint gerekmez.
          result = (
            await tx.query(
              "SELECT derslik.accept_lesson_request($1,$2) AS data",
              [request, label],
            )
          ).rows[0].data;
        } catch (error) {
          const hint = (error as { hint?: string }).hint;
          if (hint === "limit")
            throw new ConflictException("api.studentLimitReached");
          if (hint === "decided")
            throw new ConflictException("api.requestDecided");
          throw error;
        }
      } else {
        const declined = (
          await tx.query(
            `UPDATE derslik.lesson_requests SET status='DECLINED',decided_at=now()
             WHERE workspace_id=$1 AND id=$2 AND status='PENDING' RETURNING id`,
            [ws, request],
          )
        ).rows[0];
        if (!declined) throw new ConflictException("api.requestDecided");
        result = { id: request };
      }
      const teacher = (
        await tx.query(
          "SELECT COALESCE(p.display_name,w.name) AS name FROM derslik.workspaces w LEFT JOIN derslik.teacher_profiles p ON p.workspace_id=w.id WHERE w.id=$1",
          [ws],
        )
      ).rows[0].name;
      await tx.query("SELECT derslik.request_notice($1,$2,$3)", [
        request,
        decision === "accept"
          ? "notice.requestAccepted"
          : "notice.requestDeclined",
        teacher,
      ]);
      await this.audit(tx, ws, actor, `request.${decision}`, request, {
        studentId: result.studentId ?? null,
      });
      const updated = (
        await tx.query(
          `SELECT ${REQUEST_COLUMNS} FROM derslik.lesson_requests WHERE workspace_id=$1 AND id=$2`,
          [ws, request],
        )
      ).rows[0];
      return { data: toDto(updated) };
    });
  }

  private async audit(
    tx: PoolClient,
    ws: string,
    actor: Actor,
    action: string,
    resource: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.query(
      "INSERT INTO derslik.audit_events (workspace_id,actor_id,action,resource_id,metadata) VALUES ($1,$2,$3,$4,$5)",
      [ws, actor.id, action, resource, JSON.stringify(metadata)],
    );
  }
}

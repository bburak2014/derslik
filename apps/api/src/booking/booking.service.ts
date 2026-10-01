import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService, toDto } from "../common/command.service.js";
import { RateLimiter } from "../common/rate-limit.js";
import { ISTANBUL_TODAY } from "../learning/learning.service.js";
import { istanbulDay } from "../lessons/lessons.service.js";
import {
  bookLessonSchema,
  bookingSettingsSchema,
  cancelBookingSchema,
  defaultBookingSettings,
  minutesOf,
  timeOf,
  type BookingSettings,
} from "../../../../packages/contracts/src/booking.js";

/** Veritabanı fonksiyonlarının (book_lesson, cancel_booking) HINT değerleri
 *  ve karşılıkları olan çeviri anahtarlı HTTP hataları. */
const BOOKING_ERRORS: Record<string, () => Error> = {
  archived: () => new ConflictException("api.studentArchived"),
  disabled: () => new ConflictException("api.bookingDisabled"),
  slot: () => new ConflictException("api.bookingSlotTaken"),
  credits: () => new ConflictException("api.bookingNoCredits"),
  notFound: () => new NotFoundException("api.lessonNotFound"),
  notBooked: () => new ConflictException("api.bookingNotYours"),
  state: () => new ConflictException("api.lessonStateInvalid"),
  changed: () => new ConflictException("api.lessonChanged"),
  deadline: () => new ConflictException("api.bookingCancelClosed"),
};
function bookingError(error: unknown) {
  const { code, hint } = error as { code?: string; hint?: string };
  if (code === "42501") return new ForbiddenException("api.noStudentAccess");
  // Son güvence (teacher_calendar_no_overlap); takvim kilidi varken beklenmez.
  if (code === "23P01") return new ConflictException("api.bookingSlotTaken");
  const known = code === "P0001" && hint ? BOOKING_ERRORS[hint] : undefined;
  return known ? known() : error;
}

/** Öğretmenin ayarları; hiç kaydedilmemişse varsayılanlar (sürüm 0).
 *  Bitişi geçmiş kapalı günler gelmez. */
async function readSettings(
  tx: PoolClient,
  ws: string,
): Promise<BookingSettings> {
  const row = (
    await tx.query(
      "SELECT enabled,duration_minutes,notice_hours,cancel_hours,location,version FROM derslik.booking_settings WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0];
  if (!row) return defaultBookingSettings();
  const windows = (
    await tx.query(
      "SELECT weekday,start_minute,end_minute FROM derslik.availability_windows WHERE workspace_id=$1 ORDER BY weekday,start_minute",
      [ws],
    )
  ).rows;
  const blocks = (
    await tx.query(
      `SELECT starts_on,ends_on FROM derslik.availability_blocks WHERE workspace_id=$1 AND ends_on>=${ISTANBUL_TODAY} ORDER BY starts_on,ends_on`,
      [ws],
    )
  ).rows;
  return {
    enabled: row.enabled,
    durationMinutes: row.duration_minutes,
    noticeHours: row.notice_hours,
    cancelHours: row.cancel_hours,
    location: row.location,
    windows: windows.map((w) => ({
      weekday: w.weekday,
      start: timeOf(w.start_minute),
      end: timeOf(w.end_minute),
    })),
    blocks: blocks.map((b) => ({ from: b.starts_on, to: b.ends_on })),
    version: row.version,
  };
}

/** Boş saatler yalnızca öğrencinin kendi hesabına açılır; veli ve öğretmen
 *  portal kontrolünden geçse de burada durur. */
async function assertBookingStudent(
  tx: PoolClient,
  ws: string,
  student: string,
) {
  const allowed = (
    await tx.query("SELECT derslik.booking_student($1,$2) AS ok", [
      ws,
      student,
    ])
  ).rows[0].ok;
  if (!allowed) throw new ForbiddenException("api.noStudentAccess");
}

@Injectable()
export class BookingService {
  // Ders ayarlama ve iptal: kullanıcı başına dakikada 10 istek. Ayarla-iptal
  // döngüsü öğretmenin gelen kutusunu dolduramaz.
  private readonly limiter = new RateLimiter(10);

  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
  ) {}

  settings(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => ({
      data: await readSettings(tx, ws),
    }));
  }

  /** Ayarların tamamını değiştirir. Sürüm GET'ten gelir: satır yoksa 0
   *  beklenir ve satır sürüm 1 ile eklenir; varsa yalnızca aynı sürüm
   *  güncellenir. Ayar satırının kilidi, aynı anda ders ayarlayan öğrenciyi
   *  (derslik.book_lesson, FOR SHARE) bu kayıt bitene kadar bekletir. */
  saveSettings(actor: Actor, ws: string, input: unknown) {
    const c = bookingSettingsSchema.parse(input);
    const today = istanbulDay(new Date());
    return this.db.transaction(actor, ws, async (tx) => {
      const values = [
        ws,
        c.enabled,
        c.durationMinutes,
        c.noticeHours,
        c.cancelHours,
        c.location,
      ];
      const saved = (
        c.version === 0
          ? await tx.query(
              `INSERT INTO derslik.booking_settings(workspace_id,enabled,duration_minutes,notice_hours,cancel_hours,location,version)
               VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT (workspace_id) DO NOTHING RETURNING version`,
              values,
            )
          : await tx.query(
              `UPDATE derslik.booking_settings SET enabled=$2,duration_minutes=$3,notice_hours=$4,cancel_hours=$5,
                 location=$6,version=version+1,updated_at=now()
               WHERE workspace_id=$1 AND version=$7 RETURNING version`,
              [...values, c.version],
            )
      ).rows[0];
      if (!saved) throw new ConflictException("api.bookingSettingsChanged");
      await tx.query(
        "DELETE FROM derslik.availability_windows WHERE workspace_id=$1",
        [ws],
      );
      await tx.query(
        "DELETE FROM derslik.availability_blocks WHERE workspace_id=$1",
        [ws],
      );
      for (const w of c.windows)
        await tx.query(
          "INSERT INTO derslik.availability_windows(workspace_id,weekday,start_minute,end_minute) VALUES($1,$2,$3,$4)",
          [ws, w.weekday, minutesOf(w.start), minutesOf(w.end)],
        );
      // Bitişi geçmiş kapalı günler saklanmaz.
      for (const b of c.blocks.filter((b) => b.to >= today))
        await tx.query(
          "INSERT INTO derslik.availability_blocks(workspace_id,starts_on,ends_on) VALUES($1,$2,$3)",
          [ws, b.from, b.to],
        );
      await tx.query(
        "INSERT INTO derslik.audit_events (workspace_id,actor_id,action,resource_id,metadata) VALUES ($1,$2,$3,$4,$5)",
        [
          ws,
          actor.id,
          "booking.save",
          ws,
          JSON.stringify({
            enabled: c.enabled,
            windows: c.windows.length,
            blocks: c.blocks.length,
          }),
        ],
      );
      return { data: await readSettings(tx, ws) };
    });
  }

  /** Öğrencinin boş saatleri, süre, yer ve boştaki hak. Ayarlama kapalıysa 409. */
  slots(actor: Actor, ws: string, student: string) {
    return this.db.portalTransaction(
      actor,
      ws,
      student,
      "lessons",
      async (tx) => {
        await assertBookingStudent(tx, ws, student);
        const policy = (
          await tx.query(
            "SELECT enabled,duration_minutes,cancel_hours,location FROM derslik.booking_policy($1)",
            [ws],
          )
        ).rows[0];
        if (!policy?.enabled)
          throw new ConflictException("api.bookingDisabled");
        const slots = (
          await tx.query(
            "SELECT starts_at,ends_at FROM derslik.open_slots($1,$2)",
            [ws, student],
          )
        ).rows;
        const credits = (
          await tx.query("SELECT derslik.free_credits($1,$2) AS n", [
            ws,
            student,
          ])
        ).rows[0].n;
        return {
          data: toDto({
            duration_minutes: policy.duration_minutes,
            location: policy.location,
            cancel_hours: policy.cancel_hours,
            free_credits: credits,
            slots,
          }),
        };
      },
      true,
    );
  }

  /** Boş saate ders ayarlar; tekrar edilen anahtar aynı dersi döndürür. */
  book(actor: Actor, ws: string, student: string, key: string, input: unknown) {
    this.limiter.check(actor.id);
    const c = bookLessonSchema.parse(input);
    return this.commands.run(
      actor,
      ws,
      key,
      { action: "lesson.book", studentId: student, startsAt: c.startsAt },
      async (tx) => {
        try {
          const data = (
            await tx.query("SELECT derslik.book_lesson($1,$2,$3) AS data", [
              ws,
              student,
              c.startsAt,
            ])
          ).rows[0].data;
          return { data, audit: { startsAt: data.starts_at } };
        } catch (error) {
          throw bookingError(error);
        }
      },
      { studentId: student, permission: "lessons", write: true },
    );
  }

  /** Öğrencinin kendi ayarladığı dersi iptal eder. */
  cancel(
    actor: Actor,
    ws: string,
    student: string,
    lesson: string,
    key: string,
    input: unknown,
  ) {
    this.limiter.check(actor.id);
    const c = cancelBookingSchema.parse(input);
    return this.commands.run(
      actor,
      ws,
      key,
      {
        action: "lesson.cancelBooking",
        studentId: student,
        id: lesson,
        version: c.version,
      },
      async (tx) => {
        try {
          const data = (
            await tx.query(
              "SELECT derslik.cancel_booking($1,$2,$3,$4) AS data",
              [ws, student, lesson, c.version],
            )
          ).rows[0].data;
          return { data, audit: { startsAt: data.starts_at } };
        } catch (error) {
          throw bookingError(error);
        }
      },
      { studentId: student, permission: "lessons", write: true },
    );
  }
}

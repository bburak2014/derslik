import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { MailService } from "../access/mail.js";
import {
  defaultLocale,
  matchLocale,
} from "../../../../packages/contracts/src/i18n/index.js";

const BATCH = 100;

type Reminder = {
  lesson_id: string;
  starts_at: Date;
  topic: string;
  location: string;
  student_name: string;
  teacher_name: string;
  recipient_role: "OWNER" | "STUDENT" | "GUARDIAN";
  email: string;
  locale: string;
};

/**
 * Ders hatırlatması. API her dakika önümüzdeki LESSON_REMINDER_MINUTES
 * dakikada başlayacak dersleri alır; öğretmene, öğrenciye ve veliye uygulama
 * içi bildirim yazılır, öğrenci ve veliye ayrıca e-posta gider. Ders aynı
 * işlemde hatırlatıldı olarak işaretlendiği için birden çok API kopyası aynı
 * dersi iki kez göndermez. E-posta gönderilemezse yeniden denenmez; bildirim
 * yine uygulamada durur.
 */
@Injectable()
export class LessonRemindersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  onApplicationBootstrap() {
    // Testler run() fonksiyonunu kendileri çağırır.
    if (this.config.NODE_ENV === "test" || !this.config.LESSON_REMINDER_MINUTES)
      return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      console.error("Lesson reminders failed", {
        code: (error as Error & { code?: string }).code,
        message: (error as Error).message,
      });
    } finally {
      this.running = false;
    }
  }

  /** Vakti gelen dersleri hatırlatır; hatırlatılan ders sayısını döndürür. */
  async run(): Promise<number> {
    let total = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- döngünün sürüp sürmeyeceği bu partinin sonucuna (lessons < BATCH) bağlı; sonraki parti ancak bu parti işlendikten sonra talep edilir.
      const rows = await this.db.systemTransaction(
        async (tx) =>
          (
            await tx.query<Reminder>(
              "SELECT * FROM derslik.claim_lesson_reminders($1,$2)",
              [this.config.LESSON_REMINDER_MINUTES || 60, BATCH],
            )
          ).rows,
      );
      const lessons = new Set(rows.map((r) => r.lesson_id)).size;
      total += lessons;
      for (const r of rows) {
        // Öğretmen dersleri takviminde görür; e-posta yalnızca öğrenci ve veliye.
        if (r.recipient_role === "OWNER" || !r.email) continue;
        // eslint-disable-next-line no-await-in-loop -- e-postalar sırayla gider: ilk gönderim hatasında kalan alıcılara gönderim başlamaz (mevcut davranış) ve posta sağlayıcısına aynı anda tek istek gider.
        await this.mail.sendLessonReminder({ // NOSONAR: e-postalar sırayla gider: ilk gönderim hatasında kalan alıcılara gönderim başlamaz (mevcut davranış) ve posta sağlayıcısına aynı anda tek istek gider
          to: r.email,
          locale: matchLocale(r.locale) ?? defaultLocale,
          role: r.recipient_role,
          studentName: r.student_name,
          teacherName: r.teacher_name,
          startsAt: new Date(r.starts_at),
          topic: r.topic,
          location: r.location,
          url: this.config.WEB_ORIGIN,
        });
      }
      if (lessons < BATCH) return total;
    }
  }
}

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
  meeting_url: string | null;
  student_name: string;
  teacher_name: string;
  recipient_role: "OWNER" | "STUDENT" | "GUARDIAN";
  email: string;
  locale: string;
};

function failed(error: unknown) {
  console.error("Lesson reminders failed", {
    code: (error as Error & { code?: string }).code,
    message: (error as Error).message,
  });
}

/**
 * Ders hatırlatması. API her dakika önümüzdeki LESSON_REMINDER_MINUTES
 * dakikada başlayacak dersleri alır; öğretmene, öğrenciye ve veliye uygulama
 * içi bildirim yazılır, öğrenci ve veliye ayrıca e-posta gider. Ders aynı
 * işlemde hatırlatıldı olarak işaretlendiği için birden çok API kopyası aynı
 * dersi iki kez göndermez. E-posta gönderilemezse yeniden denenmez; bildirim
 * yine uygulamada durur.
 *
 * Talep ile e-posta ayrıdır: vakti gelen bütün dersler önce talep edilir
 * (bildirimler bu sırada yazılır), e-postalar sonra kendi sırasında gider.
 * Yavaş e-posta sağlayıcısı sonraki partilerin talebini geciktirseydi, o
 * sırada başlayan ders hiç hatırlatılmazdı (talep yalnızca başlamamış dersi
 * alır).
 */
@Injectable()
export class LessonRemindersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly outbox: Reminder[] = [];
  private sending?: Promise<void>;

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
      // E-postalar beklenmez: sonraki dakikanın talebi onlara takılmaz.
      this.outbox.push(...(await this.claim()).rows);
      this.drain().catch(failed);
    } catch (error) {
      failed(error);
    } finally {
      this.running = false;
    }
  }

  /** Vakti gelen dersleri hatırlatır ve e-postalar gidene kadar bekler;
   *  hatırlatılan ders sayısını döndürür. */
  async run(): Promise<number> {
    const { lessons, rows } = await this.claim();
    this.outbox.push(...rows);
    await this.drain();
    return lessons;
  }

  /** Vakti gelen bütün dersleri partiler halinde talep eder. */
  private async claim() {
    const rows: Reminder[] = [];
    let lessons = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- döngünün sürüp sürmeyeceği bu partinin sonucuna (lessons < BATCH) bağlı; sonraki parti ancak bu parti talep edildikten sonra istenir.
      const batch = await this.db.systemTransaction(
        async (tx) =>
          (
            await tx.query<Reminder>(
              "SELECT * FROM derslik.claim_lesson_reminders($1,$2)",
              [this.config.LESSON_REMINDER_MINUTES || 60, BATCH],
            )
          ).rows,
      );
      const count = new Set(batch.map((r) => r.lesson_id)).size;
      lessons += count;
      rows.push(...batch);
      if (count < BATCH) return { lessons, rows };
    }
  }

  /** Sıradaki e-postalar gidene kadar bekler. Aynı anda tek gönderim döngüsü
   *  çalışır; sonradan sıraya giren e-postalar da aynı döngüyle gider. */
  private async drain() {
    while (this.outbox.length || this.sending) {
      this.sending ??= this.sendAll().finally(() => {
        this.sending = undefined;
      });
      // eslint-disable-next-line no-await-in-loop -- döngü bitince sıraya yeni e-posta girmiş olabilir; ancak bu döngü bittikten sonra yenisi başlar.
      await this.sending;
    }
  }

  private async sendAll() {
    for (let r = this.outbox.shift(); r; r = this.outbox.shift())
      // eslint-disable-next-line no-await-in-loop -- e-postalar sırayla gider: sağlayıcıya aynı anda tek istek; Promise.all bir partide yüzlerce eşzamanlı istekle hız sınırına takılır ve gönderilemeyen hatırlatma yeniden denenmediği için kaybolur.
      await this.send(r);
  }

  private async send(r: Reminder) {
    // Öğretmen dersleri takviminde görür; e-posta yalnızca öğrenci ve veliye.
    if (r.recipient_role === "OWNER" || !r.email) return false;
    return this.mail
      .sendLessonReminder({
        to: r.email,
        locale: matchLocale(r.locale) ?? defaultLocale,
        role: r.recipient_role,
        studentName: r.student_name,
        teacherName: r.teacher_name,
        startsAt: new Date(r.starts_at),
        topic: r.topic,
        location: r.location,
        meetingUrl: r.meeting_url,
        url: this.config.WEB_ORIGIN,
      })
      .catch(() => false);
  }
}

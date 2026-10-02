import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import {
  defaultLocale,
  matchLocale,
  translate,
  type Locale,
} from "../../../../packages/contracts/src/i18n/index.js";
import { currentLocale } from "../common/i18n.js";
import { calendar } from "./ics.js";

const TOKEN = /^[a-f0-9]{64}$/;

type FeedRow = {
  lesson_id: string;
  version: number;
  starts_at: Date;
  ends_at: Date;
  topic: string;
  location: string;
  student_name: string;
  teacher_name: string;
  viewer_role: "OWNER" | "STUDENT" | "GUARDIAN";
};

/** Kişiye özel takvim aboneliği (Google/Apple Takvim). */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  /** Bağlantı web adresinde durur; takvim uygulaması API'ye değil siteye gelir. */
  private url(token: string) {
    return new URL(`/api/calendar/${token}.ics`, this.config.WEB_ORIGIN).href;
  }

  /** Kişinin bağlantısı; yoksa oluşturulur. Belirteç komut kaydına yazılmaz. */
  feed(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => {
      await this.ensureUser(tx, actor);
      await tx.query(
        "INSERT INTO derslik.calendar_feeds(user_id,token) VALUES($1,$2) ON CONFLICT (user_id) DO NOTHING",
        [actor.id, randomBytes(32).toString("hex")],
      );
      const token = (
        await tx.query(
          "SELECT token FROM derslik.calendar_feeds WHERE user_id=$1",
          [actor.id],
        )
      ).rows[0].token as string;
      return { data: { url: this.url(token) } };
    });
  }

  /** Yeni bağlantı: eskisi hemen çalışmaz olur. */
  rotate(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => {
      await this.ensureUser(tx, actor);
      const token = (
        await tx.query(
          `INSERT INTO derslik.calendar_feeds(user_id,token) VALUES($1,$2)
           ON CONFLICT (user_id) DO UPDATE SET token=EXCLUDED.token, created_at=now()
           RETURNING token`,
          [actor.id, randomBytes(32).toString("hex")],
        )
      ).rows[0].token as string;
      return { data: { url: this.url(token) } };
    });
  }

  /** Takvim uygulamasının okuduğu .ics. Bilinmeyen bağlantı 404 döner. */
  async ics(token: string) {
    if (!TOKEN.test(token)) throw new NotFoundException("api.calendarNotFound");
    const { locale, rows } = await this.db.publicQuery(async (tx) => {
      const owner = (
        await tx.query("SELECT * FROM derslik.calendar_feed_owner($1)", [token])
      ).rows[0] as { locale: string } | undefined;
      if (!owner) throw new NotFoundException("api.calendarNotFound");
      return {
        locale: matchLocale(owner.locale) ?? defaultLocale,
        rows: (
          await tx.query("SELECT * FROM derslik.calendar_feed($1)", [token])
        ).rows as FeedRow[],
      };
    });
    return this.render(locale, rows);
  }

  private render(locale: Locale, rows: FeedRow[]) {
    const web = new URL("/", this.config.WEB_ORIGIN).href;
    const summary = (r: FeedRow) =>
      translate(locale, summaryKey(r.viewer_role), {
        topic: r.topic,
        student: r.student_name,
        teacher: r.teacher_name,
      });
    return calendar({
      name: translate(locale, "calendar.icsName"),
      events: rows.map((r) => ({
        uid: `${r.lesson_id}@derslik`,
        sequence: r.version,
        start: new Date(r.starts_at),
        end: new Date(r.ends_at),
        summary: summary(r),
        location: r.location,
        description: translate(locale, "calendar.icsDescription", {
          url: web,
        }),
        url: web,
      })),
    });
  }

  /** Takvimdeki metinler bağlantıyı isteyenin o anki dilinde yazılır. */
  private async ensureUser(tx: PoolClient, actor: Actor) {
    await tx.query(
      "INSERT INTO derslik.users (id,locale) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET locale=EXCLUDED.locale WHERE users.locale<>EXCLUDED.locale",
      [actor.id, currentLocale()],
    );
  }
}

function summaryKey(role: FeedRow["viewer_role"]) {
  if (role === "OWNER") return "calendar.icsSummaryTeacher";
  if (role === "GUARDIAN") return "calendar.icsSummaryGuardian";
  return "calendar.icsSummaryStudent";
}

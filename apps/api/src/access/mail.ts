import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";
import { apiText } from "../common/i18n.js";
import {
  intlLocale,
  translate,
  type Locale,
  type MessageKey,
  type Params,
} from "../../../../packages/contracts/src/i18n/index.js";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/**
 * Davet ve ders hatırlatması e-postaları. Sağlayıcı anahtarı tanımlı değilse
 * gönderim sessizce atlanır ve `false` döner; davet akışı bundan etkilenmez,
 * öğretmen bağlantıyı kopyalayarak ya da WhatsApp ile iletmeye devam eder.
 */
@Injectable()
export class MailService {
  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {}

  get configured() {
    return Boolean(this.config.RESEND_API_KEY && this.config.MAIL_FROM);
  }

  async sendInvite(input: {
    to: string;
    url: string;
    studentName: string;
    role: "STUDENT" | "GUARDIAN";
  }): Promise<boolean> {
    if (!this.configured) return false;
    // E-posta daveti gönderen öğretmenin dilinde yazılır.
    const intro =
      input.role === "GUARDIAN"
        ? "mail.inviteIntroGuardian"
        : "mail.inviteIntroStudent";
    const url = encodeURI(input.url);
    const subject = apiText("mail.inviteSubject", { name: input.studentName });
    const text =
      apiText(intro, { name: input.studentName }) +
      "\n\n" +
      apiText("mail.inviteSignIn") +
      `\n\n${input.url}\n`;
    const html =
      `<p>${escapeHtml(apiText(intro, { name: input.studentName }))}</p>` +
      `<p><a href="${url}">${escapeHtml(apiText("mail.inviteOpen"))}</a></p>` +
      `<p>${escapeHtml(apiText("mail.inviteValidity"))}</p>`;
    return this.send({ to: input.to, subject, text, html });
  }

  /** Ders hatırlatması, alıcının uygulamada seçtiği dilde. */
  async sendLessonReminder(input: {
    to: string;
    locale: Locale;
    role: "STUDENT" | "GUARDIAN";
    studentName: string;
    teacherName: string;
    startsAt: Date;
    topic: string;
    location: string;
    meetingUrl?: string | null;
    url: string;
  }): Promise<boolean> {
    if (!this.configured) return false;
    const text = (key: MessageKey, params?: Params) =>
      translate(input.locale, key, params);
    const time = new Intl.DateTimeFormat(intlLocale(input.locale), {
      timeZone: "Europe/Istanbul",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(input.startsAt);
    const intro =
      input.role === "GUARDIAN"
        ? text("mail.reminderIntroGuardian", {
            student: input.studentName,
            teacher: input.teacherName,
          })
        : text("mail.reminderIntroStudent", { teacher: input.teacherName });
    const lines = [
      text("mail.reminderTime", { time }),
      text("mail.reminderTopic", { topic: input.topic }),
      ...(input.location
        ? [text("mail.reminderLocation", { location: input.location })]
        : []),
    ];
    const url = encodeURI(input.url);
    return this.send({
      to: input.to,
      subject: text("mail.reminderSubject", { time }),
      text:
        `${intro}\n\n${lines.join("\n")}\n\n${input.url}\n` +
        (input.meetingUrl
          ? `${text("liveLesson.join")}\n${input.meetingUrl}\n`
          : ""),
      html:
        `<p>${escapeHtml(intro)}</p>` +
        `<p>${lines.map(escapeHtml).join("<br>")}</p>` +
        `<p><a href="${url}">${escapeHtml(text("mail.reminderOpen"))}</a></p>` +
        (input.meetingUrl
          ? `<p><a href="${escapeHtml(input.meetingUrl)}">${escapeHtml(text("liveLesson.join"))}</a></p>`
          : ""),
    });
  }

  private async send(message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<boolean> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        // Sağlayıcı yavaşlarsa istek kilitlenmesin.
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

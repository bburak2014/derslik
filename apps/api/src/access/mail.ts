import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";
import { apiText } from "../common/i18n.js";

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
 * Davet e-postası. Sağlayıcı anahtarı tanımlı değilse gönderim sessizce
 * atlanır ve `false` döner; davet akışı bundan etkilenmez, öğretmen bağlantıyı
 * kopyalayarak ya da WhatsApp ile iletmeye devam eder.
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
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.MAIL_FROM,
          to: [input.to],
          subject,
          text,
          html,
        }),
        // Sağlayıcı yavaşlarsa davet isteği kilitlenmesin.
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

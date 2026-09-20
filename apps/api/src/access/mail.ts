import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";

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
    const who = input.role === "GUARDIAN" ? "veli" : "öğrenci";
    const name = escapeHtml(input.studentName);
    const url = encodeURI(input.url);
    const subject = `Derslik daveti · ${input.studentName}`;
    const text =
      `${input.studentName} için Derslik'te ${who} erişiminiz tanımlandı.\n\n` +
      `Aşağıdaki bağlantıdan 7 gün içinde giriş yapın. Daveti yalnızca bu ` +
      `e-posta adresiyle açtığınız hesapla kabul edebilirsiniz.\n\n${input.url}\n`;
    const html =
      `<p>${name} için Derslik'te <strong>${who}</strong> erişiminiz tanımlandı.</p>` +
      `<p><a href="${url}">Daveti aç</a></p>` +
      `<p>Bağlantı 7 gün geçerlidir. Daveti yalnızca bu e-posta adresiyle ` +
      `açtığınız hesapla kabul edebilirsiniz.</p>`;
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

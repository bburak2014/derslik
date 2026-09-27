import {
  authClient,
  csrf,
  errorResponse,
  HttpError,
  json,
  readBody,
} from "@/lib/server/session";
import { cookies } from "next/headers";
import { safeAuthNext } from "@/lib/server/auth-next";
import { clientIp } from "@/lib/server/client-ip";
import { limit } from "@/lib/server/rate-limit";
import { z } from "zod";
export const dynamic = "force-dynamic";
const credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(128),
});
const MINUTE = 60_000;
// Şifre yalnızca e-postadaki sıfırlama bağlantısıyla açılan oturumda
// değiştirilebilir. Çalınan bir oturum çerezi böylece kalıcı hesap ele
// geçirmeye dönüşmez. amr, oturumun nasıl açıldığını söyler.
const RECOVERY_METHODS = new Set(["recovery", "otp", "magiclink"]);
const RECOVERY_WINDOW_SECONDS = 60 * 60;
const signupNext = (value: string | undefined) => {
  const next = safeAuthNext(value);
  return next === "/" ? "" : "?next=" + encodeURIComponent(next);
};
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  try {
    csrf(request);
    const { action } = await context.params,
      body = await readBody(request),
      auth = await authClient(),
      ip = clientIp(request.headers);
    if (action === "oauth") {
      const input = z
        .object({
          provider: z.enum(["google", "apple", "azure"]),
          next: z.string().optional(),
        })
        .safeParse(body);
      if (!input.success) throw new HttpError(400, "web.providerInvalid");
      const next = safeAuthNext(input.data.next);
      const { data, error } = await auth.auth.signInWithOAuth({
        provider: input.data.provider,
        options: {
          redirectTo: process.env.APP_ORIGIN + "/api/auth/callback",
          skipBrowserRedirect: true,
          ...(input.data.provider === "azure" ? { scopes: "email" } : {}),
        },
      });
      if (error || !data.url)
        throw new HttpError(503, "web.providerUnavailable");
      (await cookies()).set("derslik-auth-next", next, {
        httpOnly: true,
        secure: process.env.APP_ORIGIN!.startsWith("https:"),
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return json({ url: data.url });
    }
    if (action === "signout") {
      const { error } = await auth.auth.signOut();
      if (error) throw new HttpError(503, "web.signoutFailed");
      (await cookies()).delete("derslik-context");
      return json({ ok: true });
    }
    if (action === "signin" || action === "signup") {
      const parsed = (
        action === "signin"
          ? credentials.extend({ password: z.string().min(1).max(128) })
          : credentials
      ).safeParse(body);
      if (!parsed.success) throw new HttpError(400, "web.credentialsInvalid");
      const email = parsed.data.email.toLowerCase();
      if (action === "signin") {
        // E-posta tek başına anahtar olsaydı saldırgan kurbanın adresine 10
        // yanlış şifre gönderip onu 15 dakika dışarıda tutabilirdi. Anahtar
        // e-posta + IP; IP bilinmiyorsa (CLIENT_IP_HEADER yok) yalnızca e-posta.
        if (ip) limit("signin-ip:" + ip, 30, 15 * MINUTE);
        limit(`signin:${email}:${ip}`, 10, 15 * MINUTE);
      } else if (ip) limit("signup-ip:" + ip, 10, 60 * MINUTE);
      const { error, data } =
        action === "signin"
          ? await auth.auth.signInWithPassword(parsed.data)
          : await auth.auth.signUp({
              email: parsed.data.email,
              password: parsed.data.password,
              options: {
                // Davet ya da vitrin bağlantısından kaydolan, e-postayı
                // onayladıktan sonra aynı akışa döner. Onay bağlantısı başka
                // bir tarayıcıda açılabileceği için çerez değil adres taşır.
                emailRedirectTo:
                  process.env.APP_ORIGIN +
                  "/api/auth/callback" +
                  signupNext(
                    z.object({ next: z.string() }).safeParse(body).data?.next,
                  ),
              },
            });
      if (error)
        throw new HttpError(
          400,
          action === "signin" ? "web.signinFailed" : "web.signupFailed",
        );
      return json({ ok: true, confirmationRequired: !data.session });
    }
    if (action === "recover") {
      const parsed = z
        .object({ email: z.string().email().max(200) })
        .safeParse(body);
      if (!parsed.success) throw new HttpError(400, "web.emailInvalid");
      if (ip) limit("recover-ip:" + ip, 5, 15 * MINUTE);
      limit(`recover:${parsed.data.email.toLowerCase()}:${ip}`, 3, 15 * MINUTE);
      const { error } = await auth.auth.resetPasswordForEmail(
        parsed.data.email,
        {
          redirectTo:
            process.env.APP_ORIGIN + "/api/auth/callback?next=/reset-password",
        },
      );
      if (error) throw new HttpError(503, "web.recoverFailed");
      return json({ ok: true });
    }
    if (action === "password") {
      const parsed = z
        .object({ password: z.string().min(10).max(128) })
        .safeParse(body);
      if (!parsed.success) throw new HttpError(400, "web.passwordTooShort");
      if (ip) limit("password-ip:" + ip, 10, 15 * MINUTE);
      const { data: claims } = await auth.auth.getClaims();
      if (!claims) throw new HttpError(401, "web.signIn");
      const now = Math.floor(Date.now() / 1000);
      const recovered = (claims.claims.amr ?? []).some(
        (entry) =>
          typeof entry === "object" &&
          RECOVERY_METHODS.has(entry.method) &&
          now - entry.timestamp < RECOVERY_WINDOW_SECONDS,
      );
      if (!recovered) throw new HttpError(403, "web.passwordRecoveryRequired");
      const { error } = await auth.auth.updateUser(parsed.data);
      if (error) throw new HttpError(400, "web.passwordChangeFailed");
      return json({ ok: true });
    }
    throw new HttpError(404, "web.actionNotFound");
  } catch (e) {
    return errorResponse(e);
  }
}

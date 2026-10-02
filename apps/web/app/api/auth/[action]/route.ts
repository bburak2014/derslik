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
// Turnstile site anahtarı ayarlıysa e-postalı giriş, kayıt ve sıfırlama
// CAPTCHA belirteci ister; Supabase belirteci Cloudflare'e doğrulatır.
// Anahtar yoksa hiçbir şey değişmez.
function captchaOptions(body: unknown) {
  if (!process.env.TURNSTILE_SITE_KEY?.trim()) return {};
  const token = z
    .object({ captchaToken: z.string().min(1).max(4096) })
    .safeParse(body).data?.captchaToken;
  if (!token) throw new HttpError(400, "auth.captchaRequired");
  return { captchaToken: token };
}
const authFailure = (
  error: { code?: string } | null,
  status: number,
  key: string,
) =>
  error?.code === "captcha_failed"
    ? new HttpError(400, "auth.captchaFailed")
    : new HttpError(status, key);
const signupNext = (value: string | undefined) => {
  const next = safeAuthNext(value);
  return next === "/" ? "" : "?next=" + encodeURIComponent(next);
};
type AuthContext = {
  auth: Awaited<ReturnType<typeof authClient>>;
  body: unknown;
  ip: ReturnType<typeof clientIp>;
};
type Claims = NonNullable<
  Awaited<ReturnType<AuthContext["auth"]["auth"]["getClaims"]>>["data"]
>;
async function oauth({ auth, body }: AuthContext) {
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
  if (error || !data.url) throw new HttpError(503, "web.providerUnavailable");
  (await cookies()).set("derslik-auth-next", next, {
    httpOnly: true,
    secure: process.env.APP_ORIGIN!.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return json({ url: data.url });
}
async function signout({ auth }: AuthContext) {
  const { error } = await auth.auth.signOut();
  if (error) throw new HttpError(503, "web.signoutFailed");
  (await cookies()).delete("derslik-context");
  return json({ ok: true });
}
function parseCredentials(action: "signin" | "signup", body: unknown) {
  const parsed = (
    action === "signin"
      ? credentials.extend({ password: z.string().min(1).max(128) })
      : credentials
  ).safeParse(body);
  if (!parsed.success) throw new HttpError(400, "web.credentialsInvalid");
  return parsed.data;
}
function emailAuthResult(
  error: { code?: string } | null,
  session: unknown,
  key: string,
) {
  if (error) throw authFailure(error, 400, key);
  return json({ ok: true, confirmationRequired: !session });
}
async function signin({ auth, body, ip }: AuthContext) {
  const input = parseCredentials("signin", body);
  const email = input.email.toLowerCase();
  // E-posta tek başına anahtar olsaydı saldırgan kurbanın adresine 10
  // yanlış şifre gönderip onu 15 dakika dışarıda tutabilirdi. Anahtar
  // e-posta + IP; IP bilinmiyorsa (CLIENT_IP_HEADER yok) yalnızca e-posta.
  if (ip) limit("signin-ip:" + ip, 30, 15 * MINUTE);
  limit(`signin:${email}:${ip}`, 10, 15 * MINUTE);
  const captcha = captchaOptions(body);
  const { error, data } = await auth.auth.signInWithPassword({
    ...input,
    options: captcha,
  });
  return emailAuthResult(error, data.session, "web.signinFailed");
}
async function signup({ auth, body, ip }: AuthContext) {
  const input = parseCredentials("signup", body);
  if (ip) limit("signup-ip:" + ip, 10, 60 * MINUTE);
  const captcha = captchaOptions(body);
  const { error, data } = await auth.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      ...captcha,
      // Davet ya da vitrin bağlantısından kaydolan, e-postayı
      // onayladıktan sonra aynı akışa döner. Onay bağlantısı başka
      // bir tarayıcıda açılabileceği için çerez değil adres taşır.
      emailRedirectTo:
        process.env.APP_ORIGIN +
        "/api/auth/callback" +
        signupNext(z.object({ next: z.string() }).safeParse(body).data?.next),
    },
  });
  return emailAuthResult(error, data.session, "web.signupFailed");
}
async function recover({ auth, body, ip }: AuthContext) {
  const parsed = z
    .object({ email: z.string().email().max(200) })
    .safeParse(body);
  if (!parsed.success) throw new HttpError(400, "web.emailInvalid");
  if (ip) limit("recover-ip:" + ip, 5, 15 * MINUTE);
  limit(`recover:${parsed.data.email.toLowerCase()}:${ip}`, 3, 15 * MINUTE);
  const captcha = captchaOptions(body);
  const { error } = await auth.auth.resetPasswordForEmail(parsed.data.email, {
    ...captcha,
    redirectTo:
      process.env.APP_ORIGIN + "/api/auth/callback?next=/reset-password",
  });
  if (error) throw authFailure(error, 503, "web.recoverFailed");
  return json({ ok: true });
}
const recoverySession = ({ claims }: Claims, now: number) =>
  (claims.amr ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      RECOVERY_METHODS.has(entry.method) &&
      now - entry.timestamp < RECOVERY_WINDOW_SECONDS,
  );
async function changePassword({ auth, body, ip }: AuthContext) {
  const parsed = z
    .object({ password: z.string().min(10).max(128) })
    .safeParse(body);
  if (!parsed.success) throw new HttpError(400, "web.passwordTooShort");
  if (ip) limit("password-ip:" + ip, 10, 15 * MINUTE);
  const { data: claims } = await auth.auth.getClaims();
  if (!claims) throw new HttpError(401, "web.signIn");
  const now = Math.floor(Date.now() / 1000);
  if (!recoverySession(claims, now))
    throw new HttpError(403, "web.passwordRecoveryRequired");
  const { error } = await auth.auth.updateUser(parsed.data);
  if (error) throw new HttpError(400, "web.passwordChangeFailed");
  return json({ ok: true });
}
function runAction(action: string, context: AuthContext) {
  switch (action) {
    case "oauth":
      return oauth(context);
    case "signout":
      return signout(context);
    case "signin":
      return signin(context);
    case "signup":
      return signup(context);
    case "recover":
      return recover(context);
    case "password":
      return changePassword(context);
    default:
      throw new HttpError(404, "web.actionNotFound");
  }
}
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
    return await runAction(action, { auth, body, ip });
  } catch (e) {
    return errorResponse(e);
  }
}

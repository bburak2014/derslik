import {
  authClient,
  csrf,
  errorResponse,
  HttpError,
  json,
  readBody,
} from "@/lib/server/session";
import { cookies } from "next/headers";
import { z } from "zod";
export const dynamic = "force-dynamic";
const credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(128),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  try {
    csrf(request);
    const { action } = await context.params,
      body = await readBody(request),
      auth = await authClient();
    if (action === "oauth") {
      const input = z
        .object({
          provider: z.enum(["google", "apple", "azure"]),
          next: z.string().optional(),
        })
        .safeParse(body);
      if (!input.success)
        throw new HttpError(400, "Giriş sağlayıcısı geçersiz.");
      const next =
        input.data.next && /^\/invite\/[a-f0-9]{64}\/?$/.test(input.data.next)
          ? input.data.next
          : "/";
      const { data, error } = await auth.auth.signInWithOAuth({
        provider: input.data.provider,
        options: {
          redirectTo: process.env.APP_ORIGIN + "/api/auth/callback",
          skipBrowserRedirect: true,
          ...(input.data.provider === "azure" ? { scopes: "email" } : {}),
        },
      });
      if (error || !data.url)
        throw new HttpError(
          503,
          "Bu giriş seçeneği şu anda kullanılamıyor. E-posta ile giriş yapabilirsiniz.",
        );
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
      if (error) throw new HttpError(503, "Çıkış tamamlanamadı.");
      (await cookies()).delete("derslik-context");
      return json({ ok: true });
    }
    if (action === "signin" || action === "signup") {
      const parsed = (
        action === "signin"
          ? credentials.extend({ password: z.string().min(1).max(128) })
          : credentials
      ).safeParse(body);
      if (!parsed.success)
        throw new HttpError(
          400,
          "Geçerli e-posta ve en az 10 karakterli şifre girin.",
        );
      const { error, data } =
        action === "signin"
          ? await auth.auth.signInWithPassword(parsed.data)
          : await auth.auth.signUp({
              ...parsed.data,
              options: {
                emailRedirectTo: process.env.APP_ORIGIN + "/api/auth/callback",
              },
            });
      if (error)
        throw new HttpError(
          400,
          action === "signin"
            ? "Giriş yapılamadı. Bilgilerinizi ve e-posta doğrulamanızı kontrol edin."
            : "Kayıt tamamlanamadı. E-posta adresinizi kontrol ederek yeniden deneyin.",
        );
      return json({ ok: true, confirmationRequired: !data.session });
    }
    if (action === "recover") {
      const parsed = z
        .object({ email: z.string().email().max(200) })
        .safeParse(body);
      if (!parsed.success) throw new HttpError(400, "Geçerli e-posta girin.");
      const { error } = await auth.auth.resetPasswordForEmail(
        parsed.data.email,
        {
          redirectTo:
            process.env.APP_ORIGIN + "/api/auth/callback?next=/reset-password",
        },
      );
      if (error)
        throw new HttpError(503, "Şifre sıfırlama isteği tamamlanamadı.");
      return json({ ok: true });
    }
    if (action === "password") {
      const parsed = z
        .object({ password: z.string().min(10).max(128) })
        .safeParse(body);
      if (!parsed.success)
        throw new HttpError(400, "Şifre en az 10 karakter olmalı.");
      const { error } = await auth.auth.updateUser(parsed.data);
      if (error)
        throw new HttpError(
          400,
          "Şifre değiştirilemedi. Yeni bir sıfırlama bağlantısı isteyin.",
        );
      return json({ ok: true });
    }
    throw new HttpError(404, "İşlem bulunamadı.");
  } catch (e) {
    return errorResponse(e);
  }
}

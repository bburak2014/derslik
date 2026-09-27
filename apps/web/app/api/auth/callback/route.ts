import { authClient } from "@/lib/server/session";
import { cookies } from "next/headers";
import { safeAuthNext } from "@/lib/server/auth-next";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const jar = await cookies();
  const savedNext = jar.get("derslik-auth-next")?.value || "/";
  jar.delete("derslik-auth-next");
  const url = new URL(request.url),
    code = url.searchParams.get("code"),
    queryNext = url.searchParams.get("next"),
    // Parola sıfırlama ve e-posta onayı adresle, sosyal giriş çerezle gelir.
    next =
      queryNext === "/reset-password"
        ? "/reset-password"
        : safeAuthNext(queryNext ?? savedNext);
  if (code) {
    try {
      const auth = await authClient();
      const { error } = await auth.auth.exchangeCodeForSession(code);
      if (!error)
        return Response.redirect(new URL(next, process.env.APP_ORIGIN));
    } catch {}
  }
  return Response.redirect(
    new URL("/?auth_error=1", process.env.APP_ORIGIN || url.origin),
  );
}

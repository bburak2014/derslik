import type { CookieOptions } from "@supabase/ssr";

/** Supabase oturum çerezlerinin bayrakları. Proxy (oturum yenileme) ve
 *  route handler'lar (giriş, çıkış) aynı çerezi aynı bayraklarla yazar. */
export function authCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_ORIGIN!.startsWith("https:"),
    path: "/",
  };
}

/** Supabase oturum çerezi (parçalıysa .0, .1 ...). */
export const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

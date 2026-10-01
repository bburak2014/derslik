import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { contentSecurityPolicy } from "@/lib/server/csp";
import { AUTH_COOKIE, authCookieOptions } from "@/lib/server/auth-cookies";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  // Next, sayfayı çizerken nonce'u istekteki CSP başlığından okur.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("Content-Security-Policy", policy);
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();
  // Sayfalar oturumu sunucuda çizer ve Server Component çerez yazamaz.
  // Süresi dolmuş erişim belirteci burada, çizimden önce yenilenir: yeni
  // çerez hem bu isteğe (çizim onu okur) hem yanıta (tarayıcı saklar) yazılır.
  // Yenilenen belirteç kaydedilmezse sonraki her istek refresh token'ı
  // yeniden harcar.
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.APP_ORIGIN &&
    request.cookies.getAll().some((c) => AUTH_COOKIE.test(c.name))
  ) {
    const auth = createServerClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      {
        cookieOptions: authCookieOptions(),
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (items) => {
            for (const { name, value } of items)
              request.cookies.set(name, value);
            response = forward();
            for (const { name, value, options } of items)
              response.cookies.set(name, value, authCookieOptions(options));
          },
        },
      },
    );
    // Belirteç süresi dolmuşsa yeniler; geçerliyse ağa gitmez. Yenileme
    // başarısızsa sayfa yine çizilir, oturumu /api/session doğrular.
    await auth.auth.getSession().catch(() => undefined);
  }
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // /api JSON döner, nonce gerekmez. Proxy'den geçen isteğin gövdesi Next
      // tarafından önce tamamen belleğe alınır; API yolları hariç tutulunca
      // büyük gövde sınırı (readBody) okuma sırasında hemen devreye girer.
      source: "/((?!api/|_next/static|_next/image|favicon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

// Sunucu her dilde metin üretir; tarayıcı paketine girmez.
import "@derslik/contracts/i18n/all";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { DerslikClient, ApiError, type Access } from "@derslik/api-client";
import { isMessageKey, translate } from "@derslik/contracts";
import { serverLocale } from "./locale";
import { clientIp } from "./client-ip";
import { AUTH_COOKIE, authCookieOptions } from "./auth-cookies";

export function configured() {
  return !!(
    process.env.API_BASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.APP_ORIGIN
  );
}
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
/** HttpError iletileri çeviri anahtarıdır; API'den gelen iletiler zaten
 *  isteğin dilinde yazılmıştır. */
export async function errorResponse(e: unknown) {
  const locale = await serverLocale();
  if (e instanceof HttpError || e instanceof ApiError)
    return json(
      {
        error: isMessageKey(e.message)
          ? translate(locale, e.message)
          : e.message,
      },
      e.status,
    );
  console.error(
    "Derslik web request failed",
    e instanceof Error ? e.name : "unknown",
  );
  return json({ error: translate(locale, "web.failed") }, 503);
}
export function csrf(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Browsers that send Sec-Fetch-Site must report a same-origin request; a
  // sibling subdomain ("same-site") is as untrusted here as a foreign one.
  if (site && site !== "same-origin" && site !== "none")
    throw new HttpError(403, "web.requestRejected");
  if (origin && origin !== process.env.APP_ORIGIN)
    throw new HttpError(403, "web.requestRejected");
  // Neither header can be forged by a cross-site form post, and asking for them
  // forces a preflight that the checks above then reject.
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    request.headers.get("x-derslik-client") !== "web"
  )
    throw new HttpError(415, "web.appRequestRequired");
}
export async function readBody(request: Request, limit = 16000) {
  // Content-Length bildirilmişse gövde hiç okunmaz; bildirilmemişse (chunked)
  // sınır aşıldığı anda okuma kesilir, büyük gövde belleğe alınmaz.
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "web.requestTooLarge");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- gövde akış olarak okunur: her parça bir öncekinin bitmesine ve toplanan bayt sınırına bağlı.
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // eslint-disable-next-line no-await-in-loop -- bu dal döngüyü bitirir: okuyucunun iptali beklenir ve hemen 413 fırlatılır, sonraki tur yoktur.
        await reader.cancel().catch(() => undefined); // NOSONAR: bu dal döngüyü bitirir: okuyucunun iptali beklenir ve hemen 413 fırlatılır, sonraki tur yoktur
        throw new HttpError(413, "web.requestTooLarge");
      }
      chunks.push(value);
    }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "web.requestUnreadable");
  }
}
export async function authClient() {
  if (!configured()) throw new HttpError(503, "web.notConfigured");
  const jar = await cookies();
  // Supabase bu başlığı yalnızca gizli anahtarla gelen isteklerde ve panelde
  // "IP Address Forwarding" açıksa dikkate alır. Burada herkese açık anahtar
  // kullanıldığı için şu an etkisi yok; asıl koruma rate-limit.ts'teki
  // sayaçlar. İleride gizli anahtara geçilirse hazır dursun.
  const ip = clientIp(await headers());
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: ip ? { "sb-forwarded-for": ip } : {} },
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            for (const { name, value, options } of items)
              jar.set(name, value, authCookieOptions(options));
          } catch {
            // Server Component çerez yazamaz. Sayfa isteklerinde oturum
            // proxy.ts'de çizimden önce yenilendiği için burada yazılacak
            // bir şey kalmaz; route handler'lar yazmaya devam eder.
          }
        },
      },
    },
  );
}
/** Supabase oturum çerezi hiç yoksa kullanıcı kesin çıkış yapmıştır. Ağa
 *  gitmeden bakılır; çerez varsa geçerliliğini istemci /api/session ile
 *  öğrenir. */
export async function hasSessionCookie() {
  return (await cookies())
    .getAll()
    .some((c) => AUTH_COOKIE.test(c.name));
}
export async function serverSession() {
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user) throw new HttpError(401, "web.signIn");
  const {
    data: { session },
  } = await auth.auth.getSession();
  if (!session) throw new HttpError(401, "web.sessionEnded");
  const locale = await serverLocale();
  return {
    user,
    auth,
    client: new DerslikClient({
      baseUrl: process.env.API_BASE_URL!,
      // Gövde yalnızca değişmeyen bir alanı okur ve fırlatamaz; async yerine
      // hazır bir söz döndürülür (imza aynı: Promise<string>).
      getToken: () => Promise.resolve(session.access_token),
      locale: () => locale,
    }),
  };
}
/** Oturum varsa istemci ve dil; yoksa null (herkese açık vitrin sayfaları). */
export async function optionalToken() {
  if (!configured()) return null;
  try {
    const auth = await authClient();
    const {
      data: { session },
    } = await auth.auth.getSession();
    if (!session) return null;
    // Çerezdeki oturum API'de yeniden doğrulanır; burada yalnızca taşınır.
    return session.access_token;
  } catch {
    return null;
  }
}
export const accessKey = (a: Access) =>
  `${a.id}:${a.role}:${a.studentId || ""}`;
export async function selectedAccess(client: DerslikClient) {
  const list = (await client.access()).data,
    jar = await cookies();
  const active =
    list.find((a) => accessKey(a) === jar.get("derslik-context")?.value) ||
    list[0] ||
    null;
  return { list, active };
}
/** Sayfa sunucuda çizilirken oturum ve seçili erişim; istemci ilk açılışta
 *  /api/session'a ayrıca gitmesin (yavaş bağlantıda bir tur kazandırır).
 *  Belirteç yenilenmesi gerekiyorsa ya da bir hata olursa null döner ve
 *  istemci eski yoldan (/api/session) devam eder. */
export async function initialSession() {
  try {
    const { user, client } = await serverSession();
    return {
      user: { id: user.id, email: user.email ?? "" },
      ...(await selectedAccess(client)),
    };
  } catch {
    return null;
  }
}

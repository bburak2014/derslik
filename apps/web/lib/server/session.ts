import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DerslikClient, ApiError, type Access } from "@derslik/api-client";

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
export function errorResponse(e: unknown) {
  if (e instanceof HttpError || e instanceof ApiError)
    return json({ error: e.message }, e.status);
  console.error(
    "Derslik web request failed",
    e instanceof Error ? e.name : "unknown",
  );
  return json({ error: "İşlem tamamlanamadı. Yeniden deneyin." }, 503);
}
export function csrf(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Browsers that send Sec-Fetch-Site must report a same-origin request; a
  // sibling subdomain ("same-site") is as untrusted here as a foreign one.
  if (site && site !== "same-origin" && site !== "none")
    throw new HttpError(403, "Bu istek kabul edilmedi.");
  if (origin && origin !== process.env.APP_ORIGIN)
    throw new HttpError(403, "Bu istek kabul edilmedi.");
  // Neither header can be forged by a cross-site form post, and asking for them
  // forces a preflight that the checks above then reject.
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    request.headers.get("x-derslik-client") !== "web"
  )
    throw new HttpError(415, "Geçerli uygulama isteği gerekli.");
}
export async function readBody(request: Request) {
  const text = await request.text();
  if (text.length > 16000) throw new HttpError(413, "İstek çok büyük.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "İstek okunamadı.");
  }
}
export async function authClient() {
  if (!configured())
    throw new HttpError(503, "Uygulamanın bağlantı ayarları tamamlanmamış.");
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        secure: process.env.APP_ORIGIN!.startsWith("https:"),
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items)
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.APP_ORIGIN!.startsWith("https:"),
            });
        },
      },
    },
  );
}
export async function serverSession() {
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user) throw new HttpError(401, "Oturum açın.");
  const {
    data: { session },
  } = await auth.auth.getSession();
  if (!session) throw new HttpError(401, "Oturumunuz sona erdi.");
  return {
    user,
    auth,
    client: new DerslikClient({
      baseUrl: process.env.API_BASE_URL!,
      getToken: async () => session.access_token,
    }),
  };
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

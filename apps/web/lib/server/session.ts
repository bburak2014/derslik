import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DerslikClient, ApiError, type Access } from "@derslik/api-client";
import { isMessageKey, translate } from "@derslik/contracts";
import { serverLocale } from "./locale";

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
export async function readBody(request: Request) {
  const text = await request.text();
  if (text.length > 16000) throw new HttpError(413, "web.requestTooLarge");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "web.requestUnreadable");
  }
}
export async function authClient() {
  if (!configured()) throw new HttpError(503, "web.notConfigured");
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
      getToken: async () => session.access_token,
      locale: () => locale,
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

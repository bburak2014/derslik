import { errorResponse, HttpError, optionalToken } from "@/lib/server/session";
import { serverLocale } from "@/lib/server/locale";
import { intlTags } from "@derslik/contracts";
export const dynamic = "force-dynamic";

/** Öğretmen vitrini giriş yapmadan da gezilir. Oturum varsa belirteç API'ye
 *  iletilir (öğretmen yayında olmayan kendi fotoğrafını böyle görür). */
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const { path = [] } = await context.params;
    const uuid = /^[0-9a-f-]{36}$/i;
    if (
      path.length > 2 ||
      (path[0] !== undefined && !uuid.test(path[0])) ||
      (path.length === 2 && path[1] !== "photo")
    )
      throw new HttpError(400, "web.invalidPath");
    if (!process.env.API_BASE_URL)
      throw new HttpError(503, "web.notConfigured");
    const token = await optionalToken();
    const url =
      process.env.API_BASE_URL.replace(/\/$/, "") +
      "/v1/teachers" +
      path.map((p) => "/" + encodeURIComponent(p)).join("") +
      new URL(request.url).search;
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Accept-Language": intlTags[await serverLocale()],
      },
      signal: AbortSignal.timeout(10_000),
    });
    const photo = path[1] === "photo";
    if (photo && response.ok)
      return new Response(await response.arrayBuffer(), {
        headers: {
          "Content-Type": response.headers.get("content-type") || "image/jpeg",
          "Cache-Control": token
            ? "private, max-age=86400"
            : "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!response.ok)
      return Response.json(
        { error: payload.error?.message || "" },
        { status: response.status, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(payload, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

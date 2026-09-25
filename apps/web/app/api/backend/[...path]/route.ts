import {
  csrf,
  errorResponse,
  HttpError,
  json,
  readBody,
  serverSession,
} from "@/lib/server/session";
export const dynamic = "force-dynamic";
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    if (
      !path.length ||
      path.some((p) => !p || p === "." || p === ".." || /[\\/?#]/.test(p)) ||
      path[0] === "webhooks"
    )
      throw new HttpError(400, "web.invalidPath");
    const { client } = await serverSession();
    if (request.method !== "GET") csrf(request);
    // Vitrin fotoğrafı base64 olarak gelir; yalnızca o uç büyük gövde alır.
    const photo =
      request.method === "PUT" && path.at(-1) === "photo" && path.length === 4;
    const body =
      request.method === "GET"
        ? undefined
        : await readBody(request, photo ? 520_000 : 16000);
    const data = await client.request(
      "/v1/" +
        path.map(encodeURIComponent).join("/") +
        new URL(request.url).search,
      {
        method: request.method,
        body,
        key: request.headers.get("Idempotency-Key") || undefined,
      },
    );
    return json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = proxy,
  POST = proxy,
  PATCH = proxy,
  PUT = proxy;

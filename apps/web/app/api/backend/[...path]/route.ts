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
    const body = request.method === "GET" ? undefined : await readBody(request);
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

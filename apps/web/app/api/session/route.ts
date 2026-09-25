import { cookies } from "next/headers";
import {
  accessKey,
  csrf,
  errorResponse,
  HttpError,
  json,
  readBody,
  selectedAccess,
  serverSession,
} from "@/lib/server/session";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { user, client } = await serverSession();
    return json({
      user: { id: user.id, email: user.email },
      ...(await selectedAccess(client)),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    csrf(request);
    const body = await readBody(request),
      { client } = await serverSession(),
      list = (await client.access()).data;
    const active = list.find((a) => accessKey(a) === body.key);
    if (!active) throw new HttpError(403, "web.noWorkspaceAccess");
    (await cookies()).set("derslik-context", accessKey(active), {
      httpOnly: true,
      secure: process.env.APP_ORIGIN!.startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

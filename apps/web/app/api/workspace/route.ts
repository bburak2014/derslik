import {
  serverSession,
  selectedAccess,
  HttpError,
  errorResponse,
  csrf,
  readBody,
  json,
} from "@/lib/server/session";
import { serverLocale } from "@/lib/server/locale";
import { WORKSPACE_HEADER } from "@/lib/workspace-prefetch";
import { commandSchema, requestIdSchema, translate } from "@derslik/contracts";

export const dynamic = "force-dynamic";

class AccountChanged extends Error {}

// Oturum ve bağlam çerezleri bütün sekmelerde ortaktır. Başka sekmede başka
// hesaba girilince eski sekmenin isteği yeni hesabın alanına giderdi; istek
// ekrandaki alanı taşır, çerezlerin seçtiği alan o değilse hiçbir şey yapılmaz.
async function owner(request: Request) {
  const { client } = await serverSession();
  const { active } = await selectedAccess(client);
  if (active?.role !== "OWNER")
    throw new HttpError(403, "web.teacherWorkspaceRequired");
  if (request.headers.get(WORKSPACE_HEADER) !== active.id)
    throw new AccountChanged();
  return { client, workspaceId: active.id };
}
async function failure(e: unknown) {
  if (!(e instanceof AccountChanged)) return errorResponse(e);
  return json(
    {
      error: translate(await serverLocale(), "web.accountChanged"),
      accountChanged: true,
    },
    409,
  );
}
export async function GET(request: Request) {
  try {
    const { client, workspaceId } = await owner(request);
    return json(await client.snapshot(workspaceId));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    csrf(request);
    const { client, workspaceId } = await owner(request);
    const command = commandSchema.safeParse(await readBody(request));
    if (!command.success) throw new HttpError(400, "web.invalidFields");
    const key = requestIdSchema.safeParse(
      request.headers.get("Idempotency-Key"),
    );
    if (!key.success) throw new HttpError(400, "web.keyRequired");
    return json(await client.command(workspaceId, command.data, key.data));
  } catch (e) {
    return failure(e);
  }
}

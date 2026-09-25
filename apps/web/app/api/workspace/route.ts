import {
  serverSession,
  selectedAccess,
  HttpError,
  errorResponse,
  csrf,
  readBody,
  json,
} from "@/lib/server/session";
import { commandSchema, requestIdSchema } from "@derslik/contracts";

export const dynamic = "force-dynamic";
async function owner() {
  const { client } = await serverSession();
  const { active } = await selectedAccess(client);
  if (!active || active.role !== "OWNER")
    throw new HttpError(403, "web.teacherWorkspaceRequired");
  return { client, workspaceId: active.id };
}
export async function GET() {
  try {
    const { client, workspaceId } = await owner();
    return json(await client.snapshot(workspaceId));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    csrf(request);
    const { client, workspaceId } = await owner();
    const command = commandSchema.safeParse(await readBody(request));
    if (!command.success) throw new HttpError(400, "web.invalidFields");
    const key = requestIdSchema.safeParse(
      request.headers.get("Idempotency-Key"),
    );
    if (!key.success) throw new HttpError(400, "web.keyRequired");
    return json(await client.command(workspaceId, command.data, key.data));
  } catch (e) {
    return errorResponse(e);
  }
}

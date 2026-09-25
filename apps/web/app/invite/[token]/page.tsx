import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token))
    return (
      <main className="connection-state">
        <h1>{await serverText("web.inviteInvalid")}</h1>
        <a href="/">{await serverText("web.backHome")}</a>
      </main>
    );
  return <ConnectedWorkspace inviteToken={token} />;
}

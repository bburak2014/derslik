import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import { serverText } from "@/lib/server/locale";
import { hasSessionCookie } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token))
    return (
      <main className="connection-state">
        <h1>{await serverText("web.inviteInvalid")}</h1>
        <a href="/">{await serverText("web.backHome")}</a>
      </main>
    );
  return (
    <ConnectedWorkspace
      inviteToken={token}
      signedOut={!(await hasSessionCookie())}
    />
  );
}

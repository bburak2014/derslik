import { ConnectedWorkspace } from "@/components/account/connected-workspace";
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
        <h1>Davet bağlantısı geçersiz.</h1>
        <a href="/">Ana sayfaya dön</a>
      </main>
    );
  return <ConnectedWorkspace inviteToken={token} />;
}

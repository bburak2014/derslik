import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import { configured } from "@/lib/server/session";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (configured()) return <ConnectedWorkspace />;
  return (
    <main className="connection-state">
      <h1>{await serverText("web.setupTitle")}</h1>
      <p>{await serverText("web.setupBody")}</p>
    </main>
  );
}

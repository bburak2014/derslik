import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import {
  configured,
  hasSessionCookie,
  initialSession,
} from "@/lib/server/session";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
// Sunucu çizimi adres çubuğundaki görünümle (?view=, ?teacher=) başlasın.
const searchString = (params: Record<string, string | string[] | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x]),
    ),
  ).toString();
export default async function Home({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  if (configured()) {
    const signedIn = await hasSessionCookie();
    return (
      <ConnectedWorkspace
        signedOut={!signedIn}
        initialSession={signedIn ? await initialSession() : null}
        initialSearch={searchString(await searchParams)}
      />
    );
  }
  return (
    <main className="connection-state">
      <h1>{await serverText("web.setupTitle")}</h1>
      <p>{await serverText("web.setupBody")}</p>
    </main>
  );
}

import { ConnectedWorkspace } from "@/components/account/connected-workspace";
import {
  configured,
  hasSessionCookie,
  initialSession,
} from "@/lib/server/session";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
type SearchParams = Record<string, string | string[] | undefined>;
// Sunucu çizimi adres çubuğundaki görünümle (?view=, ?teacher=) başlasın.
const searchString = (params: SearchParams) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      paramValues(v).map((x) => [k, x]),
    ),
  ).toString();
function paramValues(value: SearchParams[string]) {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}
export default async function Home({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
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

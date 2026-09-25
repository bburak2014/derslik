import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { configuration, supabase } from "./core";
import { t } from "@derslik/contracts";

WebBrowser.maybeCompleteAuthSession();
export type SocialProvider = "google" | "apple" | "azure";
export const providers: { id: SocialProvider; name: string }[] = [
  { id: "google", name: "Google" },
  { id: "apple", name: "Apple" },
  { id: "azure", name: "Microsoft" },
];
export type AuthRoute = "callback" | "confirm" | "recovery";
const routes: AuthRoute[] = ["callback", "confirm", "recovery"];

// A standalone or development build opens `derslik://auth/<route>`; Expo Go
// receives the same route as `exp://<host>:8081/--/auth/<route>`. Building the
// address with `Linking.createURL` keeps both clients on one code path, so
// social sign-in no longer has to be refused inside Expo Go.
export function authRedirect(route: AuthRoute) {
  return Linking.createURL("auth/" + route);
}

// Accepts the address shapes the two clients produce and returns the auth route
// it points at. Foreign schemes and unrelated paths are rejected.
export function authRoute(value: string): AuthRoute | null {
  let link;
  try {
    link = Linking.parse(value);
  } catch {
    return null;
  }
  const segments = [link.hostname || "", link.path || ""]
    .join("/")
    .split("/")
    .filter((s) => s && s !== "--");
  const route = segments.at(-1) as AuthRoute | undefined;
  if (segments.at(-2) !== "auth" || !route || !routes.includes(route))
    return null;
  return route;
}

const exchanges = new Map<string, Promise<void>>();
export async function completeAuthLink(value: string) {
  if (!authRoute(value)) return false;
  const query = Linking.parse(value).queryParams || {};
  if (query.error || query.error_description)
    throw new Error(t("oauth.failed"));
  const code = typeof query.code === "string" ? query.code : null;
  if (!code || !supabase) return false;
  let exchange = exchanges.get(code);
  if (!exchange) {
    exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) throw new Error(t("oauth.linkExpired"));
    });
    exchanges.set(code, exchange);
    if (exchanges.size > 20) exchanges.delete(exchanges.keys().next().value!);
  }
  await exchange;
  return true;
}
export async function availableProviders(): Promise<SocialProvider[]> {
  const response = await fetch(
    new URL("/auth/v1/settings", configuration.url).href,
    {
      headers: { apikey: configuration.key },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(t("web.providersFailed"));
  const body = await response.json();
  return providers
    .filter((p) => body.external?.[p.id] === true)
    .map((p) => p.id);
}
// Supabase refuses a redirect address whose host is a bare IP other than
// loopback, even when it is on the allow list, and quietly sends the browser to
// the Site URL instead (docs/guncelleme-v6.md). Expo Go started on the LAN
// builds exactly such an address, so stop before the browser opens.
function unreachableRedirect(redirectTo: string) {
  const ip = /^exp:\/\/(\d{1,3}(?:\.\d{1,3}){3})[:/]/.exec(redirectTo)?.[1];
  return !!ip && !ip.startsWith("127.");
}

export async function socialSignIn(provider: SocialProvider) {
  if (!supabase) throw new Error(t("oauth.notReady"));
  const redirectTo = authRedirect("callback");
  if (unreachableRedirect(redirectTo)) throw new Error(t("oauth.expoLan"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(provider === "azure" ? { scopes: "email" } : {}),
    },
  });
  if (error || !data.url) throw new Error(t("oauth.providerUnavailable"));
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === "success") {
    if (!(await completeAuthLink(result.url)))
      throw new Error(missingRedirect(redirectTo));
    return;
  }
  // The browser closed without coming back to the app. Either the person
  // cancelled, or Supabase ignored an unlisted redirect address and sent the
  // browser to the project's Site URL instead — which on a phone is a dead
  // "localhost" page. A session that already exists means it worked anyway.
  if ((await supabase.auth.getSession()).data.session) return;
  throw new Error(missingRedirect(redirectTo));
}

function missingRedirect(redirectTo: string) {
  return t("oauth.notCompleted") + "\n\n" + redirectTo;
}

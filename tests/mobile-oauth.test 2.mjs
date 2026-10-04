import assert from "node:assert/strict";
import test from "node:test";
import { loadTestModule } from "../scripts/test-source-loader.mjs";

const tunnelHost = "derslik-fixture.exp.direct";

// Use the installed Expo parser: hosted callbacks remove their hostname,
// whereas parsing the same client's root URL preserves it. Native browser and
// Supabase calls are deterministic adapters, not device or Google login tests.
function fixture({
  hostUri = null,
  resultType = "success",
  resultUrl,
  session = null,
  providerError = null,
  exchangeError = null,
  configured = true,
} = {}) {
  const linking = loadTestModule(
    "apps/mobile/node_modules/expo-linking/build/createURL.js",
    {
      dependencies: {
        "expo-constants": {
          expoConfig: { hostUri },
          expoGoConfig: hostUri ? { developer: {} } : undefined,
          linkingUri: hostUri ? `exp://${hostUri}` : "derslik://",
        },
        "./Schemes": {
          hasCustomScheme: () => !hostUri,
          resolveScheme: () => (hostUri ? "exp" : "derslik"),
        },
        "./validateURL": {
          validateURL(value) {
            if (typeof value !== "string" || !value)
              throw new TypeError("Invalid URL");
          },
        },
      },
    },
  );
  const exchanges = [], signIns = [], browserCalls = [];
  const oauth = loadTestModule("apps/mobile/src/oauth.ts", {
    dependencies: {
      "expo-web-browser": {
        maybeCompleteAuthSession() {},
        async openAuthSessionAsync(url, redirectTo) {
          browserCalls.push({ url, redirectTo });
          return {
            type: resultType,
            url: resultUrl ?? `${redirectTo}?code=browser-fixture`,
          };
        },
      },
      "expo-linking": linking,
      "./core": {
        configuration: {},
        supabase: configured
          ? {
              auth: {
                async signInWithOAuth(options) {
                  signIns.push(options);
                  return {
                    data: { url: "https://provider.fixture.invalid/authorize" },
                    error: providerError,
                  };
                },
                async exchangeCodeForSession(code) {
                  exchanges.push(code);
                  return { error: exchangeError };
                },
                async getSession() {
                  return { data: { session } };
                },
              },
            }
          : null,
      },
      "@derslik/contracts": { t: (key) => key },
    },
  });
  return { ...oauth, linking, exchanges, signIns, browserCalls };
}

for (const hostUri of [tunnelHost, "127.0.0.1:8081", null]) {
  const client = hostUri || "native";
  test(`${client} accepts and exchanges its own callback, confirmation and recovery`, async () => {
    const f = fixture({ hostUri });
    for (const route of ["callback", "confirm", "recovery"]) {
      const redirect = f.authRedirect(route);
      const parsed = f.linking.parse(redirect);
      if (hostUri) {
        assert.equal(f.linking.parse(f.linking.createURL("")).hostname, hostUri.split(":")[0]);
        assert.equal(parsed.hostname, null);
        assert.equal(parsed.path, `auth/${route}`);
        assert.equal(redirect, `exp://${hostUri}/--/auth/${route}`);
      } else {
        assert.equal(redirect, `derslik://auth/${route}`);
      }
      assert.equal(f.authRoute(redirect), route);
      assert.equal(
        await f.completeAuthLink(`${redirect}?code=${route}-fixture`),
        true,
      );
    }
    assert.deepEqual(f.exchanges, [
      "callback-fixture",
      "confirm-fixture",
      "recovery-fixture",
    ]);
  });

  test(`${client} finishes a successful browser callback instead of reporting a missing redirect`, async () => {
    const f = fixture({ hostUri });
    await f.socialSignIn("google");
    assert.equal(f.signIns.length, 1);
    assert.equal(f.signIns[0].provider, "google");
    assert.equal(f.signIns[0].options.redirectTo, f.authRedirect("callback"));
    assert.equal(f.signIns[0].options.skipBrowserRedirect, true);
    assert.equal(f.browserCalls.length, 1);
    assert.equal(f.browserCalls[0].redirectTo, f.authRedirect("callback"));
    assert.deepEqual(f.exchanges, ["browser-fixture"]);
  });
}

test("tunnel callbacks reject another host, port, scheme or URL credentials", async () => {
  const f = fixture({ hostUri: tunnelHost });
  for (const url of [
    "exp://other-fixture.exp.direct/--/auth/callback",
    `exp://${tunnelHost}:8081/--/auth/callback`,
    `exps://${tunnelHost}/--/auth/callback`,
    `https://${tunnelHost}/--/auth/callback`,
    `exp://account@${tunnelHost}/--/auth/callback`,
    "derslik://auth/callback",
  ]) {
    assert.equal(f.authRoute(url), null, url);
    assert.equal(await f.completeAuthLink(`${url}?code=foreign-fixture`), false);
  }
  assert.deepEqual(f.exchanges, []);
});

test("localhost callbacks preserve exact development host and port checks", async () => {
  const f = fixture({ hostUri: "127.0.0.1:8081" });
  for (const url of [
    "exp://127.0.0.1:8082/--/auth/callback",
    "exp://127.0.0.1/--/auth/callback",
    "exp://localhost:8081/--/auth/callback",
    "exp://account@127.0.0.1:8081/--/auth/callback",
  ]) {
    assert.equal(f.authRoute(url), null, url);
    assert.equal(await f.completeAuthLink(`${url}?code=foreign-fixture`), false);
  }
  assert.deepEqual(f.exchanges, []);
});

test("Expo separators cannot hide extra path prefixes or invalid auth routes", async () => {
  const f = fixture({ hostUri: tunnelHost });
  for (const path of [
    "/--/prefix/auth/callback",
    "/prefix/auth/callback",
    "/--/auth/--/callback",
    "/--/--/auth/callback",
    "/--/auth/callback/extra",
    "/--/unknown/callback",
    "/--/auth/unknown",
  ]) {
    const url = `exp://${tunnelHost}${path}?code=foreign-fixture`;
    assert.equal(f.authRoute(url), null, url);
    assert.equal(await f.completeAuthLink(url), false);
  }
  assert.deepEqual(f.exchanges, []);
});

test("native callbacks reject foreign host prefixes, credentials and Expo separators", async () => {
  const f = fixture();
  for (const url of [
    "derslik://prefix/auth/callback",
    "derslik://auth/callback/extra",
    "derslik://account@auth/callback",
    "derslik://--/auth/callback",
    "derslik://auth/--/callback",
    "derslik://auth/unknown",
  ]) {
    assert.equal(f.authRoute(url), null, url);
    assert.equal(await f.completeAuthLink(`${url}?code=foreign-fixture`), false);
  }
  assert.deepEqual(f.exchanges, []);
});

test("native callback compatibility includes single and triple slash auth links", async () => {
  const f = fixture();
  const callbacks = ["derslik:/auth/callback", "derslik:///auth/callback"];
  for (const [index, url] of callbacks.entries()) {
    assert.equal(f.authRoute(url), "callback");
    assert.equal(await f.completeAuthLink(`${url}?code=legacy-${index}`), true);
  }
  assert.deepEqual(f.exchanges, ["legacy-0", "legacy-1"]);
});

test("a callback without a PKCE code never installs fragment tokens", async () => {
  const f = fixture({ hostUri: tunnelHost });
  const redirect = f.authRedirect("callback");
  assert.equal(await f.completeAuthLink(redirect), false);
  assert.equal(
    await f.completeAuthLink(`${redirect}#access_token=fixture&refresh_token=fixture`),
    false,
  );
  assert.deepEqual(f.exchanges, []);
});

test("duplicate tunnel callbacks exchange their authorization code only once", async () => {
  const f = fixture({ hostUri: tunnelHost });
  const url = `${f.authRedirect("callback")}?code=duplicate-fixture`;
  assert.deepEqual(await Promise.all([
    f.completeAuthLink(url),
    f.completeAuthLink(url),
    f.completeAuthLink(url),
  ]), [true, true, true]);
  assert.deepEqual(f.exchanges, ["duplicate-fixture"]);
});

test("provider callback errors and failed exchanges remain distinct from missing redirects", async () => {
  const f = fixture({ hostUri: tunnelHost });
  await assert.rejects(
    () => f.completeAuthLink(`${f.authRedirect("callback")}?error=access_denied&code=fixture`),
    { message: "oauth.failed" },
  );
  assert.deepEqual(f.exchanges, []);
  const expired = fixture({ hostUri: tunnelHost, exchangeError: {} });
  await assert.rejects(
    () => expired.completeAuthLink(`${expired.authRedirect("callback")}?code=expired-fixture`),
    { message: "oauth.linkExpired" },
  );
});

test("a successful browser return with an invalid callback reports the expected redirect", async () => {
  const f = fixture({
    hostUri: tunnelHost,
    resultUrl: "exp://other-fixture.exp.direct/--/auth/callback?code=foreign-fixture",
  });
  await assert.rejects(() => f.socialSignIn("google"), {
    message: `oauth.notCompleted\n\n${f.authRedirect("callback")}`,
  });
  assert.deepEqual(f.exchanges, []);
});

test("browser cancellation preserves an existing session and reports an absent session", async () => {
  for (const resultType of ["cancel", "dismiss"]) {
    const signedIn = fixture({ hostUri: tunnelHost, resultType, session: {} });
    await signedIn.socialSignIn("google");
    assert.deepEqual(signedIn.exchanges, []);
    const signedOut = fixture({ hostUri: tunnelHost, resultType });
    await assert.rejects(() => signedOut.socialSignIn("google"), {
      message: `oauth.notCompleted\n\n${signedOut.authRedirect("callback")}`,
    });
    assert.deepEqual(signedOut.exchanges, []);
  }
});

test("Azure keeps its email scope and provider errors never open a browser", async () => {
  const f = fixture({ hostUri: tunnelHost });
  await f.socialSignIn("azure");
  assert.equal(f.signIns[0].options.scopes, "email");
  const unavailable = fixture({ hostUri: tunnelHost, providerError: {} });
  await assert.rejects(() => unavailable.socialSignIn("google"), {
    message: "oauth.providerUnavailable",
  });
  assert.deepEqual(unavailable.browserCalls, []);
});

test("unconfigured Auth and unsupported Expo LAN redirects stop before the provider", async () => {
  const unconfigured = fixture({ configured: false });
  await assert.rejects(() => unconfigured.socialSignIn("google"), {
    message: "oauth.notReady",
  });
  const lan = fixture({ hostUri: "192.168.1.50:8081" });
  await assert.rejects(() => lan.socialSignIn("google"), {
    message: "oauth.expoLan",
  });
  assert.deepEqual(lan.signIns, []);
  assert.deepEqual(lan.browserCalls, []);
});

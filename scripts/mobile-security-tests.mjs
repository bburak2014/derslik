import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { resolve } from "node:path";
import ts from "typescript";

// Executes the current application functions with native storage/network adapters
// replaced by deterministic fixtures. This is not an Android/iOS runtime test.
const root = resolve(import.meta.dirname, "..");
const report = { generatedAt: new Date().toISOString(), scope: "Actual mobile TypeScript and installed Expo Linking parser; native and network adapters mocked", checks: [], observations: [] };
function load(file, dependencies, suffix = "") {
  const source = readFileSync(resolve(root, file), "utf8") + suffix;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  const context = createContext({ exports, module: { exports }, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, URL, URLSearchParams, TextEncoder, AbortSignal, process: { env: {} }, console, setTimeout, clearTimeout });
  runInContext(code, context, { filename: file });
  return exports;
}
async function check(name, run, observation = false) {
  try { await run(); (observation ? report.observations : report.checks).push({ name, result: observation ? "reproduced" : "passed" }); }
  catch (error) { report.checks.push({ name, result: "failed", error: String(error.message) }); process.exitCode = 1; }
}
const t = (key) => key;
function linking(hostUri = null) {
  return load("apps/mobile/node_modules/expo-linking/build/createURL.js", {
    "expo-constants": { expoConfig: { hostUri }, linkingUri: hostUri ? `exp://${hostUri}` : "derslik://" },
    "./Schemes": { hasCustomScheme: () => !hostUri, resolveScheme: () => hostUri ? "exp" : "derslik" },
    "./validateURL": { validateURL: (value) => { if (typeof value !== "string" || !value) throw new TypeError("Invalid URL"); } },
  });
}
function oauth(hostUri = null) {
  const calls = [];
  const instance = load("apps/mobile/src/oauth.ts", {
    "expo-web-browser": { maybeCompleteAuthSession() {} },
    "expo-linking": linking(hostUri),
    "./core": { configuration: { url: "https://fixture.invalid", key: "fixture" }, supabase: { auth: { exchangeCodeForSession: async (code) => { calls.push(code); return { error: code === "invalid-code" ? {} : null }; } } } },
    "@derslik/contracts": { t },
  });
  return { ...instance, calls };
}
const production = oauth();
await check("Standalone callback, confirmation and recovery links are accepted", () => {
  for (const route of ["callback", "confirm", "recovery"]) assert.equal(production.authRoute(`derslik://auth/${route}?code=fixture`), route);
});
await check("Foreign OAuth schemes and unrelated routes are rejected", () => {
  for (const url of ["https://attacker.invalid/auth/callback?code=x", "javascript:auth/callback", "other://auth/callback", "derslik://not-auth/callback", "derslik://auth/unknown", "not a URL"]) assert.equal(production.authRoute(url), null, url);
});
await check("Expo Go OAuth links reject a different development hostname", () => {
  const development = oauth("127.0.0.1:8081");
  assert.equal(development.authRoute("exp://127.0.0.1:8081/--/auth/callback"), "callback");
  assert.equal(development.authRoute("exp://attacker.invalid:8081/--/auth/callback"), null);
});
await check("Implicit fragment tokens are never installed as a session", async () => {
  assert.equal(await production.completeAuthLink("derslik://auth/callback#access_token=attacker&refresh_token=attacker"), false);
  assert.equal(production.calls.length, 0);
});
await check("Foreign scheme code does not reach session exchange", async () => {
  assert.equal(await production.completeAuthLink("https://attacker.invalid/auth/callback?code=attacker"), false);
  assert.equal(production.calls.length, 0);
});
await check("OAuth error callback is rejected without exchanging a code", async () => {
  await assert.rejects(() => production.completeAuthLink("derslik://auth/callback?error=access_denied&code=fixture"));
  assert.equal(production.calls.length, 0);
});
await check("Concurrent duplicate OAuth callbacks exchange once", async () => {
  const result = await Promise.all(Array.from({ length: 8 }, () => production.completeAuthLink("derslik://auth/callback?code=unique-fixture")));
  assert.ok(result.every(Boolean)); assert.equal(production.calls.length, 1);
});
await check("Rejected authorization code cannot complete authentication", async () => {
  await assert.rejects(() => production.completeAuthLink("derslik://auth/callback?code=invalid-code"));
});
await check("Standalone OAuth route parser accepts extra host/path prefixes", () => {
  assert.equal(production.authRoute("derslik://unexpected-host/extra/auth/callback"), "callback");
}, true);
const authHelpers = readFileSync(resolve(root, "node_modules/.pnpm/@supabase+auth-js@2.115.0/node_modules/@supabase/auth-js/src/lib/helpers.ts"), "utf8");
const pkceFunctions = authHelpers.slice(authHelpers.indexOf("export function generatePKCEVerifier()"), authHelpers.indexOf("const PKCE_FLOW_ID_PATTERN"));
const cryptoFixture = load("apps/mobile/src/crypto-polyfill.ts", {
  "expo-crypto": {
    CryptoDigestAlgorithm: { SHA1: "SHA-1", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" },
    digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data),
    getRandomValues: (array) => webcrypto.getRandomValues(array),
  },
}, `\n${pkceFunctions}\n`);
await check("Actual PKCE polyfill and installed Supabase helper produce RFC 7636 S256 challenge", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = await cryptoFixture.generatePKCEChallenge(verifier);
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); assert.notEqual(challenge, verifier);
});

function storageFixture() {
  const values = new Map(), options = [];
  let fail = false;
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fixture-device-only",
    async getItemAsync(key, option) { options.push(option); return values.get(key) ?? null; },
    async setItemAsync(key, value, option) { options.push(option); if (fail && key.endsWith(".1")) throw new Error("Fixture write failure"); values.set(key, value); },
    async deleteItemAsync(key, option) { options.push(option); values.delete(key); },
  };
  const core = load("apps/mobile/src/core.ts", {
    "react-native-url-polyfill/auto": {}, "react-native": { AppState: {} }, "expo-secure-store": store,
    "expo-crypto": { randomUUID }, "@supabase/supabase-js": { createClient() { throw new Error("Real client must not be created in this fixture"); } },
    "@derslik/api-client": { DerslikClient: class {}, ApiError: class extends Error {} },
  });
  return { ...core, values, options, setFailure: (value) => { fail = value; } };
}
await check("Large session is round-tripped through bounded SecureStore chunks", async () => {
  const fixture = storageFixture(), token = "s".repeat(5000);
  await fixture.secureStorage.setItem("session", token);
  assert.equal(await fixture.secureStorage.getItem("session"), token);
  assert.ok([...fixture.values].filter(([key]) => key !== "session").every(([, value]) => value.length <= 500));
  assert.ok(fixture.options.every((option) => option.keychainAccessible === "fixture-device-only"));
});
await check("Concurrent session reads, refresh and logout are serialized", async () => {
  const fixture = storageFixture();
  const results = await Promise.all([
    fixture.secureStorage.setItem("session", "old".repeat(600)), fixture.secureStorage.getItem("session"),
    fixture.secureStorage.setItem("session", "new".repeat(600)), fixture.secureStorage.getItem("session"),
    fixture.secureStorage.removeItem("session"), fixture.secureStorage.getItem("session"),
  ]);
  assert.equal(results[1], "old".repeat(600)); assert.equal(results[3], "new".repeat(600)); assert.equal(results[5], null); assert.equal(fixture.values.size, 0);
});
await check("Partial SecureStore write failure preserves the previous session", async () => {
  const fixture = storageFixture(); await fixture.secureStorage.setItem("session", "old-session"); fixture.setFailure(true);
  await assert.rejects(() => fixture.secureStorage.setItem("session", "new".repeat(600)));
  assert.equal(await fixture.secureStorage.getItem("session"), "old-session");
});
await check("Oversized sessions and corrupt chunk counts are rejected", async () => {
  const fixture = storageFixture(); await assert.rejects(() => fixture.secureStorage.setItem("session", "x".repeat(64001)));
  for (const count of [-1, 0, 129, 1.5]) { fixture.values.set("session", JSON.stringify({ generation: "x", count })); assert.equal(await fixture.secureStorage.getItem("session"), null); }
});
await check("Missing SecureStore chunk never returns a partial token", async () => {
  const fixture = storageFixture(); await fixture.secureStorage.setItem("session", "x".repeat(1100));
  const manifest = JSON.parse(fixture.values.get("session")); fixture.values.delete(`session.${manifest.generation}.1`);
  assert.equal(await fixture.secureStorage.getItem("session"), null);
});
await check("Failed SecureStore writes leave unreachable encrypted chunks after logout", async () => {
  const fixture = storageFixture(); await fixture.secureStorage.setItem("session", "old-session"); fixture.setFailure(true);
  await assert.rejects(() => fixture.secureStorage.setItem("session", "new".repeat(600)));
  await fixture.secureStorage.removeItem("session"); assert.equal(await fixture.secureStorage.getItem("session"), null); assert.equal(fixture.values.size, 1);
}, true);

const uiDependencies = {
  react: {}, "react/jsx-runtime": {}, "react-native": {}, "react-native-safe-area-context": {}, "react-native-webview": {}, "@expo/vector-icons": {}, "expo-web-browser": {}, "./ui": {}, "@derslik/contracts": { t },
};
const pdf = load("apps/mobile/src/PdfViewer.tsx", uiDependencies, "\nexport { buildHtml };\n");
await check("PDF renderer disables the known font eval execution path", () => assert.match(pdf.buildHtml("https://fixture.invalid/test.pdf", "#000", "#fff"), /isEvalSupported:\s*false/));
await check("PDF inline HTML accepts a closing script tag in an arbitrary supplied URL", () => {
  const html = pdf.buildHtml("https://fixture.invalid/</script><script>window.securityProbe=1</script>", "#000", "#fff");
  assert.match(html, /<script>window\.securityProbe=1<\/script>/);
}, true);
const turnstileSource = readFileSync(resolve(root, "apps/mobile/src/Turnstile.tsx"), "utf8");
const predicateSource = turnstileSource.match(/onShouldStartLoadWithRequest=\{\(request\) =>([\s\S]*?)\n\s*\}/)?.[1];
assert.ok(predicateSource);
const allowTurnstile = runInContext(`(request) => (${predicateSource})`, createContext({ origin: "https://derslik.example" }));
await check("Turnstile WebView blocks an unrelated origin", () => assert.equal(allowTurnstile({ url: "https://unrelated.invalid/" }), false));
await check("Turnstile prefix origin check accepts attacker-controlled lookalike hosts", () => {
  for (const url of ["https://derslik.example.attacker.invalid/", "https://derslik.example@attacker.invalid/"]) assert.equal(allowTurnstile({ url }), true);
}, true);
report.summary = { passed: report.checks.filter((item) => item.result === "passed").length, failed: report.checks.filter((item) => item.result === "failed").length, observationsReproduced: report.observations.length };
writeFileSync(resolve(root, "reports/security/mobile-js-tests.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

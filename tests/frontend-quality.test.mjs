import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Execute application code with deterministic native/network/time adapters.
// No Expo native runtime or production services are used by these regressions.
const root = resolve(import.meta.dirname, "..");
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(resolve(root, file), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  runInContext(
    code,
    createContext({
      exports,
      module: { exports },
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
      URL,
      URLSearchParams,
      AbortSignal,
      AbortController,
      process: { env: {} },
      crypto: { randomUUID },
      setTimeout,
      clearTimeout,
      ...globals,
    }),
    { filename: file },
  );
  return exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function socketFixture(ticket, globals = {}) {
  const timers = new Map(),
    sockets = [];
  let nextTimer = 0;
  class Socket {
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      sockets.push(this);
    }
    close(code) {
      this.closed = code;
      this.readyState = 3;
    }
  }
  const { MessageSocket } = load(
    "packages/api-client/src/socket.ts",
    {},
    {
      setTimeout: (callback, wait) => {
        const id = ++nextTimer;
        timers.set(id, { callback, wait });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      ...globals,
    },
  );
  return {
    client: new MessageSocket({ ticket, WebSocket: Socket }),
    sockets,
    timers,
    fire(id) {
      const timer = timers.get(id);
      assert.ok(timer);
      timers.delete(id);
      timer.callback();
    },
  };
}
const validTicket = { ticket: "fixture", url: "wss://fixture.invalid/socket" };

test("late socket ticket from a stopped session cannot connect after restart", async () => {
  const old = deferred(),
    current = deferred();
  let calls = 0;
  const f = socketFixture(() =>
    ++calls === 1 ? old.promise : current.promise,
  );
  f.client.start();
  f.client.stop();
  f.client.start();
  old.resolve({ ...validTicket, ticket: "old-session" });
  await settle();
  assert.equal(f.sockets.length, 0);
  current.resolve({ ...validTicket, ticket: "current-session" });
  await settle();
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].protocols[1], "ticket.current-session");
  f.client.stop();
});

test("failure from a stopped socket ticket cannot schedule a new session retry", async () => {
  const old = deferred(),
    current = deferred();
  let calls = 0;
  const f = socketFixture(() =>
    ++calls === 1 ? old.promise : current.promise,
  );
  f.client.start();
  f.client.stop();
  f.client.start();
  old.reject(new Error("old session request failed"));
  await settle();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].wait, 70000);
  current.resolve(validTicket);
  await settle();
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("unresolved socket ticket times out, aborts and retries without accepting its late response", async () => {
  const old = deferred(),
    current = deferred(),
    signals = [];
  const f = socketFixture((signal) => {
    signals.push(signal);
    return signals.length === 1 ? old.promise : current.promise;
  });
  f.client.start();
  const deadline = [...f.timers].find(([, timer]) => timer.wait === 70000);
  assert.ok(deadline, "Ticket request must have a bounded deadline");
  f.fire(deadline[0]);
  await settle();
  assert.equal(signals[0].aborted, true);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.timers.size, 1);
  f.fire([...f.timers.keys()][0]);
  assert.equal(signals.length, 2);
  old.resolve({ ...validTicket, ticket: "expired-request" });
  await settle();
  assert.equal(f.sockets.length, 0);
  current.resolve(validTicket);
  await settle();
  assert.equal(f.sockets.length, 1);
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("stopping an unresolved socket ticket aborts it and clears its deadline", async () => {
  const pending = deferred();
  let signal;
  const f = socketFixture((next) => {
    signal = next;
    return pending.promise;
  });
  f.client.start();
  assert.equal(f.timers.size, 1);
  f.client.stop();
  assert.equal(signal.aborted, true);
  assert.equal(f.timers.size, 0);
  pending.resolve(validTicket);
  await settle();
  assert.equal(f.sockets.length, 0);
  assert.equal(f.timers.size, 0);
});

test("socket handshake that never opens times out and reconnects", async () => {
  const f = socketFixture(async () => validTicket);
  f.client.start();
  await settle();
  const timer = [...f.timers].find(([, value]) => value.wait === 70000);
  assert.ok(timer, "CONNECTING socket must have a silence deadline");
  f.fire(timer[0]);
  assert.equal(f.sockets[0].closed, 4001);
  assert.equal(f.client.live, false);
  assert.equal(f.timers.size, 1);
  f.fire([...f.timers.keys()][0]);
  await settle();
  assert.equal(f.sockets.length, 2);
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("throwing live listener does not prevent resync or other listeners", async () => {
  const f = socketFixture(async () => validTicket);
  let updates = 0,
    resyncs = 0;
  f.client.onLive(() => {
    throw new Error("listener failure");
  });
  f.client.onLive(() => {
    updates += 1;
  });
  f.client.subscribe(() => {
    resyncs += 1;
  });
  f.client.start();
  await settle();
  assert.doesNotThrow(() => f.sockets[0].onopen({}));
  assert.equal(updates, 1);
  assert.equal(resyncs, 1);
  assert.doesNotThrow(() => f.client.stop());
  assert.equal(updates, 2);
  assert.equal(f.sockets[0].closed, 1000);
  assert.equal(f.timers.size, 0);
});

function storageFixture() {
  const values = new Map(),
    operations = [];
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    async getItemAsync(key) {
      operations.push(["get", key]);
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      operations.push(["set", key]);
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      operations.push(["delete", key]);
      values.delete(key);
    },
  };
  const { secureStorage } = load("apps/mobile/src/core.ts", {
    "react-native-url-polyfill/auto": {},
    "react-native": { AppState: {} },
    "expo-secure-store": secureStore,
    "expo-crypto": { randomUUID },
    "@supabase/supabase-js": {
      createClient() {
        throw new Error("Unexpected native client");
      },
    },
    "@derslik/api-client": {
      DerslikClient: class {},
      ApiError: class extends Error {},
    },
  });
  return { secureStorage, values, operations };
}

for (const raw of [
  "{",
  "null",
  "false",
  "[]",
  '{"generation":null,"count":1}',
  '{"generation":"../other","count":1}',
  '{"generation":"x","count":129}',
]) {
  test(`corrupt SecureStore manifest is bounded and recoverable: ${raw}`, async () => {
    const f = storageFixture();
    f.values.set("session", raw);
    assert.equal(await f.secureStorage.getItem("session"), null);
    assert.equal(
      f.operations.length,
      1,
      "Invalid manifest must not read chunks",
    );
    await f.secureStorage.setItem("session", "new-session");
    assert.equal(await f.secureStorage.getItem("session"), "new-session");
    await f.secureStorage.removeItem("session");
    assert.equal(f.values.size, 0);
  });
  test(`logout removes corrupt SecureStore manifest without reading foreign chunks: ${raw}`, async () => {
    const f = storageFixture();
    f.values.set("session", raw);
    await f.secureStorage.removeItem("session");
    assert.equal(f.values.size, 0);
    assert.equal(f.operations.length, 2);
  });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
test("web request preserves HTTP error status for non-JSON and null payloads", async () => {
  for (const payload of [
    "<html>Bad gateway</html>",
    "null",
    '"proxy failure"',
  ]) {
    const { webRequest } = load(
      "apps/web/lib/client.ts",
      {
        "@derslik/api-client": { ApiError },
        "@derslik/contracts": { t: (key) => key },
      },
      { fetch: async () => new Response(payload, { status: 502 }) },
    );
    await assert.rejects(
      () => webRequest("/api/workspace"),
      (error) => error instanceof ApiError && error.status === 502,
    );
  }
});

test("web request retains failed mutation retry keys until a valid successful response", async () => {
  const keys = [];
  let attempts = 0;
  const { webRequest } = load(
    "apps/web/lib/client.ts",
    {
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { t: (key) => key },
    },
    {
      fetch: async (_, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return ++attempts === 1
          ? new Response("<html>Bad gateway</html>", { status: 502 })
          : Response.json({ ok: true });
      },
    },
  );
  const body = { action: "student.create", name: "Fixture" };
  await assert.rejects(() => webRequest("/api/workspace", body));
  await webRequest("/api/workspace", body);
  await webRequest("/api/workspace", body);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("web retry keys distinguish different HTTP methods at the same URL", async () => {
  const keys = [];
  const { webRequest } = load(
    "apps/web/lib/client.ts",
    {
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { t: (key) => key },
    },
    {
      fetch: async (_, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return new Response("Gateway failure", { status: 502 });
      },
    },
  );
  await assert.rejects(() => webRequest("/api/backend/profile", {}, "POST"));
  await assert.rejects(() => webRequest("/api/backend/profile", {}, "PUT"));
  assert.notEqual(keys[0], keys[1]);
});

function apiFixture(payload, status) {
  return load(
    "packages/api-client/src/index.ts",
    {
      "../../contracts/src/i18n/index.ts": {
        t: (key) => key,
        getLocale: () => "en",
      },
      "./uploads.ts": {},
      "./socket.ts": {},
    },
    { fetch: async () => new Response(payload, { status }) },
  );
}

test("shared API client preserves HTTP status for malformed error payloads", async () => {
  for (const payload of [
    "Bad gateway",
    "null",
    '"proxy failure"',
    '{"error":{"message":3,"requestId":[]}}',
  ]) {
    const api = apiFixture(payload, 502);
    const client = new api.DerslikClient({
      baseUrl: "https://fixture.invalid",
      getToken: async () => "fixture",
    });
    await assert.rejects(
      () => client.access(),
      (error) =>
        error instanceof api.ApiError &&
        error.status === 502 &&
        error.message === "common.failed" &&
        error.requestId === undefined,
    );
  }
});

test("shared API client rejects unreadable successful responses", async () => {
  for (const payload of ["<html>Upstream error</html>", "null"]) {
    const api = apiFixture(payload, 200);
    const client = new api.DerslikClient({
      baseUrl: "https://fixture.invalid",
      getToken: async () => "fixture",
    });
    await assert.rejects(
      () => client.access(),
      (error) => error instanceof api.ApiError && error.status === 502,
    );
  }
});

function linking(hostUri) {
  return load("apps/mobile/node_modules/expo-linking/build/createURL.js", {
    "expo-constants": {
      expoConfig: { hostUri },
      linkingUri: hostUri ? `exp://${hostUri}` : "derslik://",
    },
    "./Schemes": {
      hasCustomScheme: () => !hostUri,
      resolveScheme: () => (hostUri ? "exp" : "derslik"),
    },
    "./validateURL": { validateURL() {} },
  });
}
function oauthFixture(hostUri) {
  const calls = [];
  return {
    ...load("apps/mobile/src/oauth.ts", {
      "expo-web-browser": { maybeCompleteAuthSession() {} },
      "expo-linking": linking(hostUri),
      "./core": {
        configuration: {},
        supabase: {
          auth: {
            async exchangeCodeForSession(code) {
              calls.push(code);
              return { error: null };
            },
          },
        },
      },
      "@derslik/contracts": { t: (key) => key },
    }),
    calls,
  };
}

test("Expo OAuth rejects a different server port and URL credentials", async () => {
  const f = oauthFixture("127.0.0.1:8081");
  assert.equal(
    f.authRoute("exp://127.0.0.1:8081/--/auth/callback"),
    "callback",
  );
  for (const value of [
    "exp://127.0.0.1:8082/--/auth/callback?code=foreign",
    "exp://127.0.0.1/--/auth/callback?code=foreign",
    "exp://user@127.0.0.1:8081/--/auth/callback?code=foreign",
  ]) {
    assert.equal(f.authRoute(value), null);
    assert.equal(await f.completeAuthLink(value), false);
  }
  assert.equal(f.calls.length, 0);
});

test("standalone OAuth rejects credentials and preserves supported auth routes", () => {
  const f = oauthFixture(null);
  for (const route of ["callback", "confirm", "recovery"])
    assert.equal(f.authRoute(`derslik://auth/${route}`), route);
  assert.equal(f.authRoute("derslik://user@auth/callback"), null);
});

test("chat drafts are kept per thread, emptied text removes them, and logout clears them", () => {
  const { getChatDraft, setChatDraft, clearChatDrafts } = load(
    "apps/web/lib/chat-drafts.ts",
  );
  const first = "/workspaces/fixture/messages/thread-one";
  const second = "/portal/fixture/student/messages/thread-two";
  assert.equal(getChatDraft(first), undefined);
  setChatDraft(first, "Unsent teacher message");
  setChatDraft(second, "Unsent student message");
  assert.equal(getChatDraft(first), "Unsent teacher message");
  assert.equal(getChatDraft(second), "Unsent student message");
  setChatDraft(first, "");
  assert.equal(getChatDraft(first), undefined);
  assert.equal(getChatDraft(second), "Unsent student message");
  setChatDraft(first, "Unsent teacher message");
  clearChatDrafts();
  assert.equal(getChatDraft(first), undefined);
  assert.equal(getChatDraft(second), undefined);
});

test("actual Tailwind dark variant compiles both nesting branches under a class scoping root", async () => {
  const { compile } = await import("tailwindcss");
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve("@tailwindcss/postcss"));
  const postcss = pluginRequire("postcss");
  const source = readFileSync(
    resolve(root, "apps/web/app/globals.css"),
    "utf8",
  );
  const start = source.indexOf("@custom-variant dark");
  const end = source.indexOf(
    "/* ==================================================================",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const compiler = await compile(
    `${source.slice(start, end)}\n@tailwind utilities;\n@utility sonar-theme-audit { color: #010203; }`,
  );
  const compiled = compiler.build(["dark:sonar-theme-audit"]);
  const css = postcss.parse(compiled);
  const variants = [];
  css.walkRules((rule) => {
    if (!rule.selector.startsWith("&")) return;
    let scope = rule.parent;
    while (scope && scope.type !== "rule") scope = scope.parent;
    assert.equal(scope?.selector, ".dark\\:sonar-theme-audit");
    variants.push(rule);
  });
  assert.equal(variants.length, 2);
  assert.equal(variants[0].selector, "&:where(.dark, .dark *)");
  assert.equal(variants[1].selector, "&:where(:not(.light), :not(.light *))");
  assert.equal(variants[1].parent.type, "atrule");
  assert.equal(variants[1].parent.name, "media");
  assert.equal(variants[1].parent.params, "(prefers-color-scheme: dark)");
  css.walkAtRules((rule) => {
    assert.ok(
      !["custom-variant", "slot", "tailwind", "utility"].includes(rule.name),
    );
  });
});

test("socket PRNG affects bounded retry timing while provider-issued authentication tickets stay intact", async () => {
  for (const random of [0, 0.5, 0.999999]) {
    let attempts = 0;
    const f = socketFixture(
      async () => {
        if (++attempts <= 8)
          throw new Error("Transient ticket service failure");
        return {
          ...validTicket,
          ticket: "provider-issued-authentication-ticket",
        };
      },
      { Math: { min: Math.min, random: () => random } },
    );
    f.client.start();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await settle();
      assert.equal(f.sockets.length, 0);
      assert.equal(f.timers.size, 1);
      const [id, timer] = [...f.timers][0];
      const cap = Math.min(30000, 1000 * 2 ** attempt);
      assert.ok(timer.wait >= cap / 2 && timer.wait <= cap);
      assert.equal(timer.wait, cap * (0.5 + random / 2));
      f.fire(id);
    }
    await settle();
    assert.equal(f.sockets.length, 1);
    assert.equal(f.sockets[0].url, validTicket.url);
    assert.equal(
      f.sockets[0].protocols[1],
      "ticket.provider-issued-authentication-ticket",
    );
    f.client.stop();
    assert.equal(f.timers.size, 0);
  }
});

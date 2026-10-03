import test from "node:test";
import assert from "node:assert/strict";
import { loadTestModule } from "../scripts/test-source-loader.mjs";

function sessionFixture({ user = { id: "fixture-user" }, session = { access_token: "fixture-session" } } = {}) {
  return loadTestModule("apps/web/lib/server/session.ts", {
    dependencies: {
      "@derslik/contracts/i18n/all": {},
      "@supabase/ssr": { createServerClient: () => ({ auth: {
        getUser: async () => ({ data: { user }, error: null }),
        getSession: async () => ({ data: { session } }),
      } }) },
      "next/headers": {
        cookies: async () => ({ getAll: () => [], set() {} }),
        headers: async () => new Headers(),
      },
      "@derslik/api-client": {
        DerslikClient: class { constructor(options) { this.options = options; } },
        ApiError: class extends Error {},
      },
      "@derslik/contracts": { isMessageKey: () => true, translate: (_locale, key) => key },
      "./locale": { serverLocale: async () => "tr" },
      "./client-ip": { clientIp: () => null },
      "./auth-cookies": { AUTH_COOKIE: /^fixture-auth$/, authCookieOptions: () => ({}) },
    },
    globals: { Buffer, Response, process: { env: {
      API_BASE_URL: "https://api.fixture.invalid",
      SUPABASE_URL: "https://identity.fixture.invalid",
      SUPABASE_PUBLISHABLE_KEY: "fixture-public",
      APP_ORIGIN: "https://web.fixture.invalid",
    } } },
  });
}

function streamedRequest(parts, { cancel = () => {}, headers = {} } = {}) {
  let next = 0, reads = 0, canceled = 0;
  const bytes = parts.map((part) => typeof part === "string" ? new TextEncoder().encode(part) : part);
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      if (next < bytes.length) controller.enqueue(bytes[next++]);
      else controller.close();
    },
    cancel() { canceled++; return cancel(); },
  }, { highWaterMark: 0 });
  return {
    request: new Request("https://web.fixture.invalid/api/example", {
      method: "POST", body, duplex: "half", headers,
    }),
    get reads() { return reads; },
    get canceled() { return canceled; },
  };
}
const httpError = (fixture, status, message) => (error) => {
  assert.ok(error instanceof fixture.HttpError);
  assert.equal(error.status, status);
  assert.equal(error.message, message);
  return true;
};

test("request body accepts valid JSON across chunk and UTF-8 character boundaries", async () => {
  const fixture = sessionFixture();
  const content = new TextEncoder().encode('{"name":"Öğrenci 🎓"}');
  const stream = streamedRequest([content.slice(0, 10), content.slice(10, 12), content.slice(12)]);
  const parsed = await fixture.readBody(stream.request, content.byteLength);
  assert.equal(parsed.name, "Öğrenci 🎓");
  assert.equal(stream.canceled, 0);
});

test("request body checks advertised size before acquiring a stream reader", async () => {
  const fixture = sessionFixture();
  let acquired = false;
  const request = {
    headers: new Headers({ "Content-Length": "101" }),
    body: { getReader() { acquired = true; throw new Error("body must remain unread"); } },
  };
  await assert.rejects(fixture.readBody(request, 100), httpError(fixture, 413, "web.requestTooLarge"));
  assert.equal(acquired, false);
});

test("request body counts encoded bytes rather than Unicode characters", async () => {
  const fixture = sessionFixture();
  const text = '{"name":"🎓"}';
  const stream = streamedRequest([text]);
  assert.ok(new TextEncoder().encode(text).byteLength > text.length);
  await assert.rejects(fixture.readBody(stream.request, text.length), httpError(fixture, 413, "web.requestTooLarge"));
  assert.equal(stream.canceled, 1);
});

test("oversized streaming body stops consuming input and finishes cancellation before rejecting", { timeout: 5000 }, async () => {
  const fixture = sessionFixture();
  const cancelled = Promise.withResolvers();
  const cleanup = Promise.withResolvers();
  const stream = streamedRequest(["{", "x".repeat(100), "must not be read"], {
    cancel: () => { cancelled.resolve(); return cleanup.promise; },
  });
  let finished = false;
  const rejected = assert.rejects(
    fixture.readBody(stream.request, 50),
    httpError(fixture, 413, "web.requestTooLarge"),
  ).finally(() => { finished = true; });
  await cancelled.promise;
  assert.equal(stream.reads, 2);
  assert.equal(stream.canceled, 1);
  assert.equal(finished, false);
  cleanup.resolve();
  await rejected;
});

test("a rejected stream cancellation still returns the intended payload-too-large error", async () => {
  const fixture = sessionFixture();
  const stream = streamedRequest(["x".repeat(100)], {
    cancel: () => Promise.reject(new Error("fixture transport cleanup failed")),
  });
  await assert.rejects(fixture.readBody(stream.request, 50), httpError(fixture, 413, "web.requestTooLarge"));
  assert.equal(stream.canceled, 1);
});

test("empty and malformed bodies return a readable client error", async () => {
  const fixture = sessionFixture();
  const empty = new Request("https://web.fixture.invalid/api/example", { method: "POST" });
  await assert.rejects(fixture.readBody(empty), httpError(fixture, 400, "web.requestUnreadable"));
  await assert.rejects(fixture.readBody(streamedRequest(["{", "invalid"]).request), httpError(fixture, 400, "web.requestUnreadable"));
});

test("a stream transport error is preserved for the server error handler", async () => {
  const fixture = sessionFixture();
  const failure = new Error("fixture interrupted transport");
  const body = new ReadableStream({ pull(controller) { controller.error(failure); } });
  const request = new Request("https://web.fixture.invalid/api/example", { method: "POST", body, duplex: "half" });
  await assert.rejects(fixture.readBody(request), (error) => error === failure);
});

test("authenticated server API client receives a Promise token provider and the server locale", async () => {
  const fixture = sessionFixture();
  const result = await fixture.serverSession();
  assert.equal(result.user.id, "fixture-user");
  assert.equal(result.client.options.baseUrl, "https://api.fixture.invalid");
  const token = result.client.options.getToken();
  assert.equal(typeof token.then, "function");
  assert.equal(await token, "fixture-session");
  assert.equal(result.client.options.locale(), "tr");
});

test("missing identity or session never creates an authenticated API client", async () => {
  const anonymous = sessionFixture({ user: null });
  await assert.rejects(anonymous.serverSession(), httpError(anonymous, 401, "web.signIn"));
  const expired = sessionFixture({ session: null });
  await assert.rejects(expired.serverSession(), httpError(expired, 401, "web.sessionEnded"));
});

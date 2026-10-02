import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sites } from "../build/sites-vite-plugin.ts";

async function fixture(t, command = "build") {
  const root = await mkdtemp(join(tmpdir(), "derslik-site-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = sites({ mockAuth: false });
  plugin.configResolved({ root, command });
  return { root, build: () => plugin.closeBundle() };
}

test("portable build without hosting metadata removes stale deployment metadata", async (t) => {
  const { root, build } = await fixture(t);
  await mkdir(join(root, "dist", ".openai"), { recursive: true });
  await writeFile(join(root, "dist", ".openai", "hosting.json"), "stale");
  await build();
  await assert.rejects(access(join(root, "dist", ".openai")), {
    code: "ENOENT",
  });
});

test("configured build preserves hosting metadata and migration history", async (t) => {
  const { root, build } = await fixture(t);
  await mkdir(join(root, ".openai"));
  await mkdir(join(root, "drizzle"));
  const metadata = JSON.stringify({ site_id: "test-site" });
  await writeFile(join(root, ".openai", "hosting.json"), metadata);
  await writeFile(join(root, "drizzle", "0000.sql"), "select 1;");
  await build();
  assert.equal(
    await readFile(join(root, "dist", ".openai", "hosting.json"), "utf8"),
    metadata,
  );
  assert.equal(
    await readFile(
      join(root, "dist", ".openai", "drizzle", "0000.sql"),
      "utf8",
    ),
    "select 1;",
  );
});

test("development server does not alter build metadata", async (t) => {
  const { root, build } = await fixture(t, "serve");
  await mkdir(join(root, "dist", ".openai"), { recursive: true });
  await writeFile(join(root, "dist", ".openai", "hosting.json"), "preserved");
  await build();
  assert.equal(
    await readFile(join(root, "dist", ".openai", "hosting.json"), "utf8"),
    "preserved",
  );
});

// Local mock sign-in middleware (dev server only). The fake request and
// response record exactly what the middleware does to them.
function devServer({ secure = false } = {}) {
  const messages = [];
  let middleware;
  const server = {
    config: {
      server: { https: secure },
      logger: { info: (m) => messages.push(m) },
    },
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  };
  sites().configureServer(server);
  return { messages, middleware };
}

function dispatch(options, request) {
  const { middleware } = devServer(options);
  const headers = { host: "localhost:5173", ...request.headers };
  const rawHeaders = Object.entries(headers).flat();
  const req = {
    url: "/",
    method: "GET",
    ...request,
    headers,
    rawHeaders,
    socket: { remoteAddress: request.remoteAddress ?? "127.0.0.1" },
  };
  const sent = { headers: {}, ended: false, statusCode: undefined };
  const res = {
    set statusCode(value) {
      sent.statusCode = value;
    },
    setHeader(name, value) {
      sent.headers[name] = value;
    },
    end() {
      sent.ended = true;
    },
  };
  let next = false;
  middleware(req, res, () => {
    next = true;
  });
  return {
    status: sent.statusCode,
    headers: sent.headers,
    ended: sent.ended,
    next,
    requestHeaders: req.headers,
    rawHeaders: req.rawHeaders,
  };
}

const noStore = { "Cache-Control": "private, no-store" };
const answered = (status, headers = noStore) => ({
  status,
  headers,
  ended: true,
  next: false,
});
const passed = { status: undefined, headers: {}, ended: false, next: true };
const pick = (result) => ({
  status: result.status,
  headers: result.headers,
  ended: result.ended,
  next: result.next,
});

test("development middleware registers only with mock sign-in and announces the local account", () => {
  const { messages, middleware } = devServer();
  assert.equal(typeof middleware, "function");
  assert.deepEqual(messages, ["Sites local sign-in: seedy@sites.test"]);
  let registered = false;
  sites({ mockAuth: false }).configureServer({
    config: { server: {}, logger: { info() {} } },
    middlewares: {
      use() {
        registered = true;
      },
    },
  });
  assert.equal(registered, false);
});

test("development middleware leaves non-local and unparsable requests alone, refusing only auth paths", () => {
  const cases = [
    [{ headers: { host: "bad host" }, url: "/page" }, passed],
    [{ headers: { host: "bad host" }, url: "/callback?x=1" }, answered(403)],
    [{ headers: { host: "example.com" }, url: "/page" }, passed],
    [
      { headers: { host: "example.com" }, url: "/signin-with-chatgpt" },
      answered(403),
    ],
    [{ remoteAddress: "10.0.0.8", url: "/page" }, passed],
    [
      { remoteAddress: "10.0.0.8", url: "/signout-with-chatgpt" },
      answered(403),
    ],
    [{ url: "http://evil.test/page" }, passed],
    [{ url: "http://evil.test/signin-with-chatgpt" }, answered(403)],
    [{ url: "http://evil.test/callback" }, answered(403)],
    [
      { headers: { host: "[::1]:5173" }, remoteAddress: "::1", url: "/page" },
      passed,
    ],
    [{ headers: { host: "LOCALHOST" }, url: "/callback" }, answered(501)],
    [
      {
        headers: { host: "127.0.0.1:5173" },
        remoteAddress: "::ffff:127.0.0.1",
        url: "/callback",
      },
      answered(501),
    ],
  ];
  for (const [request, expected] of cases)
    assert.deepEqual(
      pick(dispatch({}, request)),
      expected,
      JSON.stringify(request),
    );
});

test("development middleware strips spoofed identity headers and only trusts exactly one sign-in cookie", () => {
  const spoofed = {
    "oai-authenticated-user-id": "attacker",
    "oai-authenticated-user-email": "a@b.c",
    "x-other": "kept",
  };
  const plain = dispatch({}, { headers: spoofed, url: "/page" });
  assert.equal(plain.next, true);
  assert.deepEqual(plain.requestHeaders, {
    host: "localhost:5173",
    "x-other": "kept",
  });
  assert.deepEqual(plain.rawHeaders, [
    "host",
    "localhost:5173",
    "x-other",
    "kept",
  ]);

  const signedIn = dispatch(
    {},
    {
      headers: { cookie: "theme=dark; __sites_local_auth=1; lang=tr" },
      url: "/page",
    },
  );
  assert.equal(signedIn.next, true);
  assert.deepEqual(signedIn.requestHeaders, {
    host: "localhost:5173",
    cookie: "theme=dark; lang=tr",
    "oai-authenticated-user-id": "local_seedy",
    "oai-authenticated-user-email": "seedy@sites.test",
    "oai-authenticated-user-full-name": "Seedy",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  assert.deepEqual(signedIn.rawHeaders, [
    "host",
    "localhost:5173",
    "cookie",
    "theme=dark; lang=tr",
    "oai-authenticated-user-id",
    "local_seedy",
    "oai-authenticated-user-email",
    "seedy@sites.test",
    "oai-authenticated-user-full-name",
    "Seedy",
    "oai-authenticated-user-full-name-encoding",
    "percent-encoded-utf-8",
  ]);

  const onlyAuthCookie = dispatch(
    {},
    { headers: { cookie: "__sites_local_auth=1" }, url: "/page" },
  );
  assert.equal(onlyAuthCookie.requestHeaders.cookie, undefined);
  assert.equal(
    onlyAuthCookie.requestHeaders["oai-authenticated-user-id"],
    "local_seedy",
  );

  for (const cookie of [
    "__sites_local_auth=0",
    "__sites_local_auth=1; __sites_local_auth=1",
    "__sites_local_auth=",
    "theme=dark",
  ]) {
    const result = dispatch({}, { headers: { cookie }, url: "/page" });
    assert.equal(result.next, true, cookie);
    assert.equal(
      result.requestHeaders["oai-authenticated-user-id"],
      undefined,
      cookie,
    );
  }
  assert.equal(
    dispatch({}, { headers: { cookie: "theme=dark; a=b" }, url: "/page" })
      .requestHeaders.cookie,
    "theme=dark; a=b",
  );
});

test("development middleware refuses cross-site and answers prefetches without signing in", () => {
  const auth = { url: "/signin-with-chatgpt" };
  const cases = [
    [{ ...auth, headers: { origin: "http://evil.test" } }, answered(403)],
    [{ ...auth, headers: { "sec-fetch-site": "cross-site" } }, answered(403)],
    [{ ...auth, headers: { origin: "http://localhost:5173" } }, undefined],
    [{ ...auth, headers: { "next-router-prefetch": "1" } }, answered(204)],
    [{ ...auth, headers: { "next-router-prefetch": "" } }, answered(204)],
    [{ ...auth, headers: { "x-middleware-prefetch": "1" } }, answered(204)],
    [{ ...auth, headers: { "x-middleware-prefetch": "0" } }, undefined],
    [{ ...auth, headers: { purpose: "prefetch" } }, answered(204)],
    [
      { ...auth, headers: { "sec-purpose": "prefetch;anonymous-client-ip" } },
      answered(204),
    ],
    [{ ...auth, headers: { purpose: " Prefetch , other" } }, answered(204)],
    [{ ...auth, headers: { purpose: "prerender" } }, undefined],
    [{ ...auth, method: "POST" }, answered(405, { ...noStore, Allow: "GET" })],
    [
      { url: "/signout-with-chatgpt", method: "PUT" },
      answered(405, { ...noStore, Allow: "GET, POST" }),
    ],
    [
      { url: "/signout-with-chatgpt", method: "DELETE" },
      answered(405, { ...noStore, Allow: "GET, POST" }),
    ],
  ];
  for (const [request, expected] of cases) {
    const result = dispatch({}, request);
    assert.equal(result.requestHeaders["oai-authenticated-user-id"], undefined);
    if (expected)
      assert.deepEqual(pick(result), expected, JSON.stringify(request));
    else assert.equal(result.status, 302, JSON.stringify(request));
  }
});

test("development middleware signs in and out with a safe redirect and a scoped cookie", () => {
  const cookie = (value, ...flags) =>
    ["__sites_local_auth=" + value, "Path=/", ...flags].join("; ");
  const redirect = (status, location, setCookie) =>
    answered(status, {
      "Cache-Control": "private, no-store",
      Location: location,
      "Set-Cookie": setCookie,
    });
  const secureCookie = (value, ...flags) =>
    cookie(value, ...flags, "HttpOnly", "SameSite=Lax", "Secure");
  const plainCookie = (value, ...flags) =>
    cookie(value, ...flags, "HttpOnly", "SameSite=Lax");
  const cases = [
    [{}, { url: "/signin-with-chatgpt" }, redirect(302, "/", plainCookie("1"))],
    [
      {},
      { url: "/signin-with-chatgpt?return_to=/dashboard%3Fa%3D1%23top" },
      redirect(302, "/dashboard?a=1#top", plainCookie("1")),
    ],
    [
      {},
      { url: "/signin-with-chatgpt?return_to=//evil.test" },
      redirect(302, "/", plainCookie("1")),
    ],
    [
      {},
      { url: "/signin-with-chatgpt?return_to=https://evil.test/x" },
      redirect(302, "/", plainCookie("1")),
    ],
    [
      {},
      { url: "/signin-with-chatgpt?return_to=/callback" },
      redirect(302, "/", plainCookie("1")),
    ],
    [
      {},
      { url: "/signin-with-chatgpt?return_to=/signout-with-chatgpt%3Fx" },
      redirect(302, "/", plainCookie("1")),
    ],
    [
      {},
      { url: "/signout-with-chatgpt?return_to=/bye" },
      redirect(302, "/bye", plainCookie("", "Max-Age=0")),
    ],
    [
      {},
      { url: "/signout-with-chatgpt", method: "POST" },
      redirect(303, "/", plainCookie("", "Max-Age=0")),
    ],
    [
      { secure: true },
      { url: "/signin-with-chatgpt", headers: { host: "localhost:5173" } },
      redirect(302, "/", secureCookie("1")),
    ],
    [
      { secure: true },
      { url: "/signout-with-chatgpt", method: "POST" },
      redirect(303, "/", secureCookie("", "Max-Age=0")),
    ],
  ];
  for (const [options, request, expected] of cases)
    assert.deepEqual(
      pick(dispatch(options, request)),
      expected,
      JSON.stringify(request),
    );
});

import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

export async function startWebSecurityHarness({
  port = 0,
  backend,
  fixture,
  ipHeader = "x-forwarded-for",
} = {}) {
  const userId = randomUUID(),
    workspaceId = randomUUID(),
    calendarToken = randomBytes(32).toString("hex");
  const requests = [];
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "web-security",
    alg: "ES256",
  };
  const token = await new SignJWT({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
  })
    .setProtectedHeader({ alg: "ES256", kid: "web-security" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  const defaultAccount = {
    id: userId,
    token,
    email: "web-security@example.test",
    password: "web-security-test-only",
  };
  const accounts =
    fixture?.accounts ??
    (fixture?.actors
      ? Object.entries(fixture.actors).map(([name, account]) => ({
          ...account,
          name,
          password: "web-security-test-only",
        }))
      : [defaultAccount]);
  const accountUser = (account) => ({
    id: account.id,
    email: account.email,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email" },
    user_metadata: {},
    identities: [],
  });
  const upstream = createServer(async (req, res) => {
    const reply = (status, payload) =>
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(payload));
    requests.push({ method: req.method, url: req.url });
    if (requests.length > 1000) requests.shift();
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/auth/v1/settings")
      return reply(200, {
        external: { google: true, apple: false, azure: false },
      });
    if (url.pathname === "/auth/v1/.well-known/jwks.json")
      return reply(200, {
        keys:
          fixture?.jwks ?? (fixture?.publicJwk ? [fixture.publicJwk] : [jwk]),
      });
    if (url.pathname === "/auth/v1/token") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const account = accounts.find(
        (a) => a.email === body.email && a.password === body.password,
      );
      if (!account)
        return reply(400, {
          error: "invalid_grant",
          error_description: "Invalid credentials",
        });
      return reply(200, {
        access_token: account.token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: randomUUID(),
        user: accountUser(account),
      });
    }
    const account = accounts.find(
      (a) => req.headers.authorization === `Bearer ${a.token}`,
    );
    if (url.pathname === "/auth/v1/user")
      return reply(
        account ? 200 : 401,
        account ? accountUser(account) : { error: "Unauthorized" },
      );
    if (url.pathname === "/auth/v1/logout") return res.writeHead(204).end();
    if (
      url.pathname === "/auth/v1/signup" ||
      url.pathname === "/auth/v1/recover"
    )
      return reply(200, { user: null, session: null });
    if (url.pathname === "/v1/teachers")
      return reply(200, { data: [], total: 0 });
    // Calendar apps read the feed without a session; only one token exists.
    const feed = /^\/v1\/calendar\/([a-f0-9]{64})$/.exec(url.pathname);
    if (feed) {
      if (feed[1] !== calendarToken)
        return reply(404, { error: { message: "Calendar not found" } });
      return res
        .writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" })
        .end(
          "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Derslik//Test//EN\r\nEND:VCALENDAR\r\n",
        );
    }
    if (url.pathname === `/v1/teachers/${workspaceId}/photo`) {
      if (!account)
        return reply(404, { error: { message: "Unpublished teacher" } });
      return res
        .writeHead(200, { "Content-Type": "image/png" })
        .end(Buffer.from("89504e470d0a1a0a", "hex"));
    }
    if (!account) return reply(401, { error: { message: "Unauthorized" } });
    if (url.pathname === "/v1/access")
      return reply(200, {
        data: [{ id: workspaceId, name: "Web security test", role: "OWNER" }],
      });
    if (url.pathname === `/v1/workspaces/${workspaceId}/snapshot`)
      return reply(200, {
        students: [],
        lessons: [],
        packages: [],
        payments: [],
        credits: [],
        notes: [],
        serverTime: new Date().toISOString(),
      });
    return reply(404, { error: { message: "Unknown fixture route" } });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  if (!port) {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
  }
  const origin = `http://127.0.0.1:${port}`;
  let logs = "";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: fileURLToPath(new URL("../apps/web", import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        API_BASE_URL: backend ?? upstreamUrl,
        SUPABASE_URL: upstreamUrl,
        SUPABASE_PUBLISHABLE_KEY: "web-security-fixture-public-key",
        APP_ORIGIN: origin,
        CLIENT_IP_HEADER: ipHeader,
        TURNSTILE_SITE_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) => {
    logs = (logs + data).slice(-4000);
  });
  child.stderr.on("data", (data) => {
    logs = (logs + data).slice(-4000);
  });
  const close = async () => {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) =>
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000).unref(),
      ),
    ]);
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("Next stopped: " + logs);
      try {
        const r = await fetch(origin + "/api/session");
        if (r.status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Next did not become ready: " + logs);
  } catch (error) {
    await close();
    throw error;
  }
  const makeClient = () => {
    const jar = new Map();
    const call = async (
      path,
      {
        body,
        method = body === undefined ? "GET" : "POST",
        headers = {},
        raw = false,
      } = {},
    ) => {
      const reqHeaders = {
        "Content-Type": "application/json",
        "X-Derslik-Client": "web",
        Origin: origin,
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      };
      for (const key of Object.keys(reqHeaders))
        if (reqHeaders[key] === undefined) delete reqHeaders[key];
      const r = await fetch(origin + path, {
        method,
        headers: reqHeaders,
        ...(body === undefined
          ? {}
          : { body: raw ? body : JSON.stringify(body) }),
        redirect: "manual",
      });
      for (const value of r.headers.getSetCookie()) {
        const first = value.split(";")[0],
          i = first.indexOf("=");
        jar.set(first.slice(0, i), first.slice(i + 1));
      }
      return r;
    };
    return {
      jar,
      call,
      login: (account = accounts[0]) =>
        call("/api/auth/signin", {
          body: { email: account.email, password: account.password },
        }),
    };
  };
  return {
    origin,
    upstreamUrl,
    requests,
    accounts,
    workspaceId,
    calendarToken,
    child,
    close,
    makeClient,
  };
}

if (process.argv.includes("--serve")) {
  const fixturePath = process.env.WEB_SECURITY_FIXTURE;
  const fixture = fixturePath
    ? JSON.parse(await readFile(fixturePath, "utf8"))
    : undefined;
  const harness = await startWebSecurityHarness({
    port: Number(process.env.WEB_SECURITY_PORT || 3100),
    backend: process.env.WEB_SECURITY_BACKEND,
    fixture,
  });
  const outputPath =
    process.env.WEB_SECURITY_SESSION ||
    "/tmp/derslik-web-security-session.json";
  const sessions = [];
  for (const account of harness.accounts) {
    const client = harness.makeClient();
    const login = await client.login(account);
    if (login.status !== 200)
      throw new Error("Fixture login failed: " + login.status);
    sessions.push({
      id: account.id,
      name: account.name,
      cookie: [...client.jar].map(([k, v]) => `${k}=${v}`).join("; "),
    });
  }
  await writeFile(
    outputPath,
    JSON.stringify({ origin: harness.origin, accounts: sessions }, null, 2),
    { mode: 0o600 },
  );
  await chmod(outputPath, 0o600);
  console.log(
    `Isolated web ready at ${harness.origin}; pid=${harness.child.pid}; sessionFile=${outputPath}`,
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await harness.close();
      process.exit(0);
    });
}

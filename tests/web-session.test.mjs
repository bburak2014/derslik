import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { fileURLToPath } from "node:url";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
test(
  "Next.js BFF / HTTP-only session / CSRF / fixed central API",
  { timeout: 45000 },
  async () => {
    const userId = randomUUID(),
      ws = randomUUID(),
      foreign = randomUUID();
    const { privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "teacher@example.test",
      email_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      identities: [],
    };
    let unavailable = false;
    const upstream = createServer(async (req, res) => {
      const reply = (status, data) =>
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(data));
      if (req.url === "/auth/v1/settings")
        return reply(200, {
          external: { google: true, apple: false, azure: true, github: true },
        });
      if (req.url.startsWith("/auth/v1/token")) {
        let body = "";
        for await (const c of req) body += c;
        const credentials = JSON.parse(body);
        if (
          credentials.email !== user.email ||
          credentials.password !== "test-password-only"
        )
          return reply(400, { error: "invalid_grant" });
        return reply(200, {
          access_token: token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: randomUUID(),
          user,
        });
      }
      if (req.url === "/auth/v1/user")
        return reply(
          req.headers.authorization === `Bearer ${token}` ? 200 : 401,
          user,
        );
      if (req.url.startsWith("/auth/v1/logout")) {
        res.writeHead(204).end();
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`)
        return reply(401, { error: { message: "Unauthorized" } });
      if (req.url === "/v1/access")
        return reply(200, {
          data: [{ id: ws, name: "Test alanı", role: "OWNER" }],
        });
      if (req.url === `/v1/workspaces/${ws}/snapshot`)
        return reply(200, {
          students: [],
          packages: [],
          lessons: [],
          payments: [],
          credits: [],
          notes: [],
          serverTime: new Date().toISOString(),
        });
      if (req.url === `/v1/workspaces/${ws}/commands`)
        return unavailable
          ? reply(503, { error: { message: "Central API unavailable" } })
          : reply(201, { data: { id: randomUUID() } });
      if (req.url === `/v1/workspaces/${foreign}/snapshot`)
        return reply(403, { error: { message: "Workspace forbidden" } });
      return reply(404, { error: { message: "Unknown route" } });
    });
    const upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`,
      reservation = createServer(),
      port = await listen(reservation);
    await new Promise((r) => reservation.close(r));
    const origin = `http://127.0.0.1:${port}`,
      webRoot = fileURLToPath(new URL("../apps/web", import.meta.url)),
      jar = new Map();
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
        cwd: webRoot,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          API_BASE_URL: upstreamUrl,
          SUPABASE_URL: upstreamUrl,
          SUPABASE_PUBLISHABLE_KEY: "test-public-key",
          APP_ORIGIN: origin,
          // The old hosting flag must never activate a second backend.
          DERSLIK_HOSTING: "sites",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (x) => {
      logs = (logs + x).slice(-4000);
    });
    child.stderr.on("data", (x) => {
      logs = (logs + x).slice(-4000);
    });
    async function call(path, body, headers = {}) {
      const r = await fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Derslik-Client": "web",
          Origin: origin,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
      });
      for (const value of r.headers.getSetCookie()) {
        const first = value.split(";")[0],
          i = first.indexOf("=");
        jar.set(first.slice(0, i), first.slice(i + 1));
      }
      return r;
    }
    try {
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null)
          throw new Error("Next server stopped: " + logs);
        try {
          const r = await fetch(origin + "/api/session");
          if (r.status === 401) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal((await call("/api/session")).status, 401);
      assert.deepEqual(await (await call("/api/auth/providers")).json(), {
        providers: ["google", "azure"],
      });
      assert.equal(
        (await call("/api/auth/oauth", { provider: "github" })).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/api/auth/oauth",
            { provider: "google" },
            { Origin: "https://foreign.example" },
          )
        ).status,
        403,
      );
      const oauth = await call("/api/auth/oauth", {
        provider: "google",
        next: "https://foreign.example",
      });
      assert.equal(oauth.status, 200);
      const authorize = new URL((await oauth.json()).url);
      assert.equal(authorize.origin, upstreamUrl);
      assert.equal(authorize.searchParams.get("provider"), "google");
      assert.equal(
        authorize.searchParams.get("redirect_to"),
        origin + "/api/auth/callback",
      );
      assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
      assert.ok(authorize.searchParams.get("code_challenge"));
      assert.equal(decodeURIComponent(jar.get("derslik-auth-next")), "/");
      assert.ok(
        oauth.headers
          .getSetCookie()
          .some((c) => c.includes("code-verifier") && /HttpOnly/i.test(c)),
      );
      const body = { email: user.email, password: "test-password-only" };
      assert.equal(
        (
          await call("/api/auth/signin", body, {
            Origin: "https://foreign.example",
          })
        ).status,
        403,
      );
      assert.equal(
        (await call("/api/auth/signin", body, { "X-Derslik-Client": "" }))
          .status,
        415,
      );
      const login = await call("/api/auth/signin", body);
      assert.equal(login.status, 200, await login.clone().text());
      assert.ok(
        login.headers
          .getSetCookie()
          .some((c) => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)),
      );
      const session = await (await call("/api/session")).json();
      assert.equal(session.user.id, userId);
      assert.equal(session.active.id, ws);
      assert.ok(!JSON.stringify(session).includes(token));
      assert.equal(
        (await call("/api/session", { key: `${foreign}:OWNER:` })).status,
        403,
      );
      assert.equal((await call("/api/workspace")).status, 200);
      assert.equal((await call("/api/teaching")).status, 404);
      assert.equal(
        (await call(`/api/backend/workspaces/${foreign}/snapshot`)).status,
        403,
      );
      assert.equal(
        (await call("/api/backend/webhooks/stream", {})).status,
        400,
      );
      unavailable = true;
      const command = {
        action: "student.create",
        name: "Test",
        subject: "Math",
        grade: "",
        phone: "",
        email: "",
      };
      const failed = await call("/api/workspace", command, {
        "Idempotency-Key": randomUUID(),
      });
      assert.equal(failed.status, 503);
      assert.match((await failed.json()).error, /Central API/);
      assert.equal((await call("/api/auth/signout", {})).status, 200);
      assert.equal((await call("/api/session")).status, 401);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      });
      await new Promise((r) => upstream.close(r));
    }
  },
);

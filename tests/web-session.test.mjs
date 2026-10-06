import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
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
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "web-test",
      alg: "ES256",
    };
    const sign = (claims = {}) =>
      new SignJWT({
        sub: userId,
        role: "authenticated",
        aud: "authenticated",
        ...claims,
      })
        .setProtectedHeader({ alg: "ES256", kid: "web-test" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
    // Şifre yalnızca sıfırlama bağlantısıyla açılan oturumda değişir (amr).
    const passwordToken = await sign({
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    });
    const recoveryToken = await sign({
      amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) }],
    });
    let token = passwordToken,
      passwordChanged = false;
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
    let unavailable = false,
      lastRedirect = null;
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
        // CAPTCHA açık bir Supabase gibi: belirteç yoksa ya da geçersizse red.
        if (credentials.gotrue_meta_security?.captcha_token !== "ok-token")
          return reply(400, {
            code: 400,
            error_code: "captcha_failed",
            msg: "captcha protection: request disallowed",
          });
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
      if (
        req.url.startsWith("/auth/v1/signup") ||
        req.url.startsWith("/auth/v1/recover")
      ) {
        let body = "";
        for await (const c of req) body += c;
        lastRedirect = new URL(
          req.url,
          "http://upstream.test",
        ).searchParams.get("redirect_to");
        if (JSON.parse(body).gotrue_meta_security?.captcha_token !== "ok-token")
          return reply(400, {
            code: 400,
            error_code: "captcha_failed",
            msg: "captcha protection: request disallowed",
          });
        return reply(200, req.url.startsWith("/auth/v1/signup") ? user : {});
      }
      if (req.url === "/auth/v1/.well-known/jwks.json")
        return reply(200, { keys: [jwk] });
      if (req.url === "/auth/v1/user" && req.method === "PUT") {
        if (req.headers.authorization !== `Bearer ${token}`)
          return reply(401, {});
        passwordChanged = true;
        return reply(200, user);
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
      if (req.url === "/v1/socket/ticket" && req.method === "POST")
        return reply(201, { data: { ticket: "a".repeat(64), expiresIn: 30 } });
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
          // Minified Turbopack SSR maps can mark uncalled client methods as
          // covered. Direct source tests collect coverage; this HTTP test
          // still verifies the production server without importing its maps.
          ...(process.env.DERSLIK_TEST_COVERAGE === "1" ? { NODE_V8_COVERAGE: "" } : {}),
          NEXT_TELEMETRY_DISABLED: "1",
          API_BASE_URL: upstreamUrl,
          SUPABASE_URL: upstreamUrl,
          SUPABASE_PUBLISHABLE_KEY: "test-public-key",
          APP_ORIGIN: origin,
          // The old hosting flag must never activate a second backend.
          DERSLIK_HOSTING: "sites",
          // Testteki istemci, önündeki vekil gibi davranıp başlığı yazar.
          CLIENT_IP_HEADER: "x-forwarded-for",
          // Cloudflare'in her zaman geçen test site anahtarı.
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
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
        captchaSiteKey: "1x00000000000000000000AA",
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
      // Azure e-posta kapsamı ister; geçerli bir sonraki adres çerezde saklanır.
      const inviteNext = "/invite/" + "a".repeat(64);
      const azure = await call("/api/auth/oauth", {
        provider: "azure",
        next: inviteNext,
      });
      assert.equal(azure.status, 200);
      const azureUrl = new URL((await azure.json()).url);
      assert.equal(azureUrl.searchParams.get("provider"), "azure");
      assert.equal(azureUrl.searchParams.get("scopes"), "email");
      assert.equal(authorize.searchParams.get("scopes"), null);
      assert.equal(
        decodeURIComponent(jar.get("derslik-auth-next")),
        inviteNext,
      );
      const body = {
        email: user.email,
        password: "test-password-only",
        captchaToken: "ok-token",
      };
      // CAPTCHA açıkken belirteçsiz istek Supabase'e gitmeden reddedilir;
      // Supabase'in reddettiği belirteç ayrı bir iletiyle döner.
      const missing = await call("/api/auth/signin", {
        email: user.email,
        password: "test-password-only",
      });
      assert.equal(missing.status, 400);
      assert.match(
        (await missing.json()).error,
        /complete the security check/i,
      );
      const rejected = await call("/api/auth/signin", {
        ...body,
        captchaToken: "bad-token",
      });
      assert.equal(rejected.status, 400);
      assert.match((await rejected.json()).error, /security check failed/i);
      assert.equal(
        (
          await call("/api/auth/recover", {
            email: user.email,
          })
        ).status,
        400,
      );
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
      // Geçersiz girdi, bilinmeyen eylem, kayıt ve sıfırlama (kendi IP'siyle,
      // sınırlar diğer denemelerle karışmasın).
      const fresh = { "X-Forwarded-For": "198.51.100.77" };
      const unknown = await call("/api/auth/nope", {}, fresh);
      assert.equal(unknown.status, 404);
      assert.match((await unknown.json()).error, /Action not found/);
      const badSignin = await call(
        "/api/auth/signin",
        { email: "not-an-email", password: "x" },
        fresh,
      );
      assert.equal(badSignin.status, 400);
      assert.match(
        (await badSignin.json()).error,
        /valid email and a password/,
      );
      const wrongPassword = await call(
        "/api/auth/signin",
        { ...body, password: "wrong-password" },
        fresh,
      );
      assert.equal(wrongPassword.status, 400);
      assert.match((await wrongPassword.json()).error, /Couldn't sign in/);
      const shortSignup = await call(
        "/api/auth/signup",
        { ...body, password: "short" },
        fresh,
      );
      assert.equal(shortSignup.status, 400);
      assert.match(
        (await shortSignup.json()).error,
        /valid email and a password/,
      );
      const noCaptchaSignup = await call(
        "/api/auth/signup",
        { email: "new@example.test", password: "long-enough-password" },
        fresh,
      );
      assert.equal(noCaptchaSignup.status, 400);
      assert.match(
        (await noCaptchaSignup.json()).error,
        /complete the security check/i,
      );
      const signup = { ...body, email: "New@Example.test" };
      const created = await call("/api/auth/signup", signup, fresh);
      assert.equal(created.status, 200, await created.clone().text());
      assert.deepEqual(await created.json(), {
        ok: true,
        confirmationRequired: true,
      });
      assert.equal(lastRedirect, origin + "/api/auth/callback");
      const invited = await call(
        "/api/auth/signup",
        { ...signup, next: inviteNext },
        fresh,
      );
      assert.equal(invited.status, 200);
      assert.equal(
        lastRedirect,
        origin + "/api/auth/callback?next=" + encodeURIComponent(inviteNext),
      );
      const foreignNext = await call(
        "/api/auth/signup",
        { ...signup, next: "https://foreign.example" },
        fresh,
      );
      assert.equal(foreignNext.status, 200);
      assert.equal(lastRedirect, origin + "/api/auth/callback");
      const badSignup = await call(
        "/api/auth/signup",
        { ...signup, captchaToken: "bad-token" },
        fresh,
      );
      assert.equal(badSignup.status, 400);
      assert.match((await badSignup.json()).error, /security check failed/i);
      const invalidRecover = await call(
        "/api/auth/recover",
        { email: "not-an-email" },
        fresh,
      );
      assert.equal(invalidRecover.status, 400);
      assert.match((await invalidRecover.json()).error, /valid email/i);
      const recovered = await call(
        "/api/auth/recover",
        { email: user.email, captchaToken: "ok-token" },
        fresh,
      );
      assert.equal(recovered.status, 200, await recovered.clone().text());
      assert.deepEqual(await recovered.json(), { ok: true });
      assert.equal(
        lastRedirect,
        origin + "/api/auth/callback?next=/reset-password",
      );
      const badRecover = await call(
        "/api/auth/recover",
        { email: user.email, captchaToken: "bad-token" },
        fresh,
      );
      assert.equal(badRecover.status, 400);
      assert.match((await badRecover.json()).error, /security check failed/i);
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
      // İstek ekrandaki alanı taşır: başka sekmede hesap ya da alan
      // değiştiyse eski ekranın isteği yeni hesaba gitmez.
      const shown = { "X-Derslik-Workspace": ws };
      assert.equal((await call("/api/workspace", undefined, shown)).status, 200);
      for (const headers of [{}, { "X-Derslik-Workspace": foreign }]) {
        const stale = await call("/api/workspace", undefined, headers);
        assert.equal(stale.status, 409);
        assert.equal((await stale.json()).accountChanged, true);
        const write = await call(
          "/api/workspace",
          {
            action: "student.create",
            name: "Eski sekme",
            subject: "Math",
            grade: "",
            phone: "",
            email: "",
          },
          { ...headers, "Idempotency-Key": randomUUID() },
        );
        assert.equal(write.status, 409);
      }
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
        ...shown,
        "Idempotency-Key": randomUUID(),
      });
      assert.equal(failed.status, 503);
      assert.match((await failed.json()).error, /Central API/);
      // CSP: her istekte yeni nonce; satır içi betik ve Supabase joker
      // karakteri yok, video yükleme adresi izinli.
      const page = await call("/");
      const csp = page.headers.get("content-security-policy");
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      assert.ok(nonce, csp);
      assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
      assert.doesNotMatch(csp, /\*\.supabase\.co/);
      assert.match(csp, /connect-src[^;]*https:\/\/upload\.videodelivery\.net/);
      assert.match(csp, new RegExp("connect-src[^;]*" + upstreamUrl));
      assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
      const html = await page.text();
      assert.ok(html.includes(`nonce="${nonce}"`));
      assert.notEqual(
        /'nonce-([^']+)'/.exec(
          (await call("/")).headers.get("content-security-policy"),
        )?.[1],
        nonce,
      );
      // Anlık mesajlaşma: bilet oturum çereziyle alınır, soket adresi API'nin
      // tarayıcıdan erişilen adresidir ve CSP'de izinlidir.
      const socketOrigin = upstreamUrl.replace(/^http/, "ws");
      assert.match(csp, new RegExp("connect-src[^;]*" + socketOrigin));
      const socket = await call("/api/socket", {});
      assert.equal(socket.status, 200, await socket.clone().text());
      assert.deepEqual((await socket.json()).data, {
        ticket: "a".repeat(64),
        expiresIn: 30,
        url: socketOrigin + "/v1/socket",
      });
      assert.equal(
        (await call("/api/socket", {}, { Origin: "https://foreign.example" }))
          .status,
        403,
      );
      // Şifre değiştirme: normal girişle açılan oturum reddedilir.
      const denied = await call("/api/auth/password", {
        password: "new-password-123",
      });
      assert.equal(denied.status, 403, await denied.clone().text());
      assert.equal(passwordChanged, false);
      assert.equal((await call("/api/auth/signout", {})).status, 200);
      // Sıfırlama bağlantısıyla açılan oturum şifreyi değiştirebilir.
      token = recoveryToken;
      assert.equal((await call("/api/auth/signin", body)).status, 200);
      const changed = await call("/api/auth/password", {
        password: "new-password-123",
      });
      assert.equal(changed.status, 200, await changed.clone().text());
      assert.equal(passwordChanged, true);
      assert.equal((await call("/api/auth/signout", {})).status, 200);
      assert.equal((await call("/api/session")).status, 401);
      // Giriş denemeleri e-posta + IP başına sınırlı: saldırganın IP'si
      // 10 denemeden sonra durur, kurbanın kendi IP'sinden girişi sürer.
      const attacker = { "X-Forwarded-For": "198.51.100.7, 203.0.113.9" };
      let limited;
      for (let i = 0; i < 12 && !limited; i++) {
        const r = await call(
          "/api/auth/signin",
          { ...body, password: "wrong-password" },
          attacker,
        );
        if (r.status === 429) limited = r;
      }
      assert.ok(limited, "signin was never rate limited");
      // Vekilin eklediği son değer sayılır; ilk değeri değiştirmek kaçırmaz.
      assert.equal(
        (
          await call(
            "/api/auth/signin",
            { ...body, password: "wrong-password" },
            { "X-Forwarded-For": "192.0.2.55, 203.0.113.9" },
          )
        ).status,
        429,
      );
      const victim = await call("/api/auth/signin", body, {
        "X-Forwarded-For": "203.0.113.10",
      });
      assert.equal(victim.status, 200, await victim.clone().text());
      assert.equal((await call("/api/auth/signout", {})).status, 200);
      // Şifre değiştirme: kısa şifre ve oturumsuz istek reddedilir.
      const shortPassword = await call("/api/auth/password", {
        password: "short",
      });
      assert.equal(shortPassword.status, 400);
      assert.match(
        (await shortPassword.json()).error,
        /at least 10 characters/,
      );
      const signedOut = await call("/api/auth/password", {
        password: "new-password-123",
      });
      assert.equal(signedOut.status, 401);
      assert.match((await signedOut.json()).error, /sign in/i);
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

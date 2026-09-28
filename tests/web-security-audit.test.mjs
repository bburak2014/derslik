import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { startWebSecurityHarness } from "./web-security-harness.mjs";

test(
  "production Next web security audit with isolated identity/API fixtures",
  { timeout: 45000 },
  async (t) => {
    const web = await startWebSecurityHarness();
    const client = web.makeClient();
    const checks = [];
    const check = async (name, fn) =>
      t.test(name, async () => {
        await fn();
        checks.push({ name, result: "passed" });
      });
    try {
      await check("anonymous protected routes reject access", async () => {
        for (const path of [
          "/api/session",
          "/api/workspace",
          "/api/backend/access",
          "/api/backend/workspaces/00000000-0000-0000-0000-000000000000/snapshot",
        ])
          assert.equal((await client.call(path)).status, 401, path);
      });
      await check(
        "cross-origin, sibling origin, fetch metadata, content type and missing custom header are rejected",
        async () => {
          const body = {
            email: web.accounts[0].email,
            password: web.accounts[0].password,
          };
          for (const headers of [
            { Origin: "https://attacker.example" },
            { Origin: "null" },
            { "Sec-Fetch-Site": "cross-site" },
            { "Sec-Fetch-Site": "same-site" },
          ])
            assert.equal(
              (await client.call("/api/auth/signin", { body, headers })).status,
              403,
            );
          for (const headers of [
            { "Content-Type": "text/plain" },
            { "Content-Type": "application/x-www-form-urlencoded" },
            { "X-Derslik-Client": undefined },
          ])
            assert.equal(
              (await client.call("/api/auth/signin", { body, headers })).status,
              415,
            );
          const preflight = await client.call("/api/auth/signin", {
            method: "OPTIONS",
            headers: {
              Origin: "https://attacker.example",
              "Access-Control-Request-Method": "POST",
              "Access-Control-Request-Headers": "x-derslik-client,content-type",
            },
          });
          assert.equal(
            preflight.headers.get("access-control-allow-origin"),
            null,
          );
        },
      );
      await check(
        "login cookies are HTTP-only and session JSON excludes bearer tokens",
        async () => {
          const response = await client.login();
          assert.equal(response.status, 200);
          assert.ok(
            response.headers
              .getSetCookie()
              .some(
                (cookie) =>
                  /HttpOnly/i.test(cookie) && /SameSite=lax/i.test(cookie),
              ),
          );
          const session = await client.call("/api/session");
          assert.equal(session.status, 200);
          assert.match(
            session.headers.get("cache-control"),
            /private.*no-store/,
          );
          assert.match(session.headers.get("vary"), /Cookie/i);
          assert.ok(!(await session.text()).includes(web.accounts[0].token));
        },
      );
      await check(
        "unsafe API proxy path segments and webhooks are blocked",
        async () => {
          for (const path of [
            "/api/backend/webhooks/stream",
            "/api/backend/%5c%5cattacker.example",
            "/api/backend/%2fattacker.example",
            "/api/backend/access%3fq=x",
            "/api/backend/access%23fragment",
          ])
            assert.equal((await client.call(path)).status, 400, path);
          for (const path of [
            "/api/public/teachers/https:%2f%2fattacker.example",
            "/api/public/teachers/..%2fauth",
            "/api/public/teachers/00000000-0000-0000-0000-000000000000/secret",
          ])
            assert.equal((await client.call(path)).status, 400, path);
        },
      );
      await check(
        "OAuth redirects are allowlisted and callback uses configured origin",
        async () => {
          for (const next of [
            "https://attacker.example",
            "//attacker.example",
            "/\\attacker.example",
            "/invite/" + "a".repeat(64) + "?next=https://attacker.example",
            "javascript:alert(1)",
          ]) {
            const response = await client.call("/api/auth/oauth", {
              body: { provider: "google", next },
            });
            assert.equal(response.status, 200);
            assert.equal(
              decodeURIComponent(client.jar.get("derslik-auth-next")),
              "/",
            );
            const url = new URL((await response.json()).url);
            assert.equal(url.origin, web.upstreamUrl);
            assert.equal(url.searchParams.get("code_challenge_method"), "s256");
          }
          const callback = await client.call(
            "/api/auth/callback?next=https://attacker.example",
            {
              headers: {
                Host: "attacker.example",
                "X-Forwarded-Host": "attacker.example",
              },
            },
          );
          assert.equal(
            callback.headers.get("location"),
            web.origin + "/?auth_error=1",
          );
        },
      );
      await check(
        "malformed, oversized JSON and unsupported methods are rejected",
        async () => {
          assert.equal(
            (await client.call("/api/auth/signin", { body: "{", raw: true }))
              .status,
            400,
          );
          assert.equal(
            (
              await client.call("/api/auth/signin", {
                body: " ".repeat(32000) + "{}",
                raw: true,
              })
            ).status,
            413,
          );
          assert.equal(
            (await client.call("/api/auth/signin", { method: "GET" })).status,
            405,
          );
          assert.equal(
            (await client.call("/api/backend/access", { method: "DELETE" }))
              .status,
            405,
          );
        },
      );
      await check(
        "production pages set nonce CSP and anti-framing headers without reflected executable HTML",
        async () => {
          let previousNonce;
          for (const path of [
            "/?teacher=%3Csvg%20onload%3Dalert(1)%3E",
            "/teachers",
            "/reset-password",
            "/invite/invalid%3Cscript%3E",
          ]) {
            const response = await client.call(path);
            const csp = response.headers.get("content-security-policy");
            assert.match(csp, /frame-ancestors 'none'/);
            assert.doesNotMatch(csp, /script-src[^;]*unsafe-(inline|eval)/);
            assert.equal(response.headers.get("x-frame-options"), "DENY");
            assert.equal(
              response.headers.get("x-content-type-options"),
              "nosniff",
            );
            assert.equal(response.headers.get("x-powered-by"), null);
            const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
            assert.ok(nonce && nonce !== previousNonce);
            previousNonce = nonce;
            const html = await response.text();
            assert.ok(html.includes(`nonce="${nonce}"`));
            assert.ok(!html.includes("<svg onload=alert(1)>"));
          }
        },
      );
      await check(
        "session and workspace tampering cannot manufacture account access",
        async () => {
          assert.equal(
            (
              await client.call("/api/session", {
                body: { key: "00000000-0000-0000-0000-000000000000:OWNER:" },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await client.call("/api/auth/password", {
                body: { password: "new-test-password-only" },
              })
            ).status,
            403,
          );
          const bad = web.makeClient();
          for (const [name] of client.jar)
            if (name.includes("auth-token"))
              bad.jar.set(name, "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0");
          assert.equal((await bad.call("/api/session")).status, 401);
        },
      );
      await check(
        "signed-in teacher photo is not reusable from cache after logout",
        async () => {
          const path = `/api/public/teachers/${web.workspaceId}/photo?v=1`;
          const owner = await client.call(path);
          assert.equal(owner.status, 200);
          const anonymous = await web.makeClient().call(path);
          assert.equal(anonymous.status, 404);
          // A signed-in (possibly unpublished) photo must be revalidated on every
          // use, so it never outlives logout or an account switch in the cache.
          assert.match(owner.headers.get("cache-control"), /private, no-cache/);
          assert.match(owner.headers.get("vary") || "", /Cookie/i);
        },
      );
      await check(
        "oversized streaming body is rejected before it ends",
        async () => {
          const state = await new Promise((resolve, reject) => {
            let responseStatus = null,
              ended = false;
            const req = httpRequest(
              web.origin + "/api/auth/signin",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Derslik-Client": "web",
                  Origin: web.origin,
                  "Transfer-Encoding": "chunked",
                },
              },
              (res) => {
                responseStatus = res.statusCode;
                res.resume();
                res.on("end", () =>
                  resolve({
                    responseStatus,
                    respondedBeforeBodyEnd: !ended,
                    bytesSent: 131072,
                  }),
                );
              },
            );
            req.on("error", reject);
            req.write(" ".repeat(131072));
            setTimeout(() => {
              ended = true;
              req.end("{}");
            }, 500);
          });
          assert.equal(state.responseStatus, 413);
          assert.equal(
            state.respondedBeforeBodyEnd,
            true,
            "Oversized body must be rejected before it is fully read",
          );
        },
      );
      await check("signout removes authenticated API access", async () => {
        assert.equal(
          (await client.call("/api/auth/signout", { body: {} })).status,
          200,
        );
        assert.equal((await client.call("/api/session")).status, 401);
      });
    } finally {
      await web.close();
      await mkdir(new URL("../reports/security/", import.meta.url), {
        recursive: true,
      });
      await writeFile(
        new URL("../reports/security/web-audit-results.json", import.meta.url),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            checks,
            externalServices:
              "Local identity and API mocks only; no production services contacted.",
          },
          null,
          2,
        ),
      );
    }
  },
);

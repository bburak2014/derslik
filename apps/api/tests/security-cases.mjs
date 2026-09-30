import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createApplication } from "../../../.api-build/apps/api/src/main.js";

export async function securityCases({
  t,
  config,
  admin,
  request,
  ok,
  ws,
  wsB,
  student,
  token,
  tokenA,
  tokenB,
  actorA,
}) {
  await t.test(
    "security: missing JWT claims, algorithm confusion and malformed subject fail closed",
    async () => {
      for (const claims of [
        { exp: undefined },
        { iat: undefined },
        { sub: undefined },
        { role: undefined },
        { nbf: Math.floor(Date.now() / 1000) + 600 },
        { sub: "not-a-uuid" },
      ]) {
        assert.equal(
          (
            await request("/v1/workspaces", {
              auth: await token(actorA, claims),
            })
          ).status,
          401,
        );
      }
      const hmac = await new SignJWT({ sub: actorA, role: "authenticated" })
        .setProtectedHeader({ alg: "HS256", kid: "local-test-key" })
        .setIssuer(config.AUTH_ISSUER)
        .setAudience("authenticated")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(new Uint8Array(32));
      const none =
        Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: actorA,
            role: "authenticated",
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        ).toString("base64url") +
        ".";
      for (const auth of [hmac, none])
        assert.equal((await request("/v1/workspaces", { auth })).status, 401);
    },
  );

  await t.test(
    "security: valid foreign mutation bodies cannot write across workspace boundaries",
    async () => {
      const otherStudent = (
        await ok(
          `/v1/workspaces/${wsB}/students`,
          {
            name: "Foreign student fixture",
            grade: "10",
            subject: "Matematik",
            phone: "",
            email: "",
          },
          { auth: tokenB },
        )
      ).data;
      const bodies = [
        [
          "POST",
          `/v1/workspaces/${ws}/students`,
          {
            name: "Injected owner",
            grade: "10",
            subject: "X",
            phone: "",
            email: "",
          },
        ],
        [
          "PATCH",
          `/v1/workspaces/${ws}/students/${student.id}`,
          {
            name: "Injected edit",
            grade: "10",
            subject: "X",
            phone: "",
            email: "",
            version: 0,
          },
        ],
        [
          "PUT",
          `/v1/workspaces/${ws}/students/${student.id}/private-note`,
          { body: "Injected note", version: 0 },
        ],
        [
          "POST",
          `/v1/workspaces/${ws}/students/${student.id}/invitations`,
          {
            email: "intruder@example.test",
            role: "GUARDIAN",
            permissions: ["lessons"],
          },
        ],
        [
          "POST",
          `/v1/workspaces/${ws}/commands`,
          {
            action: "student.create",
            name: "Injected shared",
            grade: "10",
            subject: "X",
            phone: "",
            email: "",
          },
        ],
        [
          "POST",
          `/v1/media/${ws}/${student.id}/files`,
          {
            purpose: "RESOURCE",
            name: "attack.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
          },
        ],
        [
          "POST",
          `/v1/media/${ws}/${student.id}/videos`,
          { title: "attack", sizeBytes: 100, maxDurationSeconds: 60 },
        ],
      ];
      for (const [method, path, body] of bodies)
        assert.equal(
          (await request(path, { method, body, auth: tokenB })).status,
          403,
          `${method} ${path}`,
        );
      const ownWsForeignStudent = await request(
        `/v1/workspaces/${wsB}/students/${student.id}/private-note`,
        {
          method: "PUT",
          body: { body: "Foreign ID", version: 0 },
          auth: tokenB,
        },
      );
      assert.equal(ownWsForeignStudent.status, 404);
      assert.equal(
        (await request(`/v1/portal/${ws}/${otherStudent.id}`, { auth: tokenB }))
          .status,
        403,
      );
      const leaked = (
        await admin.query(
          "SELECT count(*)::int AS n FROM derslik.students WHERE workspace_id=$1 AND name LIKE 'Injected%'",
          [ws],
        )
      ).rows[0].n;
      assert.equal(leaked, 0);
    },
  );

  await t.test(
    "security: SQL metacharacters stay data, JSON bounds and CORS are enforced",
    async () => {
      const q = encodeURIComponent("' OR 1=1; SELECT pg_sleep(10); --");
      const result = await request(`/v1/teachers?q=${q}`, { auth: null });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data, []);
      for (const suffix of [
        "students?limit=-1",
        "students?limit=1000000",
        "students?sort=1%3BDROP%20TABLE%20users",
        "students?studentId='OR%201=1--",
      ]) {
        const r = await request(`/v1/workspaces/${ws}/${suffix}`);
        assert.ok([200, 400].includes(r.status));
        assert.doesNotMatch(
          JSON.stringify(r.body),
          /SELECT .*FROM|node_modules|postgresql:\/\//,
        );
      }
      assert.equal(
        (
          await request(`/v1/workspaces/${ws}/students`, {
            method: "POST",
            body: { name: "X".repeat(20000) },
          })
        ).status,
        413,
      );
      for (const origin of [
        "null",
        "http://localhost:3000.attacker.test",
        "https://localhost:3000",
      ]) {
        const r = await request("/v1/workspaces", {
          headers: { Origin: origin },
        });
        assert.equal(r.headers.get("access-control-allow-origin"), null);
      }
    },
  );

  await t.test(
    "security: account rate limit ignores forged forwarded IP; public limit applies",
    async () => {
      const limited = await createApplication({
        ...config,
        RATE_LIMIT_USER_PER_MINUTE: 2,
        RATE_LIMIT_PUBLIC_PER_MINUTE: 2,
      });
      await limited.listen(0, "127.0.0.1");
      const url = await limited.getUrl();
      try {
        for (let i = 0; i < 3; i++) {
          const r = await fetch(url + "/v1/workspaces", {
            headers: {
              Authorization: `Bearer ${tokenA}`,
              "X-Forwarded-For": `198.51.100.${i + 1}`,
            },
          });
          assert.equal(r.status, i < 2 ? 200 : 429);
        }
        for (let i = 0; i < 3; i++) {
          const r = await fetch(url + "/v1/teachers");
          assert.equal(r.status, i < 2 ? 200 : 429);
          if (i === 2) assert.ok(Number(r.headers.get("retry-after")) > 0);
        }
        // Takvim akışı da IP başına sınırlanır; belirteç tahmini yavaşlar.
        for (let i = 0; i < 3; i++) {
          const r = await fetch(url + "/v1/calendar/" + "0".repeat(64));
          assert.equal(r.status, i < 2 ? 404 : 429);
        }
      } finally {
        await limited.close();
      }
    },
  );
}

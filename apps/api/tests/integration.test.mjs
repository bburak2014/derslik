import test from "node:test";
import { learningCases } from "./learning-cases.mjs";
import { directoryCases } from "./directory-cases.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { Pool } from "pg";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import EmbeddedPostgres from "embedded-postgres";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createApplication } from "../../../.api-build/apps/api/src/main.js";
import { loadConfig } from "../../../.api-build/apps/api/src/config.js";
import { migrateDatabase } from "../../../.api-build/apps/api/src/db/migrate.js";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const wasmMode = process.env.DERSLIK_TEST_ENGINE === "pglite";
test(
  `NestJS API / ${wasmMode ? "PGlite (multiplexed, not native concurrency)" : "native PostgreSQL"} / signed JWT`,
  { timeout: 90_000 },
  async (t) => {
    process.umask(0o077);
    const dir = await mkdtemp(join(tmpdir(), "derslik-api-test-"));
    const reservation = createServer();
    const dbPort = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const adminPassword = randomBytes(24).toString("hex"),
      runtimePassword = randomBytes(24).toString("hex");
    let wasm, socket;
    const postgres = wasmMode
      ? {
          async initialise() {
            wasm = await PGlite.create({ extensions: { btree_gist } });
          },
          async start() {
            socket = new PGLiteSocketServer({
              db: wasm,
              port: dbPort,
              host: "127.0.0.1",
              maxConnections: 20,
            });
            await socket.start();
          },
          async stop() {
            if (socket) await socket.stop();
            if (wasm) await wasm.close();
          },
        }
      : new EmbeddedPostgres({
          databaseDir: join(dir, "data"),
          port: dbPort,
          user: "postgres",
          password: adminPassword,
          authMethod: "scram-sha-256",
          persistent: false,
          createPostgresUser: false,
          initdbFlags: ["--encoding=UTF8", "--locale=C"],
          postgresFlags: ["-h", "127.0.0.1", "-k", dir],
          onLog: () => {},
          onError: () => {},
        });
    let admin, runtime, app, jwksServer;
    try {
      await postgres.initialise();
      await postgres.start();
      const adminUrl = `postgresql://postgres:${adminPassword}@127.0.0.1:${dbPort}/postgres`;
      const runtimeUrl = `postgresql://derslik_app:${runtimePassword}@127.0.0.1:${dbPort}/postgres`;
      admin = new Pool({ connectionString: adminUrl });
      const role = await admin.query(
        "SELECT format('CREATE ROLE derslik_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', $1::text) AS sql",
        [runtimePassword],
      );
      await admin.query(role.rows[0].sql);
      await migrateDatabase(adminUrl);
      await migrateDatabase(adminUrl); // Existing migration history must be respected.
      if (wasmMode) {
        // PGlite has one SQL session and ignores the connection's login role.
        // Explicitly use the real restricted role for ALL application queries.
        // Admin fixture queries occur only between completed HTTP test requests.
        const adminPool = admin;
        admin = {
          async query(sql, values) {
            await wasm.exec("RESET ROLE");
            try {
              return await adminPool.query(sql, values);
            } finally {
              await wasm.exec("SET ROLE derslik_app");
            }
          },
          end: () => adminPool.end(),
        };
        await wasm.exec("SET ROLE derslik_app");
      }
      runtime = new Pool({ connectionString: runtimeUrl, max: 4 });
      const { privateKey, publicKey } = await generateKeyPair("ES256");
      const publicJwk = {
        ...(await exportJWK(publicKey)),
        kid: "local-test-key",
        alg: "ES256",
        use: "sig",
      };
      const verifiedUsers = new Map();
      jwksServer = createServer((req, res) => {
        if (req.url === "/auth/v1/user") {
          const user = verifiedUsers.get(req.headers.authorization);
          res
            .writeHead(user ? 200 : 401, { "Content-Type": "application/json" })
            .end(JSON.stringify(user || {}));
          return;
        }
        if (req.url !== "/auth/v1/.well-known/jwks.json") {
          res.writeHead(404).end();
          return;
        }
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ keys: [publicJwk] }));
      });
      const issuer = `http://127.0.0.1:${await listen(jwksServer)}/auth/v1`;
      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: runtimeUrl,
        AUTH_ISSUER: issuer,
        CORS_ORIGINS: "http://localhost:3000",
        SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
        SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
        CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        CLOUDFLARE_STREAM_TOKEN: randomUUID(),
        CLOUDFLARE_STREAM_WEBHOOK_SECRET: randomUUID(),
        LEMONSQUEEZY_API_KEY: randomUUID(),
        LEMONSQUEEZY_STORE_ID: "123",
        LEMONSQUEEZY_VARIANT_ID: "456",
        LEMONSQUEEZY_WEBHOOK_SECRET: randomUUID(),
        LEMONSQUEEZY_TEST_MODE: "true",
      });
      app = await createApplication(config);
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const actorA = randomUUID(),
        actorB = randomUUID(),
        actorStudent = randomUUID();
      async function token(sub, overrides = {}) {
        return new SignJWT({
          sub,
          role: "authenticated",
          iss: issuer,
          aud: "authenticated",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
          ...overrides,
        })
          .setProtectedHeader({ alg: "ES256", kid: "local-test-key" })
          .sign(privateKey);
      }
      const tokenA = await token(actorA),
        tokenB = await token(actorB),
        tokenStudent = await token(actorStudent);
      async function request(
        path,
        {
          method = "GET",
          body,
          key = randomUUID(),
          auth = tokenA,
          headers = {},
          raw = false,
        } = {},
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          body: raw ? await response.arrayBuffer() : await response.json(),
          headers: response.headers,
        };
      }
      async function ok(path, body, options = {}) {
        const r = await request(path, {
          method: body === undefined ? "GET" : "POST",
          body,
          ...options,
        });
        assert.ok(
          r.status >= 200 && r.status < 300,
          `${path}: ${r.status} ${JSON.stringify(r.body)}`,
        );
        return r.body;
      }
      let ws, wsB, student, pack, lesson;
      const path = (suffix) => `/v1/workspaces/${ws}/${suffix}`;
      const studentBody = {
        name: "Test öğrencisi",
        grade: "10",
        subject: "Matematik",
        phone: "",
        email: "",
      };
      const packageBody = (studentId, granted = 8, priceMinor = "800000") => ({
        studentId,
        name: `${granted} ders`,
        granted,
        priceMinor,
        expiresOn: null,
      });
      const sessionBody = (studentId, packageId, startsAt, weeks = 1) => ({
        studentId,
        packageId,
        startsAt,
        weeks,
        topic: "Denklemler",
        duration: 60,
        location: "Çevrim içi",
      });
      const paymentBody = (studentId, amountMinor) => ({
        studentId,
        amountMinor,
        receivedOn: "2025-01-01",
        method: "TRANSFER",
        reference: "Test kaydı",
      });

      await t.test(
        "JWT signature, issuer, audience, expiry, role and anonymous access",
        async () => {
          assert.equal(
            (await request("/health/ready", { auth: null })).status,
            200,
          );
          assert.equal(
            (
              await request("/v1/workspaces", {
                auth: null,
                headers: { "X-User-Id": actorA },
              })
            ).status,
            401,
          );
          assert.equal(
            (await request("/v1/workspaces", { auth: "fake.token.value" }))
              .status,
            401,
          );
          for (const claims of [
            { iss: "https://other.example/auth/v1" },
            { aud: "wrong" },
            { exp: 1 },
            { role: "service_role" },
            { is_anonymous: true },
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
          const otherPair = await generateKeyPair("ES256");
          const forged = await new SignJWT({
            sub: actorA,
            role: "authenticated",
          })
            .setProtectedHeader({ alg: "ES256", kid: "local-test-key" })
            .setIssuer(issuer)
            .setAudience("authenticated")
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(otherPair.privateKey);
          assert.equal(
            (await request("/v1/workspaces", { auth: forged })).status,
            401,
          );
          assert.equal(
            (
              await request("/v1/workspaces", {
                headers: { Origin: "https://other.example" },
              })
            ).headers.get("access-control-allow-origin"),
            null,
          );
          assert.equal(
            (
              await request("/v1/workspaces", {
                headers: { Origin: "http://localhost:3000" },
              })
            ).headers.get("access-control-allow-origin"),
            "http://localhost:3000",
          );
        },
      );

      await t.test(
        "workspace bootstrap, student, package and schedule persist",
        async () => {
          ws = (await ok("/v1/workspaces", { name: "Öğretmen A" })).data.id;
          wsB = (
            await ok("/v1/workspaces", { name: "Öğretmen B" }, { auth: tokenB })
          ).data.id;
          assert.equal(
            (await ok("/v1/workspaces", { name: "Tekrar" })).data.id,
            ws,
          );
          student = (await ok(path("students"), studentBody)).data;
          pack = (await ok(path("packages"), packageBody(student.id))).data;
          assert.equal(pack.priceMinor, "800000");
          assert.equal(pack.charge.amountMinor, "800000");
          lesson = (
            await ok(
              path("sessions"),
              sessionBody(student.id, pack.id, "2025-03-01T12:00:00Z"),
            )
          ).data.lessons[0];
          assert.equal(
            (await ok(path(`students/${student.id}`))).data.outstandingMinor,
            "800000",
          );
          assert.equal(
            (
              await request(path("students"), {
                method: "POST",
                body: studentBody,
                key: "",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request(path("students"), {
                method: "POST",
                body: { ...studentBody, name: "" },
              })
            ).status,
            400,
          );
        },
      );

      await t.test(
        "concurrent same-key completion, stale versions, reversal and recompletion",
        async () => {
          const key = randomUUID();
          const responses = await Promise.all(
            [0, 1].map(() =>
              request(path(`sessions/${lesson.id}/complete`), {
                method: "POST",
                body: { version: 0 },
                key,
              }),
            ),
          );
          assert.deepEqual(
            responses.map((r) => r.status),
            [201, 201],
          );
          assert.equal(responses.filter((r) => r.body.replayed).length, 1);
          assert.equal(responses[0].body.data.remaining, 7);
          assert.equal(
            (
              await request(path(`sessions/${lesson.id}/complete`), {
                method: "POST",
                body: { version: 0 },
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request(path(`sessions/${lesson.id}/reverse`), {
                method: "POST",
                body: { version: 1 },
                key,
              })
            ).status,
            409,
          );
          const reversed = await ok(path(`sessions/${lesson.id}/reverse`), {
            version: 1,
          });
          assert.equal(reversed.data.remaining, 8);
          assert.equal(
            (
              await request(path(`sessions/${lesson.id}/reverse`), {
                method: "POST",
                body: { version: 1 },
              })
            ).status,
            409,
          );
          assert.equal(
            (await ok(path(`sessions/${lesson.id}/complete`), { version: 2 }))
              .data.remaining,
            7,
          );
          const entries = (
            await ok(path(`credit-entries?studentId=${student.id}`))
          ).data;
          assert.equal(entries.length, 3);
          assert.equal(
            entries.reduce((sum, row) => sum + row.delta, 0),
            -1,
          );
        },
      );

      await t.test(
        "two concurrent HTTP requests compete for the last credit",
        async () => {
          const s = (
            await ok(path("students"), { ...studentBody, name: "Son hak" })
          ).data;
          const p = (await ok(path("packages"), packageBody(s.id, 1, "100000")))
            .data;
          const l1 = (
            await ok(
              path("sessions"),
              sessionBody(s.id, p.id, "2025-03-02T12:00:00Z"),
            )
          ).data.lessons[0];
          const l2 = (
            await ok(
              path("sessions"),
              sessionBody(s.id, p.id, "2025-03-03T12:00:00Z"),
            )
          ).data.lessons[0];
          const results = await Promise.all(
            [l1, l2].map((l) =>
              request(path(`sessions/${l.id}/complete`), {
                method: "POST",
                body: { version: 0 },
              }),
            ),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            (await ok(path(`packages?studentId=${s.id}`))).data[0].remaining,
            0,
          );
          assert.equal(
            (await ok(path(`credit-entries?studentId=${s.id}`))).data.length,
            1,
          );
        },
      );

      await t.test(
        "overlapping weekly series rolls back, reschedule and expiry rules",
        async () => {
          const before = (await ok(path("sessions?limit=100"))).data.length;
          await ok(
            path("sessions"),
            sessionBody(student.id, pack.id, "2025-04-08T12:00:00Z"),
          );
          const collision = await request(path("sessions"), {
            method: "POST",
            body: sessionBody(student.id, pack.id, "2025-04-01T12:00:00Z", 4),
          });
          assert.equal(collision.status, 409);
          assert.equal(
            (await ok(path("sessions?limit=100"))).data.length,
            before + 1,
          );
          const move = (
            await ok(
              path("sessions"),
              sessionBody(student.id, pack.id, "2025-04-09T12:00:00Z"),
            )
          ).data.lessons[0];
          assert.equal(
            (
              await request(path(`sessions/${move.id}/reschedule`), {
                method: "POST",
                body: {
                  version: 0,
                  startsAt: "2025-04-08T12:00:00Z",
                  duration: 60,
                },
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await ok(path(`sessions/${move.id}/reschedule`), {
                version: 0,
                startsAt: "2025-04-08T13:00:00Z",
                duration: 60,
              })
            ).data.version,
            1,
          );
          const expired = (
            await ok(path("packages"), {
              ...packageBody(student.id, 1, "1000"),
              expiresOn: "2025-01-01",
            })
          ).data;
          assert.equal(
            (
              await request(path("sessions"), {
                method: "POST",
                body: sessionBody(
                  student.id,
                  expired.id,
                  "2025-01-01T22:00:00Z",
                ),
              })
            ).status,
            409,
          );
        },
      );

      await t.test(
        "payments allocate across charges, prevent concurrent overpayment and preserve void history",
        async () => {
          const s = (
            await ok(path("students"), { ...studentBody, name: "Tahsilat" })
          ).data;
          await ok(path("packages"), packageBody(s.id, 2, "10001"));
          await ok(path("packages"), packageBody(s.id, 2, "19999"));
          const payment = (
            await ok(path("payments"), paymentBody(s.id, "15000"))
          ).data;
          assert.equal(payment.allocations.length, 2);
          assert.equal(payment.receivedOn, "2025-01-01");
          const results = await Promise.all(
            [0, 1].map(() =>
              request(path("payments"), {
                method: "POST",
                body: paymentBody(s.id, "15000"),
              }),
            ),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            (await ok(path(`students/${s.id}`))).data.outstandingMinor,
            "0",
          );
          await ok(path(`payments/${payment.id}/void`), { version: 0 });
          assert.equal(
            (await ok(path(`students/${s.id}`))).data.outstandingMinor,
            "15000",
          );
          assert.equal(
            (
              await request(path(`payments/${payment.id}/void`), {
                method: "POST",
                body: { version: 0 },
              })
            ).status,
            409,
          );
          assert.equal(
            (await ok(path(`payments?studentId=${s.id}`))).data.length,
            2,
          );
          assert.equal(
            (
              await request(path("payments"), {
                method: "POST",
                body: { ...paymentBody(s.id, "100"), receivedOn: "2099-01-01" },
              })
            ).status,
            409,
          );
          const allocations = await admin.query(
            "SELECT count(*) AS n FROM derslik.payment_allocations WHERE payment_id=$1",
            [payment.id],
          );
          assert.equal(allocations.rows[0].n, "2");
        },
      );

      await t.test(
        "tenant paths, composite references, private notes and student role are isolated",
        async () => {
          for (const suffix of [
            "students",
            `students/${student.id}`,
            `students/${student.id}/private-note`,
            "audit",
            "packages",
            "payments",
          ]) {
            assert.equal(
              (await request(path(suffix), { auth: tokenB })).status,
              403,
            );
          }
          assert.equal(
            (
              await request(`/v1/workspaces/${wsB}/packages`, {
                method: "POST",
                auth: tokenB,
                body: packageBody(student.id),
              })
            ).status,
            404,
          );
          const note = await ok(
            path(`students/${student.id}/private-note`),
            { body: "Yalnızca öğretmenin görebileceği not", version: 0 },
            { method: "PUT" },
          );
          assert.equal(note.data.version, 1);
          assert.equal(
            (
              await request(path(`students/${student.id}/private-note`), {
                method: "PUT",
                body: { body: "Eski sürüm", version: 0 },
              })
            ).status,
            409,
          );
          assert.ok(!(await ok(path(`students/${student.id}`))).data.body);
          assert.ok(
            !JSON.stringify((await ok(path("audit?limit=100"))).data).includes(
              "Yalnızca",
            ),
          );
          await admin.query("INSERT INTO derslik.users(id) VALUES($1)", [
            actorStudent,
          ]);
          await admin.query(
            "INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES($1,$2,'STUDENT')",
            [ws, actorStudent],
          );
          assert.equal(
            (await request(path("students"), { auth: tokenStudent })).status,
            403,
          );
          assert.equal(
            (
              await request(path(`students/${student.id}/private-note`), {
                auth: tokenStudent,
              })
            ).status,
            403,
          );
        },
      );

      await t.test(
        "database RLS, append-only grants and pooled connection context",
        async () => {
          const client = await runtime.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              "SELECT set_config('app.actor_id',$1,true),set_config('app.workspace_id',$2,true)",
              [actorB, ws],
            );
            assert.equal(
              (await client.query("SELECT * FROM derslik.students")).rowCount,
              0,
            );
            assert.equal(
              (await client.query("SELECT * FROM derslik.private_notes"))
                .rowCount,
              0,
            );
            await assert.rejects(
              client.query(
                "INSERT INTO derslik.students(workspace_id,name,subject) VALUES($1,'illegal','x')",
                [ws],
              ),
              (error) => error.code === "42501",
            );
            await client.query("ROLLBACK");
            assert.equal(
              (await client.query("SELECT * FROM derslik.students")).rowCount,
              0,
            );
            await client.query("BEGIN");
            await client.query(
              "SELECT set_config('app.actor_id',$1,true),set_config('app.workspace_id',$2,true)",
              [actorA, ws],
            );
            await assert.rejects(
              client.query("UPDATE derslik.credit_entries SET delta=1"),
              (error) => error.code === "42501",
            );
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
          if (wasmMode) await wasm.exec("RESET ROLE");
          try {
            await assert.rejects(
              createApplication({ ...config, DATABASE_URL: adminUrl }),
              /non-superuser/,
            );
          } finally {
            if (wasmMode) await wasm.exec("SET ROLE derslik_app");
          }
        },
      );

      await t.test(
        "archive observes scheduled lessons and pagination has a bound",
        async () => {
          const s = (
            await ok(path("students"), { ...studentBody, name: "Arşiv" })
          ).data;
          const p = (await ok(path("packages"), packageBody(s.id))).data;
          const l = (
            await ok(
              path("sessions"),
              sessionBody(s.id, p.id, "2025-06-01T12:00:00Z"),
            )
          ).data.lessons[0];
          assert.equal(
            (
              await request(path(`students/${s.id}/archive`), {
                method: "POST",
                body: { version: 0 },
              })
            ).status,
            409,
          );
          await ok(path(`sessions/${l.id}/cancel`), { version: 0 });
          assert.equal(
            (await ok(path(`students/${s.id}/archive`), { version: 0 })).data
              .active,
            false,
          );
          assert.equal(
            (
              await request(path("sessions"), {
                method: "POST",
                body: sessionBody(s.id, p.id, "2025-06-02T12:00:00Z"),
              })
            ).status,
            409,
          );
          const list = await ok(path("students?limit=1"));
          assert.equal(list.data.length, 1);
          assert.equal(list.pagination.hasMore, true);
          assert.equal((await request(path("students?limit=101"))).status, 400);
        },
      );
      await learningCases({
        t,
        app,
        config,
        admin,
        request,
        ok,
        ws,
        wsB,
        student,
        pack,
        lesson,
        actorA,
        actorB,
        actorStudent,
        tokenA,
        tokenB,
        tokenStudent,
        token,
        verifiedUsers,
        sessionBody,
      });
      await directoryCases({ t, admin, request, ok, token });
    } finally {
      if (app) await app.close();
      if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
      if (runtime) await runtime.end();
      if (admin) await admin.end();
      await postgres.stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

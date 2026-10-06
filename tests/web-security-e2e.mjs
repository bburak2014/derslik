import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const fixture = JSON.parse(
  await readFile(
    process.env.WEB_SECURITY_FIXTURE || "reports/security/backend-fixture.json",
    "utf8",
  ),
);
const sessions = JSON.parse(
  await readFile(
    process.env.WEB_SECURITY_SESSION ||
      "reports/security/web-fixture-session.json",
    "utf8",
  ),
);
const rows = [];
const origin = sessions.origin;
async function request(
  actor,
  path,
  { method = "GET", body, headers = {} } = {},
) {
  const account = sessions.accounts.find((entry) => entry.name === actor);
  const response = await fetch(origin + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Derslik-Client": "web",
      Origin: origin,
      ...(account ? { Cookie: account.cookie } : {}),
      "Idempotency-Key": randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const payload = await response.text();
  return {
    status: response.status,
    text: payload,
    json: (() => {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })(),
  };
}
async function check(name, fn) {
  try {
    await fn();
    rows.push({ name, result: "passed" });
    console.log("PASS " + name);
  } catch (error) {
    rows.push({
      name,
      result: "failed",
      error: String(error.message).slice(0, 500),
    });
    console.error("FAIL " + name);
  }
}
const denied = (response) =>
  assert.ok(
    [401, 403, 404].includes(response.status),
    `Expected access rejection, received ${response.status}`,
  );
const ws = fixture.workspaceId,
  studentId = fixture.studentId;
for (const actor of ["owner", "otherOwner", "student", "guardian"]) {
  await check(
    `${actor}: signed backend identity survives the cookie/BFF boundary without token disclosure`,
    async () => {
      const r = await request(actor, "/api/session");
      assert.equal(r.status, 200);
      assert.equal(r.json.user.id, fixture.actors[actor].id);
      assert.ok(!r.text.includes(fixture.actors[actor].token));
    },
  );
}
await check("owner: own workspace and student remain reachable", async () => {
  assert.equal(
    (
      await request("owner", "/api/workspace", {
        headers: { "X-Derslik-Workspace": ws },
      })
    ).status,
    200,
  );
  // Ekrandaki alanı taşımayan istek, başka sekmede değişmiş oturumla
  // işlem yapamaz.
  assert.equal((await request("owner", "/api/workspace")).status, 409);
  assert.equal(
    (await request("owner", `/api/backend/workspaces/${ws}/students`)).status,
    200,
  );
});
const before = await request("owner", `/api/backend/workspaces/${ws}/snapshot`);
assert.equal(before.status, 200);
const studentsBefore = before.json.students;
for (const actor of ["otherOwner", "student", "guardian"]) {
  await check(
    `${actor}: cannot read owner snapshot or teacher-only student details`,
    async () => {
      denied(await request(actor, `/api/backend/workspaces/${ws}/snapshot`));
      denied(
        await request(
          actor,
          `/api/backend/workspaces/${ws}/students/${studentId}/learning`,
        ),
      );
    },
  );
  await check(
    `${actor}: cannot create a student or edit the owner's private note`,
    async () => {
      denied(
        await request(actor, `/api/backend/workspaces/${ws}/students`, {
          method: "POST",
          body: {
            name: "Unauthorized security test",
            grade: "10",
            subject: "Math",
            phone: "",
            email: "",
          },
        }),
      );
      denied(
        await request(
          actor,
          `/api/backend/workspaces/${ws}/students/${studentId}/private-note`,
          {
            method: "PUT",
            body: { body: "Unauthorized test edit", version: 0 },
          },
        ),
      );
    },
  );
  await check(
    `${actor}: cannot switch the context cookie to another owner's workspace`,
    async () => {
      denied(
        await request(actor, "/api/session", {
          method: "POST",
          body: { key: `${ws}:OWNER:` },
        }),
      );
    },
  );
  await check(
    `${actor}: CSRF still rejects mutation with a valid session cookie`,
    async () => {
      assert.equal(
        (
          await request(actor, "/api/session", {
            method: "POST",
            body: {},
            headers: { Origin: "https://attacker.example" },
          })
        ).status,
        403,
      );
    },
  );
}
for (const actor of ["student", "guardian"]) {
  await check(
    `${actor}: own portal works and foreign workspace access fails`,
    async () => {
      assert.equal(
        (await request(actor, `/api/backend/portal/${ws}/${studentId}`)).status,
        200,
      );
      denied(
        await request(
          actor,
          `/api/backend/portal/${fixture.otherWorkspaceId}/${studentId}`,
        ),
      );
      assert.equal((await request(actor, "/api/workspace")).status, 403);
    },
  );
}
await check(
  "anonymous: protected BFF GET and mutation reject requests",
  async () => {
    assert.equal((await request(null, "/api/session")).status, 401);
    assert.equal(
      (await request(null, `/api/backend/workspaces/${ws}/students`)).status,
      401,
    );
    assert.equal(
      (
        await request(null, `/api/backend/workspaces/${ws}/students`, {
          method: "POST",
          body: { name: "Unauthorized anonymous test" },
        })
      ).status,
      401,
    );
  },
);
await check(
  "owner: rejected cross-account mutations left student records unchanged",
  async () => {
    const after = await request(
      "owner",
      `/api/backend/workspaces/${ws}/snapshot`,
    );
    assert.equal(after.status, 200);
    assert.deepEqual(after.json.students, studentsBefore);
  },
);
await writeFile(
  process.env.WEB_SECURITY_RESULTS || "reports/security/web-e2e-results.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      architecture:
        "Production Next -> isolated real NestJS -> disposable database; local Supabase auth fixture with real signed ES256 tokens",
      checks: rows,
      passed: rows.filter((row) => row.result === "passed").length,
      failed: rows.filter((row) => row.result === "failed").length,
    },
    null,
    2,
  ),
);
if (rows.some((row) => row.result === "failed")) process.exitCode = 1;

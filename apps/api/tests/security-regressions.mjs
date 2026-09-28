import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseService } from "../../../.api-build/apps/api/src/db/database.service.js";

// Opt-in audit reproductions, intentionally fail when the vulnerability remains.
// Run: DERSLIK_SECURITY_FOCUSED_ONLY=1 pnpm api:test
export async function securityRegressions({
  t,
  app,
  admin,
  request,
  ok,
  token,
  wasmMode,
}) {
  const results = [];
  const owner = randomUUID(),
    guardian = randomUUID();
  const ownerToken = await token(owner),
    guardianToken = await token(guardian);
  const ws = (
    await ok(
      "/v1/workspaces",
      { name: "Focused security audit" },
      { auth: ownerToken },
    )
  ).data.id;
  const students = [];
  for (let n = 0; n < 5; n++)
    students.push(
      (
        await ok(
          `/v1/workspaces/${ws}/students`,
          {
            name: `Audit student ${n}`,
            grade: "10",
            subject: "Matematik",
            phone: "",
            email: "",
          },
          { auth: ownerToken },
        )
      ).data,
    );

  await t.test(
    "security regression: lessons-only guardian must not receive assignment metadata",
    async () => {
      await admin.query("INSERT INTO derslik.users(id) VALUES($1)", [guardian]);
      await admin.query(
        "INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES($1,$2,'GUARDIAN')",
        [ws, guardian],
      );
      await admin.query(
        "INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES($1,$2,$3,'GUARDIAN',ARRAY['lessons'])",
        [ws, students[0].id, guardian],
      );
      const title = "RESTRICTED-ASSIGNMENT-METADATA";
      const assignment = (
        await ok(
          `/v1/workspaces/${ws}/students/${students[0].id}/learning`,
          {
            action: "assignment.create",
            title,
            instructions: "Private assignment instruction",
            dueOn: null,
          },
          { auth: ownerToken },
        )
      ).data;
      const portal = await request(`/v1/portal/${ws}/${students[0].id}`, {
        auth: guardianToken,
      });
      const inbox = await request("/v1/inbox", { auth: guardianToken });
      const leaked = JSON.stringify(inbox.body).includes(title);
      results.push({
        id: "BACKEND-01",
        permission: ["lessons"],
        portalStatus: portal.status,
        portalAssignmentCount: portal.body.assignments?.length,
        inboxStatus: inbox.status,
        assignmentTitleInInbox: leaked,
        assignmentIdInInbox: JSON.stringify(inbox.body).includes(assignment.id),
      });
      assert.equal(portal.status, 200);
      assert.deepEqual(portal.body.assignments, []);
      assert.equal(
        leaked,
        false,
        "Guardian without assignments permission received restricted assignment title through /v1/inbox",
      );
    },
  );

  await t.test(
    "security regression: concurrent invitations across students must preserve workspace hourly quota",
    { skip: wasmMode ? "Requires native PostgreSQL concurrency" : false },
    async () => {
      await admin.query(
        `INSERT INTO derslik.invitations(workspace_id,student_id,email,role,permissions,token_hash,expires_at)
      SELECT $1,$2,'audit'||g||'@example.test','GUARDIAN',ARRAY['lessons'],md5(random()::text)||g,now()+interval '7 days' FROM generate_series(1,19) g`,
        [ws, students[0].id],
      );
      // A warm production pool already has parallel DB connections. Without this,
      // opening SCRAM sessions can serialize a tiny local test by accident.
      const clients = await Promise.all(
        students.map(() => app.get(DatabaseService).pool.connect()),
      );
      for (const client of clients) client.release();
      const responses = await Promise.all(
        students.map((s, n) =>
          request(`/v1/workspaces/${ws}/students/${s.id}/invitations`, {
            method: "POST",
            auth: ownerToken,
            body: {
              email: `parallel${n}@example.test`,
              role: "GUARDIAN",
              permissions: ["lessons"],
            },
          }),
        ),
      );
      const count = (
        await admin.query(
          "SELECT count(*)::int AS n FROM derslik.invitations WHERE workspace_id=$1 AND created_at>now()-interval '1 hour'",
          [ws],
        )
      ).rows[0].n;
      results.push({
        id: "BACKEND-02",
        before: 19,
        requestCount: responses.length,
        statuses: responses.map((r) => r.status),
        after: count,
        expectedMaximum: 20,
      });
      assert.ok(
        count <= 20,
        `Hourly invitation quota was exceeded: ${count} > 20`,
      );
    },
  );
  await mkdir("reports/security", { recursive: true });
  await writeFile(
    "reports/security/backend-targeted-results.json",
    JSON.stringify({ nativeConcurrency: !wasmMode, results }, null, 2),
  );
}

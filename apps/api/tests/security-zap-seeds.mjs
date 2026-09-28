import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const fixture = JSON.parse(
  await readFile("reports/security/backend-fixture.json", "utf8"),
);
const ws = fixture.workspaceId,
  student = fixture.studentId;
async function call(path, method = "GET", body, actor = "owner") {
  const response = await fetch(fixture.base + path, {
    method,
    headers: {
      Authorization: `Bearer ${fixture.actors[actor].token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}
const person = await call(`/v1/workspaces/${ws}/students/${student}`);
const note = await call(
  `/v1/workspaces/${ws}/students/${student}/private-note`,
);
const fileBody = {
  purpose: "RESOURCE",
  name: "fixture.pdf",
  mimeType: "application/pdf",
  sizeBytes: 100,
};
const videoBody = {
  title: "Security fixture video",
  sizeBytes: 100,
  maxDurationSeconds: 60,
};
const file = await call(`/v1/media/${ws}/${student}/files`, "POST", fileBody);
const video = await call(
  `/v1/media/${ws}/${student}/videos`,
  "POST",
  videoBody,
);
if (file.status !== 201 || video.status !== 201)
  throw new Error("Fixture media seeding failed");
await call(
  `/v1/media/${ws}/${student}/files/${file.body.data.id}/finish`,
  "POST",
  {},
);
const seeds = [];
for (const route of fixture.routes.filter((r) => r.method === "GET")) {
  for (const resource of route.path.includes(":resource")
    ? [
        "students",
        "packages",
        "sessions",
        "payments",
        "credit-entries",
        "audit",
      ]
    : ["students"]) {
    const id = route.path.includes("/files/")
      ? file.body.data.id
      : route.path.includes("/videos/")
        ? video.body.data.id
        : route.path.includes("/students/")
          ? student
          : ws;
    const path = route.path
      .replaceAll(":ws", ws)
      .replaceAll(":student", student)
      .replaceAll(":resource", resource)
      .replaceAll(":id", id);
    const actor = route.path.includes("/portal/") ? "student" : "owner";
    const result = await call(path, "GET", undefined, actor);
    seeds.push({ method: "GET", path, actor, expectedStatus: result.status });
  }
}
seeds.push(
  {
    method: "POST",
    path: `/v1/workspaces/${ws}/students`,
    actor: "owner",
    body: {
      name: "ZAP disposable student",
      grade: "10",
      subject: "Matematik",
      phone: "",
      email: "",
    },
    expectedStatus: 201,
  },
  {
    method: "PATCH",
    path: `/v1/workspaces/${ws}/students/${student}`,
    actor: "owner",
    body: {
      name: "ZAP fixture student",
      grade: "10",
      subject: "Matematik",
      phone: "",
      email: fixture.actors.student.email,
      version: person.body.data.version,
    },
    expectedStatus: 200,
  },
  {
    method: "PUT",
    path: `/v1/workspaces/${ws}/students/${student}/private-note`,
    actor: "owner",
    body: {
      body: "Security fixture private note",
      version: note.body.data?.version ?? 0,
    },
    expectedStatus: 200,
  },
  {
    method: "POST",
    path: `/v1/workspaces/${ws}/students/${student}/learning`,
    actor: "owner",
    body: {
      action: "assignment.create",
      title: "Security fixture assignment",
      instructions: "Disposable security test",
      dueOn: null,
    },
    expectedStatus: 201,
  },
  {
    method: "POST",
    path: `/v1/media/${ws}/${student}/files`,
    actor: "owner",
    body: fileBody,
    expectedStatus: 201,
  },
  {
    method: "POST",
    path: `/v1/media/${ws}/${student}/videos`,
    actor: "owner",
    body: videoBody,
    expectedStatus: 201,
  },
);
await writeFile(
  "reports/security/backend-zap-seeds.json",
  JSON.stringify(
    {
      base: fixture.base,
      dockerBase: fixture.dockerBase,
      seeds,
      notes: [
        "GET expected statuses measured against the current fixture.",
        "Student/private-note versions read from current API state.",
        "Actor names map to backend-fixture.json; tokens omitted.",
        "Use a fresh UUID Idempotency-Key per mutation.",
        "Expected statuses can change after active scanner mutations.",
      ],
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    seeds: seeds.length,
    gets: seeds.filter((s) => s.method === "GET").length,
    getStatuses: Object.fromEntries(
      [
        ...new Set(
          seeds.filter((s) => s.method === "GET").map((s) => s.expectedStatus),
        ),
      ].map((status) => [
        status,
        seeds.filter((s) => s.method === "GET" && s.expectedStatus === status)
          .length,
      ]),
    ),
  }),
);

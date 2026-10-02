import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAnalysisReport,
  scannerTaskId,
  scannerInvocation,
  waitForAnalysis,
} from "../scripts/sonar-report.mjs";
import { SCANNER_IMAGE } from "../scripts/sonar-local.mjs";

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("native scanner targets the local server with private project cache and native Node", () => {
  const invocation = scannerInvocation({
    root: "/workspace",
    host: "http://127.0.0.1:9001",
    container: "isolated-sonar",
    network: "isolated-network",
    token: "fixture-secret",
    nodeMaxspace: "2048",
    javaOpts: "-Xmx512m",
    scannerPath: "/workspace/tool-cache/sonar-scanner",
    userHome: "/workspace/reports/quality/cache",
    nodePath: "/native/node",
  });
  assert.equal(invocation.command, "/workspace/tool-cache/sonar-scanner");
  assert.equal(invocation.options.cwd, "/workspace");
  assert.equal(invocation.options.env.SONAR_HOST_URL, "http://127.0.0.1:9001");
  assert.equal(
    invocation.options.env.SONAR_USER_HOME,
    "/workspace/reports/quality/cache",
  );
  assert.ok(invocation.args.includes("-Dsonar.nodejs.executable=/native/node"));
  assert.ok(invocation.args.includes("-Dsonar.javascript.node.maxspace=2048"));
  assert.equal(invocation.options.env.SONAR_TOKEN, "fixture-secret");
  assert.ok(
    !invocation.args.some((argument) => argument.includes("fixture-secret")),
  );
});

test("default Docker scanner preserves its container network and keeps token out of arguments", () => {
  const invocation = scannerInvocation({
    root: "/workspace",
    host: "http://127.0.0.1:9001",
    container: "isolated-sonar",
    network: "isolated-network",
    token: "fixture-secret",
    nodeMaxspace: "2048",
    javaOpts: "-Xmx512m",
  });
  assert.equal(invocation.command, "docker");
  assert.ok(invocation.args.includes("isolated-network"));
  assert.ok(invocation.args.includes("/workspace:/usr/src"));
  assert.equal(
    invocation.options.env.SONAR_HOST_URL,
    "http://isolated-sonar:9000",
  );
  assert.equal(invocation.options.env.SONAR_TOKEN, "fixture-secret");
  assert.ok(
    !invocation.args.some((argument) => argument.includes("fixture-secret")),
  );
  const image = invocation.args.indexOf(SCANNER_IMAGE);
  assert.ok(image > 0, "sabit tarayıcı imajı kullanılır");
  assert.deepEqual(invocation.args.slice(image - 2, image), [
    "--platform",
    "linux/amd64",
  ]);
});

test("scanner report must identify the submitted task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "derslik-sonar-"));
  const file = join(directory, "report-task.txt");
  try {
    await writeFile(
      file,
      "serverUrl=http://localhost:9000\r\nceTaskId=task-123\r\n",
    );
    assert.equal(scannerTaskId(file), "task-123");
    await writeFile(file, "serverUrl=http://localhost:9000\n");
    assert.throws(() => scannerTaskId(file), /ceTaskId/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("processing waits for the submitted task and returns its analysis", async () => {
  let polls = 0;
  const analysis = await waitForAnalysis(
    async (method, pathname) => {
      assert.equal(method, "GET");
      assert.equal(pathname, "/api/ce/task?id=task-123");
      polls += 1;
      return response({
        task: {
          id: "task-123",
          status: polls < 3 ? "IN_PROGRESS" : "SUCCESS",
          analysisId: "analysis-123",
        },
      });
    },
    "task-123",
    { sleep: async () => {} },
  );
  assert.equal(analysis, "analysis-123");
  assert.equal(polls, 3);
});

test("failed, canceled, unrecognized and mismatched tasks never produce a summary", async () => {
  for (const status of ["FAILED", "CANCELED", "UNKNOWN"]) {
    await assert.rejects(() =>
      waitForAnalysis(
        async () => response({ task: { id: "task-123", status } }),
        "task-123",
      ),
    );
  }
  await assert.rejects(
    () =>
      waitForAnalysis(
        async () =>
          response({
            task: {
              id: "old-task",
              status: "SUCCESS",
              analysisId: "old-analysis",
            },
          }),
        "task-123",
      ),
    /beklenen/,
  );
  await assert.rejects(
    () =>
      waitForAnalysis(
        async () => response({ task: { id: "task-123", status: "SUCCESS" } }),
        "task-123",
      ),
    /kimliğini/,
  );
});

test("task timeout and HTTP errors cannot be interpreted as completed analyses", async () => {
  let elapsed = 0;
  await assert.rejects(
    () =>
      waitForAnalysis(
        async () => response({ task: { id: "task-123", status: "PENDING" } }),
        "task-123",
        {
          now: () => elapsed,
          timeoutMs: 10,
          pollMs: 5,
          sleep: async (duration) => {
            elapsed += duration;
          },
        },
      ),
    /zaman aşımı/,
  );
  await assert.rejects(
    () =>
      waitForAnalysis(async () => response({ errors: [] }, 401), "task-123"),
    /API 401/,
  );
});

test("report requests the gate for this analysis and explicitly records absent coverage", async () => {
  const result = await collectAnalysisReport(
    async (_, pathname) => {
      if (pathname.startsWith("/api/measures/component"))
        return response({
          component: {
            key: "derslik",
            measures: [{ metric: "bugs", value: "2" }],
          },
        });
      assert.equal(
        pathname,
        "/api/qualitygates/project_status?analysisId=analysis-123",
      );
      return response({
        projectStatus: { status: "ERROR", conditions: [{ status: "ERROR" }] },
      });
    },
    "derslik",
    "task-123",
    "analysis-123",
  );
  assert.equal(result.analysisId, "analysis-123");
  assert.equal(result.metrics.bugs, "2");
  assert.equal(result.qualityGate.status, "ERROR");
  assert.equal(result.coverageMeasured, false);
  assert.equal(result.coverageReportImported, false);
});

test("automatic zero coverage from Sonar does not imply test coverage was imported", async () => {
  const result = await collectAnalysisReport(
    async (_, pathname) =>
      response(
        pathname.startsWith("/api/measures")
          ? {
              component: {
                key: "derslik",
                measures: [{ metric: "coverage", value: "0.0" }],
              },
            }
          : { projectStatus: { status: "OK" } },
      ),
    "derslik",
    "task-123",
    "analysis-123",
  );
  assert.equal(result.coverageMeasured, true);
  assert.equal(result.coverageReportImported, false);
});

test("API errors and missing gate or metrics cannot create an empty successful report", async () => {
  await assert.rejects(
    () =>
      collectAnalysisReport(
        async () => response({}, 500),
        "derslik",
        "task-123",
        "analysis-123",
      ),
    /API 500/,
  );
  await assert.rejects(
    () =>
      collectAnalysisReport(
        async (_, pathname) =>
          response(
            pathname.startsWith("/api/measures")
              ? { component: { key: "derslik", measures: [] } }
              : {},
          ),
        "derslik",
        "task-123",
        "analysis-123",
      ),
    /kalite kapısı/,
  );
  await assert.rejects(
    () =>
      collectAnalysisReport(
        async () => response({ projectStatus: { status: "OK" } }),
        "derslik",
        "task-123",
        "analysis-123",
      ),
    /ölçülerini/,
  );
});

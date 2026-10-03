import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Gerçek CLI akışı çalışır; yalnızca ağ ve rapor dosyaları sahteleştirilir.
// Hiçbir istek SonarCloud'a gitmez, çalışma alanındaki rapora dokunulmaz.
const root = path.resolve(import.meta.dirname, "..");
const gateUrl = pathToFileURL(path.join(root, "scripts/sonar-cloud-gate.mjs"));
const taskFile = path.join(root, ".scannerwork", "report-task.txt");
const reportFile = path.join(root, "reports", "sonar-gate.json");
const fixtureToken = "cloud-integration-fixture";

const workerSource = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const config = JSON.parse(fs.readFileSync(process.env.GATE_FIXTURE, "utf8"));
const read = fs.readFileSync;
const write = fs.writeFileSync;
const mkdir = fs.mkdirSync;
fs.readFileSync = (file, ...args) =>
  String(file) === ${JSON.stringify(taskFile)} ? config.taskReport : read(file, ...args);
fs.mkdirSync = (directory, ...args) =>
  String(directory) === ${JSON.stringify(path.dirname(reportFile))}
    ? undefined : mkdir(directory, ...args);
fs.writeFileSync = (file, contents, ...args) => {
  if (String(file) !== ${JSON.stringify(reportFile)}) return write(file, contents, ...args);
  if (config.writeError) throw new Error("Fixture report write failed");
  return write(path.join(config.directory, "gate-report.json"), contents, ...args);
};
syncBuiltinESMExports();

const requests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  assert.equal(url.origin, "https://sonarcloud.io");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer " + ${JSON.stringify(fixtureToken)});
  assert.ok(init.signal instanceof AbortSignal);
  const pathname = url.pathname + url.search;
  requests.push(pathname);
  const fixture = config.responses[pathname];
  return new Response(JSON.stringify(fixture?.body ?? { errors: ["unexpected fixture request"] }), {
    status: fixture?.status ?? 500,
  });
};
const { main } = await import(${JSON.stringify(gateUrl.href)});
const code = await main(config.argv, {
  SONAR_TOKEN: "  " + ${JSON.stringify(fixtureToken)} + "  ",
  ...config.github,
});
write(path.join(config.directory, "requests.json"), JSON.stringify(requests));
process.exitCode = code;
`;

const taskPath = "/api/ce/task?id=current-task";
const scopePaths = (scope) => ({
  issues: `/api/issues/search?componentKeys=bburak2014_derslik&resolved=false&ps=500&p=1&${scope}`,
  hotspots: `/api/hotspots/search?projectKey=bburak2014_derslik&status=TO_REVIEW&ps=500&p=1&${scope}`,
  measures: `/api/measures/component?component=bburak2014_derslik&metricKeys=duplicated_lines_density&${scope}`,
});
const response = (body, status = 200) => ({ body, status });
function successfulResponses(scope = "branch=main") {
  const urls = scopePaths(scope);
  return {
    [taskPath]: response({
      task: { id: "current-task", status: "SUCCESS", analysisId: "current-analysis" },
    }),
    [urls.issues]: response({ issues: [], paging: { total: 0 } }),
    [urls.hotspots]: response({ hotspots: [], paging: { total: 0 } }),
    [urls.measures]: response({
      component: { measures: [{ metric: "duplicated_lines_density", value: "0.6" }] },
    }),
  };
}

function runFixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "derslik-cloud-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixtureFile = path.join(directory, "fixture.json");
  const worker = path.join(directory, "worker.mjs");
  fs.writeFileSync(fixtureFile, JSON.stringify({
    directory,
    argv: ["--branch", "main"],
    github: {},
    taskReport: "serverUrl=https://sonarcloud.io\nceTaskId=current-task\n",
    responses: successfulResponses(),
    ...overrides,
  }));
  fs.writeFileSync(worker, workerSource);
  const env = { PATH: process.env.PATH, GATE_FIXTURE: fixtureFile };
  if (process.env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
  const run = spawnSync(process.execPath, [worker], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env,
  });
  assert.ifError(run.error);
  const output = path.join(directory, "gate-report.json");
  const report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
  const requests = JSON.parse(fs.readFileSync(path.join(directory, "requests.json"), "utf8"));
  assert.ok(!run.stdout.includes(fixtureToken));
  assert.ok(!run.stderr.includes(fixtureToken));
  return { ...run, report, requests };
}

test("Cloud CLI waits for this scan before writing a scoped successful report", (t) => {
  const run = runFixture(t);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.report.failed, false);
  assert.equal(run.report.duplication, 0.6);
  assert.deepEqual(run.report.issues, []);
  assert.deepEqual(run.report.hotspots, []);
  assert.deepEqual(run.requests, [taskPath, ...Object.values(scopePaths("branch=main"))]);
  assert.match(run.stdout, /Sonar kapısı: geçti/);
});

test("Cloud CLI keeps a pull request scope on all gate queries", (t) => {
  const scope = "pullRequest=42";
  const run = runFixture(t, {
    argv: [],
    github: { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/42/merge" },
    responses: successfulResponses(scope),
  });
  assert.equal(run.status, 0);
  assert.deepEqual(run.requests, [taskPath, ...Object.values(scopePaths(scope))]);
  assert.match(run.stdout, /dashboard\?id=bburak2014_derslik&pullRequest=42/);
});

test("Cloud CLI lists findings from every page and prevents terminal line injection", (t) => {
  const urls = scopePaths("branch=main");
  const issue = (line, message) => ({
    key: `issue-${line}`, component: "bburak2014_derslik:apps/web/lib/example.ts",
    line, severity: "MAJOR", rule: "typescript:S1234", message,
  });
  const responses = successfulResponses();
  responses[urls.issues] = response({ issues: [issue(12, "first\nFORGED\u001b[2J")], paging: { total: 2 } });
  responses[urls.issues.replace("p=1&", "p=2&")] = response({
    issues: [issue(28, "second")], paging: { total: 2 },
  });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report.failed, true);
  assert.deepEqual(run.report.issues.map(({ line }) => line), [12, 28]);
  assert.match(run.stdout, /Açık sorunlar \(2\)/);
  assert.match(run.stdout, /first FORGED \[2J/);
  assert.ok(!run.stdout.includes("\nFORGED"));
  assert.ok(!run.stdout.includes("\u001b"));
  assert.equal(run.requests[2], urls.issues.replace("p=1&", "p=2&"));
});

test("Cloud CLI rejects pending security review even with no issues", (t) => {
  const responses = successfulResponses();
  responses[scopePaths("branch=main").hotspots] = response({
    hotspots: [{ component: "bburak2014_derslik:scripts/example.mjs", line: 7,
      vulnerabilityProbability: "HIGH", ruleKey: "javascript:S0001", message: "review required" }],
    paging: { total: 1 },
  });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report.hotspots[0].line, 7);
  assert.match(run.stdout, /İnceleme bekleyen güvenlik noktaları \(1\)/);
});

test("Cloud CLI rejects duplication above the configured limit", (t) => {
  const responses = successfulResponses();
  responses[scopePaths("branch=main").measures] = response({
    component: { measures: [{ metric: "duplicated_lines_density", value: "3.01" }] },
  });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report.failed, true);
  assert.match(run.stdout, /sınır aşıldı/);
});

for (const status of ["FAILED", "CANCELED"]) {
  test(`Cloud CLI cannot read a previous successful project state after ${status}`, (t) => {
    const responses = successfulResponses();
    responses[taskPath] = response({ task: {
      id: "current-task", status, errorMessage: "processing\nfailed\u001b[0m",
    } });
    const run = runFixture(t, { responses });
    assert.equal(run.status, 1);
    assert.equal(run.report, null);
    assert.deepEqual(run.requests, [taskPath]);
    assert.equal(run.stdout, "");
    assert.ok(!run.stderr.includes("\nfailed"));
    assert.ok(!run.stderr.includes("\u001b"));
  });
}

test("Cloud CLI treats API authorization failure as failure rather than zero issues", (t) => {
  const responses = successfulResponses();
  responses[scopePaths("branch=main").issues] = response({ errors: [] }, 401);
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /SonarCloud API 401: \/api\/issues\/search/);
  assert.equal(run.requests.length, 2);
});

test("Cloud CLI rejects an incomplete issue list", (t) => {
  const responses = successfulResponses();
  responses[scopePaths("branch=main").issues] = response({ issues: [], paging: { total: 1 } });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /liste eksik geldi \(0\/1\)/);
});

test("Cloud CLI cannot pass when Sonar omits the duplication metric", (t) => {
  const responses = successfulResponses();
  responses[scopePaths("branch=main").measures] = response({ component: { measures: [] } });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /kod tekrarı oranı okunamadı/);
});

test("Cloud CLI needs a scanner task identifier before contacting the API", (t) => {
  const run = runFixture(t, { taskReport: "serverUrl=https://sonarcloud.io\n" });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.deepEqual(run.requests, []);
  assert.match(run.stderr, /ceTaskId yok/);
});

test("Cloud CLI cannot announce success if saving its report fails", (t) => {
  const run = runFixture(t, { writeError: true });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /report write failed/);
});

test("Cloud CLI rejects unknown flags before querying Sonar", (t) => {
  const run = runFixture(t, { argv: ["--unsupported"] });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.deepEqual(run.requests, []);
  assert.match(run.stderr, /unsupported/);
});

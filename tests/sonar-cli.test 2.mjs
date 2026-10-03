import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Yerel CLI'nın gerçek modülleri çalışır; bütün dış işlemler özel geçici
// klasöre ve sahte yanıtlara bağlanır. Docker, ağ ve gerçek parola kullanılmaz.
const root = path.resolve(import.meta.dirname, "..");
const scriptUrl = pathToFileURL(path.join(root, "scripts/sonar.mjs"));
const taskFile = path.join(root, ".scannerwork", "report-task.txt");
const summaryFile = path.join(root, "reports", "quality", "sonar-summary.json");
const coverageFile = path.join(root, "reports", "coverage", "lcov.info");
const adminCredential = "local-cli-fixture";
const scannerToken = "local-scanner-fixture";
const workerSource = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const config = JSON.parse(fs.readFileSync(process.env.SONAR_CLI_FIXTURE, "utf8"));
const read = fs.readFileSync;
const write = fs.writeFileSync;
const rm = fs.rmSync;
const mkdir = fs.mkdirSync;
const task = path.join(config.directory, "report-task.txt");
const trace = { requests: [], commands: [], taskCleared: false, scannerCalls: 0 };
process.on("exit", () => write(path.join(config.directory, "trace.json"), JSON.stringify(trace)));
fs.readFileSync = (file, ...args) => {
  if (String(file) === ${JSON.stringify(coverageFile)}) {
    if (config.lcov === undefined) throw Object.assign(new Error("fixture coverage missing"), { code: "ENOENT" });
    return config.lcov;
  }
  return read(String(file) === ${JSON.stringify(taskFile)} ? task : file, ...args);
};
fs.rmSync = (file, ...args) => {
  assert.equal(String(file), ${JSON.stringify(taskFile)});
  trace.taskCleared = true;
  return rm(task, ...args);
};
fs.mkdirSync = (directory, ...args) => {
  const destination = String(directory) === ${JSON.stringify(path.dirname(summaryFile))}
    ? config.directory : String(directory);
  assert.ok(destination.startsWith(config.directory));
  return mkdir(destination, ...args);
};
fs.writeFileSync = (file, contents, ...args) => {
  const destination = String(file) === ${JSON.stringify(summaryFile)}
    ? path.join(config.directory, "summary.json") : String(file);
  assert.ok(destination.startsWith(config.directory));
  return write(destination, contents, ...args);
};

childProcess.execFileSync = (command, args) => {
  trace.commands.push({ command, args });
  if (command === "git") return path.join(config.directory, ".git");
  assert.equal(command, "docker");
  if (args[0] === "info" && config.dockerUnavailable) throw new Error("fixture docker unavailable");
  assert.ok(args[0] === "info" || (args[0] === "network" && args[1] === "inspect"));
  return "fixture";
};
childProcess.spawnSync = (command, args, options) => {
  trace.commands.push({ command, args });
  if (command === config.scanner) {
    trace.scannerCalls++;
    assert.ok(trace.taskCleared);
    assert.equal(fs.existsSync(task), false);
    assert.equal(options.env.SONAR_TOKEN, ${JSON.stringify(scannerToken)});
    assert.ok(!args.some((value) => value.includes(${JSON.stringify(scannerToken)})));
    if (config.scannerStatus !== 0) return { status: config.scannerStatus };
    if (config.scannerReport !== null) write(task, config.scannerReport);
    return { status: 0 };
  }
  assert.equal(command, "docker");
  assert.equal(args[0], "inspect");
  if (args[2] === "{{.State.Running}}") return { status: 0, stdout: "true" };
  return { status: 0, stdout: 'sonarqube:26.9.0.129388-community|{"9000/tcp":[{"HostIp":"127.0.0.1","HostPort":"9000"}]}' };
};
syncBuiltinESMExports();
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  assert.equal(url.origin, "http://127.0.0.1:9000");
  assert.ok(init.signal instanceof AbortSignal);
  if (url.pathname !== "/api/system/status") {
    assert.equal(init.headers.Authorization, "Basic " + Buffer.from("admin:" + ${JSON.stringify(adminCredential)}).toString("base64"));
    assert.equal(init.method, url.pathname.startsWith("/api/user_tokens/") ? "POST" : "GET");
  }
  trace.requests.push(url.pathname + url.search);
  const fixture = config.responses[url.pathname];
  return new Response(JSON.stringify(fixture?.body ?? {}), { status: fixture?.status ?? 500 });
};
try {
  await import(${JSON.stringify(scriptUrl.href)});
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`;

const response = (body, status = 200) => ({ body, status });
function successfulResponses(gateStatus = "OK") {
  return {
    "/api/system/status": response({ status: "UP" }),
    "/api/users/current": response({ isLoggedIn: true }),
    "/api/user_tokens/revoke": response({}),
    "/api/user_tokens/generate": response({ token: scannerToken }),
    "/api/ce/task": response({ task: {
      id: "new-task", status: "SUCCESS", analysisId: "new-analysis",
    } }),
    "/api/measures/component": response({ component: {
      key: "derslik", measures: [
        { metric: "bugs", value: "0" },
        { metric: "coverage", value: "0.0" },
      ],
    } }),
    "/api/qualitygates/project_status": response({ projectStatus: {
      status: gateStatus,
      conditions: gateStatus === "ERROR" ? [{ status: "ERROR", metricKey: "new_coverage" }] : [],
    } }),
  };
}
function runFixture(t, overrides = {}, extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "derslik-sonar-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scanner = path.join(directory, "scanner");
  const worker = path.join(directory, "worker.mjs");
  const fixture = path.join(directory, "fixture.json");
  fs.writeFileSync(scanner, "fixture", { mode: 0o700 });
  fs.writeFileSync(path.join(directory, "report-task.txt"), "ceTaskId=stale-task\n");
  fs.writeFileSync(fixture, JSON.stringify({
    directory, scanner, scannerStatus: 0,
    scannerReport: "ceTaskId=new-task\n",
    responses: successfulResponses(),
    ...overrides,
  }));
  fs.writeFileSync(worker, workerSource);
  const env = {
    PATH: process.env.PATH,
    SONAR_CLI_FIXTURE: fixture,
    SONAR_SCANNER_PATH: scanner,
    SONAR_USER_HOME: path.join(directory, "cache"),
    SONAR_ADMIN_PASSWORD: adminCredential,
    SONAR_HOST_URL: "http://127.0.0.1:9000",
    ...extraEnv,
  };
  if (process.env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
  const run = spawnSync(process.execPath, [worker], {
    cwd: root, encoding: "utf8", timeout: 10_000, env,
  });
  assert.ifError(run.error);
  const output = path.join(directory, "summary.json");
  const report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
  const trace = JSON.parse(fs.readFileSync(path.join(directory, "trace.json"), "utf8"));
  for (const secret of [adminCredential, scannerToken]) {
    assert.ok(!run.stdout.includes(secret));
    assert.ok(!run.stderr.includes(secret));
  }
  return { ...run, report, trace };
}

test("local CLI clears stale scanner metadata and summarizes the submitted analysis", (t) => {
  const run = runFixture(t);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.report.taskId, "new-task");
  assert.equal(run.report.analysisId, "new-analysis");
  assert.equal(run.report.qualityGate.status, "OK");
  assert.equal(run.report.coverageReport, null);
  assert.equal(run.report.coverageReportImported, false);
  assert.equal(run.trace.scannerCalls, 1);
  assert.ok(run.trace.requests.includes("/api/ce/task?id=new-task"));
  assert.ok(run.trace.requests.includes("/api/qualitygates/project_status?analysisId=new-analysis"));
  assert.match(run.stdout, /Quality gate: OK/);
  assert.match(run.stdout, /Coverage aktarımı doğrulanamadı/);
});

test("local CLI records coverage import evidence only with valid LCOV and measured covered code", (t) => {
  const responses = successfulResponses();
  responses["/api/measures/component"].body.component.measures = [{ metric: "coverage", value: "82.5" }];
  const run = runFixture(t, {
    responses, lcov: "SF:scripts/sonar.mjs\nDA:1,1\nend_of_record\n",
  });
  assert.equal(run.status, 0);
  assert.deepEqual(run.report.coverageReport, { files: 1, coveredLines: 1 });
  assert.equal(run.report.coverageReportImported, true);
  assert.ok(!run.stdout.includes("Coverage aktarımı doğrulanamadı"));
});

test("local CLI does not mistake Sonar's zero fallback for an imported coverage report", (t) => {
  const run = runFixture(t, { lcov: "SF:scripts/sonar.mjs\nDA:1,1\nend_of_record\n" });
  assert.equal(run.status, 0);
  assert.deepEqual(run.report.coverageReport, { files: 1, coveredLines: 1 });
  assert.equal(run.report.coverageMeasured, true);
  assert.equal(run.report.coverageReportImported, false);
});

test("local CLI rejects malformed coverage before announcing a successful summary", (t) => {
  const run = runFixture(t, { lcov: "SF:scripts/sonar.mjs\nDA:0,1\nend_of_record\n" });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /Invalid LCOV line/);
  assert.ok(!run.stdout.includes("Quality gate:"));
});

test("local CLI returns failure for Sonar's failed raw quality gate", (t) => {
  const run = runFixture(t, { responses: successfulResponses("ERROR") });
  assert.equal(run.status, 1);
  assert.equal(run.report.qualityGate.status, "ERROR");
  assert.match(run.stdout, /Quality gate: ERROR/);
});

test("local CLI does not reuse an old analysis when the scanner fails", (t) => {
  const run = runFixture(t, { scannerStatus: 2 });
  assert.equal(run.status, 2);
  assert.equal(run.report, null);
  assert.ok(run.trace.taskCleared);
  assert.ok(!run.trace.requests.some((url) => url.startsWith("/api/ce/task")));
  assert.ok(!run.stdout.includes("Quality gate:"));
});

test("local CLI needs new scanner task metadata even if scanning exits successfully", (t) => {
  const run = runFixture(t, { scannerReport: "serverUrl=http://127.0.0.1:9000\n" });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /ceTaskId yok/);
  assert.ok(!run.trace.requests.some((url) => url.startsWith("/api/ce/task")));
});

test("local CLI cannot treat a failed analysis as a successful project snapshot", (t) => {
  const responses = successfulResponses();
  responses["/api/ce/task"] = response({ task: {
    id: "new-task", status: "FAILED", errorMessage: "fixture analysis failed",
  } });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /analizi FAILED/);
  assert.ok(!run.trace.requests.some((url) => url.startsWith("/api/measures/")));
});

for (const endpoint of ["revoke", "generate"]) {
  test(`local CLI stops before scanning if token ${endpoint} is unauthorized`, (t) => {
    const responses = successfulResponses();
    responses[`/api/user_tokens/${endpoint}`] = response({ errors: [] }, 401);
    const run = runFixture(t, { responses });
    assert.equal(run.status, 1);
    assert.equal(run.report, null);
    assert.equal(run.trace.scannerCalls, 0);
    assert.match(run.stderr, /401/);
  });
}

test("local CLI rejects a missing scan token instead of running an unauthenticated scan", (t) => {
  const responses = successfulResponses();
  responses["/api/user_tokens/generate"] = response({});
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.equal(run.trace.scannerCalls, 0);
  assert.match(run.stderr, /tokenını döndürmedi/);
});

test("local CLI rejects a remote host before sending administrator credentials", (t) => {
  const run = runFixture(t, {}, { SONAR_HOST_URL: "https://attacker.invalid" });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.deepEqual(run.trace.requests, []);
  assert.equal(run.trace.scannerCalls, 0);
  assert.match(run.stderr, /yalnızca yerel bir SonarQube/);
});

test("local CLI validates the port and Node memory before starting Docker", (t) => {
  for (const extraEnv of [{ SONAR_PORT: "0" }, { SONAR_NODE_MAXSPACE: "127" }]) {
    const run = runFixture(t, {}, extraEnv);
    assert.equal(run.status, 1);
    assert.equal(run.report, null);
    assert.deepEqual(run.trace.requests, []);
    assert.ok(!run.trace.commands.some(({ command }) => command === "docker"));
    assert.match(run.stderr, /aralığında/);
  }
});

test("local CLI stops with a clear error when Docker is unavailable", (t) => {
  const run = runFixture(t, { dockerUnavailable: true });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.equal(run.trace.scannerCalls, 0);
  assert.deepEqual(run.trace.requests, []);
  assert.match(run.stderr, /Docker çalışmıyor/);
});

test("local CLI cannot write a successful summary from malformed project measures", (t) => {
  const responses = successfulResponses();
  responses["/api/measures/component"] = response({ component: { key: "other-project", measures: [] } });
  const run = runFixture(t, { responses });
  assert.equal(run.status, 1);
  assert.equal(run.report, null);
  assert.match(run.stderr, /proje ölçülerini döndürmedi/);
});

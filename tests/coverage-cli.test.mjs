import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Test coverage orchestration without rebuilding the application or running
// nested suites. The actual controller validates only private fixture reports.
const root = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(path.join(root, "scripts/coverage.mjs"));
const coverageRoot = path.join(root, "reports", "coverage");
const validLcov = "SF:scripts/coverage.mjs\nDA:1,1\nend_of_record\n";
const workerSource = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const fixture = JSON.parse(fs.readFileSync(process.env.COVERAGE_CLI_FIXTURE, "utf8"));
const read = fs.readFileSync;
const write = fs.writeFileSync;
const rm = fs.rmSync;
const mkdir = fs.mkdirSync;
const actualReportRoot = ${JSON.stringify(coverageRoot)};
const privateReportRoot = path.join(fixture.directory, "coverage");
const trace = { commands: [], cleared: false, lcovReads: 0 };
const redirect = (file) => {
  const name = String(file);
  return name === actualReportRoot || name.startsWith(actualReportRoot + path.sep)
    ? privateReportRoot + name.slice(actualReportRoot.length) : file;
};
fs.readFileSync = (file, ...args) => {
  if (String(file) === path.join(actualReportRoot, "lcov.info")) trace.lcovReads++;
  return read(redirect(file), ...args);
};
fs.rmSync = (file, ...args) => {
  assert.equal(String(file), actualReportRoot);
  trace.cleared = true;
  return rm(privateReportRoot, ...args);
};
fs.mkdirSync = (directory, ...args) => {
  const destination = redirect(directory);
  assert.ok(destination.startsWith(fixture.directory + path.sep));
  return mkdir(destination, ...args);
};
fs.writeFileSync = (file, contents, ...args) => {
  const destination = redirect(file);
  assert.ok(destination.startsWith(fixture.directory + path.sep));
  return write(destination, contents, ...args);
};
childProcess.spawnSync = (command, args, options) => {
  assert.equal(command, process.execPath);
  assert.equal(options.cwd, ${JSON.stringify(root)});
  const phase = args[0].includes("typescript/bin/tsc") ? "api"
    : args[0].includes("next/dist/bin/next") ? "web" : "tests";
  trace.commands.push({ phase, args });
  if (phase === "tests") {
    assert.ok(args[0].endsWith("/bin/c8.js"));
    assert.equal(args[1], "--config");
    assert.equal(args.at(-1), "scripts/coverage-suites.mjs");
    assert.equal(options.env.DERSLIK_TEST_COVERAGE, "1");
    assert.ok(trace.cleared);
    assert.equal(fs.existsSync(path.join(privateReportRoot, "lcov.info")), false);
    if (fixture.statuses.tests === 0 && fixture.lcov !== null)
      write(path.join(privateReportRoot, "lcov.info"), fixture.lcov);
  }
  const status = fixture.statuses[phase];
  return status === null ? { status: null, error: new Error("fixture spawn failed") } : { status };
};
syncBuiltinESMExports();
try {
  const { runCoverage } = await import(${JSON.stringify(moduleUrl.href)});
  process.exitCode = runCoverage();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
write(path.join(fixture.directory, "trace.json"), JSON.stringify(trace));
`;

function runFixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "derslik-coverage-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, "worker.mjs");
  const fixture = path.join(directory, "fixture.json");
  const reports = path.join(directory, "coverage");
  fs.mkdirSync(reports);
  fs.writeFileSync(path.join(reports, "lcov.info"), validLcov);
  fs.writeFileSync(fixture, JSON.stringify({
    directory, statuses: { api: 0, web: 0, tests: 0 }, lcov: validLcov,
    ...overrides,
  }));
  fs.writeFileSync(worker, workerSource);
  const env = { PATH: process.env.PATH, COVERAGE_CLI_FIXTURE: fixture };
  if (process.env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
  const run = spawnSync(process.execPath, [worker], {
    cwd: root, encoding: "utf8", timeout: 10_000, env,
  });
  assert.ifError(run.error);
  const trace = JSON.parse(fs.readFileSync(path.join(directory, "trace.json"), "utf8"));
  const configFile = path.join(reports, "c8-config.json");
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : null;
  return {
    ...run,
    trace,
    config,
    lcovExists: fs.existsSync(path.join(reports, "lcov.info")),
  };
}

test("coverage controller stops on API build failure before running web or tests", (t) => {
  const run = runFixture(t, { statuses: { api: 2, web: 0, tests: 0 } });
  assert.equal(run.status, 2, run.stderr);
  assert.deepEqual(run.trace.commands.map(({ phase }) => phase), ["api"]);
  assert.ok(run.trace.cleared);
  assert.equal(run.lcovExists, false);
  assert.equal(run.trace.lcovReads, 0);
  assert.equal(run.config, null);
  assert.equal(run.stdout, "");
});

test("coverage controller stops on web build failure before collecting test coverage", (t) => {
  const run = runFixture(t, { statuses: { api: 0, web: 3, tests: 0 } });
  assert.equal(run.status, 3, run.stderr);
  assert.deepEqual(run.trace.commands.map(({ phase }) => phase), ["api", "web"]);
  assert.ok(run.trace.cleared);
  assert.equal(run.lcovExists, false);
  assert.equal(run.trace.lcovReads, 0);
  assert.equal(run.config, null);
});

test("coverage controller cannot accept a stale successful report after tests fail", (t) => {
  const run = runFixture(t, { statuses: { api: 0, web: 0, tests: 4 } });
  assert.equal(run.status, 4, run.stderr);
  assert.ok(run.trace.cleared);
  assert.equal(run.trace.lcovReads, 0);
  assert.equal(run.stdout, "");
  assert.equal(run.config.all, true);
});

test("coverage controller completes only after a fresh valid LCOV artifact", (t) => {
  const run = runFixture(t);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  assert.deepEqual(run.trace.commands.map(({ phase }) => phase), ["api", "web", "tests"]);
  assert.ok(run.trace.cleared);
  assert.equal(run.trace.lcovReads, 1);
  assert.equal(run.config.all, true);
  assert.deepEqual(run.config.reporter, ["lcovonly", "json", "json-summary", "text-summary"]);
  assert.match(run.stdout, /LCOV verified: 1 source files, 1 executed lines/);
});

test("coverage controller rejects a missing artifact even after tests exit successfully", (t) => {
  const run = runFixture(t, { lcov: null });
  assert.equal(run.status, 1);
  assert.equal(run.trace.lcovReads, 1);
  assert.match(run.stderr, /ENOENT/);
  assert.equal(run.stdout, "");
});

test("coverage controller rejects malformed and unexecuted artifacts", (t) => {
  for (const lcov of ["", validLcov.replace("DA:1,1", "DA:0,1"), validLcov.replace("DA:1,1", "DA:1,0")]) {
    const run = runFixture(t, { lcov });
    assert.equal(run.status, 1);
    assert.equal(run.trace.commands.at(-1).phase, "tests");
    assert.equal(run.trace.lcovReads, 1);
    assert.match(run.stderr, /LCOV/);
    assert.equal(run.stdout, "");
  }
});

test("coverage controller fails closed when a build or collector process cannot start", (t) => {
  for (const phase of ["api", "tests"]) {
    const run = runFixture(t, { statuses: { api: 0, web: 0, tests: 0, [phase]: null } });
    assert.equal(run.status, 1);
    assert.equal(run.trace.commands.at(-1).phase, phase);
    assert.equal(run.trace.lcovReads, 0);
    assert.equal(run.stdout, "");
  }
});

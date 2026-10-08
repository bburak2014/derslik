import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { apiRunner, compileFinished } from "../scripts/dev-api.mjs";

// Geliştirmede API, tsc --watch bir derlemeyi bitirince yeniden başlatılır.
// Dosya izleyicisi kullanılmaz: macOS dosya olaylarını onlarca saniye
// gecikmeyle iletebildiği için açılışta API art arda yeniden başlıyordu.

test("tsc --watch compile-finished lines are recognised, other output is not", () => {
  for (const line of [
    "12:55:33 AM - Found 0 errors. Watching for file changes.",
    "12:55:33 AM - Found 1 error. Watching for file changes.",
    "\u001b[90m12:55:33 AM\u001b[0m - Found 3 errors. Watching for file changes.",
  ])
    assert.equal(compileFinished(line), true, line);
  for (const line of [
    "12:55:31 AM - Starting compilation in watch mode...",
    "12:56:02 AM - File change detected. Starting incremental compilation...",
    "apps/api/src/main.ts(1,1): error TS1005: ';' expected.",
    "",
  ])
    assert.equal(compileFinished(line), false, line);
});

/** Gerçek alt süreç başlatan sahte API; başlangıçları sırasıyla kaydeder. */
function fakeApi(t, script = "setInterval(() => {}, 1000)") {
  const started = [];
  const start = () => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    started.push({ child, previousExited: started.length === 0 || exited(started.at(-1).child) });
    return child;
  };
  t.after(() => {
    for (const { child } of started) if (!exited(child)) child.kill("SIGKILL");
  });
  return { started, start };
}
const exited = (child) => child.exitCode !== null || child.signalCode !== null;
async function until(condition, limit = 5000) {
  const end = Date.now() + limit;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(10);
  }
}

test("the API starts only after the first compilation finishes", (t) => {
  const api = fakeApi(t);
  const runner = apiRunner(api.start);
  assert.equal(api.started.length, 0);
  runner.compiled();
  assert.equal(api.started.length, 1);
});

test("a later compilation stops the running API before starting the next one", async (t) => {
  const api = fakeApi(t);
  const runner = apiRunner(api.start);
  runner.compiled();
  runner.compiled();
  await until(() => api.started.length === 2);
  assert.equal(api.started[1].previousExited, true);
  assert.equal(api.started[0].child.signalCode, "SIGTERM");
  assert.equal(exited(api.started[1].child), false);
});

test("compilations that finish during a restart are covered by that restart", async (t) => {
  const api = fakeApi(t);
  const runner = apiRunner(api.start);
  runner.compiled();
  runner.compiled();
  runner.compiled();
  runner.compiled();
  await until(() => api.started.length === 2);
  // The second process loaded the newest output; no third start follows.
  await sleep(300);
  assert.equal(api.started.length, 2);
  runner.compiled();
  await until(() => api.started.length === 3);
});

test("an API that crashed on its own is started again by the next compilation", async (t) => {
  const api = fakeApi(t, "process.exit(1)");
  const runner = apiRunner(api.start);
  runner.compiled();
  await until(() => exited(api.started[0].child));
  assert.equal(api.started[0].child.exitCode, 1);
  runner.compiled();
  await until(() => api.started.length === 2);
  assert.equal(api.started[1].previousExited, true);
});

test("no API is started while the launcher is shutting down", async (t) => {
  const api = fakeApi(t);
  let stopping = false;
  const runner = apiRunner(() => (stopping ? null : api.start()));
  runner.compiled();
  stopping = true;
  api.started[0].child.kill("SIGTERM");
  await once(api.started[0].child, "exit");
  runner.compiled();
  await sleep(100);
  runner.compiled();
  await sleep(100);
  assert.equal(api.started.length, 1);
});

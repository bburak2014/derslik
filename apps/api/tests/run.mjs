import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// PostgreSQL refuses root. Reuse an existing unprivileged account; never create one.
const wasm = process.argv.includes("--pglite");
const args = [
  "--test",
  "--test-reporter=spec",
  resolve("apps/api/tests/integration.test.mjs"),
];
const root = !wasm && process.platform === "linux" && process.getuid?.() === 0;
const result = spawnSync(
  root ? "runuser" : process.execPath,
  root ? ["-u", "nobody", "--", process.execPath, ...args] : args,
  {
    stdio: "inherit",
    env: { ...process.env, DERSLIK_TEST_ENGINE: wasm ? "pglite" : "native" },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

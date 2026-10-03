import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const suites = [
  ["apps/api/tests/run.mjs", "--pglite"],
  ["scripts/mobile-security-tests.mjs"],
  [
    "--experimental-strip-types",
    "--test",
    ...readdirSync(resolve(root, "tests"))
      .filter((file) => file.endsWith(".test.mjs"))
      .sort((a, b) => a.localeCompare(b))
      .map((file) => `tests/${file}`),
  ],
];

// Run every suite even after a failure so the output identifies all broken
// areas. The collector still exits nonzero and CI never scans failed tests.
for (const args of suites) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

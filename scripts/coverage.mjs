import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

export function coverageConfiguration(properties, workspace = root) {
  const settings = Object.fromEntries(
    properties.split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf("=");
      return separator > 0 && !line.trim().startsWith("#")
        ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
        : [];
    }),
  );
  if (!settings["sonar.sources"])
    throw new Error("sonar.sources is required for coverage scope");
  const include = settings["sonar.sources"].split(",").map((source) => {
    const file = source.trim();
    return statSync(resolve(workspace, file)).isDirectory()
      ? `${file}/**/*`
      : file;
  });
  return {
    all: true,
    src: [workspace],
    include,
    exclude: (settings["sonar.exclusions"] ?? "").split(",").filter(Boolean),
    "exclude-after-remap": true,
    extension: [".js", ".mjs", ".cjs", ".ts", ".tsx"],
    reporter: ["lcovonly", "json", "json-summary", "text-summary"],
    "reports-dir": "reports/coverage",
    "temp-directory": "reports/coverage/v8",
  };
}

export function verifyLcov(contents, workspace = root) {
  const files = contents
    .split("end_of_record")
    .filter((record) => record.includes("SF:"));
  if (!files.length) throw new Error("LCOV report contains no source files");
  let coveredLines = 0;
  for (const record of files) {
    const file = /^SF:(.+)$/m.exec(record)?.[1];
    const source = resolve(workspace, file);
    if (!source.startsWith(`${workspace}/`) || !statSync(source).isFile())
      throw new Error(`LCOV source is not a workspace file: ${file}`);
    const lineCount = readFileSync(source, "utf8").split(/\r?\n/).length;
    for (const line of record
      .split(/\r?\n/)
      .filter((value) => value.startsWith("DA:"))) {
      const [number, hits] = line.slice(3).split(",").map(Number);
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > lineCount ||
        !Number.isFinite(hits) ||
        hits < 0
      )
        throw new Error(`Invalid LCOV line for ${file}: ${line}`);
      if (hits > 0) coveredLines++;
    }
  }
  if (!coveredLines)
    throw new Error("LCOV report has no executed source lines");
  return { files: files.length, coveredLines };
}

export function runCoverage() {
  // Invalidate old coverage before any build can fail; a later Sonar command
  // must not import a report left over from another source revision.
  const reportDir = resolve(root, "reports/coverage");
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });
  // Build output is not a coverage input; its source maps are read when API tests execute it.
  const builds = [
    ["node_modules/typescript/bin/tsc", "-p", "apps/api/tsconfig.json"],
    [
      "apps/web/node_modules/next/dist/bin/next",
      "build",
      "apps/web",
      "--webpack",
    ],
  ];
  for (const args of builds) {
    const build = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    if (build.status !== 0) return build.status ?? 1;
  }
  const config = resolve(reportDir, "c8-config.json");
  writeFileSync(
    config,
    JSON.stringify(
      coverageConfiguration(
        readFileSync(resolve(root, "sonar-project.properties"), "utf8"),
      ),
      null,
      2,
    ),
  );
  const require = createRequire(import.meta.url);
  const c8 = resolve(dirname(require.resolve("c8/package.json")), "bin/c8.js");
  const tests = spawnSync(
    process.execPath,
    [c8, "--config", config, process.execPath, "scripts/coverage-suites.mjs"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, DERSLIK_TEST_COVERAGE: "1" },
    },
  );
  if (tests.status !== 0) return tests.status ?? 1;
  const result = verifyLcov(
    readFileSync(resolve(reportDir, "lcov.info"), "utf8"),
  );
  console.log(
    `LCOV verified: ${result.files} source files, ${result.coveredLines} executed lines (reports/coverage/lcov.info).`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runCoverage();
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { coverageConfiguration, verifyLcov } from "../scripts/coverage.mjs";
import {
  loadTestModule,
  transpileTestSource,
} from "../scripts/test-source-loader.mjs";

test("coverage scope follows Sonar sources and exclusions, including unexecuted files", () => {
  const config = coverageConfiguration(
    "sonar.sources=apps/api/src,apps/web/proxy.ts\nsonar.exclusions=**/node_modules/**,apps/web/components/ui/**",
  );
  assert.equal(config.all, true);
  assert.equal(config["exclude-after-remap"], true);
  assert.deepEqual(config.include, ["apps/api/src/**/*", "apps/web/proxy.ts"]);
  assert.deepEqual(config.exclude, [
    "**/node_modules/**",
    "apps/web/components/ui/**",
  ]);
  assert.throws(
    () => coverageConfiguration("# sonar.sources=apps/api/src"),
    /sonar.sources/,
  );
});

test("VM source map identifies original TypeScript and excludes appended fixture code", () => {
  const { code } = transpileTestSource("packages/contracts/src/booking.ts");
  const encoded = /sourceMappingURL=data:application\/json;base64,(.+)/.exec(
    code,
  )[1];
  const map = JSON.parse(Buffer.from(encoded, "base64").toString());
  assert.match(map.sources[0], /packages\/contracts\/src\/booking\.ts$/);
  assert.ok(map.sourcesContent[0].includes("BOOKING_HORIZON_DAYS"));
  const exports = loadTestModule("packages/api-client/src/socket.ts", {
    suffix: "export const fixture = 7;",
  });
  assert.equal(exports.fixture, 7);
});

test("LCOV validation rejects missing files, invalid line numbers and empty execution", () => {
  const workspace = mkdtempSync(join(tmpdir(), "derslik-coverage-"));
  try {
    writeFileSync(join(workspace, "fixture.ts"), "export const value = 1;\n");
    const record = (file, line) => `SF:${file}\nDA:${line}\nend_of_record\n`;
    assert.deepEqual(verifyLcov(record("fixture.ts", "1,2"), workspace), {
      files: 1,
      coveredLines: 1,
    });
    assert.throws(() => verifyLcov("", workspace), /no source files/);
    assert.throws(
      () => verifyLcov(record("fixture.ts", "1,0"), workspace),
      /no executed/,
    );
    assert.throws(
      () => verifyLcov(record("fixture.ts", "99,1"), workspace),
      /Invalid LCOV/,
    );
    assert.throws(
      () => verifyLcov(record("fixture.ts", "0,1"), workspace),
      /Invalid LCOV/,
    );
    assert.throws(
      () => verifyLcov(record("fixture.ts", "1,-1"), workspace),
      /Invalid LCOV/,
    );
    assert.throws(
      () => verifyLcov(record("../missing.ts", "1,1"), workspace),
      /not a workspace/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("V8 mapping never marks an uncalled TypeScript function as covered", () => {
  const output = mkdtempSync(join(tmpdir(), "derslik-source-map-"));
  try {
    const require = createRequire(import.meta.url);
    const c8 = resolve(
      dirname(require.resolve("c8/package.json")),
      "bin/c8.js",
    );
    const root = resolve(import.meta.dirname, "..");
    const file = "packages/api-client/src/socket.ts";
    const config = join(output, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        all: false,
        include: [file],
        "exclude-after-remap": true,
        reporter: ["lcovonly"],
        "reports-dir": output,
        "temp-directory": join(output, "v8"),
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        c8,
        "--config",
        config,
        process.execPath,
        "--input-type=module",
        "--eval",
        `import { loadTestModule } from './scripts/test-source-loader.mjs'; loadTestModule('${file}');`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, DERSLIK_TEST_COVERAGE: "1" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const source = readFileSync(resolve(root, file), "utf8").split(/\r?\n/);
    const bodyLine =
      source.findIndex((line) =>
        line.includes("const value = JSON.parse(data)"),
      ) + 1;
    assert.ok(bodyLine > 0);
    assert.match(
      readFileSync(join(output, "lcov.info"), "utf8"),
      new RegExp(`^DA:${bodyLine},0$`, "m"),
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bareSuppressions } from "../scripts/sonar-gate.mjs";

// Sonar susturmaları gerekçesiz olmaz: "// NOSONAR: <gerekçe>" ve
// "eslint-disable… sonarjs/<kural> -- <gerekçe>". Gerekçesiz susturma,
// sıfır sorun kuralını sessizce deler.
const root = path.resolve(import.meta.dirname, "..");
const roots = [
  "apps/api/src",
  "apps/api/tests",
  "apps/web/app",
  "apps/web/components",
  "apps/web/hooks",
  "apps/web/lib",
  "apps/web/proxy.ts",
  "apps/mobile/src",
  "apps/mobile/index.ts",
  "packages/contracts/src",
  "packages/api-client/src",
  "scripts",
  "build",
  "tests",
];
// Bu dosyanın örnek satırları bilerek gerekçesizdir.
const skip = /node_modules|\.next|components\/ui\/|sonar-suppressions\.test\.mjs$/;
function* files(entry) {
  if (skip.test(entry)) return;
  if (fs.statSync(entry).isFile()) {
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) yield entry;
    return;
  }
  for (const name of fs.readdirSync(entry)) yield* files(path.join(entry, name));
}

test("gerekçesiz susturma yakalanır, gerekçeli olan geçer", () => {
  assert.deepEqual(
    bareSuppressions(
      [
        "a(); // NOSONAR",
        "b(); // NOSONAR: Sonar burada X'i yanlış okuyor",
        "// eslint-disable-next-line sonarjs/no-nested-conditional",
        "// eslint-disable-next-line sonarjs/no-nested-conditional -- tablo okunuşu",
        "/* eslint-disable sonarjs/cognitive-complexity */",
        "const s = 'NOSONAR dize içinde, yorum değil';",
      ].join("\n"),
    ),
    [1, 3, 5],
  );
});

test("Sonar kapsamında gerekçesiz susturma yok", () => {
  const offenders = [];
  for (const entry of roots)
    for (const file of files(path.join(root, entry)))
      for (const line of bareSuppressions(fs.readFileSync(file, "utf8")))
        offenders.push(`${path.relative(root, file)}:${line}`);
  assert.deepEqual(offenders, []);
});

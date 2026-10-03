import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ESLint } from "eslint";

// ESLint'teki Sonar katmanı: Sonar kapsamındaki dosyada SonarJS kuralı hata
// olarak raporlanır; shadcn dosyalarında uygulanmaz.
const root = path.resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: root });
// Bütün dalları aynı koşul: SonarJS S3923 (no-all-duplicated-branches).
const sample = [
  "export function f(x: boolean) {",
  "  if (x) {",
  "    return 1;",
  "  } else {",
  "    return 1;",
  "  }",
  "}",
  "",
].join("\n");
async function sonarMessages(file) {
  const [result] = await eslint.lintText(sample, {
    filePath: path.join(root, file),
  });
  return result.messages
    .filter((m) => m.ruleId?.startsWith("sonarjs/"))
    .map((m) => [m.ruleId, m.severity]);
}

test("Sonar kapsamındaki dosyada SonarJS ihlali hata olur", async () => {
  for (const file of ["apps/web/lib/__sonar_probe__.ts", "build/__sonar_probe__.ts"]) {
    const found = await sonarMessages(file);
    assert.ok(
      found.some(([rule]) => rule === "sonarjs/no-all-duplicated-branches"),
      `${file}: ${JSON.stringify(found)}`,
    );
    assert.ok(found.every(([, severity]) => severity === 2));
  }
});

test("shadcn dosyalarında SonarJS kuralları uygulanmaz", async () => {
  assert.deepEqual(
    await sonarMessages("apps/web/components/ui/__sonar_probe__.tsx"),
    [],
  );
});

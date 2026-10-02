import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bareSuppressions } from "../scripts/sonar-gate.mjs";

// Sonar susturmaları gerekçesiz olmaz: "// NOSONAR: <gerekçe>" ve
// "eslint-disable… sonarjs/<kural> -- <gerekçe>". Gerekçesiz susturma,
// sıfır sorun kuralını sessizce deler.
const root = path.resolve(import.meta.dirname, "..");

// sonar-project.properties'ten kapsamı oku: sonar.sources ve sonar.tests.
function readSonarScope() {
  const propsPath = path.join(root, "sonar-project.properties");
  const content = fs.readFileSync(propsPath, "utf8");
  const sources = new Set();

  for (const line of content.split("\n")) {
    const match = line.match(/^sonar\.(sources|tests)\s*=\s*(.+)$/);
    if (!match) continue;
    for (const entry of match[2].split(",")) {
      const trimmed = entry.trim();
      if (trimmed) sources.add(trimmed);
    }
  }

  const roots = Array.from(sources);
  // Var olmayan yollar açık hata verir.
  for (const root_path of roots) {
    const fullPath = path.join(root, root_path);
    try {
      fs.statSync(fullPath);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(`Sonar kapsamında yapılandırılan yol bulunamadı: ${root_path}`);
      throw error;
    }
  }

  return roots;
}

const roots = readSonarScope();

// Bu dosyanın örnek satırları bilerek gerekçesizdir.
// skip regex'i nispi yola uygulanır, mutlak yola değil.
const skip = /node_modules|\.next|components\/ui\/|sonar-suppressions\.test\.mjs$/;
function* files(entry) {
  if (fs.statSync(entry).isFile()) {
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      // skip'i nispi yola uygula
      const relativePath = path.relative(root, entry);
      if (!skip.test(relativePath)) yield entry;
    }
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
  let scannedCount = 0;
  for (const entry of roots)
    for (const file of files(path.join(root, entry))) {
      scannedCount++;
      for (const line of bareSuppressions(fs.readFileSync(file, "utf8")))
        offenders.push(`${path.relative(root, file)}:${line}`);
    }
  // Test boş geçer diye, en az 100 dosya taranmalı.
  assert.ok(scannedCount >= 100, `En az 100 dosya taranmalı, tarandı: ${scannedCount}`);
  assert.deepEqual(offenders, []);
});

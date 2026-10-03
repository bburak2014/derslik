import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DUPLICATION,
  collectPages,
  componentPath,
  evaluateGate,
  formatFindings,
  safeLogText,
  severityOf,
} from "../scripts/sonar-gate.mjs";

// Sonar kapısının kararı: sorun, güvenlik noktası ya da kod tekrarı sınırı.
const issue = (file, line, rule = "typescript:S1854", severity = "MEDIUM") => ({
  component: `derslik:${file}`,
  line,
  rule,
  message: `${rule} mesajı`,
  impacts: [{ softwareQuality: "MAINTAINABILITY", severity }],
});
const hotspot = (file, line) => ({
  component: `derslik:${file}`,
  line,
  ruleKey: "typescript:S5332",
  message: "Güvenli olmayan protokol",
  vulnerabilityProbability: "LOW",
});

test("bileşen anahtarından proje adı atılır", () => {
  assert.equal(componentPath("derslik:apps/web/lib/x.ts"), "apps/web/lib/x.ts");
  assert.equal(componentPath("derslik"), "derslik");
});

test("önem en yüksek etkiden, yoksa eski severity alanından okunur", () => {
  assert.equal(
    severityOf({
      impacts: [
        { softwareQuality: "MAINTAINABILITY", severity: "LOW" },
        { softwareQuality: "RELIABILITY", severity: "HIGH" },
      ],
    }),
    "HIGH",
  );
  assert.equal(severityOf({ severity: "MAJOR" }), "MAJOR");
  assert.equal(severityOf({}), "-");
});

test("sorun, güvenlik noktası ve fazla tekrar yoksa kapı geçer", () => {
  const r = evaluateGate({ issues: [], hotspots: [], duplication: 1.2 });
  assert.equal(r.failed, false);
  assert.equal(r.maxDuplication, MAX_DUPLICATION);
  assert.match(r.text.at(-1), /geçti/);
});

test("tek bir sorun kapıyı düşürür; dosya ve satır listelenir", () => {
  const r = evaluateGate({
    issues: [issue("apps/web/lib/a.ts", 7)],
    hotspots: [],
    duplication: 0,
  });
  assert.equal(r.failed, true);
  assert.deepEqual(r.issues, [
    {
      file: "apps/web/lib/a.ts",
      line: 7,
      severity: "MEDIUM",
      rule: "typescript:S1854",
      message: "typescript:S1854 mesajı",
    },
  ]);
  assert.ok(r.text.some((l) => l === "apps/web/lib/a.ts"));
  assert.ok(r.text.some((l) => /^\s+7\s+MEDIUM\s+typescript:S1854/.test(l)));
  assert.match(r.text.at(-1), /GEÇMEDİ/);
});

test("inceleme bekleyen güvenlik noktası kapıyı düşürür", () => {
  const r = evaluateGate({
    issues: [],
    hotspots: [hotspot("scripts/x.mjs", 3)],
    duplication: 0,
  });
  assert.equal(r.failed, true);
  assert.equal(r.hotspots[0].file, "scripts/x.mjs");
  assert.ok(r.text.some((l) => /güvenlik noktaları \(1\)/.test(l)));
});

test("kod tekrarı sınırı aşılırsa kapı düşer, sınırda geçer", () => {
  assert.equal(
    evaluateGate({ issues: [], hotspots: [], duplication: 3.1, maxDuplication: 3 })
      .failed,
    true,
  );
  assert.equal(
    evaluateGate({ issues: [], hotspots: [], duplication: 3, maxDuplication: 3 })
      .failed,
    false,
  );
});

test("tekrar oranı ya da listeler okunamazsa kapı hata verir", () => {
  assert.throws(
    () => evaluateGate({ issues: [], hotspots: [], duplication: Number.NaN }),
    /tekrar/i,
  );
  assert.throws(
    () => evaluateGate({ issues: undefined, hotspots: [], duplication: 0 }),
    /sorun listesi/i,
  );
});

test("satırlar dosyaya göre gruplanır ve satıra göre sıralanır", () => {
  const lines = formatFindings([
    { file: "b.ts", line: 9, severity: "LOW", rule: "r1", message: "m1" },
    { file: "a.ts", line: 12, severity: "HIGH", rule: "r2", message: "m2" },
    { file: "a.ts", line: 3, severity: "LOW", rule: "r3", message: "m3" },
  ]);
  assert.deepEqual(
    lines.map((l) => l.trim().split(/\s+/)[0]),
    ["a.ts", "3", "12", "b.ts", "9"],
  );
});

test("sayfalar toplam sayıya ulaşana kadar okunur", async () => {
  const pages = [[1, 2], [3, 4], [5]];
  const seen = [];
  const all = await collectPages(async (page) => {
    seen.push(page);
    return { items: pages[page - 1], total: 5 };
  });
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  assert.deepEqual(seen, [1, 2, 3]);
});

test("toplam sayıdan önce boş sayfa ya da bozuk yanıt gelirse hata verilir", async () => {
  await assert.rejects(
    collectPages(async () => ({ items: [], total: 3 })),
    /eksik/i,
  );
  await assert.rejects(
    collectPages(async () => ({ items: undefined, total: 3 })),
    /beklenmeyen/i,
  );
});

test("loga yazılacak metinde satır sonu ve kontrol karakterleri boşluğa çevrilir", () => {
  assert.equal(safeLogText("a\r\nb\nc\rd"), "a  b c d");
  assert.equal(safeLogText("x\u001b[31my\u007fz\u009b"), "x [31my z ");
  assert.equal(safeLogText("a\tb"), "a b");
  // Normal metin (Türkçe harfler, noktalama, sayı) aynen kalır.
  const normal = "Açık sorunlar (3): ığüşöç İĞÜŞÖÇ — %5, 'tırnak'";
  assert.equal(safeLogText(normal), normal);
  assert.equal(safeLogText(42), "42");
});

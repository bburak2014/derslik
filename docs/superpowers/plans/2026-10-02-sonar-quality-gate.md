# Sonar Kalite Kapısı Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her `git commit` öncesinde Sonar kapısı çalışır; projede açık Sonar sorunu varsa commit atılmaz. Projedeki bütün Sonar sorunları temizlenir ve CI aynı kapıyı uygular.

**Architecture:** Üç katman. (1) Commit kancası `.githooks/pre-commit` uygun Node'u bulup `scripts/sonar.mjs --gate`'i çalıştırır. (2) Kapı yerel SonarQube'de çalışma kopyasını tarar, sorunları okur ve karar verir. Karar ve rapor saf bir modülde (`scripts/sonar-gate.mjs`); imajlar, worktree'lerin ortak yolları, kapsayıcının yeniden kurulma koşulu ve kilit ayrı bir modülde (`scripts/sonar-local.mjs`). Codex'in `scripts/sonar-report.mjs`'i (görev bekleme, tarayıcı çağrısı) olduğu gibi kullanılır. (3) ESLint'te SonarJS kuralları ve CI'da ayrı bir `sonar` işi.

**Tech Stack:** Node 24 (betikler, `node:test`), POSIX `sh` (kanca), SonarQube Community Build `26.9.0.129388` (Docker), yerel sonar-scanner `8.1.0.6389` (macOS arm64) ya da Docker'da sonar-scanner-cli `12.2.0.4256_8.1.0`, ESLint 9 ve `eslint-plugin-sonarjs`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-sonar-quality-gate-design.md`

**Çalışma yeri:** `.claude/worktrees/lesson-booking` worktree'si, dal `sonar-quality-gate` (başlangıçta `main` = `a9d98a3`).

**Sıra notu:** Tasarımın "Uygulama sırası"nda ESLint katmanı (2. adım) temizlikten (3. adım) önce. Bu planda ESLint katmanı temizlikten sonra geliyor (Görev 15). Böylece temizlik boyunca `pnpm lint` kırmızıya düşmez; ESLint'te kalan ihlaller Görev 15'te düzeltilir. Sonuç aynıdır.

## Global Constraints

- **Kanca:** `.githooks/pre-commit` (POSIX `sh`, çalıştırılabilir). `package.json`'daki `prepare` betiği `git config core.hooksPath .githooks` yapar; git deposu dışında hata vermez. Bağımlılık eklenmez (husky yok).
- **Kancanın açılışı:** Kanca dosyaları commit edildikten sonra açılır (Görev 8). Görev 1–7 boyunca `pnpm install` ya da `pnpm add` çalıştırılmaz; `prepare` kancayı erken açar.
- **Node:** `>=22.13.0` (`package.json` `engines`). PATH'teki `node` uymazsa `${NVM_DIR:-$HOME/.nvm}/versions/node/v*/bin/node` arasından uyan en yeni sürüm kullanılır. Hiçbiri yoksa commit durur.
- **`--no-verify`:** Yalnızca kullanıcının o commit ya da o temizlik bölümü için verdiği açık onayla kullanılır. Temizlik bitene kadar temizlik commit'leri bu yolla atılır; her bölümün commit'i için ayrı onay alınır.
- **Kapı kuralı:** Her türden ve her önemdeki açık sorun (hata, güvenlik açığı, kod kokusu) ya da `TO_REVIEW` durumundaki her güvenlik noktası kapıyı düşürür. Kod tekrarı en fazla %3. Test kapsamı kurala girmez. Sonar'ın kendi kalite kapısı ("Sonar way") bu kararda kullanılmaz.
- **Kapı kapalıyken güvenli çalışır.** Docker yok, sunucu açılmıyor, tarama başarısız, görev FAILED/CANCELED/zaman aşımı, API hatası, eksik sayfa: hiçbiri "0 sorun" sayılmaz, çıkış kodu 0 olmaz.
- **İmajlar:** `sonarqube:26.9.0.129388-community` ve `sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0` (`scripts/sonar-local.mjs`). Docker tarayıcısı `--platform linux/amd64` ile çalışır.
- **Ortak yollar:** Ana checkout = `git rev-parse --path-format=absolute --git-common-dir` çıktısının üst klasörü. Parola `<ana checkout>/reports/.sonar-admin`; yerel tarayıcı `<ana checkout>/reports/quality/tool-cache/sonar-scanner-*/bin/sonar-scanner`; tarayıcı önbelleği `<ana checkout>/reports/quality/cache`. Ortam değişkenleri (`SONAR_ADMIN_PASSWORD`, `SONAR_ADMIN_FILE`, `SONAR_SCANNER_PATH`, `SONAR_USER_HOME`) önceliklidir.
- **Kilit:** `<git ortak klasörü>/sonar-gate.lock` klasörü, içinde sahibin pid'i. Sahibi yaşamıyorsa ya da sahibi yazılmamış kilit 30 saniyeden eskiyse bayattır. Bekleme sınırı 10 dakika. Kapı nasıl biterse bitsin kilit bırakılır.
- **Sunucu:** Tek sunucu `derslik-sonarqube`, yalnızca `127.0.0.1:9000`. Veri birimleri (`derslik-sonar-data`, `derslik-sonar-extensions`) hiçbir adımda silinmez. `derslik-quality-sonar` durdurulur, silinmez.
- **Susturma yalnızca gerekçeyle yapılır:** `// NOSONAR: <gerekçe>`, `// eslint-disable-next-line sonarjs/<kural> -- <gerekçe>` ya da `sonar-project.properties`'te yorumla açıklanmış `sonar.issue.ignore.multicriteria`. Sunucudaki "False positive / Safe / Accept" işaretleri kullanılmaz.
- **Temizlik davranışı değiştirmez.** Değiştirmesi gereken bir düzeltme çıkarsa testle korunur ve kullanıcıya bildirilir.
- **ESLint:** SonarJS kuralları `error` düzeyinde ve yalnızca Sonar'ın taradığı dosyalarda uygulanır. Shadcn dosyaları (`apps/web/components/ui/**`, `apps/web/hooks/use-mobile.ts`) ve `apps/web/vendor/**` hariçtir.
- **GitHub eylemleri** SHA'ya sabitlenir. `actions/upload-artifact` için `v4.6.2` (`ea165f8d65b6e75b540449e92b4886f43607fa02`).
- **Commit'ler:** Mesajlar ve yorumlar Türkçe. Commit sonuna `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` eklenir.
- **Araç zinciri:** Komutlardan önce `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`. Sonar komutları Docker Desktop'ın açık olmasını ister. Ana checkout'a dokunan git komutları (birleştirme, push) kullanıcının terminalinde, onayıyla çalışır.

## Review Focus

1. **Yarıda kalan kapı:** Kapı Ctrl-C ile kesilir ya da çökerse kalan kilit sonraki commit'leri bekletmemeli. Sahibi yaşamayan kilit hemen alınır (Görev 3 testi), çıkışta kilit bırakılır (Görev 4).
2. **Aynı anda iki commit:** İki worktree aynı anda commit ederse ikincisi bekler; bir kopyanın sonucu ötekininkiyle karışmaz (Görev 3 testi).
3. **Masaüstü uygulamasından commit:** PATH'te yalnızca Node 20 varken kanca nvm'deki Node 24'ü bulur (Görev 6 testi, Görev 8'de gerçek deneme).
4. **Eksik ya da bozuk yanıt:** 500'den fazla sorun, HTTP hatası, işlenmemiş analiz ya da yanlış parola hiçbir zaman "geçti" sayılmaz (Görev 1 testleri, Görev 5'te gerçek deneme).
5. **Eski kapsayıcı:** Farklı imajla ya da bütün ağ arayüzlerine açık çalışan kapsayıcı, veri korunarak yeniden kurulur (Görev 3 testi, Görev 5'te gerçek deneme).

---

### Görev 1: Kapının saf kısmı

**Files:**
- Create: `scripts/sonar-gate.mjs`
- Modify: `package.json` (`test:quality`)
- Test: `tests/sonar-gate.test.mjs`

**Interfaces:**
- Produces: `scripts/sonar-gate.mjs` → `MAX_DUPLICATION: number`, `componentPath(component: string): string`, `severityOf(issue): string`, `formatFindings(findings): string[]`, `evaluateGate({ issues, hotspots, duplication, maxDuplication? }) → { failed: boolean, issues: Finding[], hotspots: Finding[], duplication: number, maxDuplication: number, text: string[] }`, `collectPages(fetchPage: (page: number) => Promise<{ items: unknown[], total: number }>): Promise<unknown[]>`. `Finding = { file, line, severity, rule, message }`.

- [ ] **Adım 1: Testleri yaz**

`tests/sonar-gate.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DUPLICATION,
  collectPages,
  componentPath,
  evaluateGate,
  formatFindings,
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
```

`package.json` `scripts`:

```json
"test:quality": "node --experimental-strip-types --test tests/frontend-quality.test.mjs tests/sonar-report.test.mjs tests/site-build.test.mjs tests/sonar-gate.test.mjs",
```

- [ ] **Adım 2: Testleri çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-gate.test.mjs`
Beklenen: FAIL. `Cannot find module '…/scripts/sonar-gate.mjs'`.

- [ ] **Adım 3: Saf modülü yaz**

`scripts/sonar-gate.mjs`:

```js
// Sonar kapısının saf kısmı: SonarQube'den gelen sorunları, güvenlik
// noktalarını ve kod tekrarı oranını değerlendirip okunur bir rapora çevirir.
// Ağ ve Docker işleri scripts/sonar.mjs'te; burası tests/sonar-gate.test.mjs
// ile sınanır. Kapı kapalıyken güvenlidir: eksik ya da bozuk veri hata
// fırlatır, hiçbir zaman "0 sorun" sayılmaz.

/** Kod tekrarı sınırı (%): "Sonar way" kapısının yeni kod değeri. */
export const MAX_DUPLICATION = 3;

/** "derslik:apps/web/x.tsx" → "apps/web/x.tsx". */
export const componentPath = (component) =>
  component.includes(":")
    ? component.slice(component.indexOf(":") + 1)
    : component;

const IMPACT_ORDER = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"];

/** Sorunun önemi: yeni API'de en yüksek etki (impacts), eskide severity. */
export function severityOf(issue) {
  const levels = (issue.impacts ?? []).map((i) => i.severity);
  for (const level of IMPACT_ORDER) if (levels.includes(level)) return level;
  return issue.severity ?? "-";
}

/** Dosyaya göre gruplanmış, satıra göre sıralı rapor satırları. */
export function formatFindings(findings) {
  const byFile = new Map();
  for (const f of findings)
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const lines = [];
  for (const file of [...byFile.keys()].sort()) {
    lines.push(file);
    const sorted = byFile
      .get(file)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    for (const f of sorted)
      lines.push(
        `  ${String(f.line ?? "-").padStart(5)}  ${f.severity.padEnd(8)} ${f.rule}  ${f.message}`,
      );
  }
  return lines;
}

/** Kapı kararı ve rapor metni. */
export function evaluateGate({
  issues,
  hotspots,
  duplication,
  maxDuplication = MAX_DUPLICATION,
}) {
  if (!Array.isArray(issues) || !Array.isArray(hotspots))
    throw new Error("Sonar kapısı: sorun listesi okunamadı.");
  if (!Number.isFinite(duplication))
    throw new Error("Sonar kapısı: kod tekrarı oranı okunamadı.");
  const issueFindings = issues.map((i) => ({
    file: componentPath(i.component),
    line: i.line,
    severity: severityOf(i),
    rule: i.rule,
    message: i.message,
  }));
  const hotspotFindings = hotspots.map((h) => ({
    file: componentPath(h.component),
    line: h.line,
    severity: h.vulnerabilityProbability ?? "-",
    rule: h.ruleKey,
    message: h.message,
  }));
  const tooMuchDuplication = duplication > maxDuplication;
  const failed =
    issueFindings.length > 0 ||
    hotspotFindings.length > 0 ||
    tooMuchDuplication;
  const text = [
    ...(issueFindings.length
      ? [
          `Açık sorunlar (${issueFindings.length}):`,
          ...formatFindings(issueFindings),
        ]
      : []),
    ...(hotspotFindings.length
      ? [
          `İnceleme bekleyen güvenlik noktaları (${hotspotFindings.length}):`,
          ...formatFindings(hotspotFindings),
        ]
      : []),
    `Kod tekrarı: %${duplication} (sınır %${maxDuplication})${tooMuchDuplication ? ", sınır aşıldı" : ""}`,
    failed ? "Sonar kapısı: GEÇMEDİ" : "Sonar kapısı: geçti",
  ];
  return {
    failed,
    issues: issueFindings,
    hotspots: hotspotFindings,
    duplication,
    maxDuplication,
    text,
  };
}

/** Sayfalı bir listeyi baştan sona okur. Toplam sayıya ulaşmadan boş sayfa
 *  gelirse hata verir (eksik liste "az sorun" sanılmasın). */
export async function collectPages(fetchPage) {
  const all = [];
  for (let page = 1; ; page++) {
    const { items, total } = await fetchPage(page);
    if (!Array.isArray(items) || !Number.isFinite(total))
      throw new Error("Sonar kapısı: sayfa yanıtı beklenmeyen biçimde.");
    all.push(...items);
    if (all.length >= total) return all;
    if (!items.length)
      throw new Error(
        `Sonar kapısı: liste eksik geldi (${all.length}/${total}).`,
      );
  }
}
```

- [ ] **Adım 4: Testleri çalıştır, geçtiğini gör**

Çalıştır: `node --test tests/sonar-gate.test.mjs && pnpm test:quality`
Beklenen: PASS. `sonar-gate` 10/10; `test:quality` toplamı 52 (önceki 42 + 10).

- [ ] **Adım 5: Commit**

```bash
git add scripts/sonar-gate.mjs tests/sonar-gate.test.mjs package.json
git commit -m "Sonar kapısı: karar ve rapor modülü"
```

### Görev 2: Gerekçesiz susturma testi

**Files:**
- Modify: `scripts/sonar-gate.mjs` (`bareSuppressions`)
- Modify: `package.json` (`test:quality`)
- Test: `tests/sonar-suppressions.test.mjs`

**Interfaces:**
- Consumes: Sonar kapsamındaki klasörler (`sonar-project.properties`)
- Produces: `scripts/sonar-gate.mjs` → `bareSuppressions(text: string): number[]` (gerekçesiz susturma yorumlarının 1'den başlayan satır numaraları)

- [ ] **Adım 1: Testi yaz**

`tests/sonar-suppressions.test.mjs`:

```js
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
```

`package.json`:

```json
"test:quality": "node --experimental-strip-types --test tests/frontend-quality.test.mjs tests/sonar-report.test.mjs tests/site-build.test.mjs tests/sonar-gate.test.mjs tests/sonar-suppressions.test.mjs",
```

- [ ] **Adım 2: Testi çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-suppressions.test.mjs`
Beklenen: FAIL. `does not provide an export named 'bareSuppressions'`.

- [ ] **Adım 3: `bareSuppressions`'ı `scripts/sonar-gate.mjs`'in sonuna ekle**

```js
/** Gerekçesi olmayan Sonar susturma yorumlarının satır numaraları (1'den).
 *  Yalnızca yorumlara bakılır; dize içindeki "NOSONAR" sayılmaz. Kabul
 *  edilenler: "// NOSONAR: <gerekçe>" ve
 *  "eslint-disable… sonarjs/<kural> -- <gerekçe>". */
export function bareSuppressions(text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    const comment = line.search(/\/\/|\/\*/);
    if (comment === -1) return;
    const body = line.slice(comment);
    const nosonar = /NOSONAR/.test(body) && !/NOSONAR:\s*\S/.test(body);
    const eslint =
      /eslint-disable/.test(body) &&
      /sonarjs\//.test(body) &&
      !/--\s*\S/.test(body);
    if (nosonar || eslint) found.push(i + 1);
  });
  return found;
}
```

- [ ] **Adım 4: Testleri çalıştır**

Çalıştır: `pnpm test:quality`
Beklenen: PASS, toplam 54. Depoda bugün hiç susturma yok; ikinci test hemen geçer, birinci test deseni sınar.

- [ ] **Adım 5: Commit**

```bash
git add scripts/sonar-gate.mjs tests/sonar-suppressions.test.mjs package.json
git commit -m "Sonar: gerekçesiz susturma testi"
```

### Görev 3: Yerel ortam: imajlar, ortak yollar, kilit

**Files:**
- Create: `scripts/sonar-local.mjs`
- Modify: `package.json` (`test:quality`)
- Test: `tests/sonar-local.test.mjs`

**Interfaces:**
- Produces: `scripts/sonar-local.mjs` →
  - `SONARQUBE_IMAGE: string`, `SCANNER_IMAGE: string`
  - `gitCommonDir(cwd: string): string | null` (mutlak yol)
  - `mainCheckoutRoot(cwd: string): string`
  - `findNativeScanner(mainRoot: string): string | undefined`
  - `containerNeedsRebuild({ image: string, portBindings: object | null }, expectedImage: string): boolean`
  - `acquireLock(lockDir: string, options?: { pid?, isAlive?, now?, sleep?, timeoutMs?, pollMs?, onWait? }): Promise<() => void>` (dönen işlev kilidi bırakır)

- [ ] **Adım 1: Testleri yaz**

`tests/sonar-local.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SCANNER_IMAGE,
  SONARQUBE_IMAGE,
  acquireLock,
  containerNeedsRebuild,
  findNativeScanner,
  gitCommonDir,
  mainCheckoutRoot,
} from "../scripts/sonar-local.mjs";

// Yerel Sonar ortamı: imajlar, worktree'lerin ortak yolları, kapsayıcının
// yeniden kurulması ve aynı anda tek kapıya izin veren kilit.
function tempDir(t) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "derslik-sonar-local-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// Kancadan ya da başka bir git işleminden sızan GIT_* değişkenleri ve
// kullanıcının genel ayarları geçici depoları etkilemesin.
const cleanEnv = (home) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
});
const git = (cwd, home, ...args) =>
  execFileSync("git", args, { cwd, stdio: "pipe", env: cleanEnv(home) });
function lockHeldBy(lock, pid) {
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, "pid"), String(pid));
}

test("imajlar tam sürüme sabit", () => {
  assert.equal(SONARQUBE_IMAGE, "sonarqube:26.9.0.129388-community");
  assert.equal(
    SCANNER_IMAGE,
    "sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0",
  );
});

test("worktree'de ortak git klasörü ve ana checkout bulunur", (t) => {
  const dir = tempDir(t);
  const main = path.join(dir, "main");
  fs.mkdirSync(main);
  git(main, dir, "init", "-q");
  git(main, dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "ilk");
  const worktree = path.join(dir, "wt");
  git(main, dir, "worktree", "add", "-q", worktree);
  assert.equal(gitCommonDir(worktree), path.join(main, ".git"));
  assert.equal(mainCheckoutRoot(worktree), main);
  assert.equal(mainCheckoutRoot(main), main);
});

test("git deposu dışında ana checkout çalışılan klasördür", (t) => {
  const dir = tempDir(t);
  assert.equal(gitCommonDir(dir), null);
  assert.equal(mainCheckoutRoot(dir), dir);
});

test("yerel tarayıcı ana checkout'un araç önbelleğinde aranır, en yenisi seçilir", (t) => {
  const dir = tempDir(t);
  assert.equal(findNativeScanner(dir), undefined);
  const base = path.join(dir, "reports", "quality", "tool-cache");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "sonar-scanner-cli-8.1.0.6389.zip"), "");
  for (const version of ["8.0.0.1", "8.1.0.6389"]) {
    const bin = path.join(base, `sonar-scanner-${version}-macosx-aarch64`, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "sonar-scanner"), "#!/bin/sh\n", {
      mode: 0o755,
    });
  }
  assert.equal(
    findNativeScanner(dir),
    path.join(base, "sonar-scanner-8.1.0.6389-macosx-aarch64", "bin", "sonar-scanner"),
  );
});

test("çalıştırılamayan tarayıcı dosyası seçilmez", (t) => {
  const dir = tempDir(t);
  const bin = path.join(dir, "reports", "quality", "tool-cache", "sonar-scanner-8.1.0.6389-macosx-aarch64", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "sonar-scanner"), "", { mode: 0o644 });
  assert.equal(findNativeScanner(dir), undefined);
});

test("kapsayıcı sabit imajla ve yalnızca 127.0.0.1'de değilse yeniden kurulur", () => {
  const local = { "9000/tcp": [{ HostIp: "127.0.0.1", HostPort: "9000" }] };
  const check = (image, portBindings) =>
    containerNeedsRebuild({ image, portBindings }, SONARQUBE_IMAGE);
  assert.equal(check(SONARQUBE_IMAGE, local), false);
  assert.equal(check("sonarqube:community", local), true);
  assert.equal(
    check(SONARQUBE_IMAGE, { "9000/tcp": [{ HostIp: "", HostPort: "9000" }] }),
    true,
  );
  assert.equal(
    check(SONARQUBE_IMAGE, { "9000/tcp": [{ HostIp: "0.0.0.0", HostPort: "9000" }] }),
    true,
  );
  assert.equal(check(SONARQUBE_IMAGE, null), true);
});

test("boş kilit hemen alınır, bırakılınca silinir", async (t) => {
  const lock = path.join(tempDir(t), "yok", "sonar-gate.lock");
  const release = await acquireLock(lock, { pid: 4242 });
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "4242");
  release();
  assert.equal(fs.existsSync(lock), false);
  release(); // ikinci bırakma zararsız
});

test("yaşayan sahibin kilidi beklenir; sahibi bırakınca alınır", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  lockHeldBy(lock, 1111);
  const waits = [];
  const release = await acquireLock(lock, {
    pid: 2222,
    isAlive: (pid) => pid === 1111,
    onWait: (owner) => waits.push(owner),
    sleep: async () => fs.rmSync(lock, { recursive: true, force: true }),
  });
  assert.deepEqual(waits, [1111]);
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "2222");
  release();
});

test("kilit süre içinde alınamazsa kapı hata verir, başkasının kilidine dokunmaz", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  lockHeldBy(lock, 1111);
  let clock = 0;
  await assert.rejects(
    acquireLock(lock, {
      pid: 2222,
      isAlive: () => true,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      timeoutMs: 10_000,
      pollMs: 2000,
    }),
    /kilit/,
  );
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "1111");
});

test("sahibi yaşamayan bayat kilit hemen alınır", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  lockHeldBy(lock, 1111);
  const release = await acquireLock(lock, {
    pid: 2222,
    isAlive: () => false,
    timeoutMs: 0,
  });
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "2222");
  release();
});

test("sahibi yazılmamış kilit yeniyse beklenir, 30 saniyeden eskiyse alınır", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  fs.mkdirSync(lock);
  await assert.rejects(acquireLock(lock, { pid: 2222, timeoutMs: 0 }), /kilit/);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  const release = await acquireLock(lock, { pid: 2222, timeoutMs: 0 });
  release();
  assert.equal(fs.existsSync(lock), false);
});

test("bırakma yalnızca kendi kilidini siler", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  const release = await acquireLock(lock, { pid: 2222 });
  fs.writeFileSync(path.join(lock, "pid"), "3333");
  release();
  assert.equal(fs.existsSync(lock), true);
});
```

`package.json`:

```json
"test:quality": "node --experimental-strip-types --test tests/frontend-quality.test.mjs tests/sonar-report.test.mjs tests/site-build.test.mjs tests/sonar-gate.test.mjs tests/sonar-suppressions.test.mjs tests/sonar-local.test.mjs",
```

- [ ] **Adım 2: Testleri çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-local.test.mjs`
Beklenen: FAIL. `Cannot find module '…/scripts/sonar-local.mjs'`.

- [ ] **Adım 3: Modülü yaz**

`scripts/sonar-local.mjs`:

```js
// Yerel Sonar ortamı: sabit imajlar, ana checkout'un yolları (worktree'ler
// parolayı, yerel tarayıcıyı ve önbelleği oradan paylaşır), kapsayıcının
// yeniden kurulma koşulu ve aynı anda tek kapıya izin veren kilit.
// tests/sonar-local.test.mjs ile sınanır.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Yerelde ve CI'da aynı kurallar çalışsın diye imajlar tam sürüme sabit.
// Yükseltme ayrı iştir; yeni kurallar yeni sorunlar getirebilir.
export const SONARQUBE_IMAGE = "sonarqube:26.9.0.129388-community";
export const SCANNER_IMAGE = "sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0";

/** Bütün worktree'lerin paylaştığı git klasörü (ana checkout'un .git'i).
 *  Git deposu değilse null. */
export function gitCommonDir(cwd) {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

/** Ana checkout'un kökü; worktree'de de ana kopya, git yoksa cwd. */
export function mainCheckoutRoot(cwd) {
  const common = gitCommonDir(cwd);
  return common ? path.dirname(common) : cwd;
}

/** Ana checkout'taki yerel (native) tarayıcı. Yoksa undefined: Docker
 *  tarayıcısı kullanılır. Birden çok sürüm varsa en yenisi. */
export function findNativeScanner(mainRoot) {
  const base = path.join(mainRoot, "reports", "quality", "tool-cache");
  let names;
  try {
    names = fs.readdirSync(base);
  } catch {
    return undefined;
  }
  const candidates = names
    .filter((name) => name.startsWith("sonar-scanner-"))
    .sort()
    .reverse();
  for (const name of candidates) {
    const bin = path.join(base, name, "bin", "sonar-scanner");
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {
      // Burada çalıştırılabilir tarayıcı yok (ör. indirilen zip).
    }
  }
  return undefined;
}

/** Var olan kapsayıcı sabit imajla ve yalnızca 127.0.0.1'e bağlı çalışmıyorsa
 *  yeniden kurulmalı. Docker "bütün arayüzler" için HostIp'i boş bırakır. */
export function containerNeedsRebuild({ image, portBindings }, expectedImage) {
  if (image !== expectedImage) return true;
  const bindings = Object.values(portBindings ?? {}).flat();
  return (
    bindings.length === 0 ||
    bindings.some((binding) => binding?.HostIp !== "127.0.0.1")
  );
}

const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: süreç var ama başka kullanıcının.
    return error.code === "EPERM";
  }
};

function readOwner(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function lockAge(lockDir, now) {
  try {
    return now() - fs.statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}

/** Sahibi yazılmamış kilit bu süreden eskiyse bayattır (yazan süreç çöktü). */
const OWNERLESS_STALE_MS = 30_000;

/** Aynı anda tek Sonar kapısı. Kilit klasörünü alır (mkdir atomiktir) ve
 *  bırakma işlevini döndürür. Sahibi yaşamayan kilit bayattır, alınır.
 *  Süre içinde alınamazsa hata verir. */
export async function acquireLock(lockDir, options = {}) {
  const {
    pid = process.pid,
    isAlive = processAlive,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 600_000,
    pollMs = 2000,
    onWait = () => {},
  } = options;
  const ownerFile = path.join(lockDir, "pid");
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const started = now();
  let waited = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(ownerFile, String(pid));
      return () => {
        if (readOwner(ownerFile) === pid)
          fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const owner = readOwner(ownerFile);
    const stale =
      owner === null
        ? lockAge(lockDir, now) > OWNERLESS_STALE_MS
        : !isAlive(owner);
    if (stale) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (now() - started >= timeoutMs)
      throw new Error(
        `Sonar kapısı: kilit ${Math.round(timeoutMs / 60_000)} dakikada alınamadı (${lockDir}).`,
      );
    if (!waited) {
      onWait(owner);
      waited = true;
    }
    await sleep(pollMs);
  }
}
```

- [ ] **Adım 4: Testleri çalıştır, geçtiğini gör**

Çalıştır: `node --test tests/sonar-local.test.mjs && pnpm test:quality`
Beklenen: PASS. `sonar-local` 12/12; `test:quality` toplamı 66.

- [ ] **Adım 5: Commit**

```bash
git add scripts/sonar-local.mjs tests/sonar-local.test.mjs package.json
git commit -m "Sonar: sabit imajlar, worktree'lerin ortak yolları ve kapı kilidi"
```

### Görev 4: `sonar.mjs`'i kapıya bağla

**Files:**
- Modify: `scripts/sonar-report.mjs` (Docker tarayıcısında sabit imaj ve platform)
- Modify: `scripts/sonar.mjs` (ortak yollar, kapsayıcı denetimi, sabit sunucu imajı, `--gate`, kilit)
- Modify: `sonar-project.properties` (`sonar.scm.disabled=true`)
- Modify: `package.json` (`quality:gate`)
- Test: `tests/sonar-report.test.mjs` (Docker tarayıcı testi)

**Interfaces:**
- Consumes: Görev 1 (`collectPages`, `evaluateGate`), Görev 3 (`SONARQUBE_IMAGE`, `SCANNER_IMAGE`, `acquireLock`, `containerNeedsRebuild`, `findNativeScanner`, `gitCommonDir`), mevcut `scripts/sonar-report.mjs` (`waitForAnalysis(request, taskId)`, `scannerTaskId(file)`, `scannerInvocation({...})`).
- Produces: `node scripts/sonar.mjs --gate` ve `pnpm quality:gate`: çıkış 0 (geçti) ya da 0 dışı; ilk satır `Sonar kapısı: <kök> (Node <sürüm>)`; `reports/sonar-gate.json` (`evaluateGate` sonucu). `pnpm quality:sonar`'ın davranışı değişmez.

- [ ] **Adım 1: Docker tarayıcı testini sabit imaja göre güncelle**

`tests/sonar-report.test.mjs`'in importlarına ekle:

```js
import { SCANNER_IMAGE } from "../scripts/sonar-local.mjs";
```

"default Docker scanner preserves its container network and keeps token out of arguments" testinin sonuna (kapanış `});`'den önce) ekle:

```js
  const image = invocation.args.indexOf(SCANNER_IMAGE);
  assert.ok(image > 0, "sabit tarayıcı imajı kullanılır");
  assert.deepEqual(invocation.args.slice(image - 2, image), [
    "--platform",
    "linux/amd64",
  ]);
```

- [ ] **Adım 2: Testi çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-report.test.mjs`
Beklenen: FAIL. `sabit tarayıcı imajı kullanılır`.

- [ ] **Adım 3: `scannerInvocation`'da sabit imaj ve platform**

`scripts/sonar-report.mjs`'in başına:

```js
import { SCANNER_IMAGE } from "./sonar-local.mjs";
```

Docker dalındaki argümanlarda `"sonarsource/sonar-scanner-cli",` satırının yerine:

```js
      // İmajın arm64 sürümü yok; Apple Silicon'da öykünmeyle çalışır.
      "--platform",
      "linux/amd64",
      SCANNER_IMAGE,
```

Çalıştır: `node --test tests/sonar-report.test.mjs`
Beklenen: PASS 9/9.

- [ ] **Adım 4: `scripts/sonar.mjs`'te ortak yollar**

Başlık yorumunun ilk cümlesinden sonra ekle: `// --gate: tarar, açık sorunları listeler ve sorun varsa 1 ile çıkar (commit kancası).`

Importlara ekle:

```js
import { collectPages, evaluateGate } from "./sonar-gate.mjs";
import {
  SONARQUBE_IMAGE,
  acquireLock,
  containerNeedsRebuild,
  findNativeScanner,
  gitCommonDir,
} from "./sonar-local.mjs";
```

`const root = …` satırından hemen sonra:

```js
// Worktree'ler parolayı, yerel tarayıcıyı ve önbelleği ana checkout'tan
// paylaşır. Kilit bütün kopyaların ortak git klasöründedir.
const COMMON_DIR = gitCommonDir(root);
const MAIN_ROOT = COMMON_DIR ? path.dirname(COMMON_DIR) : root;
const LOCK_DIR = path.join(
  COMMON_DIR ?? path.join(root, ".scannerwork"),
  "sonar-gate.lock",
);
const gate = process.argv.includes("--gate");
```

`SCANNER_PATH` ve `SCANNER_HOME` tanımlarının yerine:

```js
const SCANNER_PATH = process.env.SONAR_SCANNER_PATH
  ? path.resolve(root, process.env.SONAR_SCANNER_PATH)
  : findNativeScanner(MAIN_ROOT);
const SCANNER_HOME = process.env.SONAR_USER_HOME
  ? path.resolve(root, process.env.SONAR_USER_HOME)
  : path.join(MAIN_ROOT, "reports", "quality", "cache");
```

`secretFile` tanımının yerine:

```js
const secretFile = process.env.SONAR_ADMIN_FILE
  ? path.resolve(root, process.env.SONAR_ADMIN_FILE)
  : path.join(MAIN_ROOT, "reports", ".sonar-admin");
```

- [ ] **Adım 5: `ensureServer()`'da kapsayıcı denetimi ve sabit sunucu imajı**

`ensureServer()`'da ağ bloğundan sonra, `const state = …`'ten önce:

```js
  // Sabit sürümden farklı ya da bütün ağ arayüzlerine açık bir kapsayıcı
  // yeniden kurulur. Veri birimleri silinmez: analizler ve parola korunur.
  const current = spawnSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{.Config.Image}}|{{json .HostConfig.PortBindings}}",
      CONTAINER,
    ],
    { encoding: "utf8" },
  );
  if (current.status === 0) {
    const [image, bindings] = current.stdout.trim().split("|");
    if (
      containerNeedsRebuild(
        { image, portBindings: JSON.parse(bindings) },
        SONARQUBE_IMAGE,
      )
    ) {
      console.log(
        `SonarQube kapsayıcısı ${SONARQUBE_IMAGE} ile, yalnızca 127.0.0.1'de yeniden kuruluyor (veri korunur)...`,
      );
      docker(["rm", "-f", CONTAINER]);
    }
  }
```

`docker run` argümanlarındaki `"sonarqube:community",` yerine `SONARQUBE_IMAGE,` yazılır.

- [ ] **Adım 6: Kapı modu**

`summary()` işlevinden sonra:

```js
async function enforceGate(auth, taskId) {
  const request = (method, pathname) => api(method, pathname, auth);
  // Yalnızca bu taramanın işlenmiş sonucu okunur (ceTaskId).
  await waitForAnalysis(request, taskId);
  const json = async (pathname) => {
    const res = await request("GET", pathname);
    if (!res.ok)
      throw new Error(`SonarQube API ${res.status}: ${pathname.split("?")[0]}`);
    return res.json();
  };
  const issues = await collectPages(async (p) => {
    const r = await json(
      `/api/issues/search?components=${PROJECT}&resolved=false&ps=500&p=${p}`,
    );
    return { items: r.issues, total: r.paging?.total ?? r.total };
  });
  const hotspots = await collectPages(async (p) => {
    const r = await json(
      `/api/hotspots/search?projectKey=${PROJECT}&status=TO_REVIEW&ps=500&p=${p}`,
    );
    return { items: r.hotspots, total: r.paging?.total };
  });
  const measures = await json(
    `/api/measures/component?component=${PROJECT}&metricKeys=duplicated_lines_density`,
  );
  const duplication = Number(
    measures.component?.measures?.find(
      (m) => m.metric === "duplicated_lines_density",
    )?.value,
  );
  const result = evaluateGate({ issues, hotspots, duplication });
  const output = path.join(root, "reports", "sonar-gate.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  for (const line of result.text) console.log(line);
  console.log(
    `\nAyrıntılar: ${HOST}/dashboard?id=${PROJECT} · liste: reports/sonar-gate.json`,
  );
  return result.failed;
}
```

Dosyanın sonundaki akışta `ensureDocker();` satırından önce:

```js
if (gate) {
  console.log(`Sonar kapısı: ${root} (Node ${process.version})`);
  const release = await acquireLock(LOCK_DIR, {
    onWait: (owner) =>
      console.log(`Başka bir tarama sürüyor (pid ${owner}); sıra bekleniyor...`),
  });
  // process.exit dahil her çıkışta kilit bırakılır; Ctrl-C de çıkış sayılır.
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => process.exit(130));
}
```

Son satır `await summary(auth, scannerTaskId(taskFile));` yerine:

```js
const taskId = scannerTaskId(taskFile);
if (gate) {
  // Kapı kapalıyken güvenli: okuma hatası da kapıyı düşürür.
  const failed = await enforceGate(auth, taskId).catch((error) => {
    console.error(`Sonar kapısı: ${error.message}`);
    return true;
  });
  process.exit(failed ? 1 : 0);
}
await summary(auth, taskId);
```

- [ ] **Adım 7: `sonar-project.properties` ve `package.json`**

`sonar-project.properties`'e:

```properties
# Kapı bütün açık sorunlara bakar; "yeni kod" için git blame gerekmez.
# Ayrıca worktree'lerde .git bir dosyadır ve ana depoyu gösterir; Docker
# tarayıcısına bağlanmadığı için tarama "Unable to open Git repository" ile
# düşüyordu. Sonar kaynaklarında git'in yok saydığı dosya yok (2026-10-02).
sonar.scm.disabled=true
```

`package.json` `scripts`'e:

```json
"quality:gate": "node scripts/sonar.mjs --gate",
```

- [ ] **Adım 8: Testleri ve tip denetimini çalıştır**

Çalıştır: `pnpm test:quality && pnpm typecheck && pnpm lint`
Beklenen: PASS; `test:quality` toplamı 66. Gerçek sunucuda deneme Görev 5'te, kullanıcı onayından sonra.

- [ ] **Adım 9: Commit**

```bash
git add scripts/sonar.mjs scripts/sonar-report.mjs tests/sonar-report.test.mjs sonar-project.properties package.json
git commit -m "Sonar kapısı: quality:gate, ortak yollar, kilit, sabit sunucu imajı"
```

### Görev 5: Sunucu düzeni ve kapının ilk sonucu

**Files:** yok (bir kerelik makine düzeni ve rapor)

**Interfaces:**
- Consumes: Görev 4 (`pnpm quality:gate`)
- Produces: tek sunucu `derslik-sonarqube` (`sonarqube:26.9.0.129388-community`, `127.0.0.1:9000`); parola `<ana checkout>/reports/.sonar-admin`; temizlik görevlerinin kullandığı `reports/sonar-gate.json` ve kurala göre sayım.

- [ ] **Adım 1: Kullanıcıdan onay al**

Kullanıcıya şunları göster ve açık onay iste:
- Parola dosyası `.claude/worktrees/lesson-booking/reports/.sonar-admin` → ana checkout'ta `reports/.sonar-admin` (izin 600).
- `docker stop derslik-quality-sonar` (Codex denetiminin sunucusu; silinmez).
- İlk `pnpm quality:gate`, `derslik-sonarqube` kapsayıcısını `docker rm -f` ile silip sabit imajla ve yalnızca `127.0.0.1:9000`'de yeniden kurar. Veri birimleri kalır.

Onay gelmeden sonraki adımlara geçilmez.

- [ ] **Adım 2: Parolayı taşı, Codex sunucusunu durdur**

```bash
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
test ! -e "$MAIN/reports/.sonar-admin" && mv reports/.sonar-admin "$MAIN/reports/.sonar-admin" && chmod 600 "$MAIN/reports/.sonar-admin"
docker stop derslik-quality-sonar
```

Beklenen: `ls -l "$MAIN/reports/.sonar-admin"` `-rw-------` gösterir; `docker ps` listesinde `derslik-quality-sonar` yok.

- [ ] **Adım 3: Kapıyı ilk kez çalıştır**

Çalıştır: `pnpm quality:gate > reports/gate-baseline.txt 2>&1; echo "exit=$?"`
Beklenen: `exit=1`. Çıktının başında `Sonar kapısı: …/lesson-booking (Node v24.21.0)` ve kapsayıcının yeniden kurulduğunu söyleyen satır; sonunda `Sonar kapısı: GEÇMEDİ`. `reports/sonar-gate.json` yazılmış olur.

Çalıştır: `docker inspect -f '{{.Config.Image}} {{json .HostConfig.PortBindings}}' derslik-sonarqube`
Beklenen: `sonarqube:26.9.0.129388-community {"9000/tcp":[{"HostIp":"127.0.0.1","HostPort":"9000"}]}`.

- [ ] **Adım 4: Sayımı Codex denetimiyle karşılaştır**

```bash
node -e 'const r=require("./reports/sonar-gate.json");const c={};for(const i of r.issues)c[i.rule]=(c[i.rule]||0)+1;console.log(r.issues.length,r.hotspots.length,r.duplication,JSON.stringify(Object.entries(c).sort((a,b)=>b[1]-a[1])))'
```

Beklenen: yaklaşık 471 sorun (Codex denetimi; aşağıdaki temizlik görevlerinin sayıları buradan), 0 güvenlik noktası, `duplication` 0.5. Görev 1–4'te eklenen betikler birkaç yeni sorun getirmiş olabilir (ör. `javascript:S4036`); bunlar ilgili temizlik görevinin kuralları arasındadır. Sayılar ve fark kullanıcıya bildirilir.

- [ ] **Adım 5: Kapalıyken güvenli olduğunu dene**

Çalıştır: `SONAR_ADMIN_PASSWORD=yanlis pnpm quality:gate; echo "exit=$?"; test -e "$(git rev-parse --git-common-dir)/sonar-gate.lock" && echo "kilit kaldı" || echo "kilit bırakıldı"`
Beklenen: yönetici girişi hatası, `exit=1`, `kilit bırakıldı`.

### Görev 6: Commit kancası

**Files:**
- Create: `.githooks/pre-commit` (çalıştırılabilir)
- Modify: `package.json` (`prepare`, `test:quality`)
- Test: `tests/sonar-hook.test.mjs`

**Interfaces:**
- Consumes: `node scripts/sonar.mjs --gate` (Görev 4); çıkış kodu 0 = geçti.
- Produces: `.githooks/pre-commit`; `prepare` betiği. Kanca bu görevde açılmaz (Görev 8).

- [ ] **Adım 1: Testleri yaz**

`tests/sonar-hook.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Commit kancası: uygun Node'u bulur, Sonar kapısını çalıştırır, kapı
// geçmezse commit'i durdurur. Gerçek Sonar yerine sahte bir "node" çağrıyı
// kaydeder; "-e" ile sorulan sürüm denetimine verilen yanıtla eski ya da
// uygun Node gibi davranır.
const root = path.resolve(import.meta.dirname, "..");
const hook = path.join(root, ".githooks", "pre-commit");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const realGit = execFileSync("sh", ["-c", "command -v git"], {
  encoding: "utf8",
}).trim();

function fakeNode(dir, { supported }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "node");
  fs.writeFileSync(
    file,
    [
      "#!/bin/sh",
      `if [ "$1" = "-e" ]; then exit ${supported ? 0 : 1}; fi`,
      'printf "%s\\n" "$0" "$@" > "$CALLS"',
      'exit "${GATE_EXIT:-0}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return file;
}

// Yalnızca sahte node'lar ve git: makinenin gerçek node'u PATH'e girmez.
function sandbox(t) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "derslik-hook-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, "tools");
  fs.mkdirSync(tools);
  fs.symlinkSync(realGit, path.join(tools, "git"));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  const box = { dir, tools, repo, calls: path.join(dir, "calls") };
  execFileSync(realGit, ["init", "-q"], { cwd: repo, env: env(box, {}) });
  return box;
}
function env(box, { pathDirs = [], nvmDir, gateExit = 0 }) {
  return {
    PATH: [...pathDirs, box.tools].join(":"),
    HOME: box.dir,
    GIT_CONFIG_NOSYSTEM: "1",
    NVM_DIR: nvmDir ?? path.join(box.dir, "nvm-yok"),
    CALLS: box.calls,
    GATE_EXIT: String(gateExit),
  };
}
const runHook = (box, options) =>
  spawnSync("sh", [hook], { cwd: box.repo, encoding: "utf8", env: env(box, options) });
const calls = (box) => fs.readFileSync(box.calls, "utf8").trim().split("\n");

test("kanca dosyası çalıştırılabilir", () => {
  assert.ok(fs.statSync(hook).mode & 0o111);
});

test("PATH'teki uygun Node kapıyı çalıştırır; kapı geçerse kanca geçer", (t) => {
  const box = sandbox(t);
  const bin = path.join(box.dir, "bin");
  fakeNode(bin, { supported: true });
  const r = runHook(box, { pathDirs: [bin] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(box).slice(1), [
    path.join(box.repo, "scripts", "sonar.mjs"),
    "--gate",
  ]);
});

test("kapı geçmezse kanca commit'i durdurur", (t) => {
  const box = sandbox(t);
  const bin = path.join(box.dir, "bin");
  fakeNode(bin, { supported: true });
  const r = runHook(box, { pathDirs: [bin], gateExit: 1 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /commit durduruldu/);
});

test("PATH'te eski Node varsa nvm'deki uygun en yeni sürüm kullanılır", (t) => {
  const box = sandbox(t);
  const bin = path.join(box.dir, "bin");
  fakeNode(bin, { supported: false });
  const nvm = path.join(box.dir, "nvm");
  for (const [version, supported] of [
    ["v22.12.0", false],
    ["v22.13.1", true],
    ["v24.21.0", true],
  ])
    fakeNode(path.join(nvm, "versions", "node", version, "bin"), { supported });
  const r = runHook(box, { pathDirs: [bin], nvmDir: nvm });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    calls(box)[0],
    path.join(nvm, "versions", "node", "v24.21.0", "bin", "node"),
  );
});

test("uygun Node yoksa commit durur ve nedeni yazılır", (t) => {
  const box = sandbox(t);
  const bin = path.join(box.dir, "bin");
  fakeNode(bin, { supported: false });
  const r = runHook(box, { pathDirs: [bin] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Node 22\.13/);
  assert.equal(fs.existsSync(box.calls), false);
});

test("git commit kancayı çalıştırır: kapı geçmezse commit atılmaz, geçerse atılır", (t) => {
  const box = sandbox(t);
  const bin = path.join(box.dir, "bin");
  fakeNode(bin, { supported: true });
  const commit = (gateExit) =>
    spawnSync(
      realGit,
      [
        "-c", `core.hooksPath=${path.dirname(hook)}`,
        "-c", "user.name=t",
        "-c", "user.email=t@t",
        "commit", "--allow-empty", "-m", "deneme",
      ],
      { cwd: box.repo, encoding: "utf8", env: env(box, { pathDirs: [bin], gateExit }) },
    );
  const head = () =>
    spawnSync(realGit, ["rev-parse", "--verify", "-q", "HEAD"], {
      cwd: box.repo,
      env: env(box, {}),
    }).status;
  assert.notEqual(commit(1).status, 0);
  assert.notEqual(head(), 0, "commit atılmamalı");
  assert.equal(commit(0).status, 0);
  assert.equal(head(), 0, "commit atılmalı");
});

test("prepare kancayı açar, git deposu dışında hata vermez", (t) => {
  const box = sandbox(t);
  const prepare = pkg.scripts.prepare;
  const inRepo = spawnSync("sh", ["-c", prepare], { cwd: box.repo, env: env(box, {}) });
  assert.equal(inRepo.status, 0);
  assert.equal(
    execFileSync(realGit, ["config", "--get", "core.hooksPath"], {
      cwd: box.repo,
      encoding: "utf8",
      env: env(box, {}),
    }).trim(),
    ".githooks",
  );
  const plain = path.join(box.dir, "plain");
  fs.mkdirSync(plain);
  assert.equal(
    spawnSync("sh", ["-c", prepare], { cwd: plain, env: env(box, {}) }).status,
    0,
  );
});
```

`package.json` `scripts`:

```json
"prepare": "git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath .githooks || true",
"test:quality": "node --experimental-strip-types --test tests/frontend-quality.test.mjs tests/sonar-report.test.mjs tests/site-build.test.mjs tests/sonar-gate.test.mjs tests/sonar-suppressions.test.mjs tests/sonar-local.test.mjs tests/sonar-hook.test.mjs",
```

Bu görevde `pnpm install` çalıştırılmaz: `prepare` kancayı açar ve bu görevin commit'ini kapıya takar.

- [ ] **Adım 2: Testleri çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-hook.test.mjs`
Beklenen: FAIL. Kanca dosyası yok (`ENOENT … .githooks/pre-commit`).

- [ ] **Adım 3: Kancayı yaz**

`.githooks/pre-commit`:

```sh
#!/bin/sh
# Her commit'ten önce Sonar kapısı (pnpm quality:gate): projede açık Sonar
# sorunu, inceleme bekleyen güvenlik noktası ya da sınırı aşan kod tekrarı
# varsa commit atılmaz. Atlatmak (git commit --no-verify) yalnızca
# kullanıcının açık onayıyla. Ayrıntı: AGENTS.md, docs/sonar.md.
root=$(git rev-parse --show-toplevel) || exit 1

# Node 22.13+ gerekir (package.json engines). Masaüstü uygulamalarının
# PATH'inde eski Node olabilir; o zaman nvm'de kurulu sürümler denenir.
supported() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1
}
node_bin=
if command -v node >/dev/null 2>&1 && supported node; then
  node_bin=node
else
  # Glob sırası artandır: uygun olan en yeni sürüm kalır.
  for candidate in "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node; do
    if [ -x "$candidate" ] && supported "$candidate"; then
      node_bin=$candidate
    fi
  done
fi
if [ -z "$node_bin" ]; then
  echo "Sonar kapısı: Node 22.13 ya da üstü bulunamadı (PATH ve nvm). Commit durduruldu." >&2
  exit 1
fi

if ! "$node_bin" "$root/scripts/sonar.mjs" --gate; then
  echo "Sonar kapısı geçmedi; commit durduruldu. Liste: reports/sonar-gate.json" >&2
  exit 1
fi
```

Çalıştır: `chmod +x .githooks/pre-commit`

- [ ] **Adım 4: Testleri çalıştır, geçtiğini gör**

Çalıştır: `node --test tests/sonar-hook.test.mjs && pnpm test:quality`
Beklenen: PASS. `sonar-hook` 7/7; `test:quality` toplamı 73.

Çalıştır: `git config --get core.hooksPath; echo "exit=$?"`
Beklenen: çıktı yok, `exit=1` (kanca henüz kapalı).

- [ ] **Adım 5: Commit**

```bash
git add .githooks/pre-commit tests/sonar-hook.test.mjs package.json
git commit -m "Commit kancası: her commit'ten önce Sonar kapısı"
```

Çalıştır: `git ls-files -s .githooks/pre-commit`
Beklenen: satır `100755` ile başlar.

### Görev 7: Çalışma kuralı ve belge

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Modify: `docs/sonar.md`

**Interfaces:**
- Consumes: `pnpm quality:gate`, `pnpm test:quality`, kanca, susturma biçimleri (Global Constraints)
- Produces: her oturumun okuduğu kural dosyası

- [ ] **Adım 1: `AGENTS.md`'yi yaz**

```markdown
# Derslik: çalışma kuralları

Bu dosya, bu depoda çalışan herkes ve her yapay zekâ oturumu içindir.

## Commit kancası

Her `git commit` öncesinde `.githooks/pre-commit` Sonar kapısını
(`pnpm quality:gate`) çalıştırır. Projede açık Sonar sorunu, inceleme
bekleyen güvenlik noktası ya da sınırı aşan kod tekrarı varsa commit atılmaz;
sorunlar dosya ve satırıyla listelenir. Bir commit yaklaşık 40–60 saniye
sürer ve Docker'ın açık olmasını ister. Kanca `pnpm install` ile açılır.

`git commit --no-verify` kancayı atlar. Yalnızca kullanıcının o commit için
verdiği açık onayla kullanılır; onay bir sonraki commit'e geçmez.

Kapı diskteki dosyaları tarar: commit'e eklenmemiş bir değişiklikteki sorun
da commit'i durdurur.

## Göndermeden önce

`main`'e birleştirmeden ya da göndermeden önce şunların hepsi geçer:

- `pnpm typecheck`
- `pnpm mobile:typecheck`
- `pnpm lint`
- `pnpm test`, değişikliğe ilgili testler ve `pnpm test:quality`
- `pnpm web:build`
- `pnpm quality:gate` (yerel SonarQube; Docker açık olmalı)

Biri kırmızıysa gönderilmez; önce düzeltilir.

## Sıfır Sonar sorunu

Projede açık Sonar sorunu ve inceleme bekleyen güvenlik noktası yoktur; kod
tekrarı sınırı geçmez. Yeni kod da sorun getirmez.

Gerçekten yanlış bir bulgu yalnızca gerekçeyle susturulur:

- kodda `// NOSONAR: <gerekçe>`
- ESLint'te `// eslint-disable-next-line sonarjs/<kural> -- <gerekçe>`
- `sonar-project.properties`'te yorumuyla `sonar.issue.ignore.multicriteria`

SonarQube arayüzündeki "False positive", "Safe" ya da "Accept" işaretleri
kullanılmaz; CI'daki sunucu her çalıştırmada sıfırdan açılır.
`pnpm test:quality` gerekçesiz susturmayı yakalar. Ayrıntı: `docs/sonar.md`.

## Pencereler (modal)

Pencere son boyutunda açılır; içerik gelince ya da değişince boyu değişmez,
kaymaz.

- İçerik tek seferde geliyorsa önce veri istenir, düğmede dönen gösterge
  çıkar, pencere veri gelince açılır.
- Pencerenin birkaç durumu varsa gövde sabit yüksekliktedir, iskelet son
  düzenin biçimindedir, uzun listeler gövdenin içinde kayar.
- Değişen her pencerede tarayıcıda yükseklik bütün durumlarda ölçülür.
```

`CLAUDE.md`:

```markdown
@AGENTS.md
```

- [ ] **Adım 2: `docs/sonar.md`'yi güncelle**

`## SonarQube` başlığından önce bu bölüm eklenir:

```markdown
## Commit kancası ve kapı

    pnpm quality:gate

Kapı çalışma kopyasını yerel SonarQube'de tarar. Açık sorun, inceleme
bekleyen güvenlik noktası ya da %3'ü aşan kod tekrarı varsa sorunları dosya ve
satırıyla listeler (`reports/sonar-gate.json`) ve 1 ile çıkar. Test kapsamı
kurala girmez. Her `git commit` öncesinde `.githooks/pre-commit` bu kapıyı
çalıştırır; kapı geçmezse commit atılmaz.

- Kanca `pnpm install` ile açılır (`prepare` → `git config core.hooksPath .githooks`).
- Kanca PATH'te Node 22.13+ bulamazsa nvm'de kurulu sürümleri dener.
- Kapı diskteki dosyaları tarar; commit'e eklenmemiş bir değişiklikteki sorun da commit'i durdurur.
- Worktree'ler parolayı (`reports/.sonar-admin`), yerel tarayıcıyı ve önbelleği ana checkout'tan alır. Aynı anda tek kapı çalışır (`.git/sonar-gate.lock`); öteki sırasını bekler.
- `git commit --no-verify` kancayı atlar; yalnızca kullanıcının açık onayıyla kullanılır (`AGENTS.md`).

SonarQube imajı (`sonarqube:26.9.0.129388-community`) ve Docker tarayıcı
imajı `scripts/sonar-local.mjs`'te tam sürüme sabittir. Var olan kapsayıcı
farklı bir imajla ya da bütün ağ arayüzlerine açık çalışıyorsa veri birimleri
korunarak yeniden kurulur.

Susturma kuralı ve göndermeden önceki kontrol listesi: kökteki `AGENTS.md`.
```

Aynı dosyada iki düzeltme:
- "`sonarqube:community` kapsayıcısı (`derslik-sonarqube`) kurulur, yönetici parolası rastgele üretilip `reports/.sonar-admin` dosyasına yazılır" cümlesinde `sonarqube:community` → `sabit sürümlü SonarQube`; `reports/.sonar-admin` → `ana checkout'taki reports/.sonar-admin`.
- "Yeni kapsayıcı yalnızca `127.0.0.1:9000` üzerinde dinler. Önceden oluşturulmuş kapsayıcının port eşlemesi değişmez." yerine: "Kapsayıcı yalnızca `127.0.0.1:9000` üzerinde dinler; bütün arayüzlere açık eski bir kapsayıcı yeniden kurulur."

- [ ] **Adım 3: Commit**

```bash
git add AGENTS.md CLAUDE.md docs/sonar.md
git commit -m "Çalışma kuralı: commit kancası, sıfır Sonar sorunu, pencere kuralı"
```

### Görev 8: Kancayı aç ve doğrula

**Files:** yok (git ayarı ve doğrulama)

**Interfaces:**
- Consumes: Görev 4–7
- Produces: `core.hooksPath=.githooks` (repo geneli). `.githooks/pre-commit` içeren her kopyada commit'ler kapıdan geçer. `main`'de kanca, bu dal birleştirilince çalışır.

- [ ] **Adım 1: Kancayı aç**

Çalıştır: `git config core.hooksPath .githooks && git config --get core.hooksPath`
Beklenen: `.githooks`.

- [ ] **Adım 2: Kapı geçmezken commit engellenir**

Çalıştır: `git commit --allow-empty -m "kanca denemesi"; echo "exit=$?"; git log -1 --format=%s`
Beklenen: `Sonar kapısı: …/lesson-booking (Node v24.21.0)`, sorun listesi, `Sonar kapısı geçmedi; commit durduruldu`, `exit=1`. Son commit hâlâ Görev 7'ninki.

- [ ] **Adım 3: Masaüstü PATH'iyle (Node 20) commit**

Çalıştır: `env PATH=/usr/local/bin:/usr/bin:/bin git commit --allow-empty -m "kanca denemesi"; echo "exit=$?"`
Beklenen: ilk satırda `Node v24.21.0` (nvm'den bulundu; PATH'teki `/usr/local/bin/node` v20.14), `exit=1`.

- [ ] **Adım 4: Docker yokken kapı durur ve kilidi bırakır**

Çalıştır: `env PATH="$(dirname "$(command -v node)")":/usr/bin:/bin node scripts/sonar.mjs --gate; echo "exit=$?"; test -e "$(git rev-parse --git-common-dir)/sonar-gate.lock" && echo "kilit kaldı" || echo "kilit bırakıldı"`
Beklenen: `Docker çalışmıyor…`, `exit=1`, `kilit bırakıldı`.

- [ ] **Adım 5: Birleştirme noktası**

Kullanıcıya sor: "Kanca altyapısı hazır. Şimdi `main`'e birleştirirsem `main`'deki commit'ler de temizlik bitene kadar engellenir. Birleştireyim mi?" Kullanıcı isterse (ör. "sen birleştir"): ana checkout temiz mi bakılır, `git merge --ff-only sonar-quality-gate`, `git push`; komutlar kullanıcının terminalinde, birer birer. İstemezse temizlik bu dalda sürer ve birleştirme en sonda yapılır.

### Temizlik görevleri için ortak adımlar

Kaynak: Codex denetiminin taraması (2026-10-02, SonarQube 26.9, `daebad5`): **471 açık sorun** (449 kod kokusu, 19 güvenlik açığı, 3 hata), **0** güvenlik noktası, kod tekrarı **%0,5**. Dağılım: `apps/web` 240, `apps/mobile` 170, `apps/api` 19, `packages/contracts` 12, `packages/api-client` 3, `scripts` 25, `build` 2. Test klasörlerinde sorun yok. Görev 5'teki ilk kapı sonucu bu sayılardan farklıysa farklar görevlerin başında yeniden çıkarılır.

Her temizlik görevi aynı döngüyle çalışır:

1. Kuralın örneklerini listele:

   ```bash
   node -e 'const r=require("./reports/sonar-gate.json");for(const i of r.issues.filter(i=>process.argv.slice(1).includes(i.rule)))console.log(`${i.file}:${i.line}  ${i.message}`)' <kural> [<kural>…]
   ```

2. Düzelt. Davranış değişmez.
3. Doğrula: `pnpm typecheck && pnpm mobile:typecheck && pnpm lint && pnpm test && pnpm test:quality`. API'ye dokunulduysa `pnpm api:test` (yerel Postgres) de çalışır.
4. `pnpm quality:gate` çalıştır. Beklenen: görevin kurallarından hiç sorun kalmaz. Toplam yalnızca azalır, yeni kural çıkmaz.
5. **Commit (kanca açık):** Kapı temizlik bitene kadar geçemez. Bölümün commit'i için kullanıcıya şunu sor: "<bölüm> düzeltmeleri hazır (<N> sorun gitti, kalan <M>). Bu commit'i `--no-verify` ile atayım mı?" Açık onay gelince: `git add <yalnızca düzeltilen dosyalar>` ve `git commit --no-verify -m "<mesaj>"`. Onay bir sonraki commit'e geçmez. Görev büyükse alan alan (API, web, mobil, ortak paketler, betikler, `build`) ayrı commit ve ayrı onay.

Davranışı değiştirmesi kaçınılmaz bir düzeltme çıkarsa testle korunur ve kullanıcıya bildirilir.

### Görev 9: Güvenlik açıkları, hatalar ve sabit IP (23)

**Files:**
- Modify: `sonar-project.properties` (gerekçeli `sonar.issue.ignore.multicriteria`)
- Modify: `packages/api-client/src/socket.ts`, `scripts/mobile-security-tests.mjs`, `build/sites-vite-plugin.ts` (gerekçeli `NOSONAR`)
- Modify: `apps/web/lib/chat-drafts.ts` ve kullanıldığı yerler

**Interfaces:**
- Produces: `chat-drafts.ts` → `getChatDraft(key: string): string | undefined`, `setChatDraft(key: string, text: string): void`, `clearChatDrafts(): void`. `chatDrafts` Map'i artık dışa açık değil.

Bulgular ve karar:

| Kural | Yer | Karar |
|---|---|---|
| `typescript:S2068` ×8 | `packages/contracts/src/i18n/{es,ja,zh}.ts` | Yanlış alarm: "parola" sözcüğünün çevirisi, gerçek parola değil. Multicriteria ile i18n klasöründe susturulur. |
| `javascript:S4036` ×7 | `scripts/{sonar,security-zap-fixture,install-ci,pnpm-install,run-framework}.mjs` (Görev 3–4'ten sonra `scripts/sonar-local.mjs` de) | Geliştirici betikleri `docker`, `git`, `pnpm` ve `node`'u geliştiricinin PATH'iyle çağırır. Sabit yol taşınabilirliği bozar. Multicriteria ile `scripts/**`'ta susturulur. Test dosyalarında çıkarsa (`tests/sonar-*.test.mjs` `git` ve `sh` çağırır) aynı gerekçeyle `tests/**` için ikinci bir ölçüt eklenir. |
| `javascript:S5332` ×2 | `scripts/security-zap-fixture.mjs:34-35` | Yerel güvenlik taraması fikstürü `http://localhost`'ta çalışır. Multicriteria ile bu dosyada susturulur. |
| `css:S8776` ×2 | `apps/web/app/globals.css:9,13` | Tailwind v4 `@custom-variant` sözdizimindeki `&`. Codex denetimi gerçek Tailwind derlemesinde doğru köke yerleştiğini gösterdi (`tests/frontend-quality.test.mjs`). Multicriteria ile bu dosyada susturulur. |
| `typescript:S2245` ×1 | `packages/api-client/src/socket.ts` (`Math.random`, yeniden deneme gecikmesi) | Yeniden bağlanma gecikmesinin titreşimi; güvenlikle ilgisi yok. Satırda `// NOSONAR: yeniden bağlanma titreşimi, güvenlikle ilgisi yok`. |
| `javascript:S1523` ×1 | `scripts/mobile-security-tests.mjs:47` | Güvenlik testleri depodaki mobil kodu yalıtılmış bir `vm` bağlamında çalıştırır; dış girdi yok. Satırda `// NOSONAR: depodaki kodu yalıtılmış vm bağlamında test eder`. |
| `typescript:S1313` ×1 | `build/sites-vite-plugin.ts:13` (`::ffff:127.0.0.1`) | Yerel geliştirme sunucusunun loopback izin listesi. Satırda `// NOSONAR: yerel geliştirme sunucusunun loopback izin listesi`. |
| `typescript:S4158` ×1 | `apps/web/lib/chat-drafts.ts:9` | Map başka modüllerden doldurulduğu için Sonar boş sanıyor. Map modülde gizlenir, erişim `getChatDraft` ve `setChatDraft` ile olur. Susturma gerekmez. |

- [ ] **Adım 1: `sonar-project.properties`'e gerekçeli hariçleri ekle**

```properties
# Gerekçeli susturmalar. Sunucudaki "False positive" işareti CI'da kalıcı
# olmadığı için yanlış alarmlar burada, gerekçesiyle tutulur (AGENTS.md).
sonar.issue.ignore.multicriteria=i18nPassword,scriptsPath,zapHttp,tailwindVariant
# Çeviri dosyalarında "parola" sözcüğünün çevirisi parola sanılıyor.
sonar.issue.ignore.multicriteria.i18nPassword.ruleKey=typescript:S2068
sonar.issue.ignore.multicriteria.i18nPassword.resourceKey=packages/contracts/src/i18n/**
# Geliştirici betikleri docker/git/pnpm/node'u geliştiricinin PATH'iyle çağırır.
sonar.issue.ignore.multicriteria.scriptsPath.ruleKey=javascript:S4036
sonar.issue.ignore.multicriteria.scriptsPath.resourceKey=scripts/**
# Yerel güvenlik taraması fikstürü http://localhost'ta çalışır.
sonar.issue.ignore.multicriteria.zapHttp.ruleKey=javascript:S5332
sonar.issue.ignore.multicriteria.zapHttp.resourceKey=scripts/security-zap-fixture.mjs
# Tailwind v4 @custom-variant sözdizimi (& kök kural dışında) CSS ayrıştırıcısınca tanınmıyor.
sonar.issue.ignore.multicriteria.tailwindVariant.ruleKey=css:S8776
sonar.issue.ignore.multicriteria.tailwindVariant.resourceKey=apps/web/app/globals.css
```

- [ ] **Adım 2: Üç gerekçeli `NOSONAR` ve `chat-drafts` düzenlemesi**

`chat-drafts.ts`'te Map dışa açılmaz:

```ts
const chatDrafts = new Map<string, string>();

/** Yazışmanın yarım kalan metni (yazışmanın API yoluna göre). */
export const getChatDraft = (key: string) => chatDrafts.get(key);

/** Yarım kalan metni saklar; boş metin kaydı siler. */
export function setChatDraft(key: string, text: string) {
  if (text) chatDrafts.set(key, text);
  else chatDrafts.delete(key);
}
```

`clearChatDrafts` aynen kalır. Kullanım yerleri (`grep -rn "chatDrafts" apps/web tests`) bu işlevlere geçer. Boş metni silme davranışı bugünkü kullanım yerlerinde nasılsa öyle korunur: kullanım `set` ile boş dize yazıyorsa `setChatDraft` de boş dizeyi saklamalıdır; kodu okuyup buna göre karar ver. `tests/frontend-quality.test.mjs`'teki "exported chat draft map holds consumer drafts and clears them on logout" testi `chatDrafts` Map'ini doğrudan kullanıyor; test aynı davranışı `getChatDraft`/`setChatDraft`/`clearChatDrafts` ile sınayacak biçimde güncellenir.

- [ ] **Adım 3: Doğrula ve commit**

Ortak adımlar 3–5. Beklenen: güvenlik açığı ve hata 0; toplam yaklaşık 448.

```bash
git add sonar-project.properties packages/api-client/src/socket.ts scripts/mobile-security-tests.mjs build/sites-vite-plugin.ts apps/web/lib/chat-drafts.ts tests/frontend-quality.test.mjs <kullanım yerleri>
git commit --no-verify -m "Sonar: güvenlik açıkları ve hatalar (gerekçeli susturmalar, chatDrafts erişimi)"
```

### Görev 10: Salt okunur prop'lar (S6759, 166)

**Files:** `apps/mobile/src/**` ve `apps/web/**` bileşenleri (liste ortak adım 1'den)

Kalıp, yalnızca tip:

```tsx
// Önce
function Card({ title, children }: { title: string; children: React.ReactNode }) {
// Sonra
function Card({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {

// Adlı tiplerde
function BookingSheet(props: Props & { visible: boolean })
// →
function BookingSheet(props: Readonly<Props & { visible: boolean }>)
```

- [ ] **Adım 1:** `typescript:S6759` örneklerini listele.
- [ ] **Adım 2:** Her bileşenin prop tipini `Readonly<…>` ile sar.
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S6759 sıfır; toplam yaklaşık 282.
- [ ] **Adım 4:** Ortak adım 5 ile commit: mobil ve web ayrı commit, ayrı onay. Örnek: `git commit --no-verify -m "Sonar: bileşen prop'ları salt okunur, web (S6759)"`.

### Görev 11: İç içe üçlü ifadeler (S3358, 123)

**Files:** liste ortak adım 1'den (`typescript:S3358` ×122, `javascript:S3358` ×1)

Kalıplar. Davranış birebir korunur.

TypeScript ifadesi:

```ts
// Önce
const tone = state === "late" ? "danger" : state === "soon" ? "warn" : "ok";
// Sonra
function toneOf(state: State) {
  if (state === "late") return "danger";
  if (state === "soon") return "warn";
  return "ok";
}
const tone = toneOf(state);
```

JSX'te koşullu gövde:

```tsx
// Önce
{!slots ? <Loader /> : slots.length < 1 ? <Empty /> : <List slots={slots} />}
// Sonra: aynı dosyada küçük bir bileşen ya da yardımcı
function SlotsBody({ slots }: Readonly<{ slots: Slot[] | null }>) {
  if (!slots) return <Loader />;
  if (slots.length < 1) return <Empty />;
  return <List slots={slots} />;
}
```

İç içe ifade bir öznitelikteyse (ör. `style={{ color: a ? x : b ? y : z }}`), değer adı anlaşılır bir yardımcıya taşınır. Yardımcı bileşenler ve işlevler çağrıldıkları dosyada, çağrının hemen altında durur.

- [ ] **Adım 1:** Örnekleri listele; dosyaya göre grupla.
- [ ] **Adım 2:** Dosya dosya düzelt. Her düzeltmeden sonra o dosyanın tipini denetle.
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S3358 sıfır; toplam yaklaşık 159.
- [ ] **Adım 4:** Ortak adım 5 ile alan alan commit: API, web, mobil, betikler. Örnek: `git commit --no-verify -m "Sonar: iç içe üçlü ifadeler, web (S3358)"`.

### Görev 12: Karmaşıklık ve derin iç içelik (S3776 ×36, S2004 ×6)

**Files:** liste ortak adım 1'den (`typescript:S3776`, `javascript:S3776`, `typescript:S2004`)

- **Bilişsel karmaşıklık (sınır 15):** İşlevin içindeki bağımsız adımlar adlı yardımcılara çıkarılır: doğrulama, eşleme, hata çevirisi gibi. Erken dönüşle `else` derinliği azaltılır. Davranış birebir korunur.
- **API servisleri:** Mevcut entegrasyon testleri kapsıyor. Her servis düzeltmesinden sonra `pnpm test` ve `pnpm api:test` çalışır. Testlerin kapsamadığı bir dal değişiyorsa önce o dalı sınayan test eklenir; karakterizasyon testi olarak önce geçtiği görülür.
- **Arayüz bileşenleri:** Uzun bileşenden alt bileşen çıkarılır (prop'ları `Readonly`). Durum (state) üst bileşende kalır.
- **Derin iç içe işlev (S2004, 5 seviyeden derin):** İç içe geri çağırmalar adlı işlevlere çıkarılır, örneğin `apps/mobile/src/teacher/availability.tsx`.
- **`build/sites-vite-plugin.ts` ara katmanı (32):** İstek dalları (ön yükleme, giriş/çıkış, yönlendirme) adlı işlevlere bölünür. `node --experimental-strip-types --test tests/site-build.test.mjs` ve `pnpm build` önce ve sonra geçer.
- **`scripts/legacy-preflight.mjs` (50):** Adımlar ayrı işlevlere bölünür. Çıktısı `node scripts/legacy-preflight.mjs` ile önce ve sonra karşılaştırılır.

- [ ] **Adım 1:** Örnekleri listele (mesajdaki "from N" değeriyle).
- [ ] **Adım 2:** İşlev işlev düzelt, her biri sonrası ilgili test.
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S3776 ve S2004 sıfır; toplam yaklaşık 117.
- [ ] **Adım 4:** Ortak adım 5 ile alan alan commit.

### Görev 13: Küçük kurallar (80)

**Files:** liste ortak adım 1'den

| Kural | Adet | Düzeltme |
|---|---|---|
| `typescript:S7758` | 11 | `charCodeAt(i)` → `codePointAt(i)`. BMP dışı karakterlerde (emoji) değer değişir; yalnızca karakter karşılaştırma ya da renk ve karma hesabında kullanılıyorsa kabul edilir. Davranış önemliyse kalıp korunur, gerekçeli `NOSONAR` yazılır ve kullanıcıya bildirilir. |
| `typescript:S7755` | 7 | `a[a.length - 1]` → `a.at(-1)` |
| `typescript:S6819` | 7 | `role="status"` taşıyan öğe → `<output>`. `<output>` satır içidir; düzen bozulmasın diye öğedeki görünüm sınıfları korunur, gerekirse `block`/`flex` eklenir. Tarayıcıda bakılır. |
| `S7780` (ts ×4, js ×6) | 10 | Ters bölü kaçışlı dizeler `String.raw\`…\`` |
| `typescript:S7781` | 5 | `replace(/x/g, y)` → `replaceAll(…)` (düzenli ifade kalabilir: `replaceAll(/x/g, y)`) |
| `typescript:S6582` | 5 | `a && a.b` → `a?.b`. Yalnızca `a` null/undefined ya da nesne olabiliyorsa; `0`/`""` olabiliyorsa dokunulmaz, gerekçeli susturma |
| `typescript:S6754` | 5 | `useState` dönüşü `[değer, setDeğer]` olarak adlandırılır |
| `typescript:S6479` | 4 | Dizi sırası anahtar olarak kullanılmaz; içerikten kararlı anahtar |
| `typescript:S3735` | 3 | `void` işleci kaldırılır: söz (promise) ise `.catch` ile ya da `async` işlevle, değilse doğrudan çağrı |
| `S7722`/`S7723` (ts ×2, js ×6) | 8 | `Error()` → `new Error("…")`, mesajla |
| `typescript:S6571` | 2 | Birleşimde `string` ile gereksizleşen dize sabitleri sadeleştirilir |
| `typescript:S6551` | 2 | `reader.result` için tip denetimi (`typeof … === "string"`) |
| `typescript:S3863` | 2 | Aynı modülden iki import birleştirilir (`import { a, type B } from …`) |
| `typescript:S4043` | 1 | `.reverse()` → `.toReversed()` (API, Node 22) |
| `typescript:S6594` | 1 | `str.match(re)` → `re.exec(str)` |
| `typescript:S7765` | 1 | `.some(x => x === v)` → `.includes(v)` |
| `typescript:S7776` | 1 | `routes` dizisi → `Set`, `.has()` |
| `typescript:S6478` | 1 | `learning-panel.tsx`'teki iç bileşen dışarı taşınır, veri prop'la gelir |
| `typescript:S7763` | 1 | `loading.tsx`: `export { Skeleton } from "@/components/ui/skeleton"` |
| `typescript:S4084` | 1 | `video-player.tsx:106`: Öğretmenin yüklediği videoların altyazı dosyası yok. Gerekçeli `NOSONAR` ile susturulur ve kullanıcıya bildirilir (altyazı desteği ayrı iş). |
| `javascript:S2094` | 1 | `scripts/mobile-security-tests.mjs:281` boş sınıf kaldırılır ya da amacına göre doldurulur |
| `javascript:S1940` | 1 | `!(a > b)` → `a <= b` |

- [ ] **Adım 1:** Kural kural listele ve düzelt.
- [ ] **Adım 2:** `S6819` ve `S6479` değişikliklerinin göründüğü ekranları not et (Görev 17'de tarayıcıda bakılır).
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: toplam yaklaşık 37 (yalnızca CSS kaldı).
- [ ] **Adım 4:** Ortak adım 5 ile commit: `git commit --no-verify -m "Sonar: küçük kurallar (S7758, S7755, S6819 …)"`.

### Görev 14: CSS'te tekrarlanan seçiciler (css:S4666, 37)

**Files:** `apps/web/app/globals.css`

Aynı bağlamda (aynı `@media` ya da `@layer` içinde) iki kez yazılmış seçicinin bildirimleri tek kuralda birleştirilir. Kaskad sırası yüzünden birleşik kuralın **hangi konumda** duracağı her çift için ayrı seçilir:

- İki tekrar arasında aynı öğeyi hedefleyip aynı özelliği yazan bir kural yoksa, ikisi ilk konumda birleşir.
- Varsa birleşik kural ikinci konumda durur. İlk kuraldaki özelliklerden aradaki bir kuralın ezdikleri birleşikte yazılmaz.

Doğrulama, hesaplanan stillerin karşılaştırılmasıyla yapılır (görsel değişiklik sıfır olmalı):

- [ ] **Adım 1: Önce hesaplanan stillerin özetini al**

3100'de bu dalın web'i açılır (bellek: worktree-web-preview). Chrome'da şu sayfalarda, açık ve koyu temada çalıştır:
- öğretmen: genel bakış, takvim (gün ve hafta), öğrenciler, tahsilatlar, mesajlar, vitrin
- öğrenci: dersler
- herkese açık: `/teachers`, giriş

```js
// Her öğenin yolu ve hesaplanan stillerinin özeti
(() => {
  const props = ["display","position","margin","padding","border","border-radius","background-color","color","font-size","font-weight","line-height","gap","grid-template-columns","min-height","width","height","box-shadow","opacity","text-transform"];
  const out = {};
  document.querySelectorAll("body *").forEach((el, i) => {
    const s = getComputedStyle(el);
    out[`${i}:${el.tagName}.${[...el.classList].join(".")}`] = props.map((p) => s.getPropertyValue(p)).join("|");
  });
  return JSON.stringify(out);
})()
```

Sonuçlar `reports/css-before/<sayfa>-<tema>.json` dosyalarına kaydedilir. Öğrenci sayfası için kullanıcı Chrome'da öğrenci hesabına geçer.

- [ ] **Adım 2:** Tekrarları listele (`css:S4666`, mesajdaki "first used at line N" ile) ve kurala göre birleştir.
- [ ] **Adım 3:** Aynı sayfa ve temalarda özet yeniden alınır (`reports/css-after/`) ve karşılaştırılır. Beklenen: fark yok. Fark çıkarsa birleştirme konumu düzeltilir.
- [ ] **Adım 4:** Ortak adımlar 3–4. Beklenen: toplam 0, `Sonar kapısı: geçti`.
- [ ] **Adım 5: Commit (kapı artık geçer)**

```bash
git add apps/web/app/globals.css
git commit -m "Sonar: CSS'te tekrarlanan seçiciler birleştirildi (görsel fark yok)"
```

Beklenen: kanca çalışır, `Sonar kapısı: geçti`, commit `--no-verify` olmadan atılır. Geçmezse kalan sorunlar düzeltilir; `--no-verify` kullanılmaz.

### Görev 15: ESLint'te Sonar katmanı

**Files:**
- Modify: `package.json` (`eslint-plugin-sonarjs` 4.2.2, `test:quality`)
- Modify: `pnpm-lock.yaml`
- Modify: `eslint.config.mjs`
- Modify: `docs/sonar.md`
- Test: `tests/sonar-lint.test.mjs`

**Interfaces:**
- Consumes: temizlenmiş kod (Görev 9–14); `sonar-project.properties`'teki kapsam
- Produces: `pnpm lint` SonarJS kurallarını hata düzeyinde çalıştırır

- [ ] **Adım 1: Lint katmanı için testi yaz**

`tests/sonar-lint.test.mjs`:

```js
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
```

`package.json`:

```json
"test:quality": "node --experimental-strip-types --test tests/frontend-quality.test.mjs tests/sonar-report.test.mjs tests/site-build.test.mjs tests/sonar-gate.test.mjs tests/sonar-suppressions.test.mjs tests/sonar-local.test.mjs tests/sonar-hook.test.mjs tests/sonar-lint.test.mjs",
```

- [ ] **Adım 2: Testi çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-lint.test.mjs`
Beklenen: FAIL. Birinci testte `found` boş (`[]`), çünkü SonarJS henüz yapılandırmada yok.

- [ ] **Adım 3: Eklentiyi kur ve yapılandır**

Çalıştır: `pnpm add -D -w eslint-plugin-sonarjs@4.2.2` (kanca zaten açık; `prepare` yeniden çalışır, zararsız).

`eslint.config.mjs`:

```js
import sonarjs from "eslint-plugin-sonarjs";

// Sonar kuralları (SonarJS): Sonar taramasının kapsamıyla aynı dosyalarda ve
// hata düzeyinde. Lint, kapıdan (pnpm quality:gate) önce saniyeler içinde
// uyarır. Kapsam sonar-project.properties ile aynı tutulmalı.
const sonarRules = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).map(([rule, setting]) => {
    const [level, ...options] = Array.isArray(setting) ? setting : [setting];
    return [
      rule,
      level === "off" || level === 0 ? "off" : ["error", ...options],
    ];
  }),
);
```

ve `defineConfig([...])` dizisine, en sona:

```js
  {
    files: [
      "apps/api/src/**/*.{ts,js,mjs}",
      "apps/api/tests/**/*.{ts,js,mjs}",
      "apps/api/drizzle.config.ts",
      "apps/web/{app,components,hooks,lib}/**/*.{ts,tsx,js,mjs}",
      "apps/web/{proxy,next.config}.ts",
      "apps/web/postcss.config.mjs",
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/mobile/index.ts",
      "apps/mobile/metro.config.cjs",
      "packages/*/src/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs,cjs,ts}",
      "build/**/*.ts",
      "tests/**/*.{js,mjs,ts}",
      "{next,vite,drizzle}.config.ts",
      "{eslint,postcss}.config.mjs",
    ],
    // Shadcn'den olduğu gibi kopyalanan dosyalar Sonar'da da hariç.
    ignores: [
      "apps/web/components/ui/**",
      "apps/web/hooks/use-mobile.ts",
      "apps/web/vendor/**",
    ],
    plugins: { sonarjs },
    rules: sonarRules,
  },
```

`docs/sonar.md`'deki "Commit kancası ve kapı" bölümünün sonuna: "ESLint'te SonarJS kuralları da vardır (`pnpm lint`); sorunların çoğunu saniyeler içinde, kapıdan önce gösterir."

- [ ] **Adım 4: Lint testini ve lint'i çalıştır**

Çalıştır: `node --test tests/sonar-lint.test.mjs`
Beklenen: PASS 2/2.

Çalıştır: `pnpm lint 2>&1 | grep -c "sonarjs/"`
Beklenen: Temizlikten sonra kalan yalnızca ESLint'te çıkan ihlaller (çoğu 0 olmalı). Kalan her ihlal temizlik görevlerindeki kalıplarla düzeltilir. Yanlış alarm ise gerekçeli `eslint-disable-next-line sonarjs/<kural> -- <gerekçe>` ile susturulur. Bir kural Next ya da React Native ile sistematik çakışıyorsa `sonarRules` üzerine gerekçeli bir `"off"` eklenir ve kullanıcıya bildirilir. Sonunda `pnpm lint` çıkış 0 olur.

- [ ] **Adım 5: Testler ve commit**

Çalıştır: `pnpm test:quality && pnpm typecheck && pnpm mobile:typecheck && pnpm test`
Beklenen: hepsi PASS.

```bash
git add package.json pnpm-lock.yaml eslint.config.mjs tests/sonar-lint.test.mjs docs/sonar.md <düzeltilen dosyalar>
git commit -m "Sonar: ESLint'te SonarJS kuralları (hata düzeyinde)"
```

Beklenen: kanca geçer.

### Görev 16: CI işi

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/sonar.md`

**Interfaces:**
- Consumes: `pnpm quality:gate`
- Produces: CI'da `sonar` işi. `checks` işindeki "Quality reporting tests" adımı (`pnpm test:quality`) zaten var; yeni testleri o çalıştırır.

- [ ] **Adım 1: `sonar` işini ekle**

`jobs:` altında, `checks` ile aynı seviyede:

```yaml
  sonar:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      # SonarQube'un gömülü Elasticsearch'ü Linux'ta bunu ister.
      - name: Elasticsearch memory map limit
        run: sudo sysctl -w vm.max_map_count=262144
      - name: Sonar quality gate
        run: pnpm quality:gate
      - name: Upload Sonar findings
        if: failure()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: sonar-gate
          path: reports/sonar-gate.json
          if-no-files-found: ignore
```

`docs/sonar.md`'deki "Commit kancası ve kapı" bölümüne: "Aynı kapı CI'da \"Sonar\" işinde çalışır; CI'da yerel tarayıcı olmadığı için Docker tarayıcısı kullanılır."

- [ ] **Adım 2: Yerelde aynı adımları doğrula**

Çalıştır: `pnpm test:quality && pnpm quality:gate; echo "exit=$?"`
Beklenen: `exit=0`, son satır `Sonar kapısı: geçti`.

- [ ] **Adım 3: Commit**

```bash
git add .github/workflows/ci.yml docs/sonar.md
git commit -m "CI: Sonar kapısı işi"
```

### Görev 17: Son doğrulama

**Files:** yok (doğrulama)

- [ ] **Adım 1: Kapı ve kanca sorunu yakalar**

Geçici dosya oluştur: `apps/web/lib/__sonar_probe__.ts`, içine Görev 15'teki örnek. Çalıştır: `pnpm quality:gate; echo "exit=$?"`.
Beklenen: `exit=1`, listede `apps/web/lib/__sonar_probe__.ts` ve kural `typescript:S3923`.
Çalıştır: `git commit --allow-empty -m "kanca denemesi"; echo "exit=$?"`. Beklenen: `exit=1` (dosya stage edilmemiş olsa da kapı onu görür).
Dosyayı sil, `pnpm quality:gate` yeniden çalıştır. Beklenen: `exit=0`. Dosya commit'lenmez; iki çıktı kullanıcıya gösterilir.

- [ ] **Adım 2: Bütün CI adımları**

Çalıştır: `pnpm typecheck && pnpm mobile:typecheck && pnpm lint && pnpm mobile:security-test && pnpm test && node --test tests/media-config.test.mjs && pnpm test:booking && pnpm test:architecture && pnpm test:quality && pnpm web:build && pnpm web:test && pnpm quality:gate`
Beklenen: hepsi çıkış 0. `apps/web/next-env.d.ts` derleme farkı commit'lenmez, `git checkout` ile geri alınır.

- [ ] **Adım 3: Arayüz duman testi**

Temizlik çok sayıda ekran dosyasına dokunur: iç içe ifadeler, alt bileşenler, `<output>`, anahtarlar. 3100'de bu dalın web'i açılır (bellek: worktree-web-preview) ve Chrome'da şu ekranlar gezilir:

- **Öğretmen:** genel bakış, takvim, öğrenciler, öğrenci ayrıntısı, tahsilatlar, mesajlar, vitrin.
- **Öğrenci:** dersler, ders ayarla, mesajlar. Öğrenci için kullanıcı hesap değiştirir.
- **Her ekranda:** konsolda hata olmadığı doğrulanır.
- **Pencereler:** Ders ayarla, Müsaitlik ve Takvime bağla pencerelerinde yükseklik bütün durumlarda ölçülür (bellek: modal-no-layout-shift).
- **Görev 13:** Not edilen `<output>` ve anahtar değişikliklerinin ekranlarına ayrıca bakılır.

Mobilde `pnpm mobile:typecheck` ve `pnpm mobile:security-test` yeterlidir; simülatör denemesi kullanıcı isterse yapılır.

- [ ] **Adım 4: Birleştir, gönder ve CI'ı gör**

Kullanıcı birleştirmeyi isteyince `main`'e ileri sarılarak birleştirilir ve gönderilir (kullanıcının terminalinde, birer birer). Ardından `main` commit'inin GitHub kontrolleri (`/repos/bburak2014/derslik/commits/<sha>/check-runs`) bir kez okunur. `checks` ve `sonar` işlerinin `success` olduğu görülür.

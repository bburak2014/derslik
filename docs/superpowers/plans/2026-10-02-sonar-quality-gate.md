# Sonar Kalite Kapısı Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her geliştirmede kod Sonar kurallarıyla denetlenir; projede sıfır Sonar sorunu sağlanır ve sorunlu kod `main`'e gönderilmez.

**Architecture:** İki katman: ESLint'te SonarJS kuralları (saniyeler içinde, yazarken) ve yerel SonarQube kapısı (`pnpm quality:gate`, tam tarama, sorun varsa çıkış 1). Kapı yerelde birleştirmeden önce ve CI'da ayrı bir işte aynı betikle çalışır. Kapının karar ve rapor kısmı saf bir modüldedir ve birim testleriyle sınanır.

**Tech Stack:** Node 24 (betikler, `node:test`), SonarQube Community Build `26.9.0.129388` (Docker), sonar-scanner-cli `12.2.0.4256_8.1.0` (Docker), ESLint 9 düz yapılandırma ve `eslint-plugin-sonarjs`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-sonar-quality-gate-design.md`

## Global Constraints

- **İmajlar:** `sonarqube:26.9.0.129388-community` ve `sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0`. Yerelde ve CI'da aynı sabitler kullanılır (`scripts/sonar.mjs`).
- **Kapı kuralı:** Her türden ve her önemdeki açık sorun (hata, güvenlik açığı, kod kokusu) ya da `TO_REVIEW` durumundaki her güvenlik noktası kapıyı düşürür. Kod tekrarı oranı en fazla %3 (ilk taramada %0,5; sınır Sonar'ın varsayılanı olarak kalır).
- **Kapı kapalıyken güvenli çalışır.** API hatası, başarısız ya da işlenmemiş rapor, eksik sayfa: hiçbiri "0 sorun" sayılmaz, çıkış kodu 0 olmaz.
- **Susturma yalnızca gerekçeyle yapılır:** `// NOSONAR: <gerekçe>`, `// eslint-disable-next-line sonarjs/<kural> -- <gerekçe>` ya da `sonar-project.properties`'te yorumla açıklanmış `sonar.issue.ignore.multicriteria`. Sunucudaki "False positive / Safe" işaretleri kullanılmaz; CI'da kalıcı değiller.
- **Temizlik davranışı değiştirmez.** Değiştirmesi gereken bir düzeltme çıkarsa testle korunur ve kullanıcıya bildirilir.
- **ESLint:** SonarJS kuralları `error` düzeyinde ve yalnızca Sonar'ın taradığı dosyalarda uygulanır. Shadcn dosyaları (`apps/web/components/ui/**`, `apps/web/hooks/use-mobile.ts`) ve `apps/web/vendor/**` hariçtir.
- **GitHub eylemleri** SHA'ya sabitlenir. `actions/upload-artifact` için `v4.6.2` kullanılır (`ea165f8d65b6e75b540449e92b4886f43607fa02`).
- **Commit'ler:** Mesajlar ve yorumlar Türkçe. Commit sonuna `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` eklenir.
- **Araç zinciri:** Komutlar nvm'deki Node 24 ve pnpm ile çalışır. Sonar komutları Docker Desktop'ın açık olmasını ister.

## Review Focus

1. **Sayfalama ve yanıt hataları:** 500'den fazla sorunda bütün sayfalar okunmalı. HTTP hatası ya da beklenmeyen bir gövde gelirse kapı hata vermeli; "0 sorun" saymamalı (Görev 1 testleri).
2. **Rapor yarışı:** Kapı, az önce gönderilen analiz işlenmeden sorunları okumamalı. İşlem `FAILED` ya da `CANCELED` biterse kapı düşmeli (Görev 1 testleri).
3. **Eski kapsayıcı:** Sabitlenen sürümden farklı bir imajla çalışan `derslik-sonarqube` varsa yeniden kurulmalı. Yoksa yerel ile CI farklı kurallarla tarar (Görev 1).
4. **CI ortamı:** Linux'ta Elasticsearch `vm.max_map_count` ister. İş bunu ayarlamazsa SonarQube açılmayabilir (Görev 12).
5. **Gerekçesiz susturma:** `NOSONAR` ya da `eslint-disable … sonarjs/…` yorumunun gerekçesi yoksa test düşmeli (Görev 2).

---

### Görev 1: Kapı modu ve sabit sürümler

**Files:**
- Create: `scripts/sonar-gate.mjs` (saf karar ve rapor)
- Modify: `scripts/sonar.mjs` (sabit imajlar, sürüm denetimi, `--gate`, sayfalı ve kapalıyken güvenli okuma)
- Modify: `package.json` (`quality:gate`, `test:quality`)
- Modify: `sonar-project.properties` (`sonar.scm.disabled=true`)
- Test: `tests/sonar-gate.test.mjs`

**Interfaces:**
- Produces: `scripts/sonar-gate.mjs` → `MAX_DUPLICATION: number`, `componentPath(component: string): string`, `severityOf(issue): string`, `formatFindings(findings): string[]`, `evaluateGate({ issues, hotspots, duplication, maxDuplication? }) → { failed: boolean, issues: Finding[], hotspots: Finding[], duplication: number, maxDuplication: number, text: string[] }`, `collectPages(fetchPage: (page: number) => Promise<{ items: unknown[], total: number }>): Promise<unknown[]>`, `analysisDone(ce): "pending" | "success" | "failed"`
- Produces: `pnpm quality:gate` (çıkış 0/1) ve `reports/sonar-gate.json` (`evaluateGate` sonucu)

- [ ] **Adım 1: Kapının saf kısmı için testleri yaz**

`tests/sonar-gate.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DUPLICATION,
  analysisDone,
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

test("tekrar oranı sayı değilse kapı hata verir (kapalıyken güvenli)", () => {
  assert.throws(
    () => evaluateGate({ issues: [], hotspots: [], duplication: Number.NaN }),
    /tekrar/i,
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

test("toplam sayıdan önce boş sayfa gelirse hata verilir", async () => {
  await assert.rejects(
    collectPages(async () => ({ items: [], total: 3 })),
    /eksik/i,
  );
});

test("analiz durumu: kuyruk ya da süren iş bekler, başarısız iş düşer", () => {
  assert.equal(analysisDone({ queue: [{}], current: null }), "pending");
  assert.equal(
    analysisDone({ queue: [], current: { status: "IN_PROGRESS" } }),
    "pending",
  );
  assert.equal(
    analysisDone({ queue: [], current: { status: "SUCCESS" } }),
    "success",
  );
  assert.equal(
    analysisDone({ queue: [], current: { status: "FAILED" } }),
    "failed",
  );
  assert.equal(
    analysisDone({ queue: [], current: { status: "CANCELED" } }),
    "failed",
  );
  assert.equal(analysisDone({ queue: [] }), "failed");
});
```

- [ ] **Adım 2: Testleri çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-gate.test.mjs`
Beklenen: FAIL. `Cannot find module '…/scripts/sonar-gate.mjs'` hatası.

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
    const sorted = byFile.get(file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
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
    issueFindings.length > 0 || hotspotFindings.length > 0 || tooMuchDuplication;
  const text = [
    ...(issueFindings.length
      ? [`Açık sorunlar (${issueFindings.length}):`, ...formatFindings(issueFindings)]
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

/** Analiz işinin durumu (/api/ce/component yanıtı). */
export function analysisDone(ce) {
  if (ce.queue?.length || ce.current?.status === "IN_PROGRESS") return "pending";
  return ce.current?.status === "SUCCESS" ? "success" : "failed";
}
```

- [ ] **Adım 4: Testleri çalıştır, geçtiğini gör**

Çalıştır: `node --test tests/sonar-gate.test.mjs`
Beklenen: PASS, 11/11.

- [ ] **Adım 5: `scripts/sonar.mjs`'i kapıya bağla**

Değişiklikler (mevcut düzen korunur):

```js
// Dosyanın başına:
import { analysisDone, collectPages, evaluateGate } from "./sonar-gate.mjs";

// Sabitlerin yanına:
// Yerelde ve CI'da aynı kurallar çalışsın diye imajlar tam sürüme sabit.
// Yükseltme ayrı iştir; yeni kurallar yeni sorunlar getirebilir.
const SONARQUBE_IMAGE = "sonarqube:26.9.0.129388-community";
const SCANNER_IMAGE = "sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0";
const gate = process.argv.includes("--gate");
```

`ensureServer()` içinde kapsayıcı varsa imajını denetle. Farklıysa kapsayıcıyı ve veri birimlerini silip yeniden kur (yerel geçmiş sıfırlanır; parola dosyası korunur, `adminAuth` aynı parolayı yeniden ayarlar):

```js
  const image = spawnSync(
    "docker",
    ["inspect", "-f", "{{.Config.Image}}", CONTAINER],
    { encoding: "utf8" },
  );
  if (image.status === 0 && image.stdout.trim() !== SONARQUBE_IMAGE) {
    console.log(
      `SonarQube ${image.stdout.trim()} → ${SONARQUBE_IMAGE}: kapsayıcı yeniden kuruluyor.`,
    );
    docker(["rm", "-f", CONTAINER]);
    for (const volume of ["derslik-sonar-data", "derslik-sonar-extensions"])
      spawnSync("docker", ["volume", "rm", volume]);
  }
```

Bu blok, mevcut `state` denetiminden önce gelir. `docker run` argümanlarındaki `"sonarqube:community"` yerine `SONARQUBE_IMAGE`, tarayıcıdaki `"sonarsource/sonar-scanner-cli"` yerine `SCANNER_IMAGE` yazılır. Tarayıcının `docker run` argümanlarına `"--platform", "linux/amd64"` eklenir: imajın arm64 sürümü yok, Apple Silicon'da öykünmeyle çalışır ve platform açıkça verilince uyarı çıkmaz.

`sonar-project.properties`'e eklenir:

```properties
# Kapı bütün açık sorunlara bakar; "yeni kod" için git blame gerekmez.
# Ayrıca worktree'lerde .git dosyası ana depoyu gösterir ve kapsayıcıya
# bağlanmadığı için tarama "Unable to open Git repository" ile düşüyordu.
sonar.scm.disabled=true
```

`summary()` içindeki bekleme döngüsü `waitProcessed(auth)` olarak ayrılır ve başarısız işte hata verir:

```js
async function json(pathname, auth) {
  const res = await api("GET", pathname, auth);
  if (!res.ok)
    throw new Error(`SonarQube ${pathname} → HTTP ${res.status}`);
  return res.json();
}

async function waitProcessed(auth) {
  for (let i = 0; i < 150; i++) {
    const state = analysisDone(
      await json(`/api/ce/component?component=${PROJECT}`, auth),
    );
    if (state === "success") return;
    if (state === "failed")
      throw new Error("SonarQube analizi işleyemedi (FAILED/CANCELED).");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("SonarQube analizi 5 dakikada işlenmedi.");
}

async function enforceGate(auth) {
  await waitProcessed(auth);
  const issues = await collectPages(async (p) => {
    const r = await json(
      `/api/issues/search?components=${PROJECT}&resolved=false&ps=500&p=${p}`,
      auth,
    );
    return { items: r.issues, total: r.paging?.total ?? r.total };
  });
  const hotspots = await collectPages(async (p) => {
    const r = await json(
      `/api/hotspots/search?projectKey=${PROJECT}&status=TO_REVIEW&ps=500&p=${p}`,
      auth,
    );
    return { items: r.hotspots, total: r.paging?.total };
  });
  const measures = await json(
    `/api/measures/component?component=${PROJECT}&metricKeys=duplicated_lines_density`,
    auth,
  );
  const duplication = Number(measures.component?.measures?.[0]?.value);
  const result = evaluateGate({ issues, hotspots, duplication });
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "reports", "sonar-gate.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  for (const line of result.text) console.log(line);
  console.log(
    `\nAyrıntılar: ${HOST}/dashboard?id=${PROJECT} · liste: reports/sonar-gate.json`,
  );
  return result.failed;
}
```

`summary()` artık `await waitProcessed(auth)` ile başlar (eski döngünün yerine). Dosyanın sonu:

```js
if (scan.status !== 0) process.exit(scan.status ?? 1);
if (gate) {
  // Kapı kapalıyken güvenli: okuma hatası da kapıyı düşürür.
  const failed = await enforceGate(auth).catch((error) => {
    console.error(error.message);
    return true;
  });
  process.exit(failed ? 1 : 0);
}
await summary(auth);
```

`package.json` `scripts`:

```json
"quality:gate": "node scripts/sonar.mjs --gate",
"test:quality": "node --test tests/sonar-gate.test.mjs",
```

- [ ] **Adım 6: Kapıyı gerçek sunucuda dene**

Çalıştır: `pnpm quality:gate; echo "exit=$?"`
Beklenen: Kapsayıcı sabit sürüme göre yeniden kurulur. Tarama biter ve mevcut sorunlar dosya ve satırıyla listelenir. Son satır `Sonar kapısı: GEÇMEDİ`, çıkış kodu `exit=1`, `reports/sonar-gate.json` yazılmış olur. Temizlik bitmediği için bu beklenen sonuçtur.

- [ ] **Adım 7: Kapalıyken güvenli olduğunu dene**

Çalıştır: `docker stop derslik-sonarqube; SONAR_ADMIN_PASSWORD=yanlis pnpm quality:gate; echo "exit=$?"; docker start derslik-sonarqube`
Beklenen: Yönetici girişi hatası ve `exit=1`. Kapı hiçbir yolla "geçti" demez.

- [ ] **Adım 8: Commit**

```bash
git add scripts/sonar-gate.mjs scripts/sonar.mjs tests/sonar-gate.test.mjs package.json
git commit -m "Sonar kapısı: quality:gate, sabit sürümler, kapalıyken güvenli okuma"
```

### Görev 2: Gerekçesiz susturma testi

**Files:**
- Modify: `scripts/sonar-gate.mjs` (`bareSuppressions`)
- Test: `tests/sonar-suppressions.test.mjs`

**Interfaces:**
- Consumes: Sonar kapsamındaki klasörler (`sonar-project.properties`)
- Produces: `scripts/sonar-gate.mjs` → `bareSuppressions(text: string): number[]` (gerekçesiz susturma yorumlarının satır numaraları); `pnpm test:quality`'nin ikinci dosyası

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
  "apps/mobile/src",
  "packages/contracts/src",
  "packages/api-client/src",
  "scripts",
  "tests",
];
// Bu dosyanın örnek satırları bilerek gerekçesizdir.
const skip = /node_modules|\.next|components\/ui\/|sonar-suppressions\.test\.mjs$/;
function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.test(full)) continue;
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield full;
  }
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
  for (const dir of roots)
    for (const file of files(path.join(root, dir)))
      for (const line of bareSuppressions(fs.readFileSync(file, "utf8")))
        offenders.push(`${path.relative(root, file)}:${line}`);
  assert.deepEqual(offenders, []);
});
```

- [ ] **Adım 2: Testi çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-suppressions.test.mjs`
Beklenen: FAIL. `The requested module '../scripts/sonar-gate.mjs' does not provide an export named 'bareSuppressions'`.

- [ ] **Adım 3: `bareSuppressions`'ı `scripts/sonar-gate.mjs`'e ekle**

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

- [ ] **Adım 4: `test:quality`'ye ekle ve testleri çalıştır**

`package.json`:

```json
"test:quality": "node --test tests/sonar-gate.test.mjs tests/sonar-suppressions.test.mjs",
```

Çalıştır: `pnpm test:quality`
Beklenen: PASS. `sonar-gate` 11/11 ve `sonar-suppressions` 2/2. Depoda bugün susturma yoksa ikinci test hemen geçer; birinci test deseni sınar.

- [ ] **Adım 5: Commit**

```bash
git add scripts/sonar-gate.mjs tests/sonar-suppressions.test.mjs package.json
git commit -m "Sonar: gerekçesiz susturma testi"
```


### Görev 3: Kapının ilk sonucu

**Files:** yok (yalnızca rapor)

Keşif taraması (plan yazılırken, SCM kapalı, `sonarqube:community` = 26.9) 468 sorun, 0 güvenlik noktası ve %0,5 kod tekrarı buldu. Kod tekrarı sınırı %3 olarak kalır, kullanıcı kararı gerekmez. Ayrıntılar aşağıdaki temizlik görevlerinde.

- [ ] **Adım 1: Kapıyı sabit sürümle çalıştır ve keşifle karşılaştır**

Çalıştır: `pnpm quality:gate > reports/gate-baseline.txt; echo "exit=$?"`
Beklenen: `exit=1`; `reports/sonar-gate.json`'da 468 sorun, 0 güvenlik noktası, `duplication` 0.5.

Kurala göre sayım:

```bash
node -e 'const r=require("./reports/sonar-gate.json");const c={};for(const i of r.issues)c[i.rule]=(c[i.rule]||0)+1;console.log(r.issues.length,r.hotspots.length,r.duplication,JSON.stringify(Object.entries(c).sort((a,b)=>b[1]-a[1])))'
```

Sayılar keşiften farklıysa (ör. sürüm farkı), fark ledger'a not edilir. Temizlik görevlerindeki listeler zaten her görevin başında yeniden çıkarıldığı için plan değişmez.

### Temizlik görevleri için ortak adımlar

İlk tarama (2026-10-02, SonarQube 26.9, SCM kapalı) şunu buldu: **468 açık sorun** (445 kod kokusu, 20 güvenlik açığı, 3 hata). İnceleme bekleyen güvenlik noktası **0**. Kod tekrarı **%0,5** (10 blok; %3 sınırının altında). Yaklaşık 50,6 bin satır kod.

- **Dağılım:** `apps/web` 240, `apps/mobile` 168, `apps/api` 19, `packages/contracts` 12, `packages/api-client` 3, `scripts` 26.
- **Testler:** Test klasörlerinde sorun yok.

Her temizlik görevi aynı döngüyle çalışır:

1. Kuralın örneklerini listele:

   ```bash
   node -e 'const r=require("./reports/sonar-gate.json");for(const i of r.issues.filter(i=>process.argv.slice(1).includes(i.rule)))console.log(`${i.file}:${i.line}  ${i.message}`)' <kural> [<kural>…]
   ```

2. Düzelt. Davranış değişmez.
3. Doğrula: `pnpm typecheck && pnpm mobile:typecheck && pnpm lint && pnpm test`. API'ye dokunulduysa `pnpm api:test` (yerel Postgres) de çalışır.
4. `pnpm quality:gate` çalıştır. Beklenen: görevin kurallarından hiç sorun kalmaz. Toplam sayı yalnızca azalır, yeni kural çıkmaz.
5. Bölüm bölüm commit (`git add` ile yalnızca düzeltilen dosyalar). Görev büyükse alan alan (API, web, mobil, ortak paketler, betikler) ayrı commit'ler.

Davranışı değiştirmesi kaçınılmaz bir düzeltme çıkarsa testle korunur ve ledger'a `Ruling:` olarak yazılır.

### Görev 4: Güvenlik açıkları ve hatalar (23)

**Files:**
- Modify: `sonar-project.properties` (gerekçeli `sonar.issue.ignore.multicriteria`)
- Modify: `packages/api-client/src/socket.ts:196`, `scripts/mobile-security-tests.mjs:47` (gerekçeli `NOSONAR`)
- Modify: `apps/web/lib/chat-drafts.ts` ve kullanıldığı yerler

**Interfaces:**
- Produces: `chat-drafts.ts` → `getChatDraft(key: string): string | undefined`, `setChatDraft(key: string, text: string): void`, `clearChatDrafts(): void`. `chatDrafts` Map'i artık dışa açık değil.

Bulgular ve karar:

| Kural | Yer | Karar |
|---|---|---|
| `typescript:S2068` ×8 | `packages/contracts/src/i18n/{es,ja,zh}.ts` | Yanlış alarm: "parola" sözcüğünün çevirisi, gerçek parola değil. Multicriteria ile i18n klasöründe susturulur. |
| `javascript:S4036` ×8 | `scripts/{install-ci,pnpm-install,run-framework,security-zap-fixture,sonar}.mjs` | Geliştirici betikleri `docker`, `pnpm` ve `node`'u geliştiricinin PATH'iyle çağırır. Sabit yol taşınabilirliği bozar. Multicriteria ile `scripts/**`'ta susturulur. |
| `javascript:S5332` ×2 | `scripts/security-zap-fixture.mjs:34-35` | Yerel güvenlik taraması fikstürü `http://localhost`'ta çalışır. Multicriteria ile bu dosyada susturulur. |
| `css:S8776` ×2 | `apps/web/app/globals.css:9,13` | Tailwind v4 `@custom-variant` sözdizimindeki `&`. Multicriteria ile bu dosyada susturulur. |
| `typescript:S2245` ×1 | `packages/api-client/src/socket.ts:196` | Yeniden bağlanma gecikmesinin titreşimi; güvenlikle ilgisi yok. Satırda `// NOSONAR: yeniden bağlanma titreşimi, güvenlikle ilgisi yok`. |
| `javascript:S1523` ×1 | `scripts/mobile-security-tests.mjs:47` | Güvenlik testleri depodaki mobil kodu yalıtılmış bir `vm` bağlamında çalıştırır; dış girdi yok. Satırda `// NOSONAR: depodaki kodu yalıtılmış vm bağlamında test eder`. |
| `typescript:S4158` ×1 | `apps/web/lib/chat-drafts.ts:9` | Map başka modüllerden doldurulduğu için Sonar boş sanıyor. Map modülde gizlenir, erişim `getChatDraft` ve `setChatDraft` ile olur. Gerçek bir tasarım iyileştirmesi; susturma gerekmez. |

- [ ] **Adım 1: `sonar-project.properties`'e gerekçeli hariçleri ekle**

```properties
# Gerekçeli susturmalar. Sunucudaki "False positive" işareti CI'da kalıcı
# olmadığı için yanlış alarmlar burada, gerekçesiyle tutulur (AGENTS.md).
sonar.issue.ignore.multicriteria=i18nPassword,scriptsPath,zapHttp,tailwindVariant
# Çeviri dosyalarında "parola" sözcüğünün çevirisi parola sanılıyor.
sonar.issue.ignore.multicriteria.i18nPassword.ruleKey=typescript:S2068
sonar.issue.ignore.multicriteria.i18nPassword.resourceKey=packages/contracts/src/i18n/**
# Geliştirici betikleri docker/pnpm/node'u geliştiricinin PATH'iyle çağırır.
sonar.issue.ignore.multicriteria.scriptsPath.ruleKey=javascript:S4036
sonar.issue.ignore.multicriteria.scriptsPath.resourceKey=scripts/**
# Yerel güvenlik taraması fikstürü http://localhost'ta çalışır.
sonar.issue.ignore.multicriteria.zapHttp.ruleKey=javascript:S5332
sonar.issue.ignore.multicriteria.zapHttp.resourceKey=scripts/security-zap-fixture.mjs
# Tailwind v4 @custom-variant sözdizimi (& kök kural dışında) CSS ayrıştırıcısınca tanınmıyor.
sonar.issue.ignore.multicriteria.tailwindVariant.ruleKey=css:S8776
sonar.issue.ignore.multicriteria.tailwindVariant.resourceKey=apps/web/app/globals.css
```

- [ ] **Adım 2: İki gerekçeli `NOSONAR` ve `chat-drafts` düzenlemesi**

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

`clearChatDrafts` aynen kalır. Kullanım yerleri (`grep -rn "chatDrafts" apps/web`) bu işlevlere geçer. Boş metni silme davranışı bugünkü kullanım yerlerinde nasılsa öyle korunur: kullanım `set` ile boş dize yazıyorsa `setChatDraft` de boş dizeyi saklamalıdır. Kodu okuyup buna göre karar ver.

- [ ] **Adım 3: Doğrula ve commit**

Ortak adımlar 3 ve 4. Beklenen: güvenlik açığı ve hata 0; toplam 445.

```bash
git add sonar-project.properties packages/api-client/src/socket.ts scripts/mobile-security-tests.mjs apps/web/lib/chat-drafts.ts <kullanım yerleri>
git commit -m "Sonar: güvenlik açıkları ve hatalar (gerekçeli susturmalar, chatDrafts erişimi)"
```

### Görev 5: Salt okunur prop'lar (S6759, 166)

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
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S6759 sıfır; toplam 279.
- [ ] **Adım 4:** Commit: `git commit -m "Sonar: bileşen prop'ları salt okunur (S6759)"` (mobil ve web ayrı commit'ler olabilir).

### Görev 6: İç içe üçlü ifadeler (S3358, 123)

**Files:** liste ortak adım 1'den (`typescript:S3358`, `javascript:S3358`)

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
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S3358 sıfır; toplam 156.
- [ ] **Adım 4:** Alan alan commit: API, web, mobil, betikler. Örneğin `git commit -m "Sonar: iç içe üçlü ifadeler, web (S3358)"`.

### Görev 7: Karmaşıklık ve derin iç içelik (S3776 ×35, S2004 ×6)

**Files:** liste ortak adım 1'den (`typescript:S3776`, `javascript:S3776`, `typescript:S2004`)

- **Bilişsel karmaşıklık (sınır 15):** İşlevin içindeki bağımsız adımlar adlı yardımcılara çıkarılır: doğrulama, eşleme, hata çevirisi gibi. Erken dönüşle `else` derinliği azaltılır. Davranış birebir korunur.
- **API servisleri:** Mevcut entegrasyon testleri kapsıyor. Her servis düzeltmesinden sonra `pnpm test` ve `pnpm api:test` çalışır. Testlerin kapsamadığı bir dal değişiyorsa önce o dalı sınayan test eklenir; RED değil, karakterizasyon testi olarak önce geçtiği görülür.
- **Arayüz bileşenleri:** Uzun bileşenden alt bileşen çıkarılır (prop'ları `Readonly`). Durum (state) üst bileşende kalır.
- **Derin iç içe işlev (S2004, 5 seviyeden derin):** İç içe geri çağırmalar adlı işlevlere çıkarılır, örneğin `mobile/src/teacher/availability.tsx:226`.
- **`scripts/legacy-preflight.mjs` (50):** Adımlar ayrı işlevlere bölünür. Çıktısı `node scripts/legacy-preflight.mjs` ile önce ve sonra karşılaştırılır.

- [ ] **Adım 1:** Örnekleri listele (mesajdaki "from N" değeriyle).
- [ ] **Adım 2:** İşlev işlev düzelt, her biri sonrası ilgili test.
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: S3776 ve S2004 sıfır; toplam 115.
- [ ] **Adım 4:** Alan alan commit.

### Görev 8: Küçük kurallar (~70)

**Files:** liste ortak adım 1'den

| Kural | Adet | Düzeltme |
|---|---|---|
| `typescript:S7758` | 11 | `charCodeAt(i)` → `codePointAt(i)`. BMP dışı karakterlerde (emoji) değer değişir; yalnızca karakter karşılaştırma ya da renk ve karma hesabında kullanılıyorsa kabul edilir. Davranış önemliyse kalıp korunur, ledger'a not düşülür. |
| `typescript:S7755` | 7 | `a[a.length - 1]` → `a.at(-1)` |
| `typescript:S6819` | 7 | `role="status"` taşıyan öğe → `<output>`. `<output>` satır içidir; düzen bozulmasın diye öğedeki görünüm sınıfları korunur, gerekirse `block`/`flex` eklenir. Tarayıcıda bakılır. |
| `typescript:S7781` | 5 | `replace(/x/g, y)` → `replaceAll(…)` (düzenli ifade kalabilir: `replaceAll(/x/g, y)`) |
| `typescript:S6582` | 5 | `a && a.b` → `a?.b`. Yalnızca `a` null/undefined ya da nesne olabiliyorsa; `0`/`""` olabiliyorsa dokunulmaz, susturma gerekçesiyle |
| `typescript:S6754` | 5 | `useState` dönüşü `[değer, setDeğer]` olarak adlandırılır |
| `S7780` (ts ×4, js ×4) | 8 | Ters bölü kaçışlı dizeler `String.raw\`…\`` |
| `typescript:S6479` | 4 | Dizi sırası anahtar olarak kullanılmaz; içerikten kararlı anahtar |
| `typescript:S3735` | 3 | `void` işleci kaldırılır: söz (promise) ise `.catch` ile ya da `async` işlevle, değilse doğrudan çağrı |
| `S7722`/`S7723` | 5 | `Error()` → `new Error("…")`, mesajla |
| `typescript:S6571` | 2 | Birleşimde `string` ile gereksizleşen dize sabitleri sadeleştirilir |
| `typescript:S6551` | 2 | `reader.result` için tip denetimi (`typeof … === "string"`) |
| `typescript:S3863` | 2 | Aynı modülden iki import birleştirilir (`import { a, type B } from …`) |
| `typescript:S4043` | 1 | `.reverse()` → `.toReversed()` (API, Node 22) |
| `typescript:S6594` | 1 | `str.match(re)` → `re.exec(str)` |
| `typescript:S7765` | 1 | `.some(x => x === v)` → `.includes(v)` |
| `typescript:S7776` | 1 | `routes` dizisi → `Set`, `.has()` |
| `typescript:S6478` | 1 | `learning-panel.tsx:139`'daki iç bileşen dışarı taşınır, veri prop'la gelir |
| `typescript:S7763` | 1 | `loading.tsx`: `export { Skeleton } from "@/components/ui/skeleton"` |
| `typescript:S4084` | 1 | `video-player.tsx:106`: Öğretmenin yüklediği videoların altyazı dosyası yok. Gerekçeli `NOSONAR` ile susturulur, ledger'a `Ruling:` yazılır ve kullanıcıya bildirilir (altyazı desteği ayrı iş). |
| `javascript:S2094` | 1 | `scripts/mobile-security-tests.mjs:281` boş sınıf kaldırılır ya da amacına göre doldurulur |
| `javascript:S1940` | 1 | `!(a > b)` → `a <= b` |

- [ ] **Adım 1:** Kural kural listele ve düzelt.
- [ ] **Adım 2:** `S6819` ve `S6479` değişikliklerinin göründüğü ekranları not et (Görev 13'te tarayıcıda bakılır).
- [ ] **Adım 3:** Ortak adımlar 3–4. Beklenen: toplam 37 (yalnızca CSS kaldı).
- [ ] **Adım 4:** Commit: `git commit -m "Sonar: küçük kurallar (S7758, S7755, S6819 …)"`.

### Görev 9: CSS'te tekrarlanan seçiciler (css:S4666, 37)

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
- [ ] **Adım 5:** Commit: `git commit -m "Sonar: CSS'te tekrarlanan seçiciler birleştirildi (görsel fark yok)"`.

### Görev 10: ESLint'te Sonar katmanı

**Files:**
- Modify: `package.json` (`eslint-plugin-sonarjs` 4.2.2, `test:quality`)
- Modify: `eslint.config.mjs`
- Test: `tests/sonar-lint.test.mjs`

**Interfaces:**
- Consumes: temizlenmiş kod (önceki görevler); `sonar-project.properties`'teki kapsam
- Produces: `pnpm lint` SonarJS kurallarını hata düzeyinde çalıştırır; `pnpm test:quality` üç dosya

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
  const found = await sonarMessages("apps/web/lib/__sonar_probe__.ts");
  assert.ok(
    found.some(([rule]) => rule === "sonarjs/no-all-duplicated-branches"),
    JSON.stringify(found),
  );
  assert.ok(found.every(([, severity]) => severity === 2));
});

test("shadcn dosyalarında SonarJS kuralları uygulanmaz", async () => {
  assert.deepEqual(
    await sonarMessages("apps/web/components/ui/__sonar_probe__.tsx"),
    [],
  );
});
```

`package.json` `test:quality`'ye `tests/sonar-lint.test.mjs` eklenir.

- [ ] **Adım 2: Testi çalıştır, kırmızı olduğunu gör**

Çalıştır: `node --test tests/sonar-lint.test.mjs`
Beklenen: FAIL. Birinci testte `found` boş (`[]`), çünkü SonarJS henüz yapılandırmada yok.

- [ ] **Adım 3: Eklentiyi kur ve yapılandır**

Çalıştır: `pnpm add -D -w eslint-plugin-sonarjs@4.2.2`

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
      "apps/web/{app,components,hooks,lib}/**/*.{ts,tsx,js,mjs}",
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/mobile/index.ts",
      "packages/*/src/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs,cjs,ts}",
      "tests/**/*.{js,mjs,ts}",
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

- [ ] **Adım 4: Lint testini ve lint'i çalıştır**

Çalıştır: `node --test tests/sonar-lint.test.mjs`
Beklenen: PASS 2/2.

Çalıştır: `pnpm lint 2>&1 | grep -c "sonarjs/"`
Beklenen: Temizlik görevlerinden sonra kalan yalnızca ESLint'te çıkan ihlaller (çoğu 0 olmalı). Kalan her ihlal, temizlik görevlerindeki kurallarla düzeltilir. Yanlış alarm ise gerekçeli `eslint-disable-next-line sonarjs/<kural> -- <gerekçe>` ile susturulur. Bir kural Next ya da React Native ile sistematik çakışıyorsa `sonarRules` üzerine gerekçeli bir `"off"` eklenir ve ledger'a `Ruling:` yazılır. Sonunda `pnpm lint` çıkış 0 olur.

- [ ] **Adım 5: Testler ve commit**

Çalıştır: `pnpm test:quality && pnpm typecheck && pnpm mobile:typecheck && pnpm test`
Beklenen: hepsi PASS.

```bash
git add package.json pnpm-lock.yaml eslint.config.mjs tests/sonar-lint.test.mjs <düzeltilen dosyalar>
git commit -m "Sonar: ESLint'te SonarJS kuralları (hata düzeyinde)"
```

### Görev 11: Çalışma kuralı ve belge

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Modify: `docs/sonar.md`

**Interfaces:**
- Consumes: `pnpm quality:gate`, `pnpm test:quality`, susturma biçimleri (Global Constraints)
- Produces: her oturumun okuduğu kural dosyası

- [ ] **Adım 1: `AGENTS.md`'yi yaz**

```markdown
# Derslik: çalışma kuralları

Bu dosya, bu depoda çalışan herkes ve her yapay zekâ oturumu içindir.

## Göndermeden önce

`main`'e birleştirmeden ya da göndermeden önce şunların hepsi geçer:

- `pnpm typecheck`
- `pnpm mobile:typecheck`
- `pnpm lint` (Sonar kuralları dahil)
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

SonarQube arayüzündeki "False positive" ya da "Safe" işaretleri kullanılmaz;
CI'daki sunucu her çalıştırmada sıfırdan açılır. `pnpm test:quality`
gerekçesiz susturmayı yakalar. Ayrıntı: `docs/sonar.md`.

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

"SonarQube" bölümünün başına kapıyı, CI'ı ve susturma kuralını anlatan bir bölüm eklenir:

```markdown
## Kapı: göndermeden önce sıfır sorun

    pnpm quality:gate

Taramayı yapar, sonra açık sorunları ve inceleme bekleyen güvenlik
noktalarını dosya ve satırıyla listeler (`reports/sonar-gate.json`). Tek bir
sorun ya da sınırı aşan kod tekrarı varsa çıkış kodu 1'dir. Aynı kapı CI'da
"Sonar" işinde çalışır. SonarQube ve tarayıcı imajları `scripts/sonar.mjs`'te
tam sürüme sabittir; sabitten farklı bir kapsayıcı yeniden kurulur.

ESLint'te SonarJS kuralları da vardır (`pnpm lint`); sorunların çoğunu
saniyeler içinde, kapıdan önce gösterir.

Susturma kuralı ve göndermeden önceki kontrol listesi: kökteki `AGENTS.md`.
```

- [ ] **Adım 3: Commit**

```bash
git add AGENTS.md CLAUDE.md docs/sonar.md
git commit -m "Çalışma kuralı: göndermeden önce sıfır Sonar sorunu, pencere kuralı"
```

### Görev 12: CI işi

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm quality:gate`, `pnpm test:quality`
- Produces: CI'da `sonar` işi; `checks` işinde "Quality tooling tests" adımı

- [ ] **Adım 1: `checks` işine kalite araçlarının testini ekle**

"Architecture tests" adımından sonra:

```yaml
      - name: Quality tooling tests
        run: pnpm test:quality
```

- [ ] **Adım 2: `sonar` işini ekle**

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

- [ ] **Adım 3: Yerelde aynı adımları doğrula**

Çalıştır: `pnpm test:quality && pnpm quality:gate; echo "exit=$?"`
Beklenen: `exit=0`, son satır `Sonar kapısı: geçti`.

- [ ] **Adım 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "CI: Sonar kapısı işi ve kalite araçlarının testleri"
```

### Görev 13: Son doğrulama

**Files:** yok (doğrulama)

- [ ] **Adım 1: Kapının sorun yakaladığını göster**

Geçici bir dosya oluştur: `apps/web/lib/__sonar_probe__.ts`, içine Görev 10'deki örnek. Çalıştır: `pnpm quality:gate; echo "exit=$?"`.
Beklenen: `exit=1`, listede `apps/web/lib/__sonar_probe__.ts` ve kural `typescript:S3923`.
Dosyayı sil, yeniden çalıştır. Beklenen: `exit=0`. İki çıktı da ledger'a kaydedilir. Dosya commit'lenmez.

- [ ] **Adım 2: Bütün CI adımları**

Çalıştır: `pnpm typecheck && pnpm mobile:typecheck && pnpm lint && pnpm mobile:security-test && pnpm test && node --test tests/media-config.test.mjs && pnpm test:booking && pnpm test:architecture && pnpm test:quality && pnpm web:build && pnpm web:test && pnpm quality:gate`
Beklenen: hepsi çıkış 0. `apps/web/next-env.d.ts` derleme farkı commit'lenmez, `git checkout` ile geri alınır.

- [ ] **Adım 3: Arayüz duman testi**

Temizlik çok sayıda ekran dosyasına dokunur: iç içe ifadeler, alt bileşenler, `<output>`, anahtarlar. 3100'de bu dalın web'i açılır (bellek: worktree-web-preview) ve Chrome'da şu ekranlar gezilir:

- **Öğretmen:** genel bakış, takvim, öğrenciler, öğrenci ayrıntısı, tahsilatlar, mesajlar, vitrin.
- **Öğrenci:** dersler, ders ayarla, mesajlar. Öğrenci için kullanıcı hesap değiştirir.
- **Her ekranda:** konsolda hata olmadığı doğrulanır.
- **Pencereler:** Ders ayarla, Müsaitlik ve Takvime bağla pencerelerinde yükseklik bütün durumlarda ölçülür (bellek: modal-no-layout-shift).
- **Görev 8:** Not edilen `<output>` ve anahtar değişikliklerinin ekranlarına ayrıca bakılır.

Mobilde `pnpm mobile:typecheck` ve `pnpm mobile:security-test` yeterlidir; simülatör denemesi kullanıcı isterse yapılır.

- [ ] **Adım 4: Gönder ve CI'ı gör**

Dalı gönder (`git push -u origin sonar-quality-gate`). Kullanıcı birleştirmeyi isteyince `main`'e ileri sarılarak birleştirilir ve gönderilir. Ardından `main` commit'inin GitHub kontrolleri (`/repos/bburak2014/derslik/commits/<sha>/check-runs`) bir kez okunur. `checks` ve `sonar` işlerinin `success` olduğu görülür.

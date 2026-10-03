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
  const levels = new Set((issue.impacts ?? []).map((i) => i.severity));
  for (const level of IMPACT_ORDER) if (levels.has(level)) return level;
  return issue.severity ?? "-";
}

/** Loga yazılacak dış metni (API iletisi, dosya yolu, ortam değeri) güvenli
 *  hale getirir: satır sonları (log satırı bölme) ve diğer kontrol
 *  karakterleri (C0, DEL, C1; terminal kaçış dizileri) boşluğa çevrilir.
 *  Normal metin değişmez (S5145). */
export const safeLogText = (value) =>
  String(value)
    .replaceAll(/[\r\n]/g, " ")
    .replaceAll(/\p{Cc}/gu, " ");

/** Kod birimi sırasıyla karşılaştırır (yerel ayardan bağımsız, kararlı). */
const compareText = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** Dosyaya göre gruplanmış, satıra göre sıralı rapor satırları. */
export function formatFindings(findings) {
  const byFile = new Map();
  for (const f of findings)
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const lines = [];
  for (const file of [...byFile.keys()].sort(compareText)) {
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
    // eslint-disable-next-line no-await-in-loop -- sayfalama: sonraki sayfanın gerekip gerekmediği ve toplam sayı önceki sayfanın yanıtına bağlı.
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

/** Kapının üç girdisini (sorunlar, güvenlik noktaları, kod tekrarı) okur.
 *  `json(pathname)` yolu okuyup JSON döndürür, HTTP hatasında fırlatır.
 *  `issueComponentParam`: yerel SonarQube'de "components", SonarCloud'da
 *  "componentKeys". `scope`: boş ya da "branch=main" / "pullRequest=12" gibi
 *  üç isteğe de eklenen sorgu parçası. */
export async function fetchGateInputs(
  json,
  { project, issueComponentParam, scope = "" },
) {
  const suffix = scope ? `&${scope}` : "";
  const issues = await collectPages(async (p) => {
    const r = await json(
      `/api/issues/search?${issueComponentParam}=${project}&resolved=false&ps=500&p=${p}${suffix}`,
    );
    return { items: r.issues, total: r.paging?.total ?? r.total };
  });
  const hotspots = await collectPages(async (p) => {
    const r = await json(
      `/api/hotspots/search?projectKey=${project}&status=TO_REVIEW&ps=500&p=${p}${suffix}`,
    );
    return { items: r.hotspots, total: r.paging?.total };
  });
  const measures = await json(
    `/api/measures/component?component=${project}&metricKeys=duplicated_lines_density${suffix}`,
  );
  const duplication = Number(
    measures.component?.measures?.find(
      (m) => m.metric === "duplicated_lines_density",
    )?.value,
  );
  return { issues, hotspots, duplication };
}

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

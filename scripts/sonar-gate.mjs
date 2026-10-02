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

#!/usr/bin/env node
// CI kapısı: SonarCloud taraması bittikten sonra projenin "sıfır açık sorun"
// kuralını SonarCloud API'sine uygular (açık sorun 0, TO_REVIEW güvenlik
// noktası 0, kod tekrarı en çok %3). SonarCloud'un kendi "Sonar way" kalite
// kapısı (test kapsamı şartı) kullanılmaz. Kapı kapalıyken güvenlidir: token
// yoksa, görev başarısız/iptal/zaman aşımıysa, API hata verirse ya da liste
// eksik gelirse çıkış kodu 0 olmaz. Ayrıntı: docs/sonar.md
// Yerel deneme: SONAR_TOKEN=... node scripts/sonar-cloud-gate.mjs --branch main
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evaluateGate, fetchGateInputs, safeLogText } from "./sonar-gate.mjs";
import { scannerTaskId, waitForAnalysis } from "./sonar-report.mjs";

export const CLOUD_HOST = "https://sonarcloud.io";
export const CLOUD_PROJECT = "bburak2014_derslik";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Kapının bakacağı kapsam, sorgu parçası olarak: "branch=main" ya da
 *  "pullRequest=12". `branch` / `pullRequest` (yerel bayraklar) GitHub
 *  ortamından önce gelir. Belirlenemezse hata verir. */
export function cloudScope({ eventName, ref, refName, branch, pullRequest }) {
  if (branch && pullRequest !== undefined)
    throw new Error(
      "--branch ve --pull-request'ten yalnızca biri verilebilir.",
    );
  if (pullRequest !== undefined) {
    if (!/^[1-9]\d*$/.test(pullRequest))
      throw new Error(`Geçersiz çekme isteği numarası: ${pullRequest}`);
    return `pullRequest=${pullRequest}`;
  }
  if (branch) return `branch=${encodeURIComponent(branch)}`;
  if (eventName === "pull_request") {
    const number = /^refs\/pull\/([1-9]\d*)\/merge$/.exec(ref ?? "")?.[1];
    if (!number)
      throw new Error(
        `Çekme isteği numarası GITHUB_REF'ten okunamadı: ${ref ?? "(yok)"}`,
      );
    return `pullRequest=${number}`;
  }
  if (refName) return `branch=${encodeURIComponent(refName)}`;
  throw new Error(
    "Taranan dal ya da çekme isteği belirlenemedi. GitHub Actions dışında --branch <ad> ya da --pull-request <numara> verin.",
  );
}

/** `request(method, pathname)` → fetch yanıtı; Bearer token'lı, 15 sn zaman
 *  aşımlı. Bağlantı hataları (HTTP hataları değil) birkaç kez denenir. */
export function cloudRequest(
  token,
  {
    fetchFn = fetch,
    attempts = 3,
    delayMs = 3000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  return async (method, pathname) => {
    for (let attempt = 1; ; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- yeniden deneme: bağlantı hatası denemeleri sıralıdır, önceki deneme bitmeden sonraki başlamaz.
        return await fetchFn(CLOUD_HOST + pathname, { // NOSONAR: yeniden deneme: bağlantı hatası denemeleri sıralıdır, önceki deneme bitmeden sonraki başlamaz
          method,
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (error) {
        if (attempt >= attempts) throw error;
        // eslint-disable-next-line no-await-in-loop -- geri çekilme: bekleme bitmeden sonraki deneme başlamaz.
        await sleep(delayMs); // NOSONAR: geri çekilme: bekleme bitmeden sonraki deneme başlamaz
      }
    }
  };
}

async function run(argv, env) {
  const token = env.SONAR_TOKEN?.trim();
  if (!token) {
    console.error(
      "Sonar kapısı: SONAR_TOKEN tanımlı değil. GitHub'da Settings > Secrets and variables > Actions altına SONAR_TOKEN secret'ını ekleyin; yerelde ortam değişkeni olarak verin.",
    );
    return 1;
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      branch: { type: "string" },
      "pull-request": { type: "string" },
    },
  });
  const scope = cloudScope({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    refName: env.GITHUB_REF_NAME,
    branch: values.branch,
    pullRequest: values["pull-request"],
  });
  const request = cloudRequest(token);
  // Yalnızca bu taramanın işlenmiş sonucu okunur (ceTaskId).
  const taskId = scannerTaskId(
    path.join(root, ".scannerwork", "report-task.txt"),
  );
  await waitForAnalysis(request, taskId);
  const json = async (pathname) => {
    const res = await request("GET", pathname);
    if (!res.ok)
      throw new Error(
        `SonarCloud API ${res.status}: ${pathname.split("?")[0]}`,
      );
    return res.json();
  };
  const result = evaluateGate(
    await fetchGateInputs(json, {
      project: CLOUD_PROJECT,
      issueComponentParam: "componentKeys",
      scope,
    }),
  );
  const output = path.join(root, "reports", "sonar-gate.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  for (const line of result.text) console.log(safeLogText(line));
  console.log(
    `\nAyrıntılar: ${CLOUD_HOST}/dashboard?id=${CLOUD_PROJECT}&${scope} · liste: reports/sonar-gate.json`,
  );
  return result.failed ? 1 : 0;
}

/** Çıkış kodunu döndürür; hiçbir hata 0'a dönüşmez. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    return await run(argv, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      safeLogText(
        message.startsWith("Sonar kapısı") ? message : `Sonar kapısı: ${message}`,
      ),
    );
    return 1;
  }
}

// Başka bir modül içe aktarınca (testler) çalışmaz; sembolik bağla çağrılsa da
// gerçek yola çözülür, böylece kapı sessizce atlanmaz.
const entry = process.argv[1] && fs.realpathSync(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  // process.exit boruya yazılan büyük çıktıyı keser; çıkış kodu verilir.
  process.exitCode = await main();
}

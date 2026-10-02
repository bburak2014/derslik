#!/usr/bin/env node
// Yerel SonarQube analizi: Docker'da SonarQube Community'yi açar (ilk seferde
// kurar), sonar-scanner'ı çalıştırır ve özet ölçüleri yazdırır. Hesap veya
// bulut gerekmez; sonuçlar http://localhost:9000 adresinde durur.
// Ayrıntı: docs/sonar.md
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  collectAnalysisReport,
  scannerTaskId,
  scannerInvocation,
  waitForAnalysis,
} from "./sonar-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.SONAR_PORT ?? "9000";
if (!/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
  throw new Error("SONAR_PORT 1-65535 aralığında bir port olmalı.");
}
const HOST = process.env.SONAR_HOST_URL ?? `http://127.0.0.1:${PORT}`;
const NODE_MAXSPACE = process.env.SONAR_NODE_MAXSPACE ?? "3072";
if (
  !/^\d+$/.test(NODE_MAXSPACE) ||
  Number(NODE_MAXSPACE) < 128 ||
  Number(NODE_MAXSPACE) > 65536
) {
  throw new Error(
    "SONAR_NODE_MAXSPACE 128-65536 aralığında bir MiB değeri olmalı.",
  );
}
const SCANNER_JAVA_OPTS = process.env.SONAR_SCANNER_JAVA_OPTS ?? "-Xmx512m";
const SCANNER_PATH = process.env.SONAR_SCANNER_PATH
  ? path.resolve(root, process.env.SONAR_SCANNER_PATH)
  : undefined;
const SCANNER_HOME = path.resolve(
  root,
  process.env.SONAR_USER_HOME ?? "reports/quality/cache",
);
if (SCANNER_PATH) {
  fs.accessSync(SCANNER_PATH, fs.constants.X_OK);
  fs.mkdirSync(SCANNER_HOME, { recursive: true });
}
const CONTAINER = process.env.SONAR_CONTAINER ?? "derslik-sonarqube";
const NETWORK = process.env.SONAR_NETWORK ?? "derslik-sonar";
const DATA_VOLUME =
  process.env.SONAR_DATA_VOLUME ??
  (CONTAINER === "derslik-sonarqube"
    ? "derslik-sonar-data"
    : `${CONTAINER}-data`);
const EXTENSIONS_VOLUME =
  process.env.SONAR_EXTENSIONS_VOLUME ??
  (CONTAINER === "derslik-sonarqube"
    ? "derslik-sonar-extensions"
    : `${CONTAINER}-extensions`);
const PROJECT = "derslik";
// Yerel kapsayıcının yönetici parolası: ilk kurulumda rastgele üretilir ve
// git'e girmeyen reports/ klasöründe saklanır.
const secretFile = process.env.SONAR_ADMIN_FILE
  ? path.resolve(root, process.env.SONAR_ADMIN_FILE)
  : path.join(root, "reports", ".sonar-admin");
function adminPassword() {
  if (process.env.SONAR_ADMIN_PASSWORD) return process.env.SONAR_ADMIN_PASSWORD;
  if (fs.existsSync(secretFile))
    return fs.readFileSync(secretFile, "utf8").trim();
  const created = `Dx-${randomBytes(12).toString("base64url")}`;
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, created + "\n", { mode: 0o600 });
  return created;
}

const docker = (args, opts = {}) =>
  execFileSync("docker", args, { encoding: "utf8", ...opts }).trim();

function ensureDocker() {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe" });
  } catch {
    console.error("Docker çalışmıyor. Docker Desktop'ı açıp tekrar deneyin.");
    process.exit(1);
  }
}

function ensureServer() {
  try {
    docker(["network", "inspect", NETWORK], { stdio: "pipe" });
  } catch {
    docker(["network", "create", NETWORK]);
  }
  const state = spawnSync(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", CONTAINER],
    { encoding: "utf8" },
  );
  if (state.status !== 0) {
    console.log("SonarQube kuruluyor (ilk sefer birkaç dakika sürer)...");
    docker([
      "run",
      "-d",
      "--name",
      CONTAINER,
      "--network",
      NETWORK,
      "-p",
      `127.0.0.1:${PORT}:9000`,
      "-e",
      "SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true",
      // Disk doluluğu %90'ı geçince gömülü Elasticsearch açılmayı reddediyor.
      "-e",
      "SONAR_SEARCH_JAVAADDITIONALOPTS=-Dcluster.routing.allocation.disk.threshold_enabled=false",
      "-v",
      `${DATA_VOLUME}:/opt/sonarqube/data`,
      "-v",
      `${EXTENSIONS_VOLUME}:/opt/sonarqube/extensions`,
      "sonarqube:community",
    ]);
  } else if (state.stdout.trim() !== "true") {
    docker(["start", CONTAINER]);
  }
}

async function api(method, pathname, auth) {
  // Sunucu "UP" dedikten hemen sonra bağlantıyı bir iki kez kesebiliyor.
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(HOST + pathname, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: "Basic " + Buffer.from(auth).toString("base64"),
        },
      });
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${HOST}/api/system/status`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok && (await res.json()).status === "UP") return;
    } catch {
      // sunucu henüz dinlemiyor
    }
    const running = spawnSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", CONTAINER],
      { encoding: "utf8" },
    ).stdout.trim();
    if (running !== "true")
      throw new Error(
        `SonarQube kapandı. Nedeni için: docker logs ${CONTAINER}`,
      );
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("SonarQube 10 dakikada açılmadı: docker logs " + CONTAINER);
}

async function adminAuth() {
  const password = adminPassword();
  const current = `admin:${password}`;
  const me = await api("GET", "/api/users/current", current);
  if (me.ok && (await me.json()).isLoggedIn) return current;
  // İlk kurulum: varsayılan admin/admin parolasını değiştir.
  const res = await api(
    "POST",
    `/api/users/change_password?login=admin&previousPassword=admin&password=${encodeURIComponent(password)}`,
    "admin:admin",
  );
  if (!res.ok)
    throw new Error(
      "SonarQube yönetici girişi olmadı. Parolayı değiştirdiyseniz SONAR_ADMIN_PASSWORD ile verin; kapsayıcıyı sıfırlamak için docs/sonar.md.",
    );
  return current;
}

async function freshToken(auth) {
  const revoked = await api(
    "POST",
    "/api/user_tokens/revoke?name=derslik-scan",
    auth,
  );
  if (!revoked.ok)
    throw new Error(
      `SonarQube tarama tokenı iptal edilemedi: ${revoked.status}`,
    );
  const res = await api(
    "POST",
    "/api/user_tokens/generate?name=derslik-scan",
    auth,
  );
  if (!res.ok)
    throw new Error(`SonarQube tarama tokenı üretilemedi: ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error("SonarQube tarama tokenını döndürmedi.");
  return token;
}

async function summary(auth, taskId) {
  const request = (method, pathname) => api(method, pathname, auth);
  const analysisId = await waitForAnalysis(request, taskId);
  const report = await collectAnalysisReport(
    request,
    PROJECT,
    taskId,
    analysisId,
  );
  const output = path.join(root, "reports", "quality", "sonar-summary.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  for (const [metric, value] of Object.entries(report.metrics))
    console.log(`  ${metric}: ${value}`);
  console.log(`  Quality gate: ${report.qualityGate.status}`);
  if (!report.coverageReportImported)
    console.log(
      "  Test kapsamı ölçülmedi: Sonar'a coverage raporu aktarılmıyor.",
    );
  console.log(`  JSON rapor: ${output}`);
  console.log(`\nAyrıntılar: ${HOST}/dashboard?id=${PROJECT}`);
  if (report.qualityGate.status !== "OK") process.exitCode = 1;
}

ensureDocker();
ensureServer();
await waitUp();
const auth = await adminAuth();
const token = await freshToken(auth);

console.log("Analiz çalışıyor...");
const taskFile = path.join(root, ".scannerwork", "report-task.txt");
// Önceki taramanın task kimliği yeni sonuç sanılmasın.
fs.rmSync(taskFile, { force: true });
const invocation = scannerInvocation({
  root,
  host: HOST,
  container: CONTAINER,
  network: NETWORK,
  token,
  nodeMaxspace: NODE_MAXSPACE,
  javaOpts: SCANNER_JAVA_OPTS,
  scannerPath: SCANNER_PATH,
  userHome: SCANNER_HOME,
});
const scan = spawnSync(invocation.command, invocation.args, invocation.options);
if (scan.error) throw scan.error;
if (scan.status !== 0) process.exit(scan.status ?? 1);
await summary(auth, scannerTaskId(taskFile));

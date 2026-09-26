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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "http://localhost:9000";
const CONTAINER = "derslik-sonarqube";
const NETWORK = "derslik-sonar";
const PROJECT = "derslik";
// Yerel kapsayıcının yönetici parolası: ilk kurulumda rastgele üretilir ve
// git'e girmeyen reports/ klasöründe saklanır.
const secretFile = path.join(root, "reports", ".sonar-admin");
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
      "9000:9000",
      "-e",
      "SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true",
      // Disk doluluğu %90'ı geçince gömülü Elasticsearch açılmayı reddediyor.
      "-e",
      "SONAR_SEARCH_JAVAADDITIONALOPTS=-Dcluster.routing.allocation.disk.threshold_enabled=false",
      "-v",
      "derslik-sonar-data:/opt/sonarqube/data",
      "-v",
      "derslik-sonar-extensions:/opt/sonarqube/extensions",
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
      const res = await fetch(`${HOST}/api/system/status`);
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
  await api("POST", "/api/user_tokens/revoke?name=derslik-scan", auth);
  const res = await api(
    "POST",
    "/api/user_tokens/generate?name=derslik-scan",
    auth,
  );
  return (await res.json()).token;
}

async function summary(auth) {
  // Rapor sunucuda işlenene kadar bekle.
  for (let i = 0; i < 60; i++) {
    const ce = await (
      await api("GET", `/api/ce/component?component=${PROJECT}`, auth)
    ).json();
    if (!ce.queue?.length && ce.current?.status !== "IN_PROGRESS") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const keys = [
    "ncloc",
    "bugs",
    "vulnerabilities",
    "code_smells",
    "security_hotspots",
    "duplicated_lines_density",
    "cognitive_complexity",
    "sqale_index",
  ];
  const res = await api(
    "GET",
    `/api/measures/component?component=${PROJECT}&metricKeys=${keys.join(",")}`,
    auth,
  );
  const measures = (await res.json()).component?.measures ?? [];
  for (const m of measures) console.log(`  ${m.metric}: ${m.value}`);
  console.log(`\nAyrıntılar: ${HOST}/dashboard?id=${PROJECT}`);
}

ensureDocker();
ensureServer();
await waitUp();
const auth = await adminAuth();
const token = await freshToken(auth);

console.log("Analiz çalışıyor...");
const scan = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    NETWORK,
    "-e",
    `SONAR_HOST_URL=http://${CONTAINER}:9000`,
    "-e",
    `SONAR_TOKEN=${token}`,
    "-e",
    "NODE_OPTIONS=--max-old-space-size=6144",
    "-v",
    `${root}:/usr/src`,
    "sonarsource/sonar-scanner-cli",
    "-Dsonar.javascript.node.maxspace=6144",
  ],
  { stdio: "inherit" },
);
if (scan.status !== 0) process.exit(scan.status ?? 1);
await summary(auth);

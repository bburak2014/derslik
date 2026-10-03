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

/** Yerel SonarQube'ün taban adresi (yol "/" olan bir URL). Yönetici kimlik
 *  bilgisi bu adrese gider; bu yüzden yalnızca http(s) ve yerel makine
 *  (127.0.0.1, localhost, [::1]) kabul edilir, kullanıcı bilgisi, yol, sorgu
 *  ve parça içeremez. Dönen adresin şeması ve ana makinesi sabit değerlerden
 *  kurulur: ham girdi yalnızca (sayısal) port olarak taşınır. Geçersizse hata
 *  verir. */
export function localSonarBase(raw) {
  const invalid = () =>
    new Error(
      "SONAR_HOST_URL yalnızca yerel bir SonarQube olabilir: http(s) ve 127.0.0.1, localhost ya da [::1]; yol, kullanıcı bilgisi, sorgu ya da parça içermemeli.",
    );
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw invalid();
  let scheme;
  switch (url.protocol) {
    case "http:":
      scheme = "http";
      break;
    case "https:":
      scheme = "https";
      break;
    default:
      throw invalid();
  }
  let host;
  switch (url.hostname) {
    case "127.0.0.1":
      host = "127.0.0.1";
      break;
    case "localhost":
      host = "localhost";
      break;
    case "[::1]":
      host = "[::1]";
      break;
    default:
      throw invalid();
  }
  const port = url.port ? `:${Number(url.port)}` : "";
  return new URL(`${scheme}://${host}${port}/`);
}

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
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
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

/** Kilit klasörünü atomik olarak alır. Alındıysa bırakma işlevini, klasör
 *  zaten varsa null döndürür; başka her hata fırlatılır. */
function tryCreateLock(lockDir, ownerFile, pid) {
  try {
    fs.mkdirSync(lockDir);
    fs.writeFileSync(ownerFile, String(pid));
    return () => {
      if (readOwner(ownerFile) === pid)
        fs.rmSync(lockDir, { recursive: true, force: true });
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return null;
  }
}

/** Kilit bayat mı: sahibi yazılmamışsa yaşına, yazılmışsa sahibin yaşayıp
 *  yaşamadığına bakılır. */
function isStale(lockDir, owner, isAlive, now) {
  return owner === null
    ? lockAge(lockDir, now) > OWNERLESS_STALE_MS
    : !isAlive(owner);
}

/** Geri alma muteksini alır. Başkası tutuyorsa false döner; tutan çökmüş
 *  (30 saniyeden eski) ise muteksi de temizler ki sonraki tur alabilsin. */
function tryTakeReclaimMutex(reclaimDir, now) {
  try {
    fs.mkdirSync(reclaimDir);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (lockAge(reclaimDir, now) > OWNERLESS_STALE_MS)
      fs.rmSync(reclaimDir, { recursive: true, force: true });
    return false;
  }
}

/** Geri alma muteksi elde: bayat kararını yeniden kontrol eder, hâlâ bayat ve
 *  sahibi değişmediyse kilidi siler; muteksi her durumda bırakır. */
function reclaimStaleLock(lockDir, ownerFile, reclaimDir, owner, isAlive, now) {
  try {
    const currentOwner = readOwner(ownerFile);
    const stale = isStale(lockDir, currentOwner, isAlive, now);
    if (stale && currentOwner === owner)
      fs.rmSync(lockDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(reclaimDir, { recursive: true, force: true });
  }
}

/** Bekleme turu: süre dolduysa hata verir, ilk beklemede onWait'i çağırır,
 *  sonra bir yoklama aralığı uyur. */
function createWaiter({ lockDir, timeoutMs, pollMs, now, sleep, onWait }) {
  const started = now();
  let waited = false;
  return async (owner) => {
    if (now() - started >= timeoutMs)
      throw new Error(
        `Sonar kapısı: kilit ${Math.round(timeoutMs / 60_000)} dakikada alınamadı (${lockDir}).`,
      );
    if (!waited) {
      onWait(owner);
      waited = true;
    }
    await sleep(pollMs);
  };
}

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
  const reclaimDir = `${lockDir}.reclaim`;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const wait = createWaiter({ lockDir, timeoutMs, pollMs, now, sleep, onWait });
  for (;;) {
    const release = tryCreateLock(lockDir, ownerFile, pid);
    if (release) return release;
    const owner = readOwner(ownerFile);
    // İki bekleyici aynı anda bayat kilidi silip almasın diye geri alma muteksi
    // kullanılır. Muteks başkasındaysa bu tur kilit beklenir.
    if (
      isStale(lockDir, owner, isAlive, now) &&
      tryTakeReclaimMutex(reclaimDir, now)
    ) {
      reclaimStaleLock(lockDir, ownerFile, reclaimDir, owner, isAlive, now);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- kilit yoklaması: her tur kilit durumuna yeniden bakar ve sonraki tura kadar bekler, paralel bekleme kilidi açmaz.
    await wait(owner); // NOSONAR: kilit yoklaması: her tur kilit durumuna yeniden bakar ve sonraki tura kadar bekler, paralel bekleme kilidi açmaz
  }
}

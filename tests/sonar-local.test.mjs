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

test("bayat sayılan kilidi bu arada başkası aldıysa silinmez", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  lockHeldBy(lock, 1111);
  await assert.rejects(
    acquireLock(lock, {
      pid: 2222,
      isAlive: (pid) => {
        if (pid === 1111) {
          // Başkası kilidi aldı.
          fs.writeFileSync(path.join(lock, "pid"), "3333");
          return false;
        }
        return true;
      },
      timeoutMs: 0,
    }),
    /kilit/,
  );
  // Başkasının kilidi hala orada.
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "3333");
  // Geri alma mutex'i temizlenmiş.
  assert.equal(fs.existsSync(`${lock}.reclaim`), false);
});

test("çökmüş geri alma kilidi 30 saniye sonra temizlenir", async (t) => {
  const lock = path.join(tempDir(t), "sonar-gate.lock");
  lockHeldBy(lock, 1111);
  const reclaimDir = `${lock}.reclaim`;
  fs.mkdirSync(reclaimDir);
  // Mutex 60 saniye önce oluşturulmuş (çökmüş).
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(reclaimDir, old, old);

  const release = await acquireLock(lock, {
    pid: 2222,
    isAlive: () => false,
    sleep: async () => {},
    timeoutMs: 5_000,
  });
  assert.equal(fs.readFileSync(path.join(lock, "pid"), "utf8"), "2222");
  release();
  assert.equal(fs.existsSync(lock), false);
});

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
// Ortamın PATH'i bilerek yalnızca sahte node ve git klasörlerini içerir; Node
// komut adını bu PATH'ten çözdüğü için "sh" mutlak yolla verilir.
const runHook = (box, options) =>
  spawnSync("/bin/sh", [hook], { cwd: box.repo, encoding: "utf8", env: env(box, options) });
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
  const inRepo = spawnSync("/bin/sh", ["-c", prepare], { cwd: box.repo, env: env(box, {}) });
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
    spawnSync("/bin/sh", ["-c", prepare], { cwd: plain, env: env(box, {}) }).status,
    0,
  );
});

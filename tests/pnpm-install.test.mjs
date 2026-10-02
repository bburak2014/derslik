import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// scripts/pnpm-install.mjs'in karakterizasyon testi. Gerçek pnpm çalışmaz, ağ
// kullanılmaz: sahte bir "pnpm" (Node betiği) senaryoya göre ndjson olayları
// yazar, çıkış koduyla ya da sinyalle biter. Betiğin çıkış kodu, çıktısı,
// rapor dosyası ve yazdığı node_modules/.sites-install.json sınanır.
const script = path.resolve(
  import.meta.dirname,
  "..",
  "scripts",
  "pnpm-install.mjs",
);

const FAKE_PNPM = `
import { writeFileSync } from "node:fs";
const cwd = process.cwd();
const emit = (event) => console.log(JSON.stringify(event));
const stats = (added) => emit({ name: "pnpm:stats", prefix: cwd, added });
const done = () => emit({ name: "pnpm:stage", stage: "importing_done", prefix: cwd });
const progress = (status, packageId, requester = cwd) =>
  emit({ name: "pnpm:progress", requester, status, packageId });
const fail = (code, message, name = "pnpm") =>
  emit({ level: "error", name, err: { code, message } });
writeFileSync(
  process.env.FAKE_ARGS_FILE,
  JSON.stringify({
    args: process.argv.slice(2),
    reportPath: process.env.SITES_INSTALL_REPORT_PATH ?? null,
  }),
);
const scenarios = {
  success() {
    progress("fetched", "a@1");
    progress("found_in_store", "b@1");
    progress("found_in_store", "a@1");
    progress("fetched", "b@1");
    progress("found_in_store", "c@1", "/elsewhere");
    emit({ level: "warn", message: "careful" });
    emit({ level: "info", message: "fyi" });
    emit({ level: "debug", message: "hidden" });
    emit({ name: "pnpm:lifecycle", line: "building x" });
    console.log("raw text line");
    console.log("null");
    stats(3);
    done();
  },
  noAdded() { progress("fetched", "a@1"); stats(0); done(); },
  incomplete() { progress("fetched", "a@1"); stats(2); },
  emptyPackage() { progress("fetched", ""); stats(2); done(); },
  numericPackage() { progress("found_in_store", 5); stats(2); done(); },
  operational() { fail("ERR_PNPM_NO_LOCKFILE", "no lock"); process.exit(1); },
  other() { fail("ERR_X", "bad"); process.exit(2); },
  otherThenOperational() {
    fail("ERR_X", "bad");
    fail("ERR_PNPM_FETCH_503", "later");
    process.exit(1);
  },
  operationalThenOther() {
    fail("ERR_PNPM_FETCH_503", "net");
    fail("ERR_PNPM_FETCH_503", "x", "other");
    process.exit(1);
  },
  silent() { process.exit(3); },
  failedWithProgress() { progress("fetched", "a@1"); stats(2); done(); process.exit(4); },
  childSignal() { process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 5000); },
  parentSignal() {
    progress("fetched", "a@1");
    stats(1);
    done();
    process.kill(process.ppid, process.env.FAKE_SIGNAL);
    setTimeout(() => process.exit(0), 300);
  },
  parentSignalThenFail() {
    process.kill(process.ppid, "SIGINT");
    setTimeout(() => process.exit(5), 300);
  },
};
scenarios[process.env.FAKE_SCENARIO]?.();
`;

const LOCK = "lockfileVersion: '9.0'\n";

// Her test kendi geçici klasöründe çalışır; sonunda silinir.
function sandbox(t, { vinext = true, lock = true } = {}) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "derslik-pnpm-install-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, "project");
  fs.mkdirSync(path.join(cwd, "node_modules", ".bin"), { recursive: true });
  if (vinext)
    fs.writeFileSync(
      path.join(cwd, "node_modules", ".bin", "vinext"),
      "#!/bin/sh\n",
      {
        mode: 0o755,
      },
    );
  if (lock) fs.writeFileSync(path.join(cwd, "pnpm-lock.yaml"), LOCK);
  const fake = path.join(dir, "fake-pnpm.mjs");
  fs.writeFileSync(fake, FAKE_PNPM);
  return {
    dir,
    cwd,
    fake,
    store: path.join(dir, "store"),
    argsFile: path.join(dir, "args.json"),
    report: path.join(dir, "report.json"),
    installRecord: path.join(cwd, "node_modules", ".sites-install.json"),
  };
}

function run(args, { cwd, env = {}, stdin = "" }) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(stdin);
  return new Promise((resolve) => {
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
}

// Kurulum argümanları: tohum, kapsam, depo durumu, depo yolu, çalıştırılacak
// dosya (Node) ve onun önek argümanları (sahte pnpm).
function install(
  box,
  scenario,
  { env = {}, report = false, args, prefix = [] } = {},
) {
  if (report) fs.writeFileSync(box.report, "x".repeat(300));
  return run(
    args ?? [
      "seed_used",
      "project",
      "created",
      box.store,
      process.execPath,
      box.fake,
      ...prefix,
    ],
    {
      cwd: box.cwd,
      env: {
        FAKE_SCENARIO: scenario,
        FAKE_ARGS_FILE: box.argsFile,
        ...(report ? { SITES_INSTALL_REPORT_PATH: box.report } : {}),
        ...env,
      },
    },
  );
}

const reportOf = (box) => fs.readFileSync(box.report, "utf8");
const base = {
  version: 1,
  cache_seed: "seed_used",
  store_scope: "project",
  store_state: "created",
};
const line = (object) => `${JSON.stringify(object)}\n`;

test("geçersiz kurulum argümanları 64 ile biter ve hiçbir şey çalıştırmaz", async (t) => {
  const box = sandbox(t);
  const exec = process.execPath;
  const cases = [
    [],
    ["bogus", "project", "created", box.store, exec],
    ["seed_used", "unknown", "created", box.store, exec],
    ["seed_used", "project", "weird", box.store, exec],
    ["seed_used", "project", "unavailable", box.store, exec],
    ["seed_used", "project", "created", "relative/store", exec],
    ["seed_used", "project", "created"],
    ["seed_used", "project", "created", box.store],
  ];
  for (const args of cases) {
    const result = await run(args, { cwd: box.cwd });
    assert.deepEqual(
      result,
      {
        code: 64,
        signal: null,
        stdout: "",
        stderr: "Invalid pnpm installation arguments.\n",
      },
      JSON.stringify(args),
    );
  }
  assert.equal(fs.existsSync(box.argsFile), false);
});

test("--report-store geçersiz değerde 64 ile sessiz biter", async (t) => {
  const box = sandbox(t);
  for (const args of [
    ["nope", "project", "created", "1"],
    ["seed_used", "galaxy", "created", "1"],
    ["seed_used", "project", "weird", "1"],
  ]) {
    const result = await run(["--report-store", ...args], { cwd: box.cwd });
    assert.deepEqual(
      result,
      { code: 64, signal: null, stdout: "", stderr: "" },
      args.join(" "),
    );
  }
});

test("--report-store raporu dosyaya, istenirse stdout'a yazar; dosya yoksa yalnızca stdout", async (t) => {
  const box = sandbox(t);
  const unknown = {
    ...base,
    store_scope: "unknown",
    store_state: "unavailable",
  };
  const stdoutOnly = await run(
    ["--report-store", "seed_used", "unknown", "unavailable", "1"],
    { cwd: box.cwd },
  );
  assert.deepEqual(stdoutOnly, {
    code: 0,
    signal: null,
    stdout: line(unknown),
    stderr: "",
  });

  const reused = {
    ...base,
    cache_seed: "not_applicable",
    store_scope: "workspace",
    store_state: "reused",
  };
  fs.writeFileSync(box.report, "x".repeat(300));
  const fileOnly = await run(
    ["--report-store", "not_applicable", "workspace", "reused", "0"],
    { cwd: box.cwd, env: { SITES_INSTALL_REPORT_PATH: box.report } },
  );
  assert.deepEqual(fileOnly, { code: 0, signal: null, stdout: "", stderr: "" });
  assert.equal(reportOf(box), line(reused));

  const seeded = {
    ...base,
    cache_seed: "seed_unavailable",
    store_state: "seeded",
  };
  fs.writeFileSync(box.report, "x".repeat(300));
  const both = await run(
    ["--report-store", "seed_unavailable", "project", "seeded", "1"],
    { cwd: box.cwd, env: { SITES_INSTALL_REPORT_PATH: box.report } },
  );
  assert.deepEqual(both, {
    code: 0,
    signal: null,
    stdout: line(seeded),
    stderr: "",
  });
  assert.equal(reportOf(box), line(seeded));

  const missing = await run(
    ["--report-store", "seed_used", "project", "created", "1"],
    {
      cwd: box.cwd,
      env: { SITES_INSTALL_REPORT_PATH: path.join(box.dir, "yok.json") },
    },
  );
  assert.deepEqual(missing, {
    code: 0,
    signal: null,
    stdout: line(base),
    stderr: "",
  });
  assert.equal(fs.existsSync(path.join(box.dir, "yok.json")), false);
});

test("--hold-install-locks kilit dosyası yoksa 'unavailable' yanıtlar, serbest bırakmayı onaylar", async (t) => {
  const box = sandbox(t);
  const result = await run(["--hold-install-locks", "", "", "0"], {
    cwd: box.cwd,
    stdin: "shared\nrelease-shared\nbogus\n",
  });
  assert.deepEqual(result, {
    code: 0,
    signal: null,
    stdout: "unavailable\nunavailable\nreleased\nunavailable\n",
    stderr: "",
  });
});

test("başarılı kurulum pnpm'e doğru argümanları verir, çıktıyı süzer, raporu ve .sites-install.json'u yazar", async (t) => {
  const box = sandbox(t);
  const result = await install(box, "success", {
    report: true,
    prefix: ["-r"],
  });
  assert.deepEqual(result, {
    code: 0,
    signal: null,
    stdout:
      "careful\nfyi\nbuilding x\nraw text line\n" +
      "[sites] pnpm reused 0 packages and downloaded 2\n" +
      "[sites] dependency setup passed\n",
    stderr: "",
  });
  const seen = JSON.parse(fs.readFileSync(box.argsFile, "utf8"));
  // Rapor yolu pnpm'e geçmez.
  assert.equal(seen.reportPath, null);
  assert.deepEqual(seen.args, [
    "-r",
    "install",
    "--prod=false",
    "--ignore-scripts=false",
    "--frozen-lockfile",
    "--prefer-offline",
    "--store-dir",
    box.store,
    "--cache-dir",
    path.join(box.store, "policy-cache"),
    "--fetch-retries=0",
    "--fetch-timeout=30000",
    "--network-concurrency=1",
    "--reporter=ndjson",
    "--package-import-method=clone-or-copy",
  ]);
  assert.equal(
    reportOf(box),
    line({ ...base, packages_reused: 0, packages_downloaded: 2 }),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(box.installRecord, "utf8")), {
    package_manager: "pnpm@11.25.0",
    lockfile_sha256: createHash("sha256").update(LOCK).digest("hex"),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  });
  assert.match(fs.readFileSync(box.installRecord, "utf8"), /\n$/);
});

test("çalışma alanı deposu ve öneksiz çağrı kabul edilir", async (t) => {
  const box = sandbox(t);
  const result = await install(box, "success", {
    args: [
      "seed_lockfile_mismatch",
      "workspace",
      "seeded",
      box.store,
      process.execPath,
      box.fake,
    ],
  });
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout.endsWith("[sites] dependency setup passed\n"),
    true,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(box.argsFile, "utf8")).args[0],
    "install",
  );
});

test("sayaçlar yalnızca tam ve geçerli bir kurulumda rapora girer", async (t) => {
  for (const scenario of [
    "noAdded",
    "incomplete",
    "emptyPackage",
    "numericPackage",
  ]) {
    const box = sandbox(t);
    const result = await install(box, scenario, { report: true });
    assert.deepEqual(
      result,
      {
        code: 0,
        signal: null,
        stdout: "[sites] dependency setup passed\n",
        stderr: "",
      },
      scenario,
    );
    assert.equal(reportOf(box), line(base), scenario);
    assert.equal(fs.existsSync(box.installRecord), true, scenario);
  }
});

test("pnpm hatası: operasyonel kod 70, diğer her hata 65; ilk 65 kalır", async (t) => {
  const cases = [
    ["operational", 70, "no lock\n"],
    ["other", 65, "bad\n"],
    ["otherThenOperational", 65, "bad\nlater\n"],
    ["operationalThenOther", 65, "net\nx\n"],
    ["silent", 65, ""],
    ["failedWithProgress", 65, ""],
  ];
  for (const [scenario, code, stderr] of cases) {
    const box = sandbox(t);
    const result = await install(box, scenario, { report: true });
    assert.deepEqual(
      result,
      { code, signal: null, stdout: "", stderr },
      scenario,
    );
    assert.equal(reportOf(box), line(base), scenario);
    assert.equal(fs.existsSync(box.installRecord), false, scenario);
  }
});

test("pnpm başlatılamazsa ENOENT 127, diğer başlatma hataları 65 verir", async (t) => {
  const box = sandbox(t);
  const missing = await install(box, "success", {
    args: [
      "seed_used",
      "project",
      "created",
      box.store,
      path.join(box.dir, "yok", "pnpm"),
    ],
  });
  assert.deepEqual(missing, {
    code: 127,
    signal: null,
    stdout: "",
    stderr: "Unable to start pnpm.\n",
  });
  const notExecutable = path.join(box.dir, "not-executable");
  fs.writeFileSync(notExecutable, "#!/bin/sh\n", { mode: 0o644 });
  const denied = await install(box, "success", {
    args: ["seed_used", "project", "created", box.store, notExecutable],
  });
  assert.deepEqual(denied, {
    code: 65,
    signal: null,
    stdout: "",
    stderr: "Unable to start pnpm.\n",
  });
  assert.equal(fs.existsSync(box.installRecord), false);
});

test("vinext ya da kilit dosyası yoksa başarılı pnpm bile 65 ile biter ve kayıt yazılmaz", async (t) => {
  for (const missing of [{ vinext: false }, { lock: false }]) {
    const box = sandbox(t, missing);
    const result = await install(box, "success", { report: true });
    assert.deepEqual(
      result,
      {
        code: 65,
        signal: null,
        stdout: "careful\nfyi\nbuilding x\nraw text line\n",
        stderr:
          "Dependency setup did not produce a usable Vinext installation.\n",
      },
      JSON.stringify(missing),
    );
    assert.equal(reportOf(box), line(base), JSON.stringify(missing));
    assert.equal(
      fs.existsSync(box.installRecord),
      false,
      JSON.stringify(missing),
    );
  }
});

test("sinyal: çocuk sinyalle ölürse betik de aynı sinyalle sonlanır", async (t) => {
  const box = sandbox(t);
  const result = await install(box, "childSignal", { report: true });
  assert.deepEqual(result, {
    code: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: "",
  });
  assert.equal(reportOf(box), line(base));
  assert.equal(fs.existsSync(box.installRecord), false);
});

test("sinyal: betik pnpm çalışırken sinyal alırsa pnpm bitince sinyalle sonlanır, kurulum kaydı yazılmaz", async (t) => {
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    const box = sandbox(t);
    const result = await install(box, "parentSignal", {
      report: true,
      env: { FAKE_SIGNAL: signal },
    });
    assert.deepEqual(
      result,
      { code: null, signal, stdout: "", stderr: "" },
      signal,
    );
    assert.equal(reportOf(box), line(base), signal);
    assert.equal(fs.existsSync(box.installRecord), false, signal);
  }
  // pnpm hata koduyla bitse de alınan sinyal kazanır.
  const box = sandbox(t);
  const failed = await install(box, "parentSignalThenFail", { report: true });
  assert.deepEqual(failed, {
    code: null,
    signal: "SIGINT",
    stdout: "",
    stderr: "",
  });
});

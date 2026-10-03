import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateGate, fetchGateInputs } from "../scripts/sonar-gate.mjs";
import { cloudRequest, cloudScope } from "../scripts/sonar-cloud-gate.mjs";

// CI'daki SonarCloud kapısı: kapsam (dal ya da çekme isteği), ortak API
// okuması ve token yokken güvenli çıkış. Hiçbir test ağa çıkmaz.
const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "sonar-cloud-gate.mjs");

test("main'e push: kapsam dal adıdır", () => {
  assert.equal(
    cloudScope({
      eventName: "push",
      ref: "refs/heads/main",
      refName: "main",
    }),
    "branch=main",
  );
});

test("çekme isteği: kapsam GITHUB_REF'teki numaradır", () => {
  assert.equal(
    cloudScope({
      eventName: "pull_request",
      ref: "refs/pull/12/merge",
      refName: "12/merge",
    }),
    "pullRequest=12",
  );
});

test("dal adındaki özel karakterler kodlanır", () => {
  assert.equal(
    cloudScope({ eventName: "push", refName: "feature/a&b" }),
    "branch=feature%2Fa%26b",
  );
});

test("bayraklar GitHub ortamından önce gelir", () => {
  const github = {
    eventName: "pull_request",
    ref: "refs/pull/12/merge",
    refName: "12/merge",
  };
  assert.equal(cloudScope({ ...github, branch: "main" }), "branch=main");
  assert.equal(cloudScope({ ...github, pullRequest: "7" }), "pullRequest=7");
  assert.equal(
    cloudScope({ eventName: "push", refName: "main", pullRequest: "7" }),
    "pullRequest=7",
  );
});

test("kapsam belirlenemezse ya da bayraklar çelişirse hata verilir", () => {
  assert.throws(() => cloudScope({}), /dal ya da çekme isteği/);
  assert.throws(() => cloudScope({ eventName: "push", refName: "" }), /dal/);
  assert.throws(
    () => cloudScope({ eventName: "pull_request", ref: "refs/heads/main" }),
    /ekme isteği/,
  );
  assert.throws(
    () => cloudScope({ eventName: "pull_request", refName: "12/merge" }),
    /ekme isteği/,
  );
  assert.throws(() => cloudScope({ pullRequest: "abc" }), /numara/);
  assert.throws(() => cloudScope({ pullRequest: "0" }), /numara/);
  assert.throws(() => cloudScope({ branch: "main", pullRequest: "7" }), /biri/);
});

const pageOf = (pathname) => Number(/[?&]p=(\d+)/.exec(pathname)[1]);

// Sahte "json": istenen yolları kaydeder, yanıtı yola göre üretir.
function fakeApi(answer) {
  const urls = [];
  return {
    urls,
    json: async (pathname) => {
      urls.push(pathname);
      return answer(pathname);
    },
  };
}
const quiet = (pathname) => {
  if (pathname.startsWith("/api/issues/search"))
    return { issues: [], paging: { total: 0 } };
  if (pathname.startsWith("/api/hotspots/search"))
    return { hotspots: [], paging: { total: 0 } };
  return {
    component: {
      measures: [{ metric: "duplicated_lines_density", value: "1.5" }],
    },
  };
};

test("yerel okuma eski istekleri birebir yapar (components=, kapsam yok)", async () => {
  const api = fakeApi(quiet);
  const result = await fetchGateInputs(api.json, {
    project: "derslik",
    issueComponentParam: "components",
  });
  assert.deepEqual(api.urls, [
    "/api/issues/search?components=derslik&resolved=false&ps=500&p=1",
    "/api/hotspots/search?projectKey=derslik&status=TO_REVIEW&ps=500&p=1",
    "/api/measures/component?component=derslik&metricKeys=duplicated_lines_density",
  ]);
  assert.deepEqual(result, { issues: [], hotspots: [], duplication: 1.5 });
});

test("SonarCloud okuması componentKeys kullanır, kapsamı üç isteğe ekler", async () => {
  const api = fakeApi(quiet);
  await fetchGateInputs(api.json, {
    project: "bburak2014_derslik",
    issueComponentParam: "componentKeys",
    scope: "pullRequest=12",
  });
  assert.deepEqual(api.urls, [
    "/api/issues/search?componentKeys=bburak2014_derslik&resolved=false&ps=500&p=1&pullRequest=12",
    "/api/hotspots/search?projectKey=bburak2014_derslik&status=TO_REVIEW&ps=500&p=1&pullRequest=12",
    "/api/measures/component?component=bburak2014_derslik&metricKeys=duplicated_lines_density&pullRequest=12",
  ]);
});

test("sayfalar kapsamla birlikte baştan sona okunur", async () => {
  const api = fakeApi((pathname) => {
    if (pathname.startsWith("/api/issues/search"))
      return {
        issues:
          pageOf(pathname) === 1
            ? [{ key: "a" }, { key: "b" }]
            : [{ key: "c" }],
        paging: { total: 3 },
      };
    if (pathname.startsWith("/api/hotspots/search"))
      return {
        hotspots: pageOf(pathname) === 1 ? [{ key: "h1" }] : [{ key: "h2" }],
        paging: { total: 2 },
      };
    return quiet(pathname);
  });
  const result = await fetchGateInputs(api.json, {
    project: "p",
    issueComponentParam: "componentKeys",
    scope: "branch=main",
  });
  assert.deepEqual(
    result.issues.map((i) => i.key),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    result.hotspots.map((h) => h.key),
    ["h1", "h2"],
  );
  const paged = api.urls.filter((u) => /[?&]p=2&branch=main$/.test(u));
  assert.equal(paged.length, 2);
});

test("bozuk, eksik ya da hatalı yanıt kapıyı geçirmez", async () => {
  const options = { project: "p", issueComponentParam: "componentKeys" };
  await assert.rejects(
    fetchGateInputs(async () => ({}), options),
    /beklenmeyen biçimde/,
  );
  await assert.rejects(
    fetchGateInputs(
      fakeApi((pathname) =>
        pathname.startsWith("/api/issues/search")
          ? { issues: [], paging: { total: 4 } }
          : quiet(pathname),
      ).json,
      options,
    ),
    /liste eksik geldi/,
  );
  await assert.rejects(
    fetchGateInputs(async () => {
      throw new Error("SonarQube API 401: /api/issues/search");
    }, options),
    /401/,
  );
  // Ölçü yoksa tekrar oranı NaN gelir; kapı bunu "geçti" saymaz.
  const noMeasure = await fetchGateInputs(
    fakeApi((pathname) =>
      pathname.startsWith("/api/measures/")
        ? { component: { measures: [] } }
        : quiet(pathname),
    ).json,
    options,
  );
  assert.throws(() => evaluateGate(noMeasure), /kod tekrarı/);
});

test("SonarCloud isteği Bearer token ile ve zaman aşımıyla gider", async () => {
  const calls = [];
  const request = cloudRequest("gizli-token", {
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    },
  });
  await request("GET", "/api/ce/task?id=AX1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sonarcloud.io/api/ce/task?id=AX1");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer gizli-token");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("geçici bağlantı hatası birkaç kez denenir, sonunda hata verilir", async () => {
  let attempts = 0;
  const sleeps = [];
  const options = (failures) => ({
    attempts: 3,
    sleep: async (ms) => sleeps.push(ms),
    fetchFn: async () => {
      attempts++;
      if (attempts <= failures) throw new Error("ağ koptu");
      return { ok: true };
    },
  });
  const recovered = await cloudRequest("t", options(2))("GET", "/x");
  assert.deepEqual(recovered, { ok: true });
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);

  attempts = 0;
  await assert.rejects(cloudRequest("t", options(5))("GET", "/x"), /ağ koptu/);
  assert.equal(attempts, 3);
});

// Betik alt süreçte çalışır: token ya da kapsam eksikse ağa hiç çıkmadan 1.
function runGate(env, file = script) {
  return spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
}

test("SONAR_TOKEN yoksa betik Türkçe bir mesajla 1 ile çıkar", () => {
  for (const env of [{}, { SONAR_TOKEN: "" }, { SONAR_TOKEN: "  " }]) {
    const run = runGate(env);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /SONAR_TOKEN/);
    assert.equal(run.stdout, "");
  }
});

test("kapsam belirlenemezse betik ağa çıkmadan 1 ile çıkar", () => {
  const run = runGate({ SONAR_TOKEN: "deneme" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /dal ya da çekme isteği/);
});

test("betik sembolik bağ üzerinden de çalışır (sessizce atlanmaz)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "derslik-cloud-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, "gate.mjs");
  fs.symlinkSync(script, link);
  const run = runGate({}, link);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SONAR_TOKEN/);
});

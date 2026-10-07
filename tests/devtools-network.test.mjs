import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMessageSend,
  analyzeWindow,
  duplicateApiGets,
  requestLabel,
} from "../scripts/devtools/network-audit.mjs";

const req = (method, url, at) => ({ method, url, at });
const cleanWindow = () => ({
  requests: [],
  responses: [],
  failures: [],
  console: [],
  websockets: { created: [], sent: [], received: [], closed: [] },
});

test("istek etiketi query string ile birlikte okunur", () => {
  assert.equal(
    requestLabel(req("GET", "http://localhost:3000/api/backend/inbox?limit=20", 1)),
    "GET /api/backend/inbox?limit=20",
  );
});

test("aynı API GET kısa aralıkta iki kez atılırsa DevTools denetimi yakalar", () => {
  const requests = [
    req("GET", "http://localhost:3000/api/backend/workspaces/w/snapshot", 100),
    req("GET", "http://localhost:3000/api/backend/workspaces/w/snapshot", 350),
    req("GET", "http://localhost:3000/_next/static/app.js", 400),
  ];
  const duplicates = duplicateApiGets(requests, 800);
  assert.equal(duplicates.length, 1);
  assert.match(requestLabel(duplicates[0].request), /snapshot/);
});

test("aynı GET yeterince sonra geldiyse polling olarak kabul edilir", () => {
  const requests = [
    req("GET", "http://localhost:3000/api/backend/inbox", 100),
    req("GET", "http://localhost:3000/api/backend/inbox", 5000),
  ];
  assert.deepEqual(duplicateApiGets(requests, 800), []);
});

test("genel DevTools denetimi HTTP, ağ, console ve duplicate GET sorunlarını birlikte raporlar", () => {
  const window = cleanWindow();
  window.requests.push(
    req("GET", "http://localhost:3000/api/backend/inbox", 100),
    req("GET", "http://localhost:3000/api/backend/inbox", 200),
  );
  window.responses.push({
    url: "http://localhost:3000/api/backend/workspaces/w/snapshot",
    status: 503,
  });
  window.failures.push({
    url: "http://localhost:3000/api/backend/files/x",
    errorText: "net::ERR_FAILED",
  });
  window.console.push({ level: "error", text: "Unhandled rejection" });
  const result = analyzeWindow(window);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((x) => x.includes("HTTP 503")));
  assert.ok(result.problems.some((x) => x.includes("Ağ hatası")));
  assert.ok(result.problems.some((x) => x.includes("Tekrarlı GET")));
  assert.ok(result.problems.some((x) => x.includes("Console error")));
});

test("statik dosya 404'ü API denetimini düşürmez", () => {
  const window = cleanWindow();
  window.responses.push({
    url: "http://localhost:3000/favicon-does-not-exist.ico",
    status: 404,
  });
  assert.equal(analyzeWindow(window).ok, true);
});

test("mesaj gönderimi: tek POST ve gönderende thread/inbox refetch yoksa geçer", () => {
  const window = cleanWindow();
  window.requests.push(
    req(
      "POST",
      "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1",
      100,
    ),
  );
  window.websockets.received.push({ payload: '{"type":"message"}', at: 120 });
  const result = analyzeMessageSend(window);
  assert.equal(result.ok, true);
  assert.equal(result.websocketFramesReceived, 1);
});

test("mesaj gönderimi: POST sonrası thread ve inbox GET'leri regresyon olarak yakalanır", () => {
  const window = cleanWindow();
  window.requests.push(
    req(
      "POST",
      "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1",
      100,
    ),
    req(
      "GET",
      "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1",
      130,
    ),
    req("GET", "http://localhost:3000/api/backend/inbox", 150),
  );
  const result = analyzeMessageSend(window);
  assert.equal(result.ok, false);
  assert.equal(result.refetches.length, 2);
  assert.ok(result.problems.every((x) => x.includes("gereksiz GET")));
});

test("mesaj gönderimi iki POST üretirse çift gönderim yakalanır", () => {
  const window = cleanWindow();
  window.requests.push(
    req(
      "POST",
      "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1",
      100,
    ),
    req(
      "POST",
      "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1",
      120,
    ),
  );
  const result = analyzeMessageSend(window);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /1 POST.*2/);
});

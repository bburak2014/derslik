import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  analyzeMessageSend,
  analyzeWindow,
  DevtoolsRecorder,
  duplicateApiGets,
  isApiUrl,
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

test("geçersiz ve API dışı URL denetime alınmaz, istek etiketi ham URL'yi korur", () => {
  assert.equal(isApiUrl("not a URL"), false);
  assert.equal(isApiUrl("http://localhost:3000/api"), false);
  assert.equal(isApiUrl("http://localhost:3000/assets/api/icon.svg"), false);
  assert.equal(isApiUrl("https://derslik.test/api/backend/inbox"), true);
  assert.equal(requestLabel(req("GET", "not a URL", 1)), "GET not a URL");

  const window = cleanWindow();
  window.requests.push(req("GET", "not a URL", 1), req("GET", "not a URL", 2));
  window.responses.push({ url: "not a URL", status: 500 });
  window.failures.push({ url: "not a URL", errorText: "invalid URL" });
  assert.equal(analyzeWindow(window).ok, true);
});

test("duplicate GET denetimi yöntem ve query ayrımını korur, sınırda tekrarları yakalar", () => {
  const url = "http://localhost:3000/api/backend/inbox";
  const first = req("GET", `${url}?limit=20`, 100);
  const repeated = req("GET", `${url}?limit=20`, 900);
  const requests = [
    first,
    req("POST", `${url}?limit=20`, 200),
    req("GET", `${url}?limit=50`, 300),
    repeated,
  ];
  assert.deepEqual(duplicateApiGets(requests), [{ previous: first, request: repeated }]);
  assert.deepEqual(duplicateApiGets(requests, 799), []);

  const window = cleanWindow();
  window.requests.push(...requests);
  assert.equal(analyzeWindow(window, { duplicateWindowMs: 799 }).ok, true);
  assert.equal(analyzeWindow(window, { duplicateWindowMs: 800 }).ok, false);
});

test("başarılı API yanıtı, statik yükleme hatası ve bilgi mesajı denetimi düşürmez", () => {
  const window = cleanWindow();
  window.responses.push({ url: "http://localhost:3000/api/backend/inbox", status: 200 });
  window.failures.push({ url: "http://localhost:3000/favicon.ico", errorText: "net::ERR_FAILED" });
  window.console.push({ level: "info", text: "loaded" });
  const result = analyzeWindow(window);
  assert.deepEqual(result, {
    ok: true,
    problems: [],
    duplicates: [],
    responses: [],
    failures: [],
    console: [],
  });
});

test("mesaj POST'u yoksa GET ve ilgisiz POST istekleri gönderim sayılmaz", () => {
  const window = cleanWindow();
  window.requests.push(
    req("GET", "http://localhost:3000/api/backend/workspaces/ws/messages/thread-1", 1),
    req("POST", "http://localhost:3000/api/backend/files", 2),
    req("POST", "not a URL", 3),
  );
  const result = analyzeMessageSend(window);
  assert.equal(result.ok, false);
  assert.equal(result.post, null);
  assert.deepEqual(result.refetches, []);
  assert.deepEqual(result.problems, ["Mesaj gönderiminde 1 POST bekleniyordu, 0 bulundu."]);
  assert.equal(result.websocketFramesReceived, 0);
  assert.equal(result.websocketFramesSent, 0);
});

test("mesaj refetch denetimi POST öncesini ve ilgisiz yolları ayırır, aynı anda parent GET'i yakalar", () => {
  const messages = "http://localhost:3000/api/backend/workspaces/ws/messages";
  const post = req("POST", `${messages}/thread-1`, 100);
  const parentRefetch = req("GET", `${messages}?limit=20`, 100);
  const window = cleanWindow();
  window.requests.push(
    req("GET", `${messages}/thread-1`, 99),
    post,
    parentRefetch,
    req("PATCH", `${messages}/thread-1`, 101),
    req("GET", `${messages}/thread-2`, 102),
    req("GET", "http://localhost:3000/api/backend/files", 103),
    req("GET", "not a URL", 104),
  );
  window.websockets.sent.push({ payload: "ack", at: 100 });
  const result = analyzeMessageSend(window);
  assert.equal(result.post, post);
  assert.equal(result.ok, false);
  assert.deepEqual(result.refetches, [parentRefetch]);
  assert.deepEqual(result.problems, ["Gönderen gereksiz GET attı: GET /api/backend/workspaces/ws/messages?limit=20"]);
  assert.equal(result.websocketFramesSent, 1);
});

test("CDP recorder istek, yanıt, bağlantı hatası ve WebSocket yaşam döngüsünü kaydeder", () => {
  const session = new EventEmitter();
  const recorder = new DevtoolsRecorder(session);
  const mark = recorder.checkpoint();
  const startedAt = Date.now();
  const url = "http://localhost:3000/api/backend/inbox";
  session.emit("Network.requestWillBeSent", {
    requestId: "fetch-1",
    request: { method: "GET", url },
    type: "Fetch",
  });
  session.emit("Network.requestWillBeSent", {
    requestId: "fetch-2",
    request: { method: "POST", url },
  });
  session.emit("Network.responseReceived", {
    requestId: "fetch-1",
    response: { url, status: 502 },
  });
  session.emit("Network.loadingFailed", { requestId: "fetch-2", errorText: "net::ERR_FAILED" });
  session.emit("Network.loadingFailed", { requestId: "unseen", errorText: "net::ERR_ABORTED" });
  session.emit("Network.webSocketCreated", { url: "ws://localhost:3001/messages" });
  session.emit("Network.webSocketFrameSent", { response: { payloadData: "sent frame" } });
  session.emit("Network.webSocketFrameReceived", { response: { payloadData: "received frame" } });
  session.emit("Network.webSocketClosed", { requestId: "socket-1" });
  const endedAt = Date.now();
  const window = recorder.window(mark);

  assert.equal(window.requests.length, 2);
  assert.equal(window.requests[0].requestId, "fetch-1");
  assert.equal(window.requests[0].method, "GET");
  assert.equal(window.requests[0].url, url);
  assert.equal(window.requests[0].type, "Fetch");
  assert.equal(window.requests[1].type, "");
  assert.equal(window.responses[0].requestId, "fetch-1");
  assert.equal(window.responses[0].url, url);
  assert.equal(window.responses[0].status, 502);
  assert.equal(window.failures[0].url, url);
  assert.equal(window.failures[0].errorText, "net::ERR_FAILED");
  assert.equal(window.failures[1].url, "");
  assert.equal(window.failures[1].requestId, "unseen");
  assert.equal(window.websockets.created[0].url, "ws://localhost:3001/messages");
  assert.equal(window.websockets.sent[0].payload, "sent frame");
  assert.equal(window.websockets.received[0].payload, "received frame");
  assert.equal(window.websockets.closed[0].requestId, "socket-1");
  for (const row of [
    ...window.requests,
    ...window.responses,
    ...window.failures,
    ...Object.values(window.websockets).flat(),
  ]) {
    assert.ok(row.at >= startedAt && row.at <= endedAt);
  }
  const audit = analyzeWindow(window);
  assert.equal(audit.ok, false);
  assert.equal(audit.responses.length, 1);
  assert.equal(audit.failures.length, 1);
});

test("CDP recorder console değerlerini okur, exception fallback kullanır ve hata dışı olayları yoksayar", () => {
  const session = new EventEmitter();
  const recorder = new DevtoolsRecorder(session);
  const mark = recorder.checkpoint();
  session.emit("Runtime.consoleAPICalled", { type: "log", args: [{ value: "ignore" }] });
  session.emit("Log.entryAdded", { entry: { level: "warning", text: "ignore" } });
  assert.equal(recorder.console.length, 0);

  session.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: [{ value: "failed" }, { value: 42 }, { value: false }, { value: null }, { description: "Error: offline" }, {}, { value: "" }],
  });
  session.emit("Runtime.consoleAPICalled", { type: "error" });
  session.emit("Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught rejection" } });
  session.emit("Runtime.exceptionThrown", {});
  session.emit("Log.entryAdded", { entry: { level: "error", text: "network offline" } });
  const window = recorder.window(mark);
  assert.deepEqual(window.console.map((entry) => entry.text), [
    "failed 42 false null Error: offline",
    "",
    "Uncaught rejection",
    "Unhandled page exception",
    "network offline",
  ]);
  assert.ok(window.console.every((entry) => entry.level === "error" && Number.isFinite(entry.at)));
  assert.equal(analyzeWindow(window).problems.length, 5);
});

test("checkpoint bütün olay türlerini ayırır ve dönen pencere sonraki olaylarla büyümez", () => {
  const session = new EventEmitter();
  const recorder = new DevtoolsRecorder(session);
  function emitPageEvents(id) {
    const url = `http://localhost:3000/api/backend/page-${id}`;
    session.emit("Network.requestWillBeSent", { requestId: id, request: { method: "GET", url } });
    session.emit("Network.responseReceived", { requestId: id, response: { url, status: 200 } });
    session.emit("Network.loadingFailed", { requestId: id, errorText: `failure-${id}` });
    session.emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: `console-${id}` }] });
    session.emit("Network.webSocketCreated", { url: `ws://localhost:3001/${id}` });
    session.emit("Network.webSocketFrameSent", { response: { payloadData: `sent-${id}` } });
    session.emit("Network.webSocketFrameReceived", { response: { payloadData: `received-${id}` } });
    session.emit("Network.webSocketClosed", { requestId: id });
  }
  emitPageEvents("first");
  const mark = recorder.checkpoint();
  assert.deepEqual(mark, {
    requests: 1,
    responses: 1,
    failures: 1,
    console: 1,
    websocketCreated: 1,
    websocketSent: 1,
    websocketReceived: 1,
    websocketClosed: 1,
  });
  assert.deepEqual(recorder.window(mark), cleanWindow());
  emitPageEvents("second");
  const window = recorder.window(mark);
  emitPageEvents("third");
  assert.deepEqual(window.requests.map((row) => row.requestId), ["second"]);
  assert.deepEqual(window.responses.map((row) => row.requestId), ["second"]);
  assert.deepEqual(window.failures.map((row) => row.errorText), ["failure-second"]);
  assert.deepEqual(window.console.map((row) => row.text), ["console-second"]);
  assert.deepEqual(window.websockets.created.map((row) => row.url), ["ws://localhost:3001/second"]);
  assert.deepEqual(window.websockets.sent.map((row) => row.payload), ["sent-second"]);
  assert.deepEqual(window.websockets.received.map((row) => row.payload), ["received-second"]);
  assert.deepEqual(window.websockets.closed.map((row) => row.requestId), ["second"]);
  assert.deepEqual(recorder.window(mark).requests.map((row) => row.requestId), ["second", "third"]);
});

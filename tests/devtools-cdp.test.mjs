import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  CdpSession,
  DevtoolsPage,
  launchDevtoolsBrowser,
} from "../scripts/devtools/cdp-browser.mjs";

const targetUrl = "ws://localhost:9222/devtools/page/fixture";

function transport({ connectError, commandError, autoRespond = false } = {}) {
  return class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static instances = [];

    constructor(url) {
      super();
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.sent = [];
      this.closeCalls = 0;
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit(connectError ? "error" : "open", connectError));
    }

    send(raw) {
      const command = JSON.parse(raw);
      this.sent.push(command);
      if (autoRespond) {
        queueMicrotask(() => {
          const response = commandError
            ? { id: command.id, error: { message: commandError } }
            : { id: command.id, result: {} };
          this.emit("message", JSON.stringify(response));
        });
      }
    }

    close() {
      this.closeCalls += 1;
      this.readyState = 3;
      this.emit("close");
    }
  };
}

async function connectedSession() {
  const WebSocketClass = transport();
  const session = new CdpSession(targetUrl, { WebSocketClass });
  await session.connect();
  return { session, socket: WebSocketClass.instances[0] };
}

test("CDP associates responses with command IDs, including out of order replies", async () => {
  const { session, socket } = await connectedSession();
  const first = session.send("Runtime.evaluate", { expression: "1 + 1" });
  const second = session.send("Page.enable");
  assert.equal(socket.url, targetUrl);
  assert.deepEqual(socket.sent, [
    { id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } },
    { id: 2, method: "Page.enable", params: {} },
  ]);
  socket.emit("message", JSON.stringify({ id: 2 }));
  socket.emit("message", JSON.stringify({ id: 1, result: { value: 2 } }));
  assert.deepEqual(await second, {});
  assert.deepEqual(await first, { value: 2 });
  assert.equal(session.pending.size, 0);
  session.close();
  assert.equal(socket.closeCalls, 1);
});

test("CDP rejects protocol errors and unfinished commands when its socket closes", async () => {
  const { session, socket } = await connectedSession();
  const rejected = session.send("Page.navigate");
  const protocolError = assert.rejects(rejected, /navigation failed/);
  socket.emit("message", JSON.stringify({ id: 1, error: { message: "navigation failed" } }));
  await protocolError;
  const unfinished = session.send("Runtime.evaluate");
  const closed = assert.rejects(unfinished, /CDP bağlantısı kapandı/);
  session.close();
  await closed;
  assert.equal(session.pending.size, 0);
  await assert.rejects(session.send("Page.enable"), /açık değil/);
});

test("CDP reports unopened and failed connections", async () => {
  const unopened = new CdpSession(targetUrl);
  unopened.close();
  await assert.rejects(unopened.send("Page.enable"), /açık değil/);
  const WebSocketClass = transport({ connectError: new Error("socket refused") });
  const failed = new CdpSession(targetUrl, { WebSocketClass });
  await assert.rejects(failed.connect(), /socket refused/);
  failed.close();
});

test("CDP listeners receive parameters, unsubscribe and ignore unrelated replies", () => {
  const session = new CdpSession(targetUrl);
  const received = [];
  const off = session.on("Network.requestWillBeSent", (params) => received.push(params));
  const secondary = [];
  session.on("Network.requestWillBeSent", (params) => secondary.push(params));
  session.handle(JSON.stringify({ method: "Network.requestWillBeSent", params: { requestId: "r1" } }));
  off();
  session.handle(JSON.stringify({ method: "Network.requestWillBeSent" }));
  session.handle(JSON.stringify({ id: 999, result: {} }));
  session.handle(JSON.stringify({ method: "Unobserved.event" }));
  session.handle(JSON.stringify({ unrelated: true }));
  assert.deepEqual(received, [{ requestId: "r1" }]);
  assert.deepEqual(secondary, [{ requestId: "r1" }, {}]);
});

test("CDP one time listeners clean themselves up after success or timeout", async () => {
  const session = new CdpSession(targetUrl);
  const loaded = session.once("Page.loadEventFired");
  session.handle(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 10 } }));
  assert.deepEqual(await loaded, { timestamp: 10 });
  assert.equal(session.listeners.get("Page.loadEventFired").size, 0);
  await assert.rejects(session.once("Page.missingEvent", 1), /1 ms içinde gelmedi/);
  assert.equal(session.listeners.get("Page.missingEvent").size, 0);
});

test("CDP event waits cancel timers and listeners for active or already aborted signals", async () => {
  const session = new CdpSession(targetUrl);
  const active = new AbortController();
  const canceled = assert.rejects(session.once("Page.canceled", 15_000, { signal: active.signal }), /iptal edildi/);
  active.abort();
  await canceled;
  assert.equal(session.listeners.get("Page.canceled").size, 0);
  const previous = new AbortController();
  previous.abort();
  await assert.rejects(session.once("Page.previous", 15_000, { signal: previous.signal }), /iptal edildi/);
  assert.equal(session.listeners.get("Page.previous").size, 0);
  const successful = new AbortController();
  const loaded = session.once("Page.loadEventFired", 15_000, { signal: successful.signal });
  session.handle(JSON.stringify({ method: "Page.loadEventFired" }));
  assert.deepEqual(await loaded, {});
  successful.abort();
  assert.equal(session.listeners.get("Page.loadEventFired").size, 0);
});

function pageFixture(responses = []) {
  const calls = [];
  const session = {
    send: async (method, params) => {
      calls.push({ method, params });
      return responses.shift() ?? {};
    },
    once: async (method) => {
      calls.push({ event: method });
      return {};
    },
  };
  return { session, calls, page: new DevtoolsPage(session) };
}

test("page enables the four CDP domains and subscribes to load before navigation", async () => {
  const { page, calls } = pageFixture();
  await page.enable();
  assert.deepEqual(calls.map((call) => call.method), [
    "Page.enable", "Runtime.enable", "Network.enable", "Log.enable",
  ]);
  calls.length = 0;
  await page.navigate("http://localhost:3000/messages");
  assert.deepEqual(calls, [
    { event: "Page.loadEventFired" },
    { method: "Page.navigate", params: { url: "http://localhost:3000/messages" } },
  ]);
  const failure = pageFixture([{ errorText: "net::ERR_CONNECTION_REFUSED" }]);
  await assert.rejects(failure.page.navigate("http://localhost:3000"), /ERR_CONNECTION_REFUSED/);
});

test("failed navigation cancels the pending load event instead of leaving an unhandled timeout", async () => {
  const failures = [
    { result: { errorText: "net::ERR_CONNECTION_REFUSED" } },
    { error: { message: "navigation failed" } },
  ];
  for (const failure of failures) {
    const { session, socket } = await connectedSession();
    const page = new DevtoolsPage(session);
    const failed = assert.rejects(page.navigate("http://localhost:3000"), /ERR_CONNECTION_REFUSED|navigation failed/);
    assert.equal(session.listeners.get("Page.loadEventFired").size, 1);
    socket.emit("message", JSON.stringify({ id: 1, ...failure }));
    await failed;
    assert.equal(session.listeners.get("Page.loadEventFired").size, 0);
    session.close();
  }
});

test("successful navigation waits for both the response and load event in either order", async () => {
  for (const eventFirst of [false, true]) {
    const { session, socket } = await connectedSession();
    const page = new DevtoolsPage(session);
    let finished = false;
    const navigation = page.navigate("http://localhost:3000").then(() => { finished = true; });
    const response = () => socket.emit("message", JSON.stringify({ id: 1, result: {} }));
    const loaded = () => socket.emit("message", JSON.stringify({ method: "Page.loadEventFired" }));
    if (eventFirst) loaded();
    else response();
    await Promise.resolve();
    assert.equal(finished, false);
    if (eventFirst) response();
    else loaded();
    await navigation;
    assert.equal(finished, true);
    assert.equal(session.listeners.get("Page.loadEventFired").size, 0);
    session.close();
  }
});

test("page evaluates promises by value and reports browser exceptions", async () => {
  const { page, calls } = pageFixture([{ result: { value: [1, 2] } }, {}]);
  assert.deepEqual(await page.evaluate("Promise.resolve([1, 2])"), [1, 2]);
  assert.deepEqual(calls[0], {
    method: "Runtime.evaluate",
    params: {
      expression: "Promise.resolve([1, 2])",
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
  });
  assert.equal(await page.evaluate("undefined"), undefined);
  const failures = pageFixture([
    { exceptionDetails: { text: "ReferenceError" } },
    { exceptionDetails: {} },
  ]);
  await assert.rejects(failures.page.evaluate("missing"), /ReferenceError/);
  await assert.rejects(failures.page.evaluate("throw Error()"), /Tarayıcı ifadesi hata verdi/);
});

test("page condition polling is sequential, stops after success and observes timeout", async () => {
  const fixture = pageFixture([
    { result: { value: false } },
    { result: { value: true } },
  ]);
  let elapsed = 0;
  const steps = [];
  const page = new DevtoolsPage(fixture.session, {
    now: () => elapsed,
    sleep: async (ms) => {
      steps.push({ ms, commandsBeforeSleep: fixture.calls.length });
      elapsed += ms;
    },
  });
  await page.waitFor("document.querySelector('main')");
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].params.expression, "Boolean(document.querySelector('main'))");
  assert.deepEqual(steps, [{ ms: 100, commandsBeforeSleep: 1 }]);
  await assert.rejects(page.waitFor("false", 200), /Koşul 200 ms/);
  assert.equal(fixture.calls.length, 4);
  await assert.rejects(page.waitFor("false", 0), /Koşul 0 ms/);
  assert.equal(fixture.calls.length, 4);
  await page.settle();
  assert.equal(steps.at(-1).ms, 1200);
  await page.settle(20);
  assert.equal(steps.at(-1).ms, 20);
  await fixture.page.settle(1);
});

test("page imports valid cookie header pairs without losing equals signs in values", async () => {
  const { page, calls } = pageFixture();
  await page.setCookieHeader("session=abc=def; malformed; =empty-name; theme=dark; ", "http://localhost:3000");
  assert.deepEqual(calls, [{
    method: "Network.setCookies",
    params: { cookies: [
      { name: "session", value: "abc=def", url: "http://localhost:3000" },
      { name: "theme", value: "dark", url: "http://localhost:3000" },
    ] },
  }]);
  await page.setCookieHeader("; invalid; =", "http://localhost:3000");
  assert.equal(calls.length, 1);
});

function browserFixture(options = {}) {
  const calls = { spawned: [], removed: [], delays: [], checked: [], profiles: [], fetched: [] };
  const child = new EventEmitter();
  child.exitCode = options.exitCode ?? null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (options.exitOnTerminate && signal === "SIGTERM") {
      child.exitCode = 0;
      child.emit("exit", 0);
    }
  };
  const server = new EventEmitter();
  server.listen = (port, host, callback) => {
    assert.equal(port, 0);
    assert.equal(host, "127.0.0.1");
    if (options.serverError) server.emit("error", options.serverError);
    else callback();
  };
  server.address = () => options.address === undefined ? { port: 9222 } : options.address;
  server.close = (callback) => callback();
  const WebSocketClass = transport({ autoRespond: true, ...options.transport });
  let versionRequests = 0;
  const dependencies = {
    platform: options.platform ?? "linux",
    env: options.env ?? { CHROME_PATH: "/fixture/chrome" },
    existsSync: (path) => {
      calls.checked.push(path);
      return options.availablePath ? options.availablePath(path) : true;
    },
    spawnSync: (command, args) => {
      calls.checked.push({ command, args });
      return { status: options.commandStatus ?? 0 };
    },
    spawn: (executable, args, spawnOptions) => {
      calls.spawned.push({ executable, args, options: spawnOptions });
      if (options.spawnError) throw options.spawnError;
      return child;
    },
    createServer: () => server,
    tmpdir: () => "/fixture/tmp",
    mkdtemp: async (prefix) => {
      calls.profiles.push(prefix);
      return "/fixture/profile";
    },
    rm: async (profile, removalOptions) => calls.removed.push({ profile, options: removalOptions }),
    delay: async (ms) => calls.delays.push(ms),
    fetch: async (url) => {
      calls.fetched.push(url);
      if (url.endsWith("/json/version")) {
        versionRequests += 1;
        if (versionRequests <= (options.versionFailures ?? 0)) throw new Error("not ready");
      }
      return {
        ok: options.responseOk ?? true,
        status: 503,
        json: async () => url.endsWith("/json/list")
          ? options.targets ?? [{ type: "worker" }, { type: "page", webSocketDebuggerUrl: targetUrl }]
          : {},
      };
    },
    WebSocketClass,
  };
  return { dependencies, calls, child, WebSocketClass };
}

const removedProfile = [{
  profile: "/fixture/profile",
  options: { recursive: true, force: true },
}];

test("browser launch polls readiness, enables domains and forces cleanup for a stuck Chrome", async () => {
  const fixture = browserFixture({ versionFailures: 2 });
  const browser = await launchDevtoolsBrowser(fixture.dependencies);
  assert.equal(browser.session.socket.url, targetUrl);
  assert.equal(browser.page.session, browser.session);
  assert.deepEqual(fixture.calls.delays, [100, 100]);
  assert.deepEqual(fixture.calls.fetched, [
    "http://127.0.0.1:9222/json/version",
    "http://127.0.0.1:9222/json/version",
    "http://127.0.0.1:9222/json/version",
    "http://127.0.0.1:9222/json/list",
  ]);
  assert.equal(fixture.calls.spawned[0].executable, "/fixture/chrome");
  assert.ok(fixture.calls.spawned[0].args.includes("--remote-debugging-port=9222"));
  assert.ok(fixture.calls.spawned[0].args.includes("--user-data-dir=/fixture/profile"));
  assert.ok(fixture.calls.spawned[0].args.includes("--headless=new"));
  assert.deepEqual(browser.session.socket.sent.map((command) => command.method), [
    "Page.enable", "Runtime.enable", "Network.enable", "Log.enable",
  ]);
  await browser.close();
  assert.deepEqual(fixture.child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(fixture.calls.removed, removedProfile);
  assert.equal(browser.session.socket.closeCalls, 1);
});

test("browser cleanup sees immediate graceful exits without sending SIGKILL", async () => {
  const fixture = browserFixture({ exitOnTerminate: true });
  const browser = await launchDevtoolsBrowser(fixture.dependencies);
  await browser.close();
  assert.deepEqual(fixture.child.signals, ["SIGTERM"]);
  assert.deepEqual(fixture.calls.removed, removedProfile);
});

test("browser launch cleans temporary profiles when spawn, discovery or CDP setup fails", async () => {
  const cases = [
    { options: { spawnError: new Error("spawn failed") }, message: /spawn failed/, signals: [] },
    { options: { exitCode: 17 }, message: /kapandı: 17/, signals: ["SIGKILL"] },
    { options: { targets: [] }, message: /sayfa hedefi bulunamadı/, signals: ["SIGKILL"] },
    { options: { targets: [{ type: "page" }] }, message: /sayfa hedefi bulunamadı/, signals: ["SIGKILL"] },
    { options: { transport: { connectError: new Error("cannot connect") } }, message: /cannot connect/, signals: ["SIGKILL"] },
    { options: { transport: { commandError: "domain unavailable" } }, message: /domain unavailable/, signals: ["SIGKILL"] },
  ];
  for (const scenario of cases) {
    const fixture = browserFixture(scenario.options);
    await assert.rejects(launchDevtoolsBrowser(fixture.dependencies), scenario.message);
    assert.deepEqual(fixture.calls.removed, removedProfile);
    assert.deepEqual(fixture.child.signals, scenario.signals);
  }
});

test("browser readiness timeout terminates Chrome after sequential failed probes", async () => {
  const fixture = browserFixture({ responseOk: false });
  await assert.rejects(launchDevtoolsBrowser(fixture.dependencies), /10 saniye içinde hazır olmadı/);
  assert.equal(fixture.calls.fetched.length, 100);
  assert.equal(fixture.calls.delays.length, 100);
  assert.ok(fixture.calls.delays.every((ms) => ms === 100));
  assert.deepEqual(fixture.child.signals, ["SIGKILL"]);
  assert.deepEqual(fixture.calls.removed, removedProfile);
});

test("browser lookup supports macOS and Windows install paths and PATH commands", async () => {
  const cases = [
    { options: { platform: "darwin", env: {} }, executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    { options: { platform: "win32", env: {} }, executable: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe` },
    { options: { platform: "win32", env: { PROGRAMFILES: "D:/Apps", "PROGRAMFILES(X86)": "D:/Apps-x86" } }, executable: String.raw`D:/Apps\Google\Chrome\Application\chrome.exe` },
    { options: { platform: "win32", env: {}, availablePath: () => false }, executable: "google-chrome", checker: "where" },
    { options: { platform: "linux", env: {} }, executable: "google-chrome", checker: "which" },
  ];
  for (const scenario of cases) {
    const fixture = browserFixture(scenario.options);
    const browser = await launchDevtoolsBrowser(fixture.dependencies);
    assert.equal(fixture.calls.spawned[0].executable, scenario.executable);
    if (scenario.checker) assert.deepEqual(fixture.calls.checked.at(-1), { command: scenario.checker, args: ["google-chrome"] });
    await browser.close();
  }
});

test("missing browser and unavailable port fail before creating temporary profiles", async () => {
  const missing = browserFixture({ env: {}, commandStatus: 1 });
  await assert.rejects(launchDevtoolsBrowser(missing.dependencies), /CHROME_PATH/);
  assert.deepEqual(missing.calls.profiles, []);
  const unavailable = browserFixture({ serverError: new Error("port unavailable") });
  await assert.rejects(launchDevtoolsBrowser(unavailable.dependencies), /port unavailable/);
  assert.deepEqual(unavailable.calls.profiles, []);
});

test("non-TCP and null server addresses are handled without dereferencing missing ports", async () => {
  for (const address of ["fixture.pipe", null]) {
    const fixture = browserFixture({ address });
    const browser = await launchDevtoolsBrowser(fixture.dependencies);
    assert.ok(fixture.calls.spawned[0].args.includes("--remote-debugging-port=0"));
    await browser.close();
  }
});

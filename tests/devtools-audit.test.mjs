import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { auditConfiguration, runAudit } from "../scripts/devtools/audit.mjs";

const messagePath = "/?view=messages&thread=thread-1";
const messageApi = "http://127.0.0.1:3000/api/backend/workspaces/ws/messages/thread-1";
const criticalRoutes = {
  public: ["/"],
  teacher: ["overview", "calendar", "students", "messages", "payments", "assignments", "files", "videos", "showcase"].map((view) => `/?view=${view}`),
  portal: ["lessons", "messages", "assignments", "files", "videos", "notes", "payments", "teachers", "requests"].map((view) => `/?view=${view}`),
};

function emitRequest(session, method, url, id, status = 200) {
  session.emit("Network.requestWillBeSent", {
    requestId: id,
    request: { method, url },
    type: "Fetch",
  });
  session.emit("Network.responseReceived", {
    requestId: id,
    response: { url, status },
  });
}

function messageDom(onSubmit, options) {
  const events = [];
  const button = { disabled: options.disabled ?? false };
  class Form {
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return options.missingButton ? null : button;
    }

    requestSubmit() {
      onSubmit(textarea.value);
    }

    dispatchEvent(event) {
      events.push(event);
      if (event.type === "submit") onSubmit(textarea.value);
      return true;
    }
  }
  class Textarea {
    get value() { return this.currentValue ?? ""; }
    set value(value) { this.currentValue = value; }
    closest(selector) {
      assert.equal(selector, "form");
      return this.form;
    }

    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  }
  class BrowserEvent {
    constructor(type, settings) {
      this.type = type;
      Object.assign(this, settings);
    }
  }
  const textarea = new Textarea();
  const form = new Form();
  textarea.form = options.missingForm ? null : form;
  if (options.fallbackSubmit) form.requestSubmit = undefined;
  if (options.missingSetter) delete Textarea.prototype.value;
  const context = {
    HTMLTextAreaElement: Textarea,
    HTMLFormElement: Form,
    Event: BrowserEvent,
    document: {
      querySelector(selector) {
        assert.equal(selector, "textarea");
        return options.missingTextarea ? null : textarea;
      },
    },
  };
  return { context, events, textarea };
}

function fakeBrowser(options = {}) {
  const session = new EventEmitter();
  const calls = [];
  const submittedTexts = [];
  let closed = false;
  let pendingNavigation = false;
  let evaluated = 0;
  let requestId = 0;
  const dom = messageDom((text) => {
    if (options.submitError) throw options.submitError;
    submittedTexts.push(text);
    if (options.socket === "send") session.emit("Network.webSocketCreated", { url: "ws://127.0.0.1:3001/messages" });
    for (let i = 0; i < (options.posts ?? 1); i++) emitRequest(session, "POST", messageApi, `send-${requestId++}`, options.sendStatus ?? 200);
    for (const path of options.refetches ?? []) emitRequest(session, "GET", `http://127.0.0.1:3000${path}`, `refetch-${requestId++}`);
    session.emit("Network.webSocketFrameSent", { response: { payloadData: "message" } });
    session.emit("Network.webSocketFrameReceived", { response: { payloadData: "ack" } });
  }, options);
  const browser = {
    session,
    page: {
      async setCookieHeader(cookie, baseUrl) {
        calls.push(["cookie", cookie, baseUrl]);
        if (options.cookieError) throw options.cookieError;
      },
      async navigate(url) {
        assert.equal(pendingNavigation, false, "Each previous route must finish settling before the next navigation");
        calls.push(["navigate", url]);
        const path = new URL(url).pathname;
        if (options.navigationErrors?.has(path)) throw options.navigationErrors.get(path);
        pendingNavigation = true;
        await Promise.resolve();
        emitRequest(session, "GET", `http://127.0.0.1:3000/api/backend/page${new URL(url).search}`, `route-${requestId++}`, options.routeStatus ?? 200);
        if (options.socket === "before" && url.endsWith(messagePath)) session.emit("Network.webSocketCreated", { url: "ws://127.0.0.1:3001/messages" });
        if (options.routeConsoleError) session.emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: options.routeConsoleError }] });
      },
      async settle(milliseconds) {
        calls.push(["settle", milliseconds]);
        await Promise.resolve();
        pendingNavigation = false;
      },
      async waitFor(expression) {
        calls.push(["waitFor", expression]);
        // The first wait checks whether the page's composer has loaded. Later
        // waits execute the audit's actual submit readiness expression.
        if (expression === "document.querySelector('textarea')") {
          if (options.waitError) throw options.waitError;
          return;
        }
        if (!vm.runInNewContext(expression, dom.context)) throw new Error("Mesaj düğmesi hazır olmadı.");
      },
      async evaluate(expression) {
        evaluated++;
        calls.push(["evaluate", expression]);
        if (evaluated === 1 && "prepareResult" in options) return options.prepareResult;
        if (evaluated === 2 && options.removeFormBeforeSubmit) dom.textarea.form = null;
        return vm.runInNewContext(expression, dom.context);
      },
    },
    async close() {
      closed = true;
      calls.push(["close"]);
    },
  };
  return { browser, calls, submittedTexts, dom, isClosed: () => closed };
}

async function reportLocation(t) {
  const directory = await mkdtemp(join(tmpdir(), "derslik-devtools-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, reportPath: join(directory, "nested", "report.json") };
}

async function audit(t, env = {}, options = {}) {
  const { reportPath } = await reportLocation(t);
  const fixture = fakeBrowser(options);
  const report = await runAudit({
    env: { DEVTOOLS_SETTLE_MS: "17", DEVTOOLS_REPORT: reportPath, ...env },
    launchBrowser: async () => fixture.browser,
  });
  const contents = await readFile(reportPath, "utf8");
  assert.equal(contents.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(contents), report);
  assert.equal(fixture.isClosed(), true);
  assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
  return { report, ...fixture };
}

test("audit configuration has documented defaults and rejects an unknown profile", () => {
  assert.deepEqual(auditConfiguration({}), {
    baseUrl: "http://127.0.0.1:3000",
    profile: "public",
    routes: ["/"],
    reportPath: "reports/devtools-audit.json",
    settleMs: 1200,
    duplicateWindowMs: 800,
  });
  assert.throws(() => auditConfiguration({ DEVTOOLS_PROFILE: "unknown" }), /Bilinmeyen DEVTOOLS_PROFILE=unknown/);
  assert.deepEqual(auditConfiguration({ DEVTOOLS_ROUTES: "" }).routes, ["/"]);
});

test("configuration trims explicit routes, permits custom profiles and reads numeric options", () => {
  assert.deepEqual(auditConfiguration({
    DEVTOOLS_PROFILE: "custom",
    DEVTOOLS_ROUTES: " /one , , https://portal.example.test/two, /three ",
    DEVTOOLS_BASE_URL: "https://derslik.example.test",
    DEVTOOLS_REPORT: "custom-report.json",
    DEVTOOLS_SETTLE_MS: "25",
    DEVTOOLS_DUPLICATE_WINDOW_MS: "50",
  }), {
    profile: "custom",
    routes: ["/one", "https://portal.example.test/two", "/three"],
    baseUrl: "https://derslik.example.test",
    reportPath: "custom-report.json",
    settleMs: 25,
    duplicateWindowMs: 50,
  });
});

for (const [profile, routes] of Object.entries(criticalRoutes)) {
  test(`${profile} audits all critical pages sequentially with independent captures`, async (t) => {
    const { report, calls } = await audit(t, { DEVTOOLS_PROFILE: profile });
    assert.deepEqual(report.routes.map((row) => row.route), routes);
    assert.equal(report.passed, routes.length);
    assert.equal(report.failed, 0);
    assert.equal(report.message, null);
    for (const row of report.routes) assert.deepEqual(row.counts, { requests: 1, responses: 1, websocketCreated: 0, websocketReceived: 0 });
    assert.deepEqual(calls, [
      ...routes.flatMap((route) => [["navigate", new URL(route, report.baseUrl).href], ["settle", 17]]),
      ["close"],
    ]);
  });
}

test("a custom base URL and session cookie are applied before route navigation", async (t) => {
  const { report, calls } = await audit(t, {
    DEVTOOLS_BASE_URL: "https://derslik.example.test/base/",
    DEVTOOLS_ROUTES: " child , https://portal.example.test/lesson ",
    DEVTOOLS_COOKIE: "derslik-session=fake-session",
  });
  assert.equal(report.passed, 2);
  assert.deepEqual(calls[0], ["cookie", "derslik-session=fake-session", report.baseUrl]);
  assert.deepEqual(calls.filter(([kind]) => kind === "navigate"), [
    ["navigate", "https://derslik.example.test/base/child"],
    ["navigate", "https://portal.example.test/lesson"],
  ]);
});

test("failed navigation records Error and primitive reasons and continues to later routes", async (t) => {
  const { report } = await audit(t, { DEVTOOLS_ROUTES: "/broken,/offline,/working" }, {
    navigationErrors: new Map([["/broken", new Error("navigation rejected")], ["/offline", "browser offline"]]),
  });
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 2);
  assert.deepEqual(report.routes[0].result, { ok: false, problems: ["navigation rejected"] });
  assert.deepEqual(report.routes[1].result, { ok: false, problems: ["browser offline"] });
  assert.deepEqual(report.routes[0].counts, {});
  assert.equal(report.routes[2].route, "/working");
});

test("HTTP and console failures fail each route and are serialized in the report", async (t) => {
  const { report } = await audit(t, { DEVTOOLS_ROUTES: "/one,/two" }, { routeStatus: 503, routeConsoleError: "page failed" });
  assert.equal(report.passed, 0);
  assert.equal(report.failed, 2);
  for (const row of report.routes) {
    assert.equal(row.result.ok, false);
    assert.ok(row.result.problems.some((problem) => problem.includes("HTTP 503")));
    assert.ok(row.result.problems.some((problem) => problem.includes("Console error: page failed")));
  }
});

test("an explicit empty route list produces a clean empty report", async (t) => {
  const { report, calls } = await audit(t, { DEVTOOLS_ROUTES: " , " });
  assert.deepEqual(report.routes, []);
  assert.equal(report.passed, 0);
  assert.equal(report.failed, 0);
  assert.deepEqual(calls, [["close"]]);
});

test("cookie failure still closes the browser and does not claim a completed report", async (t) => {
  const { reportPath } = await reportLocation(t);
  const fixture = fakeBrowser({ cookieError: new Error("cookie denied") });
  await assert.rejects(runAudit({
    env: { DEVTOOLS_COOKIE: "session=fake", DEVTOOLS_REPORT: reportPath },
    launchBrowser: async () => fixture.browser,
  }), /cookie denied/);
  assert.equal(fixture.isClosed(), true);
  await assert.rejects(readFile(reportPath), { code: "ENOENT" });
});

test("report write failure occurs after browser cleanup", async (t) => {
  const { directory } = await reportLocation(t);
  const fixture = fakeBrowser();
  await assert.rejects(runAudit({
    env: { DEVTOOLS_ROUTES: " , ", DEVTOOLS_REPORT: directory },
    launchBrowser: async () => fixture.browser,
  }), { code: "EISDIR" });
  assert.equal(fixture.isClosed(), true);
});

test("message send executes the composer DOM script, escapes text and accepts an existing socket", async (t) => {
  const text = 'test "message"\nwith a backslash \\ and Turkish ı';
  const { report, submittedTexts, dom } = await audit(t, {
    DEVTOOLS_MESSAGE_URL: messagePath,
    DEVTOOLS_MESSAGE_TEXT: text,
  }, { socket: "before" });
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.message.ok, true);
  assert.equal(report.message.socketSeen, true);
  assert.equal(report.message.text, text);
  assert.deepEqual(submittedTexts, [text]);
  assert.deepEqual(dom.events.map((event) => [event.type, event.bubbles]), [["input", true], ["change", true]]);
  assert.deepEqual(report.message.counts, { requests: 1, websocketCreated: 1, websocketSent: 1, websocketReceived: 1 });
  assert.equal(report.message.send.websocketFramesReceived, 1);
  assert.equal(report.message.send.websocketFramesSent, 1);
});

test("message send uses a generated text and detects a socket created while sending", async (t) => {
  const { report, submittedTexts } = await audit(t, { DEVTOOLS_MESSAGE_URL: messagePath }, { socket: "send" });
  assert.equal(report.message.ok, true);
  assert.match(report.message.text, /^devtools-[a-z0-9]+$/);
  assert.deepEqual(submittedTexts, [report.message.text]);
  assert.equal(report.message.socketSeen, true);
});

test("message send fallback dispatches a cancellable submit event", async (t) => {
  const { report, dom } = await audit(t, { DEVTOOLS_MESSAGE_URL: messagePath }, { socket: "before", fallbackSubmit: true });
  assert.equal(report.message.ok, true);
  assert.deepEqual(dom.events.map((event) => event.type), ["input", "change", "submit"]);
  assert.equal(dom.events.at(-1).cancelable, true);
  assert.equal(dom.events.at(-1).bubbles, true);
});

test("duplicate POST and sender refetch fail message send with general network errors", async (t) => {
  const { report } = await audit(t, { DEVTOOLS_MESSAGE_URL: messagePath }, {
    socket: "before",
    posts: 2,
    sendStatus: 500,
    refetches: ["/api/backend/workspaces/ws/messages/thread-1", "/api/backend/inbox", "/api/backend/inbox"],
  });
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.message.ok, false);
  assert.equal(report.message.send.refetches.length, 3);
  assert.ok(report.message.problems.some((problem) => /1 POST.*2/.test(problem)));
  assert.ok(report.message.problems.some((problem) => problem.includes("gereksiz GET")));
  assert.ok(report.message.problems.some((problem) => problem.includes("HTTP 500")));
  assert.ok(report.message.problems.some((problem) => problem.includes("Tekrarlı GET")));
});

test("message send requires a socket unless the explicit opt-out is 1", async (t) => {
  for (const [allow, expected] of [[undefined, false], ["0", false], ["1", true]]) {
    await t.test(`allow=${allow}`, async (child) => {
      const { report } = await audit(child, { DEVTOOLS_MESSAGE_URL: messagePath, DEVTOOLS_ALLOW_NO_SOCKET: allow });
      assert.equal(report.message.ok, expected);
      assert.equal(report.message.socketSeen, false);
      assert.equal(report.failed, expected ? 0 : 1);
      if (!expected) assert.match(report.message.problems[0], /WebSocket bağlantısı görülmedi/);
    });
  }
});

test("a submit without a POST is a failure even when a socket exists", async (t) => {
  const { report } = await audit(t, { DEVTOOLS_MESSAGE_URL: messagePath }, { socket: "before", posts: 0 });
  assert.equal(report.message.ok, false);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.message.problems, ["Mesaj gönderiminde 1 POST bekleniyordu, 0 bulundu."]);
});

const composerFailures = [
  ["missing textarea", { missingTextarea: true }, "Mesaj textarea bulunamadı."],
  ["missing form", { missingForm: true }, "Mesaj formu bulunamadı."],
  ["missing result", { prepareResult: undefined }, "Mesaj alanı hazırlanamadı."],
  ["missing reason", { prepareResult: { ok: false } }, "Mesaj alanı hazırlanamadı."],
  ["form removed", { removeFormBeforeSubmit: true }, "Mesaj formu bulunamadı."],
  ["disabled button", { disabled: true }, "Mesaj düğmesi hazır olmadı."],
  ["missing button", { missingButton: true }, "Mesaj düğmesi hazır olmadı."],
  ["missing setter", { missingSetter: true }, "Mesaj düğmesi hazır olmadı."],
  ["composer timeout", { waitError: new Error("composer timeout") }, "composer timeout"],
  ["primitive submit error", { submitError: "send failed" }, "send failed"],
];

for (const [label, options, reason] of composerFailures) {
  test(`message composer failure (${label}) becomes a report row and closes the browser`, async (t) => {
    const { report } = await audit(t, { DEVTOOLS_MESSAGE_URL: messagePath }, options);
    assert.equal(report.passed, 1);
    assert.equal(report.failed, 1);
    assert.deepEqual(report.message, { route: messagePath, ok: false, problems: [reason] });
  });
}

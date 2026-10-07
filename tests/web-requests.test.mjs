import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { loadTestModule } from "../scripts/test-source-loader.mjs";
import { createTsxFixture } from "./tsx-fixture.mjs";

// Real web modules with a scripted fetch, React hooks and BroadcastChannel.
// Page-level behaviour (one ticket, no cancelled or duplicate requests in a
// real browser) was measured separately; these pin the rules that produce it.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** fetch whose responses resolve only when the test releases them. */
function controlledFetch() {
  const calls = [];
  const fetch = (url, init = {}) =>
    new Promise((resolve) =>
      calls.push({
        url,
        init,
        reply: (status, body) =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => {
              if (typeof body === "string") throw new SyntaxError("not json");
              return body;
            },
            clone() {
              return this;
            },
          }),
      }),
    );
  return { calls, fetch };
}

function client(fetch) {
  return loadTestModule("apps/web/lib/client.ts", {
    dependencies: {
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { t: (key) => key },
    },
    globals: { fetch, crypto: { randomUUID }, structuredClone },
  });
}

test("concurrent identical GETs share one request; each caller gets its own copy", async () => {
  const f = controlledFetch();
  const { webRequest } = client(f.fetch);
  const sidebar = webRequest("/api/backend/workspaces/w/showcase");
  const page = webRequest("/api/backend/workspaces/w/showcase");
  await tick();
  assert.equal(f.calls.length, 1, "the second reader joins the first request");
  f.calls[0].reply(200, { data: { requests: [{ status: "PENDING" }] } });
  const [a, b] = await Promise.all([sidebar, page]);
  assert.deepEqual(a, b);
  a.data.requests.push({ status: "ACCEPTED" });
  assert.equal(b.data.requests.length, 1, "one caller's edit never leaks");
  // Settled: the next read goes to the server again.
  const later = webRequest("/api/backend/workspaces/w/showcase");
  await tick();
  assert.equal(f.calls.length, 2);
  f.calls[1].reply(200, { data: { requests: [] } });
  assert.deepEqual(await later, { data: { requests: [] } });
});

test("a write ends sharing: a read sent after it never gets the pre-write answer", async () => {
  const f = controlledFetch();
  const { webRequest } = client(f.fetch);
  const before = webRequest("/api/backend/inbox");
  await tick();
  const write = webRequest("/api/backend/inbox/n1/read", {});
  const after = webRequest("/api/backend/inbox");
  await tick();
  assert.deepEqual(
    f.calls.map((c) => [c.init.method, c.url]),
    [
      ["GET", "/api/backend/inbox"],
      ["POST", "/api/backend/inbox/n1/read"],
      ["GET", "/api/backend/inbox"],
    ],
  );
  f.calls[0].reply(200, { data: [{ id: "n1", readAt: null }] });
  f.calls[1].reply(200, { ok: true });
  f.calls[2].reply(200, { data: [{ id: "n1", readAt: "now" }] });
  assert.equal((await before).data[0].readAt, null);
  await write;
  assert.equal((await after).data[0].readAt, "now");
});

test("a failed shared GET rejects every caller and is not kept", async () => {
  const f = controlledFetch();
  const { webRequest } = client(f.fetch);
  const one = webRequest("/api/session");
  const two = webRequest("/api/session");
  await tick();
  f.calls[0].reply(503, { error: "down" });
  await assert.rejects(one, (e) => e.status === 503);
  await assert.rejects(two, (e) => e.status === 503);
  void webRequest("/api/session");
  await tick();
  assert.equal(f.calls.length, 2);
});

function prefetch(fetch) {
  return loadTestModule("apps/web/lib/workspace-prefetch.ts", {
    globals: { fetch },
  });
}

test("workspace prefetch is used once, shared within a tick, and bound to the shown workspace", async () => {
  const f = controlledFetch();
  const m = prefetch(f.fetch);
  m.prefetchWorkspace("ws-a");
  m.prefetchWorkspace("ws-a");
  assert.equal(f.calls.length, 1, "one prefetch");
  assert.equal(f.calls[0].init.headers[m.WORKSPACE_HEADER], "ws-a");
  f.calls[0].reply(200, { students: [] });
  await tick();
  // The workspace code arrives later; the finished prefetch is still used.
  const first = m.workspaceResponse("ws-a");
  const second = m.workspaceResponse("ws-a"); // React's second effect run
  assert.equal(f.calls.length, 1);
  assert.equal(await first, await second);
  assert.deepEqual((await first).body, { students: [] });
  await tick();
  // Later loads and loads after a save are fresh.
  void m.workspaceResponse("ws-a");
  void m.workspaceResponse("ws-a", true);
  void m.workspaceResponse("ws-b");
  assert.deepEqual(
    f.calls.map((c) => c.init.headers[m.WORKSPACE_HEADER]),
    ["ws-a", "ws-a", "ws-a", "ws-b"],
  );
});

test("workspace load reports an account change and survives a non-JSON body", async () => {
  const f = controlledFetch();
  const m = prefetch(f.fetch);
  const changed = m.workspaceResponse("ws-a");
  f.calls[0].reply(409, { error: "changed", accountChanged: true });
  assert.deepEqual({ ...(await changed) }, {
    ok: false,
    status: 409,
    body: { error: "changed", accountChanged: true },
    accountChanged: true,
  });
  await tick();
  const broken = m.workspaceResponse("ws-a");
  f.calls[1].reply(502, "<html>Bad gateway</html>");
  assert.equal((await broken).body, null);
  assert.equal((await broken).accountChanged, false);
  const response = (status, body) => ({
    status,
    clone: () => ({ json: async () => body }),
  });
  assert.equal(await m.accountChanged(response(409, { accountChanged: true })), true);
  assert.equal(await m.accountChanged(response(409, { error: "conflict" })), false);
  assert.equal(await m.accountChanged(response(200, { accountChanged: true })), false);
});

function socketModule() {
  const renderer = createTsxFixture();
  const log = [],
    instances = [];
  class MessageSocket {
    live = false;
    listeners = new Set();
    liveListeners = new Set();
    constructor(options) {
      this.options = options;
      instances.push(this);
      log.push("new");
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    onLive(listener) {
      this.liveListeners.add(listener);
      return () => this.liveListeners.delete(listener);
    }
    start() {
      log.push("start");
    }
    stop() {
      log.push("stop");
    }
  }
  const m = loadTestModule("apps/web/lib/message-socket.ts", {
    dependencies: {
      react: {
        ...renderer.react,
        useSyncExternalStore: (subscribe, snapshot) => {
          subscribe(() => {})();
          return snapshot();
        },
      },
      "@derslik/api-client": { MessageSocket },
    },
    globals: { fetch: async () => ({ status: 501 }) },
  });
  return { m, renderer, log, instances };
}

test("switching views keeps the message socket and its ticket request alive", async () => {
  const { m, renderer, log, instances } = socketModule();
  const seen = [];
  function Calendar() {
    m.useMessageEvents((event) => seen.push(["calendar", event.type]));
    return null;
  }
  function Messages() {
    m.useMessageEvents((event) => seen.push(["messages", event.type]));
    return { type: "Live", props: { live: m.useSocketLive() } };
  }
  // Each view is its own child, as in the app: switching unmounts one and
  // mounts the other in the same commit.
  const Shell = ({ view }) => ({ type: view, props: {} });
  renderer.render(Shell, { view: Calendar });
  const tree = renderer.render(Shell, { view: Messages });
  await tick();
  assert.equal(tree.props.live, false);
  assert.deepEqual(log, ["new", "start", "start"], "never stopped in between");
  // Events reach the view that is shown now.
  for (const listener of instances[0].listeners) listener({ type: "resync" });
  assert.deepEqual(seen, [["messages", "resync"]]);
  renderer.unmount();
  assert.ok(!log.includes("stop"), "closing is deferred by a tick");
  await tick();
  assert.deepEqual(log, ["new", "start", "start", "stop"]);
});

test("a disabled listener never opens the socket; a re-render keeps one subscription", async () => {
  const { m, renderer, log, instances } = socketModule();
  const handled = [];
  function View({ enabled, label }) {
    m.useMessageEvents((event) => handled.push([label, event.type]), enabled);
    return null;
  }
  renderer.render(View, { enabled: false, label: "off" });
  await tick();
  assert.deepEqual(log, []);
  renderer.render(View, { enabled: true, label: "first" });
  renderer.render(View, { enabled: true, label: "second" });
  await tick();
  assert.deepEqual(log, ["new", "start"]);
  assert.equal(instances[0].listeners.size, 1);
  // The newest render's handler receives the event.
  for (const listener of instances[0].listeners) listener({ type: "message" });
  assert.deepEqual(handled, [["second", "message"]]);
  renderer.unmount();
  await tick();
  assert.deepEqual(log, ["new", "start", "stop"]);
});

function connectedWorkspace({ bus, reloads, name }) {
  const renderer = createTsxFixture();
  const factories = [];
  const m = loadTestModule("apps/web/components/account/connected-workspace.tsx", {
    dependencies: {
      react: {
        ...renderer.react,
        lazy: (factory) => {
          factories.push(factory);
          return `Lazy${factories.length}`;
        },
        Suspense: "Suspense",
      },
      "react/jsx-runtime": renderer.jsx,
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { noticeAccess: () => null, t: (k) => k, upper: (s) => s },
      "./auth-form": {},
      "@/lib/client": {},
      "@/lib/chat-drafts": {},
      "@/lib/workspace-prefetch": {},
      "@/lib/student-mode": {},
      "@/components/derslik/loading": { PageLoader: "PageLoader" },
      "@/components/derslik/feedback": {},
      "@/components/ui/button": {},
      "@/components/ui/card": {},
      "@/components/ui/input": {},
      "@/components/ui/label": {},
      "@/components/ui/select": {},
      // ES module namespaces, as the bundler provides them to import().
      "@/components/derslik/workspace": { __esModule: true, default: "WorkspaceView" },
      "@/components/derslik/portal": { __esModule: true, Portal: "PortalView" },
    },
    globals: {
      BroadcastChannel: bus,
      location: { reload: () => reloads.push(name), search: "" },
    },
    suffix:
      "module.exports.useAccountAcrossTabs = useAccountAcrossTabs; module.exports.Workspace = Workspace; module.exports.Portal = Portal;",
  });
  function Tab({ session, signedOut }) {
    m.useAccountAcrossTabs(session, signedOut);
    return null;
  }
  return { m, renderer, factories, show: (props) => renderer.render(Tab, props) };
}

function broadcastBus() {
  const open = new Set();
  return class FakeChannel {
    constructor(channel) {
      this.channel = channel;
      this.onmessage = null;
      open.add(this);
    }
    postMessage(data) {
      for (const other of open)
        if (other !== this && other.channel === this.channel)
          other.onmessage?.({ data });
    }
    close() {
      open.delete(this);
    }
    static get open() {
      return open.size;
    }
  };
}

const signedIn = (id) => ({ user: { id, email: id + "@example.test" }, list: [], active: null });

test("a sign-in as another account in one tab reloads the other tab", () => {
  const bus = broadcastBus(),
    reloads = [];
  const a = connectedWorkspace({ bus, reloads, name: "tab-a" });
  const b = connectedWorkspace({ bus, reloads, name: "tab-b" });
  a.show({ session: signedIn("A"), signedOut: false });
  // Same account opening another tab: nothing reloads.
  b.show({ session: signedIn("A"), signedOut: false });
  assert.deepEqual(reloads, []);
  // Tab b signs in as B: tab a must stop showing A's screen.
  b.show({ session: signedIn("B"), signedOut: false });
  assert.deepEqual(reloads, ["tab-a"]);
  // Signing out anywhere also reloads the signed-in tab.
  a.show({ session: null, signedOut: true });
  assert.deepEqual(reloads, ["tab-a", "tab-b"]);
  a.renderer.unmount();
  b.renderer.unmount();
  assert.equal(bus.open, 0, "channels are closed on unmount");
});

test("a tab still loading its session neither announces nor listens", () => {
  const bus = broadcastBus(),
    reloads = [];
  const loading = connectedWorkspace({ bus, reloads, name: "loading" });
  const other = connectedWorkspace({ bus, reloads, name: "other" });
  loading.show({ session: null, signedOut: false });
  other.show({ session: signedIn("B"), signedOut: false });
  assert.equal(bus.open, 1);
  assert.deepEqual(reloads, []);
});

test("workspace and portal load lazily behind the same loading screen", async () => {
  const bus = broadcastBus();
  const { m, factories } = connectedWorkspace({ bus, reloads: [], name: "t" });
  const workspace = m.Workspace({ connected: { id: "ws" } });
  assert.equal(workspace.type, "Suspense");
  assert.equal(workspace.props.children.type, "Lazy1");
  assert.equal(workspace.props.children.props.connected.id, "ws");
  assert.equal(workspace.props.fallback.props.className, "connection-state");
  assert.equal(m.Portal({ access: null }).props.children.type, "Lazy2");
  assert.equal((await factories[0]()).default, "WorkspaceView");
  assert.equal((await factories[1]()).default, "PortalView");
});

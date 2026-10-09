import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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

/** Web'in mesajlar görünümü gerçek kaynağıyla; soket, backend ve pencere
 *  olayları kayıt tutan sahte nesneler. `reply` her isteğin yanıtını verir.
 *  `live` soketin bağlı olup olmadığıdır; kurulan yoklama aralıkları ve
 *  pencere odak dinleyicileri kaydedilir, test onları elle tetikler. */
function chatModule(reply, { live = true } = {}) {
  const renderer = createTsxFixture();
  const requests = [],
    inbox = [];
  const socket = { handler: null, live };
  const timers = new Map(),
    focus = new Set();
  let timerId = 0,
    skipped = 0;
  // Modülün gördüğü saat; test ileri sarar (yoklama ve odak sınırları).
  class ShiftedDate extends Date {
    static now() {
      return Date.now() + skipped;
    }
  }
  const contracts = {
    ...loadTestModule("packages/contracts/src/messages.ts", {
      dependencies: {
        zod: createRequire(import.meta.url)("zod"),
        "./i18n/index.ts": { t: (key) => key },
      },
    }),
    t: (key) => key,
    intlLocale: () => "tr-TR",
    lower: (text) => text.toLowerCase(),
    timeAgo: () => "",
    dateKey: (iso) => String(iso).slice(0, 10),
    addDays: (key) => key,
    dayLabel: (iso) => iso.slice(0, 10),
    timeLabel: (iso) => iso.slice(11, 16),
  };
  const { eventConcerns } = loadTestModule("packages/api-client/src/socket.ts");
  const m = loadTestModule("apps/web/components/derslik/messages.tsx", {
    // Yazışma bileşeni dışa açık değil; yalnızca bu test için.
    suffix: "exports.Conversation = Conversation;",
    dependencies: {
      react: { ...renderer.react, useId: () => "id", useLayoutEffect() {} },
      "react/jsx-runtime": renderer.jsx,
      "@derslik/api-client": { ApiError, eventConcerns },
      "@/lib/message-socket": {
        useMessageEvents(handler, enabled = true) {
          if (enabled) socket.handler = handler;
        },
        useSocketLive: () => socket.live,
      },
      "@derslik/contracts": contracts,
      "lucide-react": {},
      cn: { cn: () => "" },
      "@/lib/client": {
        backend: async (path, body) => {
          requests.push(body === undefined ? `GET ${path}` : `POST ${path}`);
          return structuredClone(await reply(path, body));
        },
      },
      "@/lib/chat-drafts": { getChatDraft: () => undefined, setChatDraft() {} },
      "@/components/ui/badge": {},
      "@/components/ui/button": {},
      "@/components/ui/empty": {},
      "@/components/ui/input-group": {},
      "@/components/ui/item": {},
      "@/components/ui/textarea": {},
      "@/components/ui/toggle": {},
      "./feedback": {},
      "./loading": {},
    },
    globals: {
      structuredClone,
      Event: class {
        constructor(type) {
          this.type = type;
        }
      },
      window: {
        dispatchEvent: (event) => inbox.push(event.type),
        addEventListener: (type, listener) => {
          if (type === "focus") focus.add(listener);
        },
        removeEventListener: (type, listener) => focus.delete(listener),
      },
      document: {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {},
      },
      setInterval: (run, every) => {
        timers.set(++timerId, { run, every });
        return timerId;
      },
      clearInterval: (id) => timers.delete(id),
      Date: ShiftedDate,
      CSS: { supports: () => true },
    },
  });
  return {
    m,
    renderer,
    requests,
    inbox,
    emit: (event) => socket.handler(event),
    setLive: (value) => (socket.live = value),
    /** Şu an kurulu yoklama aralıkları (ms). */
    polls: () => [...timers.values()].map((t) => t.every),
    firePolls: () => [...timers.values()].forEach((t) => t.run()),
    focusWindow: () => [...focus].forEach((listener) => listener()),
    advance: (ms) => (skipped += ms),
  };
}

function chatListModule(options) {
  let rows = [];
  const f = chatModule(async () => ({ data: rows }), options);
  let store;
  const View = () => {
    store = f.m.useMessageThreads("/workspaces/w-1/messages");
    return null;
  };
  return {
    ...f,
    setRows: (value) => (rows = value),
    render: () => (f.renderer.render(View), store),
  };
}

const chatRow = {
  linkId: "l-1",
  role: "STUDENT",
  studentId: "s-1",
  studentName: "Öğrenci",
  teacherName: "Öğretmen",
  guardianEmail: null,
  viewer: "OWNER",
  canSend: true,
  active: true,
  guardianReaders: 0,
  lastBody: "Eski",
  lastAt: "2026-10-07T09:00:00.000Z",
  lastMine: true,
  unread: 0,
};
const chatEvent = (type, extra = {}) => ({
  type,
  workspace: "w-1",
  student: "s-1",
  thread: "l-1",
  ...extra,
});
const chatMessage = (id, at, mine, body = "Merhaba") => ({
  id,
  senderRole: mine ? "OWNER" : "STUDENT",
  mine,
  body,
  createdAt: `2026-10-07T10:00:0${at}.000Z`,
});
// useCoalesced olayları 250 ms toplar.
const afterEvents = () => new Promise((resolve) => setTimeout(resolve, 300));

test("a socket message with its content updates the thread list without any request", async () => {
  const f = chatListModule();
  f.setRows([chatRow]);
  f.render();
  await tick();
  f.render();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
  f.requests.length = 0;

  // Karşı taraftan: satır güncellenir, zil (bildirim) yenilenir.
  f.emit(chatEvent("message", { message: chatMessage("m-1", 1, false) }));
  await afterEvents();
  let row = f.render().threads[0];
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.inbox, ["derslik:inbox"]);
  assert.equal(row.unread, 1);
  assert.equal(row.lastBody, "Merhaba");
  assert.equal(row.lastMine, false);

  // Kendi mesajı (bu ya da başka sekmeden): ne istek ne zil.
  f.inbox.length = 0;
  f.emit(chatEvent("message", { message: chatMessage("m-2", 2, true, "Tamam") }));
  await afterEvents();
  row = f.render().threads[0];
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.inbox, []);
  assert.equal(row.lastBody, "Tamam");
  assert.equal(row.unread, 1);

  // Aynı mesaj ikinci kez gelirse sayaç yine artmaz.
  f.emit(chatEvent("message", { message: chatMessage("m-1", 1, false) }));
  await afterEvents();
  assert.equal(f.render().threads[0].unread, 1);
  assert.deepEqual(f.requests, []);
});

test("a read event that the list already reflects costs no request", async () => {
  const f = chatListModule();
  f.setRows([chatRow]);
  f.render();
  await tick();
  f.render();
  f.requests.length = 0;
  // Bu sekme okudu (satır okunmuş); sunucudan yankı gelir.
  f.emit(chatEvent("read"));
  await afterEvents();
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.inbox, []);

  // Başka sekme, burada okunmamış görünen yazışmayı okudu: liste ve zil yenilenir.
  f.emit(chatEvent("message", { message: chatMessage("m-1", 1, false) }));
  await afterEvents();
  f.render();
  f.inbox.length = 0;
  f.emit(chatEvent("read"));
  await afterEvents();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
  assert.deepEqual(f.inbox, ["derslik:inbox"]);
});

test("socket events without usable content still reload the thread list", async () => {
  const f = chatListModule();
  f.setRows([chatRow]);
  f.render();
  await tick();
  f.render();
  f.requests.length = 0;
  // Eski sunucu ya da bozuk mesaj: yalnızca yazışma kimliği.
  f.emit(chatEvent("message"));
  await afterEvents();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
  // Listede olmayan yazışma.
  f.requests.length = 0;
  f.emit(
    chatEvent("message", { thread: "l-2", message: chatMessage("m-9", 3, false) }),
  );
  await afterEvents();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
  // Başka çalışma alanının olayı bu listeyi ilgilendirmez.
  f.requests.length = 0;
  f.emit(chatEvent("message", { workspace: "w-2" }));
  await afterEvents();
  assert.deepEqual(f.requests, []);
});

/** Açık yazışma (Conversation): ilk sayfa bir mesajla gelir. Okundu istekleri
 *  `reads` ile tutulabilir. */
function chatConversation({ holdReads = false, live = true } = {}) {
  const upserts = [],
    reads = [];
  const path = "/workspaces/w-1/messages/l-1";
  const f = chatModule((url, body) => {
    if (url === path + "/read") {
      if (!holdReads) return { data: { read: true } };
      const d = deferred();
      reads.push({ body, release: () => d.resolve({ data: { read: true } }) });
      return d.promise;
    }
    return {
      data: {
        thread: chatRow,
        messages: [chatMessage("m-0", 0, true, "İlk")],
        more: false,
      },
    };
  }, { live });
  const props = {
    base: "/workspaces/w-1/messages",
    linkId: "l-1",
    summary: chatRow,
    store: { upsert: (_id, change) => upserts.push(change) },
    teacher: true,
    refreshAt: 0,
  };
  return {
    ...f,
    path,
    upserts,
    reads,
    render: () => f.renderer.render(f.m.Conversation, props),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}
const bodies = (tree) =>
  JSON.stringify(tree).match(/"(İlk|Merhaba[^"]*|Tamam)"/g) ?? [];

test("an open conversation shows a socket message without fetching the page again", async () => {
  const f = chatConversation();
  f.render();
  await tick();
  f.render();
  assert.deepEqual(f.requests, [`GET ${f.path}?limit=50`, `POST ${f.path}/read`]);
  f.requests.length = 0;
  f.upserts.length = 0;

  // Karşı taraftan: ekrana eklenir, okundu bildirilir; sayfa yeniden istenmez.
  const incoming = chatMessage("m-1", 1, false, "Merhaba yeni");
  f.emit(chatEvent("message", { message: incoming }));
  await tick();
  let tree = f.render();
  assert.deepEqual(f.requests, [`POST ${f.path}/read`]);
  assert.deepEqual(bodies(tree), ['"İlk"', '"Merhaba yeni"']);
  // Liste satırı yeni son mesajla ve okunmuş olarak güncellenir.
  assert.equal(f.upserts.at(-1).lastBody, "Merhaba yeni");
  assert.equal(f.upserts.at(-1).unread, 0);

  // Başka sekmeden gönderilen kendi mesajı: eklenir, okundu gerekmez.
  f.requests.length = 0;
  f.emit(chatEvent("message", { message: chatMessage("m-2", 2, true, "Tamam") }));
  await tick();
  tree = f.render();
  assert.deepEqual(f.requests, []);
  assert.deepEqual(bodies(tree), ['"İlk"', '"Merhaba yeni"', '"Tamam"']);

  // Ekranda olan mesaj (bu sekme gönderdi) yeniden gelirse hiçbir şey olmaz.
  f.emit(chatEvent("message", { message: chatMessage("m-2", 2, true, "Tamam") }));
  await afterEvents();
  tree = f.render();
  assert.deepEqual(f.requests, []);
  assert.equal(bodies(tree).length, 3);

  // Başka yazışmanın mesajı bu yazışmayı ilgilendirmez.
  f.emit(chatEvent("message", { thread: "l-2", message: chatMessage("m-3", 3, false) }));
  await afterEvents();
  assert.deepEqual(f.requests, []);

  // İçeriksiz olay: sayfa REST'ten yenilenir.
  f.emit(chatEvent("message"));
  await afterEvents();
  assert.deepEqual(f.requests, [`GET ${f.path}?limit=50`]);
});

test("messages that arrive while a read is in flight are read right after it", async () => {
  const f = chatConversation({ holdReads: true });
  f.render();
  await tick();
  f.render();
  f.reads.shift().release();
  await tick();
  f.render();
  f.requests.length = 0;

  f.emit(chatEvent("message", { message: chatMessage("m-1", 1, false, "Merhaba 1") }));
  await tick();
  f.render();
  f.emit(chatEvent("message", { message: chatMessage("m-2", 2, false, "Merhaba 2") }));
  await tick();
  f.render();
  // İlk okundu sürerken ikincisi gönderilmez, beklenir.
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].body.upTo, chatMessage("m-1", 1).createdAt);
  f.reads.shift().release();
  await tick();
  await tick();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].body.upTo, chatMessage("m-2", 2).createdAt);
  f.reads.shift().release();
  await tick();
  await tick();
  assert.equal(f.upserts.at(-1).lastBody, "Merhaba 2");
  assert.equal(f.upserts.at(-1).unread, 0);
  assert.deepEqual(f.requests, [`POST ${f.path}/read`, `POST ${f.path}/read`]);
});

test("the bell reloads once for a burst of inbox events", async () => {
  const renderer = createTsxFixture();
  const requests = [],
    listeners = new Map();
  const { AccountExtras } = loadTestModule(
    "apps/web/components/derslik/learning/inbox.tsx",
    {
      dependencies: {
        react: renderer.react,
        "react/jsx-runtime": renderer.jsx,
        "@/components/account/subscription": {},
        "@derslik/contracts": { t: (key) => key, intlLocale: () => "tr-TR" },
        "@/lib/client": {
          backend: async (path) => {
            requests.push(path);
            return { data: [] };
          },
        },
        "@/components/ui/button": {},
        "lucide-react": {},
        "@/components/ui/tooltip": {},
        "@/components/derslik/loading": {},
        "@/components/ui/badge": {},
        "@/components/ui/card": {},
        "@/components/ui/empty": {},
        "@/components/ui/progress": {},
        "@/components/ui/sheet": {},
        "@/components/ui/tabs": {},
        "../feedback": {},
      },
      globals: {
        window: {
          addEventListener: (type, listener) => listeners.set(type, listener),
          removeEventListener: (type) => listeners.delete(type),
        },
      },
    },
  );
  renderer.render(AccountExtras, {});
  await tick();
  assert.deepEqual(requests, ["/inbox"]);
  // Yeni mesaj ve hemen ardından okundu: zil bir kez yenilenir.
  listeners.get("derslik:inbox")();
  listeners.get("derslik:inbox")();
  await afterEvents();
  assert.deepEqual(requests, ["/inbox", "/inbox"]);
  renderer.unmount();
  assert.equal(listeners.size, 0);
});

// Soket bağlıyken mesajlar soketten gelir; kopukken yoklama onun yerini tutar.
// Bağlanınca soket `resync` gönderir, aradaki değişiklikler bir kez alınır.

test("the thread list is not polled while the socket is live, and every minute while it is down", async () => {
  const f = chatListModule({ live: true });
  f.setRows([chatRow]);
  f.render();
  await tick();
  f.render();
  assert.deepEqual(f.polls(), []);

  // Soket koptu: liste dakikada bir yoklanır.
  f.setLive(false);
  f.render();
  await tick();
  assert.deepEqual(f.polls(), [60_000]);
  f.requests.length = 0;
  f.advance(31_000);
  f.firePolls();
  await tick();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);

  // Soket yeniden bağlandı: yoklama durur.
  f.setLive(true);
  f.render();
  await tick();
  assert.deepEqual(f.polls(), []);
});

test("going back to the window refreshes the thread list once, even while the socket is live", async () => {
  const f = chatListModule({ live: true });
  f.setRows([chatRow]);
  f.render();
  await tick();
  f.render();
  f.requests.length = 0;
  f.advance(31_000);
  f.focusWindow();
  await tick();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
});

test("an open conversation is not polled while the socket is live, and every 15 s while it is down", async () => {
  const f = chatConversation({ live: true });
  f.render();
  await tick();
  f.render();
  assert.deepEqual(f.polls(), []);

  f.setLive(false);
  f.render();
  await tick();
  assert.deepEqual(f.polls(), [15_000]);
  f.requests.length = 0;
  f.firePolls();
  await tick();
  assert.deepEqual(f.requests, [`GET ${f.path}?limit=50`]);

  f.setLive(true);
  f.render();
  await tick();
  assert.deepEqual(f.polls(), []);
});

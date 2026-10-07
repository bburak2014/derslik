import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { loadTestModule } from "../scripts/test-source-loader.mjs";
import { createTsxFixture, treeNodes } from "./tsx-fixture.mjs";

// Execute application code with deterministic native/network/time adapters.
// No Expo native runtime or production services are used by these regressions.
const root = resolve(import.meta.dirname, "..");
function load(file, dependencies = {}, globals = {}) {
  return loadTestModule(file, { dependencies, globals: { crypto: { randomUUID }, ...globals } });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function confirmationFixture(perform) {
  const alerts = [], errors = [];
  const { confirmAction } = load("apps/mobile/src/ui/feedback.tsx", {
    react: {},
    "react/jsx-runtime": {},
    "react-native": { Alert: { alert: (...args) => alerts.push(args) } },
    "@expo/vector-icons": {},
    "@derslik/contracts": { t: (key) => key },
    "./theme": {},
  });
  confirmAction("Başlık", "Açıklama", perform, (message) => errors.push(message));
  return { buttons: alerts[0][2], errors };
}

test("mobile confirmation runs a synchronous action immediately only after approval", async () => {
  let calls = 0;
  const f = confirmationFixture(() => { calls++; });
  assert.equal(calls, 0);
  assert.equal(f.buttons[0].style, "cancel");
  assert.equal(f.buttons[0].onPress, undefined);
  assert.equal(f.buttons[1].onPress(), undefined);
  assert.equal(calls, 1);
  await settle();
  assert.deepEqual(f.errors, []);
});

for (const [kind, perform] of [
  ["synchronous", () => { throw new Error("İşlem başarısız"); }],
  ["asynchronous", () => Promise.reject(new Error("İşlem başarısız"))],
]) {
  test(`mobile confirmation reports ${kind} action failure once`, async () => {
    const f = confirmationFixture(perform);
    assert.equal(f.buttons[1].onPress(), undefined);
    await settle();
    assert.deepEqual(f.errors, ["İşlem başarısız"]);
  });
}

function socketFixture(ticket, globals = {}) {
  const timers = new Map(),
    sockets = [];
  let nextTimer = 0;
  class Socket {
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      sockets.push(this);
    }
    close(code) {
      this.closed = code;
      this.readyState = 3;
    }
  }
  const { MessageSocket } = load(
    "packages/api-client/src/socket.ts",
    {},
    {
      setTimeout: (callback, wait) => {
        const id = ++nextTimer;
        timers.set(id, { callback, wait });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      ...globals,
    },
  );
  return {
    client: new MessageSocket({ ticket, WebSocket: Socket }),
    sockets,
    timers,
    fire(id) {
      const timer = timers.get(id);
      assert.ok(timer);
      timers.delete(id);
      timer.callback();
    },
  };
}
const validTicket = { ticket: "fixture", url: "wss://fixture.invalid/socket" };

test("late socket ticket from a stopped session cannot connect after restart", async () => {
  const old = deferred(),
    current = deferred();
  let calls = 0;
  const f = socketFixture(() =>
    ++calls === 1 ? old.promise : current.promise,
  );
  f.client.start();
  f.client.stop();
  f.client.start();
  old.resolve({ ...validTicket, ticket: "old-session" });
  await settle();
  assert.equal(f.sockets.length, 0);
  current.resolve({ ...validTicket, ticket: "current-session" });
  await settle();
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].protocols[1], "ticket.current-session");
  f.client.stop();
});

test("failure from a stopped socket ticket cannot schedule a new session retry", async () => {
  const old = deferred(),
    current = deferred();
  let calls = 0;
  const f = socketFixture(() =>
    ++calls === 1 ? old.promise : current.promise,
  );
  f.client.start();
  f.client.stop();
  f.client.start();
  old.reject(new Error("old session request failed"));
  await settle();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].wait, 70000);
  current.resolve(validTicket);
  await settle();
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("unresolved socket ticket times out, aborts and retries without accepting its late response", async () => {
  const old = deferred(),
    current = deferred(),
    signals = [];
  const f = socketFixture((signal) => {
    signals.push(signal);
    return signals.length === 1 ? old.promise : current.promise;
  });
  f.client.start();
  const deadline = [...f.timers].find(([, timer]) => timer.wait === 70000);
  assert.ok(deadline, "Ticket request must have a bounded deadline");
  f.fire(deadline[0]);
  await settle();
  assert.equal(signals[0].aborted, true);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.timers.size, 1);
  f.fire([...f.timers.keys()][0]);
  assert.equal(signals.length, 2);
  old.resolve({ ...validTicket, ticket: "expired-request" });
  await settle();
  assert.equal(f.sockets.length, 0);
  current.resolve(validTicket);
  await settle();
  assert.equal(f.sockets.length, 1);
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("stopping an unresolved socket ticket aborts it and clears its deadline", async () => {
  const pending = deferred();
  let signal;
  const f = socketFixture((next) => {
    signal = next;
    return pending.promise;
  });
  f.client.start();
  assert.equal(f.timers.size, 1);
  f.client.stop();
  assert.equal(signal.aborted, true);
  assert.equal(f.timers.size, 0);
  pending.resolve(validTicket);
  await settle();
  assert.equal(f.sockets.length, 0);
  assert.equal(f.timers.size, 0);
});

test("socket handshake that never opens times out and reconnects", async () => {
  const f = socketFixture(async () => validTicket);
  f.client.start();
  await settle();
  const timer = [...f.timers].find(([, value]) => value.wait === 70000);
  assert.ok(timer, "CONNECTING socket must have a silence deadline");
  f.fire(timer[0]);
  assert.equal(f.sockets[0].closed, 4001);
  assert.equal(f.client.live, false);
  assert.equal(f.timers.size, 1);
  f.fire([...f.timers.keys()][0]);
  await settle();
  assert.equal(f.sockets.length, 2);
  f.client.stop();
  assert.equal(f.timers.size, 0);
});

test("throwing live listener does not prevent resync or other listeners", async () => {
  const f = socketFixture(async () => validTicket);
  let updates = 0,
    resyncs = 0;
  f.client.onLive(() => {
    throw new Error("listener failure");
  });
  f.client.onLive(() => {
    updates += 1;
  });
  f.client.subscribe(() => {
    resyncs += 1;
  });
  f.client.start();
  await settle();
  assert.doesNotThrow(() => f.sockets[0].onopen({}));
  assert.equal(updates, 1);
  assert.equal(resyncs, 1);
  assert.doesNotThrow(() => f.client.stop());
  assert.equal(updates, 2);
  assert.equal(f.sockets[0].closed, 1000);
  assert.equal(f.timers.size, 0);
});

// Uygulama kodu ayrı bir VM bağlamında çalışır; nesneleri bu bağlamın
// nesnelerine çevirip karşılaştırır.
const plain = (value) => JSON.parse(JSON.stringify(value));
const socketThread = {
  type: "message",
  workspace: "w-1",
  student: "s-1",
  thread: "l-1",
};
const socketMessage = {
  id: "m-1",
  senderRole: "STUDENT",
  mine: false,
  body: "Merhaba",
  createdAt: "2026-10-07T10:00:00.000Z",
};

test("socket message events carry the message only when it is well formed", async () => {
  const f = socketFixture(async () => validTicket);
  const events = [];
  f.client.subscribe((event) => events.push(event));
  f.client.start();
  await settle();
  f.sockets[0].onopen({});
  const frame = (value) => f.sockets[0].onmessage({ data: JSON.stringify(value) });
  frame({ ...socketThread, message: { ...socketMessage, extra: "x" } });
  // Bozuk mesaj olayı düşürmez: istemci yazışmayı REST'ten yeniler.
  frame({ ...socketThread, message: { ...socketMessage, body: 5 } });
  frame({ ...socketThread, message: { ...socketMessage, senderRole: "ADMIN" } });
  frame({ ...socketThread, message: { ...socketMessage, createdAt: "dün" } });
  frame(socketThread);
  // Okundu olayı mesaj taşımaz.
  frame({ ...socketThread, type: "read", message: socketMessage });
  assert.deepEqual(plain(events), [
    { type: "resync" },
    { ...socketThread, message: socketMessage },
    socketThread,
    socketThread,
    socketThread,
    socketThread,
    { ...socketThread, type: "read" },
  ]);
  f.client.stop();
});

function chatContracts() {
  return load("packages/contracts/src/messages.ts", {
    zod: createRequire(import.meta.url)("zod"),
    "./i18n/index.ts": { t: (key) => key },
  });
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
  unread: 2,
};

test("a socket message updates the thread row as the server's list would", () => {
  const { threadWithMessage } = chatContracts();
  const long = "ğ".repeat(150) + "😀".repeat(100);
  assert.deepEqual(
    plain(threadWithMessage(chatRow, { ...socketMessage, body: long })),
    {
      ...chatRow,
      // Sunucunun önizlemesi gibi ilk 200 karakter (emoji tek karakter).
      lastBody: "ğ".repeat(150) + "😀".repeat(50),
      lastAt: socketMessage.createdAt,
      lastMine: false,
      unread: 3,
    },
  );
  // Kendi mesajı okunmamışı artırmaz.
  assert.deepEqual(plain(threadWithMessage(chatRow, { ...socketMessage, mine: true })), {
    ...chatRow,
    lastBody: "Merhaba",
    lastAt: socketMessage.createdAt,
    lastMine: true,
  });
  // Mesajı ilk kez alan boş yazışma.
  assert.equal(
    threadWithMessage({ ...chatRow, lastAt: null, lastBody: null, unread: 0 }, socketMessage)
      .unread,
    1,
  );
});

test("a thread row that already shows the message or a newer one is left alone", () => {
  const { threadWithMessage } = chatContracts();
  assert.equal(
    threadWithMessage({ ...chatRow, lastAt: socketMessage.createdAt }, socketMessage),
    null,
  );
  assert.equal(
    threadWithMessage({ ...chatRow, lastAt: "2026-10-07T10:00:00.001Z" }, socketMessage),
    null,
  );
});

test("a socket message moves its thread to the top of the list like the server's order", () => {
  const { threadsWithMessage } = chatContracts();
  const rows = [
    { ...chatRow, linkId: "a", lastAt: "2026-10-07T09:30:00.000Z" },
    { ...chatRow, linkId: "b", lastAt: "2026-10-07T09:00:00.000Z" },
    { ...chatRow, linkId: "c", lastAt: "2026-10-07T09:00:00.000Z" },
    { ...chatRow, linkId: "d", lastAt: null, lastBody: null },
  ];
  const ids = (list) => list.map((x) => x.linkId);
  const moved = threadsWithMessage(rows, "c", socketMessage);
  assert.deepEqual(ids(moved), ["c", "a", "b", "d"]);
  assert.equal(moved[0].lastBody, "Merhaba");
  assert.equal(moved[1], rows[0], "other rows are kept as they are");
  // Mesajı ilk kez alan boş yazışma da başa geçer.
  assert.deepEqual(ids(threadsWithMessage(rows, "d", socketMessage)), ["d", "a", "b", "c"]);
  // Listede olmayan ya da mesajı zaten gösteren yazışma: değişiklik yok.
  assert.equal(threadsWithMessage(rows, "x", socketMessage), null);
  assert.equal(threadsWithMessage(moved, "c", socketMessage), null);
});

/** Mobil mesajlar ekranı gerçek kaynağıyla; `reply` her isteğin yanıtını
 *  verir, soket olayları `emit` ile gelir. */
function mobileChat(reply) {
  const renderer = createTsxFixture();
  const requests = [],
    socket = { handler: null };
  const anything = new Proxy({}, { get: () => ({}) });
  const { eventConcerns } = load("packages/api-client/src/socket.ts");
  const m = load("apps/mobile/src/messages.tsx", {
    react: { ...renderer.react, memo: (component) => component },
    "react/jsx-runtime": renderer.jsx,
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener: () => ({ remove() {} }),
      },
      AccessibilityInfo: { announceForAccessibility() {} },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
    "@expo/vector-icons": {},
    "expo-crypto": { randomUUID },
    "@derslik/api-client": { ApiError: class extends Error {}, eventConcerns },
    "./message-socket": {
      useMessageEvents(handler, enabled = true) {
        if (enabled) socket.handler = handler;
      },
      useSocketLive: () => true,
    },
    "@derslik/contracts": {
      ...chatContracts(),
      t: (key) => key,
      lower: (text) => text.toLowerCase(),
      timeAgo: () => "",
      dateKey: (iso) => String(iso).slice(0, 10),
      addDays: (key) => key,
      dayLabel: (iso) => iso.slice(0, 10),
      timeLabel: (iso) => iso.slice(11, 16),
    },
    "./core": {
      request: async (path, body) => {
        requests.push(body === undefined ? `GET ${path}` : `POST ${path}`);
        return plain(await reply(path, body));
      },
    },
    "./ui": {
      radius: anything,
      ripple: () => ({}),
      useTheme: () => ({ colors: anything, styles: anything, section: anything }),
    },
  }, { setInterval: () => 0, clearInterval() {} });
  return { m, renderer, requests, emit: (event) => socket.handler(event) };
}
const mobileEvent = (type, extra = {}) => ({ ...socketThread, workspace: "w-1", type, ...extra });
const mobileMessage = (id, second, mine, body = "Merhaba") => ({
  id,
  senderRole: mine ? "OWNER" : "STUDENT",
  mine,
  body,
  createdAt: `2026-10-07T10:00:0${second}.000Z`,
});
const coalesced = () => new Promise((resolve) => setTimeout(resolve, 300));

test("mobile thread list takes a socket message without a request and reorders", async () => {
  const rows = [
    { ...chatRow, linkId: "a", unread: 0, lastAt: "2026-10-07T09:30:00.000Z" },
    { ...chatRow, linkId: "l-1", unread: 0 },
  ];
  const f = mobileChat(async () => ({ data: rows }));
  let state;
  const View = () => {
    state = f.m.useMessages("/workspaces/w-1/messages");
    return null;
  };
  f.renderer.render(View);
  await settle();
  f.renderer.render(View);
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
  f.requests.length = 0;

  f.emit(mobileEvent("message", { message: mobileMessage("m-1", 1, false) }));
  await coalesced();
  f.renderer.render(View);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(state.threads.map((x) => x.linkId), ["l-1", "a"]);
  assert.equal(state.badge, 1);

  // Okundu yankısı, satır zaten okunmuş görünüyorsa istek göndermez.
  f.emit(mobileEvent("read", { thread: "a" }));
  await coalesced();
  assert.deepEqual(f.requests, []);
  // Burada okunmamış görünen yazışma başka cihazda okundu: liste yenilenir.
  f.emit(mobileEvent("read"));
  await coalesced();
  assert.deepEqual(f.requests, ["GET /workspaces/w-1/messages"]);
});

/** Açık mobil yazışma; okundu istekleri `holdReads` ile bekletilebilir. */
function mobileConversation({ holdReads = false } = {}) {
  const url = "/workspaces/w-1/messages/l-1",
    reads = [],
    updates = [];
  const f = mobileChat((path, body) => {
    if (path === url + "/read") {
      if (!holdReads) return { data: { read: true } };
      const d = deferred();
      reads.push({ upTo: body.upTo, release: () => d.resolve({ data: { read: true } }) });
      return d.promise;
    }
    if (path === url && body)
      return { data: { id: "m-sent", createdAt: "2026-10-07T10:00:05.000Z" } };
    return {
      data: {
        thread: { ...chatRow, unread: 0 },
        messages: [mobileMessage("m-0", 0, true, "İlk")],
        more: false,
      },
    };
  });
  const props = {
    path: "/workspaces/w-1/messages",
    linkId: "l-1",
    initial: chatRow,
    onUpdate: (thread) => updates.push(thread),
    onRead() {},
  };
  return {
    ...f,
    url,
    reads,
    updates,
    render: () => f.renderer.render(f.m.Conversation, props),
  };
}
const shownBodies = (tree) =>
  JSON.stringify(tree).match(/"(İlk|Merhaba[^"]*|Tamam|Selam)"/g) ?? [];

test("mobile conversation shows socket messages and sends without fetching the page", async () => {
  const f = mobileConversation();
  f.render();
  await settle();
  f.render();
  assert.deepEqual(f.requests, [`GET ${f.url}`, `POST ${f.url}/read`]);
  f.requests.length = 0;

  f.emit(mobileEvent("message", { message: mobileMessage("m-1", 1, false, "Merhaba yeni") }));
  await settle();
  let tree = f.render();
  assert.deepEqual(f.requests, [`POST ${f.url}/read`]);
  assert.deepEqual(shownBodies(tree), ['"İlk"', '"Merhaba yeni"']);
  assert.equal(f.updates.at(-1).lastBody, "Merhaba yeni");
  assert.equal(f.updates.at(-1).unread, 0);

  // Gönderim: yalnızca POST; yanıttaki mesaj eklenir, liste satırı güncellenir.
  f.requests.length = 0;
  treeNodes(tree).find((node) => node.props.onChangeText).props.onChangeText("Selam");
  tree = f.render();
  treeNodes(tree)
    .find((node) => node.props.onPress && JSON.stringify(node.props.children ?? "").includes("chat.send"))
    .props.onPress();
  await settle();
  tree = f.render();
  assert.deepEqual(f.requests, [`POST ${f.url}`]);
  assert.deepEqual(shownBodies(tree), ['"İlk"', '"Merhaba yeni"', '"Selam"']);
  assert.equal(f.updates.at(-1).lastBody, "Selam");
  assert.equal(f.updates.at(-1).lastMine, true);

  // Aynı mesajın soket yankısı bir şey değiştirmez.
  f.emit(mobileEvent("message", { message: { ...mobileMessage("m-sent", 5, true, "Selam") } }));
  await coalesced();
  tree = f.render();
  assert.deepEqual(f.requests, [`POST ${f.url}`]);
  assert.equal(shownBodies(tree).length, 3);

  // İçeriksiz olay: yazışma yenilenir.
  f.emit(mobileEvent("message"));
  await coalesced();
  assert.deepEqual(f.requests, [`POST ${f.url}`, `GET ${f.url}`]);
});

test("mobile conversation reads messages that arrive during a read right after it", async () => {
  const f = mobileConversation({ holdReads: true });
  f.render();
  await settle();
  f.render();
  f.reads.shift().release();
  await settle();
  f.render();
  f.emit(mobileEvent("message", { message: mobileMessage("m-1", 1, false, "Merhaba 1") }));
  await settle();
  f.render();
  f.emit(mobileEvent("message", { message: mobileMessage("m-2", 2, false, "Merhaba 2") }));
  await settle();
  f.render();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].upTo, mobileMessage("m-1", 1).createdAt);
  f.reads.shift().release();
  await settle();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].upTo, mobileMessage("m-2", 2).createdAt);
  f.reads.shift().release();
  await settle();
  assert.equal(f.updates.at(-1).lastBody, "Merhaba 2");
  assert.equal(f.updates.at(-1).unread, 0);
});

function storageFixture() {
  const values = new Map(),
    operations = [];
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    async getItemAsync(key) {
      operations.push(["get", key]);
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      operations.push(["set", key]);
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      operations.push(["delete", key]);
      values.delete(key);
    },
  };
  const { secureStorage } = load("apps/mobile/src/core.ts", {
    "react-native-url-polyfill/auto": {},
    "react-native": { AppState: {} },
    "expo-secure-store": secureStore,
    "expo-crypto": { randomUUID },
    "@supabase/supabase-js": {
      createClient() {
        throw new Error("Unexpected native client");
      },
    },
    "@derslik/api-client": {
      DerslikClient: class {},
      ApiError: class extends Error {},
    },
  });
  return { secureStorage, values, operations };
}

for (const raw of [
  "{",
  "null",
  "false",
  "[]",
  '{"generation":null,"count":1}',
  '{"generation":"../other","count":1}',
  '{"generation":"x","count":129}',
]) {
  test(`corrupt SecureStore manifest is bounded and recoverable: ${raw}`, async () => {
    const f = storageFixture();
    f.values.set("session", raw);
    assert.equal(await f.secureStorage.getItem("session"), null);
    assert.equal(
      f.operations.length,
      1,
      "Invalid manifest must not read chunks",
    );
    await f.secureStorage.setItem("session", "new-session");
    assert.equal(await f.secureStorage.getItem("session"), "new-session");
    await f.secureStorage.removeItem("session");
    assert.equal(f.values.size, 0);
  });
  test(`logout removes corrupt SecureStore manifest without reading foreign chunks: ${raw}`, async () => {
    const f = storageFixture();
    f.values.set("session", raw);
    await f.secureStorage.removeItem("session");
    assert.equal(f.values.size, 0);
    assert.equal(f.operations.length, 2);
  });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
test("web request preserves HTTP error status for non-JSON and null payloads", async () => {
  for (const payload of [
    "<html>Bad gateway</html>",
    "null",
    '"proxy failure"',
  ]) {
    const { webRequest } = load(
      "apps/web/lib/client.ts",
      {
        "@derslik/api-client": { ApiError },
        "@derslik/contracts": { t: (key) => key },
      },
      { fetch: async () => new Response(payload, { status: 502 }) },
    );
    await assert.rejects(
      () => webRequest("/api/workspace"),
      (error) => error instanceof ApiError && error.status === 502,
    );
  }
});

test("web request retains failed mutation retry keys until a valid successful response", async () => {
  const keys = [];
  let attempts = 0;
  const { webRequest } = load(
    "apps/web/lib/client.ts",
    {
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { t: (key) => key },
    },
    {
      fetch: async (_, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return ++attempts === 1
          ? new Response("<html>Bad gateway</html>", { status: 502 })
          : Response.json({ ok: true });
      },
    },
  );
  const body = { action: "student.create", name: "Fixture" };
  await assert.rejects(() => webRequest("/api/workspace", body));
  await webRequest("/api/workspace", body);
  await webRequest("/api/workspace", body);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("web retry keys distinguish different HTTP methods at the same URL", async () => {
  const keys = [];
  const { webRequest } = load(
    "apps/web/lib/client.ts",
    {
      "@derslik/api-client": { ApiError },
      "@derslik/contracts": { t: (key) => key },
    },
    {
      fetch: async (_, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return new Response("Gateway failure", { status: 502 });
      },
    },
  );
  await assert.rejects(() => webRequest("/api/backend/profile", {}, "POST"));
  await assert.rejects(() => webRequest("/api/backend/profile", {}, "PUT"));
  assert.notEqual(keys[0], keys[1]);
});

function apiFixture(payload, status) {
  return load(
    "packages/api-client/src/index.ts",
    {
      "../../contracts/src/i18n/index.ts": {
        t: (key) => key,
        getLocale: () => "en",
      },
      "./uploads.ts": {},
      "./socket.ts": {},
    "./lesson-board.ts": {},
    "./board-tools.ts": {},
    },
    { fetch: async () => new Response(payload, { status }) },
  );
}

test("shared API client preserves HTTP status for malformed error payloads", async () => {
  for (const payload of [
    "Bad gateway",
    "null",
    '"proxy failure"',
    '{"error":{"message":3,"requestId":[]}}',
  ]) {
    const api = apiFixture(payload, 502);
    const client = new api.DerslikClient({
      baseUrl: "https://fixture.invalid",
      getToken: async () => "fixture",
    });
    await assert.rejects(
      () => client.access(),
      (error) =>
        error instanceof api.ApiError &&
        error.status === 502 &&
        error.message === "common.failed" &&
        error.requestId === undefined,
    );
  }
});

test("shared API client rejects unreadable successful responses", async () => {
  for (const payload of ["<html>Upstream error</html>", "null"]) {
    const api = apiFixture(payload, 200);
    const client = new api.DerslikClient({
      baseUrl: "https://fixture.invalid",
      getToken: async () => "fixture",
    });
    await assert.rejects(
      () => client.access(),
      (error) => error instanceof api.ApiError && error.status === 502,
    );
  }
});

function linking(hostUri) {
  return load("apps/mobile/node_modules/expo-linking/build/createURL.js", {
    "expo-constants": {
      expoConfig: { hostUri },
      linkingUri: hostUri ? `exp://${hostUri}` : "derslik://",
    },
    "./Schemes": {
      hasCustomScheme: () => !hostUri,
      resolveScheme: () => (hostUri ? "exp" : "derslik"),
    },
    "./validateURL": { validateURL() {} },
  });
}
function oauthFixture(hostUri) {
  const calls = [];
  return {
    ...load("apps/mobile/src/oauth.ts", {
      "expo-web-browser": { maybeCompleteAuthSession() {} },
      "expo-linking": linking(hostUri),
      "./core": {
        configuration: {},
        supabase: {
          auth: {
            async exchangeCodeForSession(code) {
              calls.push(code);
              return { error: null };
            },
          },
        },
      },
      "@derslik/contracts": { t: (key) => key },
    }),
    calls,
  };
}

test("Expo OAuth rejects a different server port and URL credentials", async () => {
  const f = oauthFixture("127.0.0.1:8081");
  assert.equal(
    f.authRoute("exp://127.0.0.1:8081/--/auth/callback"),
    "callback",
  );
  for (const value of [
    "exp://127.0.0.1:8082/--/auth/callback?code=foreign",
    "exp://127.0.0.1/--/auth/callback?code=foreign",
    "exp://user@127.0.0.1:8081/--/auth/callback?code=foreign",
  ]) {
    assert.equal(f.authRoute(value), null);
    assert.equal(await f.completeAuthLink(value), false);
  }
  assert.equal(f.calls.length, 0);
});

test("standalone OAuth rejects credentials and preserves supported auth routes", () => {
  const f = oauthFixture(null);
  for (const route of ["callback", "confirm", "recovery"])
    assert.equal(f.authRoute(`derslik://auth/${route}`), route);
  assert.equal(f.authRoute("derslik://user@auth/callback"), null);
});

test("chat drafts are kept per thread, emptied text removes them, and logout clears them", () => {
  const { getChatDraft, setChatDraft, clearChatDrafts } = load(
    "apps/web/lib/chat-drafts.ts",
  );
  const first = "/workspaces/fixture/messages/thread-one";
  const second = "/portal/fixture/student/messages/thread-two";
  assert.equal(getChatDraft(first), undefined);
  setChatDraft(first, "Unsent teacher message");
  setChatDraft(second, "Unsent student message");
  assert.equal(getChatDraft(first), "Unsent teacher message");
  assert.equal(getChatDraft(second), "Unsent student message");
  setChatDraft(first, "");
  assert.equal(getChatDraft(first), undefined);
  assert.equal(getChatDraft(second), "Unsent student message");
  setChatDraft(first, "Unsent teacher message");
  clearChatDrafts();
  assert.equal(getChatDraft(first), undefined);
  assert.equal(getChatDraft(second), undefined);
});

test("actual Tailwind dark variant compiles both nesting branches under a class scoping root", async () => {
  const { compile } = await import("tailwindcss");
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve("@tailwindcss/postcss"));
  const postcss = pluginRequire("postcss");
  const source = readFileSync(
    resolve(root, "apps/web/app/globals.css"),
    "utf8",
  );
  const start = source.indexOf("@custom-variant dark");
  const end = source.indexOf(
    "/* ==================================================================",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const compiler = await compile(
    `${source.slice(start, end)}\n@tailwind utilities;\n@utility sonar-theme-audit { color: #010203; }`,
  );
  const compiled = compiler.build(["dark:sonar-theme-audit"]);
  const css = postcss.parse(compiled);
  const variants = [];
  css.walkRules((rule) => {
    if (!rule.selector.startsWith("&")) return;
    let scope = rule.parent;
    while (scope && scope.type !== "rule") scope = scope.parent;
    assert.equal(scope?.selector, ".dark\\:sonar-theme-audit");
    variants.push(rule);
  });
  assert.equal(variants.length, 2);
  assert.equal(variants[0].selector, "&:where(.dark, .dark *)");
  assert.equal(variants[1].selector, "&:where(:not(.light), :not(.light *))");
  assert.equal(variants[1].parent.type, "atrule");
  assert.equal(variants[1].parent.name, "media");
  assert.equal(variants[1].parent.params, "(prefers-color-scheme: dark)");
  css.walkAtRules((rule) => {
    assert.ok(
      !["custom-variant", "slot", "tailwind", "utility"].includes(rule.name),
    );
  });
});

test("socket PRNG affects bounded retry timing while provider-issued authentication tickets stay intact", async () => {
  for (const random of [0, 0.5, 0.999999]) {
    let attempts = 0;
    const f = socketFixture(
      async () => {
        if (++attempts <= 8)
          throw new Error("Transient ticket service failure");
        return {
          ...validTicket,
          ticket: "provider-issued-authentication-ticket",
        };
      },
      { Math: { min: Math.min, random: () => random } },
    );
    f.client.start();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await settle();
      assert.equal(f.sockets.length, 0);
      assert.equal(f.timers.size, 1);
      const [id, timer] = [...f.timers][0];
      const cap = Math.min(30000, 1000 * 2 ** attempt);
      assert.ok(timer.wait >= cap / 2 && timer.wait <= cap);
      assert.equal(timer.wait, cap * (0.5 + random / 2));
      f.fire(id);
    }
    await settle();
    assert.equal(f.sockets.length, 1);
    assert.equal(f.sockets[0].url, validTicket.url);
    assert.equal(
      f.sockets[0].protocols[1],
      "ticket.provider-issued-authentication-ticket",
    );
    f.client.stop();
    assert.equal(f.timers.size, 0);
  }
});

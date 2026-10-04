import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  boardColors,
  boardPointSchema,
  boardStrokeInputSchema,
  boardWidths,
  isMeetingUrl,
  lessonBoardCommandSchema,
  maxBoardPoints,
  meetingUrlSchema,
} from "../packages/contracts/src/live-lesson.ts";
import { loadTestModule } from "../scripts/test-source-loader.mjs";
import * as liveContracts from "../packages/contracts/src/live-lesson.ts";
import { createTsxFixture, oneNode, treeNodes, treeText } from "./tsx-fixture.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const stroke = (overrides = {}) => ({
  id: randomUUID(),
  points: [{ x: 0.25, y: 0.75 }],
  color: boardColors[0],
  width: boardWidths[0],
  ...overrides,
});
const board = (revision = 1, overrides = {}) => ({
  id: "lesson-1",
  revision,
  epoch: 0,
  viewerId: "teacher-1",
  canEdit: true,
  canClear: true,
  strokes: [],
  ...overrides,
});

test("meeting links accept supported HTTPS providers and normalize outer whitespace", () => {
  for (const value of [
    "https://meet.google.com/abc-defg-hij",
    "https://teams.microsoft.com/l/meetup-join/meeting-id?context=example",
    "https://teams.live.com/meet/meeting-id",
    "https://meet.jit.si/DerslikDersOdasi",
    "https://zoom.us/j/123456789",
    "https://school.zoom.us/j/123456789?pwd=join-token",
  ]) {
    assert.equal(isMeetingUrl(value), true, value);
    assert.equal(meetingUrlSchema.parse(`  ${value}  `), value);
  }
  assert.equal(meetingUrlSchema.parse(null), null);
});

test("meeting links reject unsafe schemes, credentials, host impersonation and control characters", () => {
  for (const value of [
    "",
    "not a URL",
    "javascript:alert(1)",
    "data:text/html,example",
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com/",
    "https://meet.google.com",
    "https://meet.google.com.evil.example/room",
    "https://evil.example/meet.google.com/room",
    "https://notzoom.us/j/123",
    "https://user@meet.google.com/abc-defg-hij",
    "https://user:secret@zoom.us/j/123",
    "https://meet.google.com:444/abc-defg-hij",
    "https://meet.google.com/abc defg",
    "https://meet.google.com/abc\tdefg",
    "https://meet.google.com/abc\ndefg",
    "https://meet.google.com/abc\u0000defg",
    "https://meet.google.com/abc\u007fdefg",
  ]) {
    assert.equal(isMeetingUrl(value), false, value);
    assert.equal(meetingUrlSchema.safeParse(value).success, false, value);
  }
  assert.equal(
    meetingUrlSchema.safeParse(`https://meet.google.com/${"x".repeat(2048)}`).success,
    false,
  );
});

test("board commands enforce bounded points, allowed styles and a clear epoch", () => {
  const valid = stroke();
  for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }])
    assert.equal(boardPointSchema.safeParse(point).success, true);
  for (const point of [
    { x: -0.01, y: 0 },
    { x: 0, y: 1.01 },
    { x: NaN, y: 0 },
    { x: Infinity, y: 0 },
    { x: 0, y: 0, extra: true },
    { x: "0.5", y: 0 },
  ]) assert.equal(boardPointSchema.safeParse(point).success, false);
  for (const color of boardColors)
    for (const width of boardWidths)
      assert.equal(boardStrokeInputSchema.safeParse({ ...valid, color, width }).success, true);
  const maximum = { ...valid, points: Array.from({ length: maxBoardPoints }, () => ({ x: 0.5, y: 0.5 })) };
  assert.equal(boardStrokeInputSchema.safeParse(maximum).success, true);
  for (const invalid of [
    { ...valid, id: "invalid" },
    { ...valid, points: [] },
    { ...maximum, points: [...maximum.points, { x: 0, y: 0 }] },
    { ...valid, color: "url(https://evil.example)" },
    { ...valid, width: 50 },
    { ...valid, authorId: "other-user" },
  ]) assert.equal(boardStrokeInputSchema.safeParse(invalid).success, false);
  for (const command of [
    { action: "stroke.add", epoch: 0, stroke: valid },
    { action: "stroke.remove", epoch: 0, id: valid.id },
    { action: "board.clear", epoch: 2 },
  ]) assert.equal(lessonBoardCommandSchema.safeParse(command).success, true);
  for (const command of [
    { action: "stroke.add", epoch: -1, stroke: valid },
    { action: "stroke.add", epoch: 0.5, stroke: valid },
    { action: "stroke.remove", epoch: 0, id: "invalid" },
    { action: "board.clear", epoch: 0, strokes: [] },
    { action: "board.clear" },
    { action: "delete.all", epoch: 0 },
  ]) assert.equal(lessonBoardCommandSchema.safeParse(command).success, false);
});

test("shared lesson board client sends teacher and portal paths with opaque IDs and mutation keys", async () => {
  const requests = [];
  const { DerslikClient } = loadTestModule("packages/api-client/src/index.ts", {
    dependencies: {
      "../../contracts/src/i18n/index.ts": { t: (key) => key, getLocale: () => "tr" },
      "./uploads.ts": {},
      "./socket.ts": {},
      "./lesson-board.ts": boardSource(),
    },
    globals: {
      fetch: async (url, init) => {
        requests.push({ url, ...init });
        return Response.json({ data: board(3), replayed: false });
      },
    },
  });
  const client = new DerslikClient({
    baseUrl: "https://api.example.test/",
    getToken: async () => "fixture-signed-token",
  });
  const command = { action: "board.clear", epoch: 0 };
  for (const portal of [false, true]) {
    await client.lessonBoard("ws/one", "student?two", "lesson#three", portal);
    await client.changeLessonBoard("ws/one", "student?two", "lesson#three", command, "mutation-key", portal);
  }
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/v1/workspaces/ws%2Fone/students/student%3Ftwo/lessons/lesson%23three/board",
    "/v1/workspaces/ws%2Fone/students/student%3Ftwo/lessons/lesson%23three/board",
    "/v1/portal/ws%2Fone/student%3Ftwo/lessons/lesson%23three/board",
    "/v1/portal/ws%2Fone/student%3Ftwo/lessons/lesson%23three/board",
  ]);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST", "GET", "POST"]);
  for (const index of [1, 3]) {
    assert.equal(requests[index].headers["Idempotency-Key"], "mutation-key");
    assert.deepEqual(JSON.parse(requests[index].body), command);
  }
  assert.ok(requests.every((request) => request.headers.Authorization === "Bearer fixture-signed-token"));
  await client.lessonBoard("workspace-1", "student-1", "lesson-1", false, 0);
  assert.equal(new URL(requests.at(-1).url).search, "?revision=0");
});

function boardSource(globals = {}) {
  return loadTestModule("packages/api-client/src/lesson-board.ts", {
    dependencies: {
      "../../contracts/src/live-lesson.ts": { maxBoardPoints },
      "../../contracts/src/i18n/index.ts": { t: (key) => key },
    },
    globals: { Error, ...globals },
  });
}

test("shared board geometry clamps and rounds native or browser coordinates without non-finite points", () => {
  const { boardPoint, appendBoardPoint, boardStrokePath, boardUndoStroke } = boardSource();
  assert.deepEqual(plain(boardPoint(125, 225, 500, 300)), { x: 0.25, y: 0.75 });
  assert.deepEqual(plain(boardPoint(-10, 900, 500, 300)), { x: 0, y: 1 });
  assert.deepEqual(plain(boardPoint(NaN, Infinity, 0, -1)), { x: 0, y: 0 });
  assert.deepEqual(plain(boardPoint(1, 2, 3, 7)), { x: 0.333, y: 0.286 });
  const points = [{ x: 0, y: 0 }];
  assert.strictEqual(appendBoardPoint(points, { x: 0.001, y: 0.001 }), points);
  const moved = appendBoardPoint(points, { x: 0.1, y: 0.2 });
  assert.equal(points.length, 1, "original gesture points stay unchanged");
  assert.deepEqual(plain(moved), [{ x: 0, y: 0 }, { x: 0.1, y: 0.2 }]);
  const full = Array.from({ length: maxBoardPoints }, (_, index) => ({ x: index / maxBoardPoints, y: 0 }));
  const bounded = appendBoardPoint(full, { x: 1, y: 1 });
  assert.ok(bounded.length <= maxBoardPoints);
  assert.deepEqual(plain(bounded.at(-1)), { x: 1, y: 1 });
  assert.equal(full.length, maxBoardPoints);
  assert.equal(boardStrokePath([]), "");
  assert.equal(boardStrokePath([{ x: 0.25, y: 0.5 }, { x: 1, y: 1 }]), "M250,300 L1000,600");
  const owned = { ...stroke(), authorId: "student-1" };
  const foreign = { ...stroke(), authorId: "teacher-1" };
  assert.strictEqual(boardUndoStroke(board(2, { viewerId: "student-1", canClear: false, strokes: [owned, foreign] })), owned);
  assert.strictEqual(boardUndoStroke(board(2, { strokes: [owned, foreign] })), foreign);
  assert.equal(boardUndoStroke(board(2, { viewerId: "guardian-1", canClear: false, strokes: [owned, foreign] })), undefined);
});

function sessionFixture({ load, change, pollMs = 2500 } = {}) {
  const timers = new Map(), states = [], reads = [], writes = [];
  let timerId = 0;
  const { LessonBoardSession } = boardSource({
      setTimeout: (callback, wait) => {
        const id = ++timerId;
        timers.set(id, { callback, wait });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
  });
  const session = new LessonBoardSession({
    load: (revision) => {
      reads.push({ revision });
      return load ? load(reads.length) : Promise.resolve({ data: board() });
    },
    change: (command, key) => {
      writes.push({ command: plain(command), key });
      return change ? change(command, key) : Promise.resolve({ data: board(2) });
    },
    onChange: (state) => states.push(plain(state)),
    pollMs,
  });
  return {
    session, timers, states, reads, writes,
    state: () => states.at(-1),
    fire() {
      assert.equal(timers.size, 1, "only one polling timer may be pending");
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test("board session loads once, waits for a response before polling and stops its timer", async () => {
  const first = deferred(), second = deferred();
  const f = sessionFixture({ load: (index) => index === 1 ? first.promise : second.promise });
  f.session.start();
  f.session.start();
  assert.equal(f.reads.length, 1);
  assert.equal(f.state().loading, true);
  assert.equal(f.timers.size, 0);
  first.resolve({ data: board() });
  await settle();
  assert.equal(f.state().board.revision, 1);
  assert.equal(f.state().loading, false);
  assert.equal(f.state().error, null);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].wait, 2500);
  f.fire();
  assert.equal(f.reads.length, 2);
  assert.equal(f.timers.size, 0);
  second.resolve({ data: board(2) });
  await settle();
  assert.equal(f.state().board.revision, 2);
  assert.equal(f.timers.size, 1);
  f.session.stop();
  assert.equal(f.timers.size, 0);
});

test("late read from a stopped board cannot overwrite the restarted lesson session", async () => {
  const old = deferred(), current = deferred();
  const f = sessionFixture({ load: (index) => index === 1 ? old.promise : current.promise });
  f.session.start();
  f.session.stop();
  f.session.start();
  const emitted = f.states.length;
  old.resolve({ data: board(99) });
  await settle();
  assert.equal(f.states.length, emitted);
  assert.equal(f.timers.size, 0);
  current.resolve({ data: board(1, { id: "current-lesson" }) });
  await settle();
  assert.equal(f.state().board.id, "current-lesson");
  assert.equal(f.state().board.revision, 1);
  f.session.stop();
});

test("board load failure retains a retry path and later refresh clears its error", async () => {
  const f = sessionFixture({ load: (index) => index === 1 ? Promise.reject(new Error("Sunucu kapalı")) : Promise.resolve({ data: board(3) }) });
  f.session.start();
  await settle();
  assert.equal(f.state().loading, false);
  assert.equal(f.state().board, null);
  assert.equal(f.state().error, "Sunucu kapalı");
  assert.equal(f.timers.size, 1);
  await f.session.refresh();
  assert.equal(f.state().board.revision, 3);
  assert.equal(f.state().error, null);
  assert.equal(f.timers.size, 1);
  f.session.stop();
});

test("an older polling reply cannot erase a stroke saved after its request began", async () => {
  const poll = deferred();
  const savedStroke = { ...stroke(), authorId: "teacher-1" };
  const f = sessionFixture({
    load: (index) => index === 1 ? Promise.resolve({ data: board(1) }) : poll.promise,
    change: async () => ({ data: board(2, { strokes: [savedStroke] }) }),
  });
  f.session.start();
  await settle();
  f.fire();
  const command = { action: "stroke.add", epoch: 0, stroke: { ...savedStroke } };
  delete command.stroke.authorId;
  assert.equal(await f.session.save(command, "same-stroke-key"), true);
  poll.resolve({ data: board(1) });
  await settle();
  assert.equal(f.state().board.revision, 2);
  assert.equal(f.state().board.strokes[0].id, savedStroke.id);
  assert.equal(f.writes[0].key, "same-stroke-key");
  assert.deepEqual(f.writes[0].command, command);
  f.session.stop();
});

test("pending board save blocks duplicate submission and stops late updates on close", async () => {
  const saving = deferred();
  const f = sessionFixture({ change: () => saving.promise });
  f.session.start();
  await settle();
  const command = { action: "board.clear", epoch: 0 };
  const first = f.session.save(command, "clear-1");
  assert.equal(f.state().saving, true);
  assert.equal(await f.session.save(command, "clear-2"), false);
  assert.equal(f.writes.length, 1);
  f.session.stop();
  const emitted = f.states.length;
  saving.resolve({ data: board(2, { epoch: 1 }) });
  await first;
  await settle();
  assert.equal(f.states.length, emitted);
  assert.equal(f.timers.size, 0);
});

test("failed board save preserves existing strokes and permits a fresh retry", async () => {
  const existing = { ...stroke(), authorId: "teacher-1" };
  let attempts = 0;
  const f = sessionFixture({
    load: async () => ({ data: board(1, { strokes: [existing] }) }),
    change: async () => {
      if (++attempts === 1) throw new Error("Bağlantı kesildi");
      return { data: board(2, { epoch: 1 }) };
    },
  });
  f.session.start();
  await settle();
  const command = { action: "board.clear", epoch: 0 };
  assert.equal(await f.session.save(command, "retry-clear"), false);
  assert.equal(f.state().saving, false);
  assert.equal(f.state().error, "Bağlantı kesildi");
  assert.equal(f.state().board.strokes[0].id, existing.id);
  assert.equal(await f.session.save(command, "retry-clear"), true);
  assert.equal(f.state().error, null);
  assert.equal(f.state().saving, false);
  assert.equal(f.state().board.epoch, 1);
  assert.deepEqual(f.writes.map((value) => value.key), ["retry-clear", "retry-clear"]);
  f.session.stop();
});

test("a late failed poll from a closed board does not leak an error into a reopened board", async () => {
  const old = deferred();
  const f = sessionFixture({ load: (index) => index === 1 ? old.promise : Promise.resolve({ data: board(4) }) });
  f.session.start();
  f.session.stop();
  f.session.start();
  await settle();
  const emitted = f.states.length;
  old.reject(new Error("Old request failed"));
  await settle();
  assert.equal(f.states.length, emitted);
  assert.equal(f.state().board.revision, 4);
  assert.equal(f.state().error, null);
  f.session.stop();
});

test("conditional board reads update revoked editing rights without duplicating an unchanged board", async () => {
  const existing = { ...stroke(), authorId: "teacher-1" };
  const f = sessionFixture({ load: (index) => Promise.resolve(index === 1
    ? { data: board(7, { strokes: [existing] }) }
    : { data: null, access: { canEdit: false, canClear: false } }) });
  assert.equal(await f.session.save({ action: "board.clear", epoch: 0 }, "inactive"), false);
  await f.session.refresh();
  assert.equal(f.reads.length, 0);
  f.session.start();
  await settle();
  await f.session.refresh();
  assert.deepEqual(f.reads.map((read) => read.revision), [undefined, 7]);
  assert.equal(f.state().board.revision, 7);
  assert.equal(f.state().board.strokes[0].id, existing.id);
  assert.equal(f.state().board.canEdit, false);
  assert.equal(f.state().board.canClear, false);
  assert.equal(await f.session.save({ action: "board.clear", epoch: 0 }, "revoked"), false);
  assert.equal(f.writes.length, 0);
  f.session.stop();
});

test("non-Error board failures show a translated fallback and bounded retries avoid overlapping reads", async () => {
  const pending = deferred();
  const f = sessionFixture({
    load: (index) => index === 1 ? pending.promise : Promise.resolve({ data: board(2) }),
    change: async () => { throw "network failure"; },
    pollMs: undefined,
  });
  f.session.start();
  await Promise.all([f.session.refresh(), f.session.refresh()]);
  assert.equal(f.reads.length, 1);
  pending.reject("upstream failure");
  await settle();
  assert.equal(f.state().error, "liveLesson.connectionError");
  assert.equal(f.state().loading, false);
  f.fire();
  await settle();
  assert.equal(f.state().board.revision, 2);
  assert.equal(await f.session.save({ action: "board.clear", epoch: 0 }, "failed"), false);
  assert.equal(f.state().error, "liveLesson.connectionError");
  assert.equal(f.state().saving, false);
  f.session.stop();
});

function mobileActionsFixture(options = {}) {
  const renderer = createTsxFixture();
  const reads = [], opened = [];
  const { LiveLessonActions, meetingField } = loadTestModule("apps/mobile/src/live-lesson.tsx", {
    dependencies: {
      react: renderer.react,
      "react/jsx-runtime": renderer.jsx,
      "react-native": {
        View: "View", Text: "Text",
        Linking: { openURL: async (url) => {
          opened.push(url);
          if (options.open) return options.open(url);
        } },
      },
      "@derslik/contracts": { ...liveContracts, t: (key) => key },
      "./core": { client: { lessonBoard: async (...args) => {
        reads.push(args);
        return options.load ? options.load() : { data: board() };
      } } },
      "./ui": { Button: "Button", ErrorText: "ErrorText", useTheme: () => ({ styles: { row: {}, caption: {} } }) },
      "./lesson-board": { NativeLessonBoard: "NativeLessonBoard" },
    },
  });
  const props = {
    lesson: { id: "lesson-1", student_id: "student-1", topic: "Denklemler", status: "SCHEDULED", meeting_url: "https://meet.google.com/abc-defg-hij" },
    workspaceId: "workspace-1",
    portal: true,
    ...options.props,
  };
  let tree;
  const render = () => tree = renderer.render(LiveLessonActions, props);
  const button = (key) => oneNode(tree, (node) => node.type === "Button" && treeText(node) === key, key);
  render();
  return { reads, opened, props, render, button, meetingField, unmount: renderer.unmount, tree: () => tree };
}

test("mobile live lesson actions open only safe meeting links and hide cancelled or completed joining", async () => {
  const f = mobileActionsFixture({ props: { onEditMeeting() {} } });
  assert.ok(!treeText(f.tree()).includes("liveLesson.recordingHint"), "student portal keeps teacher recording instructions out");
  assert.equal(f.meetingField(null).value, "");
  assert.equal(f.meetingField("https://meet.google.com/abc-defg-hij").value, "https://meet.google.com/abc-defg-hij");
  f.button("liveLesson.join").props.onPress();
  await settle();
  assert.deepEqual(f.opened, ["https://meet.google.com/abc-defg-hij"]);
  f.props.lesson = { ...f.props.lesson, meeting_url: "javascript:alert(1)" };
  f.render();
  f.button("liveLesson.join").props.onPress();
  await settle();
  f.render();
  assert.equal(f.opened.length, 1);
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "liveLesson.meetingOpenError");
  f.props.lesson = { ...f.props.lesson, status: "COMPLETED" };
  f.render();
  assert.ok(!treeText(f.tree()).includes("liveLesson.join"));
  assert.ok(!treeText(f.tree()).includes("liveLesson.editMeeting"));
  f.props.lesson = { ...f.props.lesson, status: "CANCELLED" };
  assert.equal(f.render(), null);
  f.unmount();
  const teacher = mobileActionsFixture({ props: { portal: false } });
  assert.ok(treeText(teacher.tree()).includes("liveLesson.recordingHint"));
  teacher.unmount();
});

test("mobile board waits before opening, rejects double opens and passes its real lesson scope", async () => {
  const response = deferred();
  const f = mobileActionsFixture({ load: () => response.promise });
  f.button("liveLesson.board").props.onPress();
  f.render();
  assert.equal(f.button("liveLesson.board").props.loading, true);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "NativeLessonBoard").length, 0);
  f.button("liveLesson.board").props.onPress();
  assert.equal(f.reads.length, 1);
  response.resolve({ data: board() });
  await settle();
  f.render();
  const modal = oneNode(f.tree(), (node) => node.type === "NativeLessonBoard");
  assert.deepEqual(f.reads[0], ["workspace-1", "student-1", "lesson-1", true]);
  assert.equal(modal.props.initial.revision, 1);
  assert.equal(modal.props.title, "Denklemler");
  assert.equal(modal.props.portal, true);
  modal.props.onClose();
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "NativeLessonBoard").length, 0);
  f.unmount();
});

test("mobile board failure leaves retry visible, a disabled action never loads and close ignores pending responses", async () => {
  let attempts = 0;
  const f = mobileActionsFixture({
    props: { lesson: { id: "lesson-1", student_id: "student-1", status: "SCHEDULED", meeting_url: null } },
    load: async () => {
      if (++attempts === 1) throw new Error("Tahta yüklenemedi");
      return { data: board() };
    },
  });
  assert.ok(treeText(f.tree()).includes("liveLesson.noMeeting"));
  f.button("liveLesson.board").props.onPress();
  await settle();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "Tahta yüklenemedi");
  assert.equal(f.button("liveLesson.board").props.loading, false);
  f.button("liveLesson.board").props.onPress();
  await settle();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "");
  f.unmount();
  const disabled = mobileActionsFixture({ props: { disabled: true } });
  disabled.button("liveLesson.board").props.onPress();
  assert.equal(disabled.reads.length, 0);
  disabled.unmount();
  const response = deferred();
  const closed = mobileActionsFixture({ load: () => response.promise });
  closed.button("liveLesson.board").props.onPress();
  closed.unmount();
  response.resolve({ data: board() });
  await settle();
  assert.equal(closed.reads.length, 1);
});

test("mobile meeting app launch failure shows a retryable error without accepting an unsafe fallback", async () => {
  const f = mobileActionsFixture({ open: async () => { throw new Error("No handler"); } });
  f.button("liveLesson.join").props.onPress();
  await settle();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "liveLesson.meetingOpenError");
  f.unmount();
});

test("mobile refuses an empty initial board reply and ignores a closed meeting launch", async () => {
  const f = mobileActionsFixture({ load: async () => ({ data: null }) });
  f.button("liveLesson.board").props.onPress();
  await settle();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "liveLesson.connectionError");
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "NativeLessonBoard").length, 0);
  f.unmount();
  const pending = deferred();
  const closed = mobileActionsFixture({ open: () => pending.promise });
  closed.button("liveLesson.join").props.onPress();
  closed.unmount();
  pending.resolve();
  await settle();
});

function nativeBoardFixture(options = {}) {
  const renderer = createTsxFixture();
  const reads = [], writes = [], confirmations = [], timers = new Map();
  const appState = { currentState: "active" };
  let currentBoard = options.initial ?? board(), timerId = 0, closed = 0;
  const shared = boardSource({
    setTimeout: (callback, wait) => {
      const id = ++timerId;
      timers.set(id, { callback, wait });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const { NativeLessonBoard } = loadTestModule("apps/mobile/src/lesson-board.tsx", {
    dependencies: {
      react: renderer.react,
      "react/jsx-runtime": renderer.jsx,
      "react-native": {
        ...Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "View"].map((name) => [name, name])),
        AppState: appState,
        PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
      },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "react-native-svg": { __esModule: true, default: "Svg", Circle: "Circle", Path: "Path" },
      "expo-crypto": { randomUUID },
      "@derslik/contracts": { ...liveContracts, t: (key) => key },
      "@derslik/api-client": shared,
      "./core": { client: {
        lessonBoard: async (...args) => {
          reads.push(args);
          return options.load ? options.load(reads.length, currentBoard) : { data: currentBoard };
        },
        changeLessonBoard: async (...args) => {
          writes.push(args);
          if (options.change) return options.change(args, writes.length, currentBoard);
          const command = args[3];
          let strokes = currentBoard.strokes;
          if (command.action === "stroke.add") strokes = [...strokes, { ...command.stroke, authorId: currentBoard.viewerId }];
          if (command.action === "stroke.remove") strokes = strokes.filter((stroke) => stroke.id !== command.id);
          if (command.action === "board.clear") strokes = [];
          currentBoard = { ...currentBoard, revision: currentBoard.revision + 1, epoch: currentBoard.epoch + (command.action === "board.clear" ? 1 : 0), strokes };
          return { data: currentBoard };
        },
      } },
      "./ui": {
        Button: "Button", CloseButton: "CloseButton", ErrorText: "ErrorText",
        confirmAction: (title, warning, callback) => {
          confirmations.push({ title, warning });
          return callback();
        },
        useTheme: () => ({ colors: { brand: "blue", surface: "white", line: "gray", marker: "blue" }, styles: {}, section: {} }),
      },
    },
    globals: { Error },
  });
  const props = { initial: currentBoard, title: "Denklemler", workspaceId: "workspace-1", studentId: "student-1", lessonId: "lesson-1", portal: true, onClose: () => closed++ };
  let tree;
  const render = () => tree = renderer.render(NativeLessonBoard, props);
  const button = (key) => oneNode(tree, (node) => node.type === "Button" && treeText(node) === key, key);
  const canvas = () => oneNode(tree, (node) => node.type === "View" && node.props.accessibilityLabel === "liveLesson.board");
  const pointer = (x, y) => ({ nativeEvent: { locationX: x, locationY: y } });
  const draw = (points) => {
    canvas().props.onPanResponderGrant(pointer(...points[0]));
    for (const point of points.slice(1)) canvas().props.onPanResponderMove(pointer(...point));
    canvas().props.onPanResponderRelease();
  };
  render();
  return { reads, writes, timers, props, appState, button, canvas, draw, pointer, render, confirmations, closed: () => closed, tree: () => tree, unmount: renderer.unmount,
    fire() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test("native board gestures normalize points, retain styles and persist both taps and paths", async () => {
  const f = nativeBoardFixture();
  await settle();
  f.render();
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), true);
  assert.equal(f.canvas().props.onMoveShouldSetPanResponder(), true);
  assert.equal(f.canvas().props.onPanResponderTerminationRequest(), false);
  const blue = oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.blue");
  blue.props.onPress();
  oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.pen 8").props.onPress();
  f.render();
  f.draw([[125, 150]]);
  await settle();
  f.render();
  assert.equal(f.writes.length, 1);
  const first = plain(f.writes[0][3]);
  assert.equal(first.action, "stroke.add");
  assert.equal(first.epoch, 0);
  assert.equal(first.stroke.color, boardColors[1]);
  assert.equal(first.stroke.width, 8);
  assert.deepEqual(first.stroke.points, [{ x: 0.25, y: 0.5 }]);
  assert.equal(lessonBoardCommandSchema.safeParse(first).success, true);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Circle").props.cx, 250);
  f.draw([[0, 0], [250, 150], [999, 999]]);
  await settle();
  f.render();
  assert.deepEqual(plain(f.writes[1][3].stroke.points), [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Path").props.d, "M0,0 L500,300 L1000,600");
  assert.deepEqual(f.writes[0].slice(0, 3), ["workspace-1", "student-1", "lesson-1"]);
  assert.equal(f.writes[0][5], true);
  assert.ok(treeText(f.tree()).includes("liveLesson.synced"));
  f.unmount();
  assert.equal(f.timers.size, 0);
});

test("native board failed drawing stays visible, prevents new gestures and retries the same stroke/key", async () => {
  let attempts = 0;
  const f = nativeBoardFixture({ change: async (args, _index, current) => {
    if (++attempts === 1) throw new Error("Tahta kaydedilemedi");
    return { data: { ...current, revision: current.revision + 1, strokes: [{ ...args[3].stroke, authorId: current.viewerId }] } };
  } });
  await settle();
  f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.draw([[100, 100], [200, 200]]);
  await settle();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "Tahta kaydedilemedi");
  assert.equal(f.canvas().props.onMoveShouldSetPanResponder(), false);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Path").length, 1);
  f.button("liveLesson.retry").props.onPress();
  await settle();
  f.render();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0][4], f.writes[1][4]);
  assert.deepEqual(plain(f.writes[0][3]), plain(f.writes[1][3]));
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Path").length, 1, "saved draft cannot draw a duplicate path");
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "");
  f.unmount();
});

test("native guardian board is read-only, polling waits in background and a full board disables drawing", async () => {
  const own = { ...stroke(), authorId: "student-1" };
  const f = nativeBoardFixture({ initial: board(1, { viewerId: "guardian-1", canEdit: false, canClear: false, strokes: [own] }) });
  await settle();
  f.render();
  assert.ok(treeText(f.tree()).includes("liveLesson.readOnly"));
  assert.equal(f.button("liveLesson.undo").props.disabled, true);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Button" && treeText(node) === "liveLesson.clear").length, 0);
  assert.ok(treeNodes(f.tree()).filter((node) => node.type === "Pressable").every((node) => node.props.disabled));
  assert.equal(f.canvas().props.onMoveShouldSetPanResponder(), false);
  f.appState.currentState = "background";
  f.fire();
  await settle();
  assert.equal(f.reads.length, 1);
  f.appState.currentState = "active";
  f.fire();
  await settle();
  assert.equal(f.reads.length, 2);
  f.unmount();
  const full = nativeBoardFixture({ initial: board(1, { strokes: Array.from({ length: liveContracts.maxBoardStrokes }, () => ({ ...stroke(), authorId: "teacher-1" })) }) });
  await settle();
  full.render();
  assert.equal(full.canvas().props.onMoveShouldSetPanResponder(), false);
  assert.equal(oneNode(full.tree(), (node) => node.type === "ErrorText").props.message, "liveLesson.boardFull");
  full.unmount();
});

test("native board undo targets the user's latest stroke and only teacher clear confirms then advances epoch", async () => {
  const own = { ...stroke(), authorId: "student-1" }, foreign = { ...stroke(), authorId: "teacher-1" };
  const pupil = nativeBoardFixture({ initial: board(1, { viewerId: "student-1", canClear: false, strokes: [own, foreign] }) });
  await settle();
  pupil.render();
  pupil.button("liveLesson.undo").props.onPress();
  await settle();
  assert.deepEqual(plain(pupil.writes[0][3]), { action: "stroke.remove", epoch: 0, id: own.id });
  pupil.unmount();
  const teacher = nativeBoardFixture({ initial: board(1, { strokes: [foreign] }) });
  await settle();
  teacher.render();
  teacher.button("liveLesson.clear").props.onPress();
  await settle();
  teacher.render();
  assert.equal(teacher.confirmations[0].title, "liveLesson.clearConfirm");
  assert.deepEqual(plain(teacher.writes[0][3]), { action: "board.clear", epoch: 0 });
  assert.equal(treeNodes(teacher.tree()).filter((node) => node.type === "Circle" || node.type === "Path").length, 0);
  teacher.unmount();
});

test("native closing blocks pending saves and warns before discarding an unsaved drawing", async () => {
  const reply = deferred();
  const f = nativeBoardFixture({ change: () => reply.promise });
  await settle();
  f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.draw([[100, 100]]);
  f.render();
  oneNode(f.tree(), (node) => node.type === "CloseButton").props.onPress();
  assert.equal(f.closed(), 0);
  assert.ok(treeText(f.tree()).includes("liveLesson.saving"));
  reply.reject(new Error("No network"));
  await settle();
  f.render();
  oneNode(f.tree(), (node) => node.type === "Modal").props.onRequestClose();
  assert.equal(f.closed(), 1);
  assert.equal(f.confirmations[0].title, "liveLesson.discardDrawing");
  f.button("common.cancel").props.onPress();
  await settle();
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Circle" || node.type === "Path").length, 0);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Button" && treeText(node) === "liveLesson.retry").length, 0);
  f.unmount();
});

test("native terminated gestures never save a stroke and polling errors leave prior drawing visible", async () => {
  const existing = { ...stroke(), authorId: "teacher-1" };
  const f = nativeBoardFixture({ initial: board(1, { strokes: [existing] }), load: async () => { throw new Error("Poll failed"); } });
  await settle();
  f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.canvas().props.onPanResponderMove(f.pointer(100, 100));
  f.canvas().props.onPanResponderRelease();
  f.canvas().props.onPanResponderGrant(f.pointer(100, 100));
  f.canvas().props.onPanResponderTerminate();
  f.canvas().props.onPanResponderRelease();
  f.render();
  assert.equal(f.writes.length, 0);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Circle").length, 1);
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "Poll failed");
  oneNode(f.tree(), (node) => node.type === "CloseButton").props.onPress();
  assert.equal(f.closed(), 1);
  f.unmount();
});

test("native drawing keeps its original epoch when a remote clear arrives during a gesture", async () => {
  const f = nativeBoardFixture({
    load: async (index, current) => ({ data: index === 1 ? current : board(2, { epoch: 1 }) }),
    change: async () => { throw new Error("Stale drawing epoch"); },
  });
  await settle();
  f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.canvas().props.onPanResponderGrant(f.pointer(100, 100));
  f.fire();
  await settle();
  f.render();
  f.canvas().props.onPanResponderMove(f.pointer(200, 200));
  f.canvas().props.onPanResponderRelease();
  await settle();
  f.render();
  assert.equal(f.writes[0][3].epoch, 0, "remote clear cannot revive a gesture from the preceding epoch");
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "Stale drawing epoch");
  f.unmount();
});

function webFixture(kind, options = {}) {
  const renderer = createTsxFixture();
  const reads = [], writes = [], confirmations = [], timers = new Map(), drafts = [], strokes = [];
  const document = { visibilityState: "visible" };
  let currentBoard = options.initial ?? board(), timerId = 0, closed = 0;
  const shared = boardSource({
    setTimeout: (callback, wait) => {
      const id = ++timerId;
      timers.set(id, { callback, wait });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const base = "/workspaces/workspace-1/students/student-1/lessons/lesson-1/board";
  const dependencies = {
    react: renderer.react,
    "react/jsx-runtime": renderer.jsx,
    "@derslik/contracts": { ...liveContracts, t: (key) => key },
    "@derslik/api-client": shared,
    "lucide-react": { Video: "Video", PencilLine: "PencilLine", Link: "Link" },
    "@/lib/client": { backend: async (path, command, key) => {
      if (command === undefined) {
        reads.push(path);
        return options.load ? options.load(reads.length, currentBoard) : { data: currentBoard };
      }
      writes.push({ path, command: plain(command), key });
      if (options.change) return options.change(command, writes.length, currentBoard);
      let strokes = currentBoard.strokes;
      if (command.action === "stroke.add") strokes = [...strokes, { ...command.stroke, authorId: currentBoard.viewerId }];
      if (command.action === "stroke.remove") strokes = strokes.filter((stroke) => stroke.id !== command.id);
      if (command.action === "board.clear") strokes = [];
      currentBoard = { ...currentBoard, revision: currentBoard.revision + 1, epoch: currentBoard.epoch + (command.action === "board.clear" ? 1 : 0), strokes };
      return { data: currentBoard };
    } },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/input": { Input: "Input" },
    "@/components/ui/label": { Label: "Label" },
    "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map((name) => [name, name])),
    "./loading": { Spinner: "Spinner" },
    "./feedback": { FormError: "FormError" },
    "./lesson-board": { LessonBoardDialog: "LessonBoardDialog" },
  };
  const globals = { Error, crypto: { randomUUID }, document, window: { confirm: (message) => {
    confirmations.push(message);
    return options.confirm === undefined ? true : options.confirm;
  } } };
  const source = loadTestModule(`apps/web/components/derslik/${kind === "canvas" || kind === "dialog" ? "lesson-board" : "live-lesson"}.tsx`, { dependencies, globals });
  let props;
  if (kind === "canvas") props = {
    board: currentBoard, editable: true, color: boardColors[0], width: 4, draft: null,
    onDraft: (next) => { drafts.push(next); props.draft = next; },
    onStroke: (stroke, epoch) => strokes.push({ stroke: plain(stroke), epoch }),
  };
  else if (kind === "dialog") props = { initial: currentBoard, base, title: "Denklemler", onClose: () => closed++ };
  else if (kind === "actions") props = { lesson: { id: "lesson-1", student_id: "student-1", topic: "Denklemler", status: "SCHEDULED", meeting_url: "https://meet.google.com/abc-defg-hij" }, base, disabled: false };
  else props = { lesson: { id: "lesson-1", topic: "Denklemler", version: 4, meeting_url: "https://meet.google.com/abc-defg-hij" }, busy: false, mutate: async (command, message) => {
    writes.push({ command: plain(command), message });
    return options.mutate ? options.mutate(command, message) : true;
  }, onClose: () => closed++ };
  Object.assign(props, options.props);
  const components = { canvas: source.BoardCanvas, dialog: source.LessonBoardDialog, actions: source.LiveLessonActions, meeting: source.MeetingLinkDialog };
  let tree;
  const render = () => tree = renderer.render(components[kind], props);
  const button = (key) => oneNode(tree, (node) => node.type === "Button" && treeText(node) === key, key);
  const canvas = () => oneNode(tree, (node) => node.type === "svg");
  const captures = [];
  const target = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 300 }), setPointerCapture: (pointer) => captures.push(pointer) };
  const pointer = (x, y, extras = {}) => ({ clientX: x + 10, clientY: y + 20, pointerId: 7, button: 0, currentTarget: target, preventDefault() {}, ...extras });
  const draw = (points) => {
    canvas().props.onPointerDown(pointer(...points[0]));
    for (const point of points.slice(1)) canvas().props.onPointerMove(pointer(...point));
    canvas().props.onPointerUp(pointer(...points.at(-1)));
  };
  render();
  return { reads, writes, confirmations, timers, drafts, strokes, document, props, captures, pointer, button, canvas, draw, render, closed: () => closed, tree: () => tree, unmount: renderer.unmount,
    fire() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test("web board uses actual SVG bounds, pointer capture and the epoch at gesture start", () => {
  const f = webFixture("canvas");
  f.canvas().props.onPointerDown(f.pointer(125, 150));
  f.render();
  assert.deepEqual(f.captures, [7]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "circle").props.cx, 250);
  f.canvas().props.onPointerMove(f.pointer(250, 150, { pointerId: 99 }));
  assert.equal(f.drafts.at(-1).points.length, 1);
  f.props.board = { ...f.props.board, epoch: 2 };
  f.render();
  f.canvas().props.onPointerMove(f.pointer(250, 150));
  f.canvas().props.onPointerUp(f.pointer(700, 900));
  f.render();
  assert.equal(f.strokes.length, 1);
  assert.equal(f.strokes[0].epoch, 0, "clear during drawing cannot revive an old stroke in a new epoch");
  assert.deepEqual(f.strokes[0].stroke.points, [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "path").props.d, "M250,300 L500,300 L1000,600");
  f.unmount();
});

test("web canvas ignores secondary/foreign pointers and cancellation never submits a stroke", () => {
  const f = webFixture("canvas");
  f.props.editable = false;
  f.render();
  f.canvas().props.onPointerDown(f.pointer(0, 0));
  assert.equal(f.drafts.length, 0);
  assert.equal(f.canvas().props.style.cursor, "default");
  f.props.editable = true;
  f.render();
  f.canvas().props.onPointerDown(f.pointer(0, 0, { button: 1 }));
  f.canvas().props.onPointerMove(f.pointer(0, 0));
  f.canvas().props.onPointerUp(f.pointer(0, 0));
  assert.equal(f.drafts.length, 0);
  f.canvas().props.onPointerDown(f.pointer(0, 0));
  f.canvas().props.onPointerDown(f.pointer(10, 10, { pointerId: 8 }));
  f.canvas().props.onPointerUp(f.pointer(0, 0, { pointerId: 8 }));
  assert.equal(f.strokes.length, 0);
  f.canvas().props.onPointerCancel();
  f.canvas().props.onPointerUp(f.pointer(0, 0));
  assert.equal(f.drafts.at(-1), null);
  assert.equal(f.strokes.length, 0);
  f.unmount();
});

test("web canvas does not duplicate a local pending stroke when polling already returns its saved ID", () => {
  const saved = { ...stroke(), authorId: "teacher-1" };
  const f = webFixture("canvas", { initial: board(2, { strokes: [saved] }), props: { draft: { ...saved } } });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "circle").length, 1);
  f.props.draft = stroke({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "circle").length, 1);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 1);
  f.unmount();
});

test("web lesson board saves real selected colors and widths, then undo/clear retain lesson scope", async () => {
  const f = webFixture("dialog");
  await settle();
  f.render();
  oneNode(f.tree(), (node) => node.type === "Button" && node.props["aria-label"] === "liveLesson.red").props.onClick();
  f.button("8").props.onClick();
  f.render();
  f.draw([[100, 100], [200, 200]]);
  await settle();
  f.render();
  assert.equal(f.writes[0].command.stroke.color, boardColors[2]);
  assert.equal(f.writes[0].command.stroke.width, 8);
  assert.equal(f.writes[0].path, f.props.base);
  assert.equal(lessonBoardCommandSchema.safeParse(f.writes[0].command).success, true);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 1);
  f.button("liveLesson.undo").props.onClick();
  await settle();
  f.render();
  assert.deepEqual(f.writes[1].command, { action: "stroke.remove", epoch: 0, id: f.writes[0].command.stroke.id });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 0);
  f.draw([[250, 150]]);
  await settle();
  f.render();
  f.button("liveLesson.clear").props.onClick();
  await settle();
  f.render();
  assert.equal(f.confirmations[0], "liveLesson.clearWarning");
  assert.deepEqual(f.writes[3].command, { action: "board.clear", epoch: 0 });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "circle").length, 0);
  f.unmount();
  assert.equal(f.timers.size, 0);
});

test("web failed stroke remains visible, blocks edits, retries the same key and can be discarded", async () => {
  let attempts = 0;
  const f = webFixture("dialog", { change: async (command, _index, current) => {
    if (++attempts === 1) throw new Error("Save failed");
    return { data: { ...current, revision: current.revision + 1, strokes: [{ ...command.stroke, authorId: current.viewerId }] } };
  } });
  await settle();
  f.render();
  f.draw([[100, 100], [200, 200]]);
  await settle();
  f.render();
  assert.ok(treeText(f.tree()).includes("Save failed"));
  assert.equal(f.canvas().props.style.cursor, "default");
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 1);
  f.button("liveLesson.retry").props.onClick();
  await settle();
  f.render();
  assert.equal(f.writes[0].key, f.writes[1].key);
  assert.deepEqual(f.writes[0].command, f.writes[1].command);
  assert.ok(!treeText(f.tree()).includes("Save failed"));
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 1);
  f.unmount();
  const discard = webFixture("dialog", { change: async () => { throw new Error("Offline"); } });
  await settle();
  discard.render();
  discard.draw([[100, 100]]);
  await settle();
  discard.render();
  discard.button("liveLesson.discardDrawing").props.onClick();
  await settle();
  discard.render();
  assert.equal(treeNodes(discard.tree()).filter((node) => node.type === "circle").length, 0);
  assert.ok(!treeText(discard.tree()).includes("liveLesson.retry"));
  discard.unmount();
});

test("web guardian rights, hidden tabs and full boards stop changes without removing prior strokes", async () => {
  const f = webFixture("dialog", { initial: board(1, { canEdit: false, canClear: false, strokes: [{ ...stroke(), authorId: "teacher-1" }] }) });
  await settle();
  f.render();
  assert.ok(treeText(f.tree()).includes("liveLesson.readOnly"));
  assert.equal(f.button("liveLesson.undo").props.disabled, true);
  assert.equal(f.canvas().props.style.cursor, "default");
  f.document.visibilityState = "hidden";
  f.fire();
  await settle();
  assert.equal(f.reads.length, 1);
  f.document.visibilityState = "visible";
  f.fire();
  await settle();
  assert.equal(f.reads.length, 2);
  assert.match(f.reads[1], /\?revision=1$/);
  f.unmount();
  const full = webFixture("dialog", { initial: board(1, { strokes: Array.from({ length: liveContracts.maxBoardStrokes }, () => ({ ...stroke(), authorId: "teacher-1" })) }) });
  await settle();
  full.render();
  assert.ok(treeText(full.tree()).includes("liveLesson.boardFull"));
  assert.equal(full.canvas().props.style.cursor, "default");
  full.unmount();
});

test("web close is blocked while saving, unsaved warning can cancel closure and closed saves cannot revive a room", async () => {
  const pending = deferred();
  const f = webFixture("dialog", { change: () => pending.promise, confirm: false });
  await settle();
  f.render();
  f.draw([[100, 100]]);
  f.render();
  assert.equal(f.button("liveLesson.close").props.disabled, true);
  f.button("liveLesson.close").props.onClick();
  assert.equal(f.closed(), 0);
  pending.reject(new Error("Offline"));
  await settle();
  f.render();
  oneNode(f.tree(), (node) => node.type === "Dialog").props.onOpenChange(false);
  assert.equal(f.closed(), 0);
  assert.deepEqual(f.confirmations, ["liveLesson.unsavedWarning"]);
  f.unmount();
  const closed = webFixture("dialog");
  await settle();
  closed.render();
  oneNode(closed.tree(), (node) => node.type === "Dialog").props.onOpenChange(true);
  assert.equal(closed.closed(), 0);
  closed.button("liveLesson.close").props.onClick();
  assert.equal(closed.closed(), 1);
  closed.unmount();
});

test("web meeting links use provider URLs with opener protection and board data arrives before a modal opens", async () => {
  const pending = deferred();
  const f = webFixture("actions", { load: () => pending.promise, props: { editMeeting() {} } });
  const link = oneNode(f.tree(), (node) => node.type === "a");
  assert.equal(link.props.href, "https://meet.google.com/abc-defg-hij");
  assert.equal(link.props.target, "_blank");
  assert.equal(link.props.rel, "noopener noreferrer");
  f.button("liveLesson.board").props.onClick();
  f.button("liveLesson.board").props.onClick();
  assert.equal(f.reads.length, 1, "rapid requests before a React render must share the opening guard");
  f.render();
  assert.equal(f.button("liveLesson.board").props.disabled, true);
  f.button("liveLesson.board").props.onClick();
  assert.equal(f.reads.length, 1);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "LessonBoardDialog").length, 0);
  pending.resolve({ data: board() });
  await settle();
  f.render();
  const modal = oneNode(f.tree(), (node) => node.type === "LessonBoardDialog");
  assert.equal(modal.props.title, "Denklemler");
  assert.equal(modal.props.base, f.props.base);
  modal.props.onClose();
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "LessonBoardDialog").length, 0);
  f.props.lesson = { ...f.props.lesson, meeting_url: "https://evil.example/room" };
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "a").length, 0);
  f.props.lesson = { ...f.props.lesson, status: "CANCELLED" };
  assert.equal(f.render(), null);
  f.unmount();
});

test("web board load failures are retryable, disabled controls do not request and late unmounted errors stay closed", async () => {
  const f = webFixture("actions", { load: async () => { throw new Error("Board unavailable"); } });
  f.button("liveLesson.board").props.onClick();
  await settle();
  f.render();
  assert.ok(treeText(f.tree()).includes("Board unavailable"));
  assert.equal(f.button("liveLesson.board").props.disabled, false);
  f.unmount();
  const disabled = webFixture("actions", { props: { disabled: true } });
  disabled.button("liveLesson.board").props.onClick();
  assert.equal(disabled.reads.length, 0);
  disabled.unmount();
  const pending = deferred();
  const closed = webFixture("actions", { load: () => pending.promise });
  closed.button("liveLesson.board").props.onClick();
  closed.unmount();
  pending.reject(new Error("Late failure"));
  await settle();
  assert.equal(closed.reads.length, 1);
});

test("meeting editor rejects unsafe links, trims valid values and clears an existing meeting without altering lesson version", async () => {
  const f = webFixture("meeting");
  const input = () => oneNode(f.tree(), (node) => node.type === "Input");
  const submit = () => oneNode(f.tree(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  input().props.onChange({ target: { value: "javascript:alert(1)" } });
  f.render();
  await submit();
  f.render();
  assert.equal(f.writes.length, 0);
  assert.ok(treeText(f.tree()).includes("api.meetingUrlInvalid"));
  input().props.onChange({ target: { value: " https://meet.google.com/new-meet-url " } });
  f.render();
  await submit();
  assert.deepEqual(f.writes[0].command, { action: "lesson.meeting.update", id: "lesson-1", version: 4, meetingUrl: "https://meet.google.com/new-meet-url" });
  assert.equal(f.closed(), 1);
  input().props.onChange({ target: { value: " " } });
  f.render();
  await submit();
  assert.equal(f.writes[1].command.meetingUrl, null);
  f.unmount();
});

test("meeting editor waits during mutations and displays failures without closing or losing typed input", async () => {
  const f = webFixture("meeting", { mutate: async () => { throw new Error("Version changed"); } });
  await oneNode(f.tree(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  f.render();
  assert.equal(f.closed(), 0);
  assert.ok(treeText(f.tree()).includes("Version changed"));
  assert.equal(oneNode(f.tree(), (node) => node.type === "Input").props.value, "https://meet.google.com/abc-defg-hij");
  f.props.busy = true;
  f.render();
  await oneNode(f.tree(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  oneNode(f.tree(), (node) => node.type === "Dialog").props.onOpenChange(false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.closed(), 0);
  assert.equal(f.button("common.cancel").props.disabled, true);
  f.props.busy = false;
  f.render();
  oneNode(f.tree(), (node) => node.type === "Dialog").props.onOpenChange(false);
  assert.equal(f.closed(), 1);
  f.unmount();
  const declined = webFixture("meeting", { mutate: async () => false, props: { lesson: { id: "lesson-1", version: 1, meeting_url: null } } });
  await oneNode(declined.tree(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(declined.closed(), 0);
  declined.unmount();
});

test("web board and meeting editor show translated errors for malformed upstream failures", async () => {
  const f = webFixture("actions", { load: async () => { throw null; } });
  f.button("liveLesson.board").props.onClick();
  await settle();
  f.render();
  assert.ok(treeText(f.tree()).includes("liveLesson.connectionError"));
  f.unmount();
  const editor = webFixture("meeting", { mutate: async () => { throw null; } });
  await oneNode(editor.tree(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  editor.render();
  assert.ok(treeText(editor.tree()).includes("common.failed"));
  assert.equal(editor.closed(), 0);
  editor.unmount();
});

test("disabled web meeting links prevent navigation and empty board replies keep the modal closed", async () => {
  const disabled = webFixture("actions", { props: { disabled: true } });
  const anchor = oneNode(disabled.tree(), (node) => node.type === "a");
  let prevented = 0;
  anchor.props.onClick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(anchor.props["aria-disabled"], true);
  assert.equal(anchor.props.tabIndex, -1);
  disabled.unmount();
  const active = webFixture("actions", { load: async () => ({ data: null }) });
  oneNode(active.tree(), (node) => node.type === "a").props.onClick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1, "enabled links keep native browser navigation");
  active.button("liveLesson.board").props.onClick();
  await settle();
  active.render();
  assert.ok(treeText(active.tree()).includes("liveLesson.connectionError"));
  assert.equal(treeNodes(active.tree()).filter((node) => node.type === "LessonBoardDialog").length, 0);
  active.unmount();
});

test("web rapid board actions cannot overwrite the first pending operation or its retry key", async () => {
  const reply = deferred();
  const existing = { ...stroke(), authorId: "teacher-1" };
  const f = webFixture("dialog", { initial: board(1, { strokes: [existing] }), change: (_command, index, current) => index === 1 ? reply.promise : Promise.resolve({ data: { ...current, revision: 2, epoch: 1, strokes: [] } }) });
  await settle();
  f.render();
  f.button("liveLesson.clear").props.onClick();
  f.button("liveLesson.undo").props.onClick();
  assert.equal(f.writes.length, 1);
  reply.reject(new Error("First operation failed"));
  await settle();
  f.render();
  f.button("liveLesson.retry").props.onClick();
  await settle();
  assert.equal(f.writes.length, 2);
  assert.deepEqual(f.writes[1].command, { action: "board.clear", epoch: 0 });
  assert.equal(f.writes[1].key, f.writes[0].key);
  f.unmount();
});

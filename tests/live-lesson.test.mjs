import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
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
  documentId: null,
  page: 0,
  tool: "pen",
  ...overrides,
});
const board = (revision = 1, overrides = {}) => ({
  id: "lesson-1",
  revision,
  epoch: 0,
  viewerId: "teacher-1",
  canEdit: true,
  canClear: true,
  documents: [],
  documentId: null,
  page: 0,
  strokes: [],
  ...overrides,
});

function applyBoardCommand(current, command, removed) {
  let { strokes, documents, documentId, page, epoch } = current;
  if (command.action === "stroke.add") strokes = [...strokes, { ...command.stroke, authorId: current.viewerId }];
  if (command.action === "stroke.remove") {
    removed.set(command.id, strokes.find((item) => item.id === command.id));
    strokes = strokes.filter((item) => item.id !== command.id);
  }
  if (command.action === "stroke.restore" && removed.has(command.id)) {
    strokes = [...strokes, removed.get(command.id)];
    removed.delete(command.id);
  }
  if (command.action === "board.clear" || command.action === "page.clear") {
    strokes = command.action === "board.clear" ? [] : strokes.filter((item) =>
      item.documentId !== command.documentId || item.page !== command.page);
    epoch++;
  }
  if (command.action === "document.select") ({ documentId, page } = command);
  if (command.action === "document.add") {
    documents = [...documents, { id: command.id, name: "Denklemler.pdf", pageCount: command.pageCount }];
    documentId = command.id;
    page = 1;
  }
  return { ...current, revision: current.revision + 1, epoch, strokes, documents, documentId, page };
}

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

test("PDF annotations validate page scope, shape geometry and literal text notes", () => {
  const documentId = randomUUID();
  const pdf = stroke({ documentId, page: 2 });
  for (const tool of ["pen", "highlighter"])
    assert.equal(boardStrokeInputSchema.safeParse({ ...pdf, tool }).success, true);
  for (const tool of ["line", "rectangle", "ellipse"])
    assert.equal(boardStrokeInputSchema.safeParse({ ...pdf, tool, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }).success, true);
  const note = { ...pdf, tool: "note", text: "x² + 2x = 8" };
  assert.equal(boardStrokeInputSchema.safeParse(note).success, true);
  assert.equal(boardStrokeInputSchema.parse({ ...note, text: "  x = 2  " }).text, "x = 2");
  for (const invalid of [
    { ...pdf, page: 0 }, { ...pdf, documentId: null }, { ...pdf, page: 101 },
    { ...pdf, tool: "rectangle" }, { ...pdf, tool: "ellipse" }, { ...pdf, tool: "line" },
    { ...pdf, tool: "pen", text: "Unexpected text" }, { ...note, text: "  " },
    { ...note, text: "x".repeat(301) }, { ...note, points: [...note.points, { x: 0, y: 0 }] },
  ]) assert.equal(boardStrokeInputSchema.safeParse(invalid).success, false);
  const legacy = { id: randomUUID(), points: [{ x: 0, y: 0 }], color: boardColors[0], width: 2 };
  assert.deepEqual(boardStrokeInputSchema.parse(legacy), { ...legacy, documentId: null, page: 0, tool: "pen" });
  for (const command of [
    { action: "document.add", epoch: 0, id: documentId, pageCount: 100 },
    { action: "document.select", epoch: 0, documentId, page: 2 },
    { action: "page.clear", epoch: 0, documentId, page: 2 },
    { action: "stroke.restore", epoch: 0, id: pdf.id, documentId, page: 2 },
  ]) assert.equal(lessonBoardCommandSchema.safeParse(command).success, true);
  for (const pageCount of [0, 101, 1.5])
    assert.equal(lessonBoardCommandSchema.safeParse({ action: "document.add", epoch: 0, id: documentId, pageCount }).success, false);
});

test("shared lesson board client sends teacher and portal paths with opaque IDs and mutation keys", async () => {
  const requests = [];
  const { DerslikClient } = loadTestModule("packages/api-client/src/index.ts", {
    dependencies: {
      "../../contracts/src/i18n/index.ts": { t: (key) => key, getLocale: () => "tr" },
      "./uploads.ts": {},
      "./socket.ts": {},
      "./lesson-board.ts": boardSource(),
      "./board-tools.ts": boardToolsSource(),
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
  await client.lessonBoardDocument("ws/one", "student?two", "lesson#three", "document/four", true);
  assert.equal(new URL(requests.at(-1).url).pathname, "/v1/portal/ws%2Fone/student%3Ftwo/lessons/lesson%23three/board/documents/document%2Ffour");
});

function boardSource(globals = {}) {
  const shared = loadTestModule("packages/api-client/src/lesson-board.ts", {
    dependencies: {
      "../../contracts/src/live-lesson.ts": { maxBoardPoints },
      "../../contracts/src/i18n/index.ts": { t: (key) => key },
    },
    globals: { Error, ...globals },
  });
  return { ...shared, ...boardToolsSource(shared) };
}

function boardToolsSource(shared) {
  return loadTestModule("packages/api-client/src/board-tools.ts", {
    dependencies: { "./lesson-board.ts": shared ?? boardSource() },
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

test("shared drawing visibility and undo stay on the selected PDF page", () => {
  const { boardPageStrokes, boardUndoStroke } = boardSource();
  const documentId = randomUUID(), otherDocument = randomUUID();
  const blank = { ...stroke(), authorId: "teacher-1" };
  const first = { ...stroke({ documentId, page: 1 }), authorId: "teacher-1" };
  const second = { ...stroke({ documentId, page: 2 }), authorId: "teacher-1" };
  const own = { ...stroke({ documentId, page: 2 }), authorId: "student-1" };
  const unrelated = { ...stroke({ documentId: otherDocument, page: 2 }), authorId: "teacher-1" };
  const current = board(3, { documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }], documentId, page: 2, strokes: [blank, first, second, own, unrelated] });
  assert.deepEqual(plain(boardPageStrokes(current)), [second, own]);
  assert.strictEqual(boardUndoStroke({ ...current, viewerId: "student-1", canClear: false }), own);
  assert.strictEqual(boardUndoStroke({ ...current, page: 1 }), first);
  assert.strictEqual(boardUndoStroke({ ...current, documentId: null, page: 0 }), blank);
});

test("shape gestures keep only their endpoints and erasing respects page and author rights", () => {
  const { boardGesturePoints, boardHitStroke } = boardToolsSource();
  const points = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }], next = { x: 0.9, y: 0.8 };
  for (const tool of ["line", "rectangle", "ellipse"])
    assert.deepEqual(plain(boardGesturePoints(stroke({ points, tool }), next)), [points[0], next]);
  assert.deepEqual(plain(boardGesturePoints(stroke({ points }), next)), [...points, next]);
  const documentId = randomUUID();
  const owned = { ...stroke({ documentId, page: 2, points, tool: "rectangle" }), authorId: "student-1" };
  const foreign = { ...stroke({ documentId, page: 2, points, tool: "rectangle" }), authorId: "teacher-1" };
  const hidden = { ...stroke({ documentId, page: 1, points, tool: "rectangle" }), authorId: "student-1" };
  const pupil = board(3, { documentId, page: 2, viewerId: "student-1", canClear: false, strokes: [owned, foreign, hidden] });
  assert.strictEqual(boardHitStroke(pupil, { x: 0.1, y: 0.25 }), owned);
  assert.strictEqual(boardHitStroke({ ...pupil, canClear: true }, { x: 0.1, y: 0.25 }), foreign);
  assert.equal(boardHitStroke(pupil, { x: 0.25, y: 0.25 }), undefined, "erasing the empty center does not remove an outlined rectangle");
  const ellipse = { ...stroke({ points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], tool: "ellipse" }), authorId: "teacher-1" };
  assert.strictEqual(boardHitStroke(board(1, { strokes: [ellipse] }), { x: 0.5, y: 0.3 }), ellipse);
  assert.equal(boardHitStroke(board(1, { strokes: [ellipse] }), { x: 0.3, y: 0.3 }), undefined);
});

test("notes stay inside the paper and erasing follows their rendered bounds on portrait pages", () => {
  const { boardNoteLayout, boardHitStroke } = boardToolsSource();
  const note = { ...stroke({ tool: "note", text: "x = 2", points: [{ x: 0.99, y: 0.99 }] }), authorId: "teacher-1" };
  assert.deepEqual(plain(boardNoteLayout(note, 1400)), { x: 720, y: 1336, width: 280, height: 64, lines: ["x = 2"] });
  assert.strictEqual(boardHitStroke(board(1, { strokes: [note] }), { x: 0.9, y: 0.98 }, 1000 / 1400), note);
  assert.equal(boardHitStroke(board(1, { strokes: [note] }), { x: 0.5, y: 0.98 }, 1000 / 1400), undefined);
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
  const documentReads = [];
  const removed = new Map();
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
        ...Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "TextInput", "View"].map((name) => [name, name])),
        AppState: appState,
        PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
      },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "react-native-svg": { __esModule: true, default: "Svg", ...Object.fromEntries(["Circle", "Path", "Rect", "Ellipse", "G", "Line", "Text", "TSpan"].map((name) => [name, name === "Text" ? "SvgText" : name])) },
      "@expo/vector-icons": { Ionicons: "Ionicons" },
      "expo-crypto": { randomUUID },
      "@derslik/contracts": { ...liveContracts, t: (key) => key },
      "@derslik/api-client": shared,
      "./lesson-board-pdf": { NativeBoardPdf: "NativeBoardPdf" },
      "./lesson-board-upload": { uploadBoardPdf: options.upload ?? (() => Promise.resolve(null)) },
      "./core": { client: {
        lessonBoard: async (...args) => {
          reads.push(args);
          return options.load ? options.load(reads.length, currentBoard) : { data: currentBoard };
        },
        lessonBoardDocument: (...args) => {
          documentReads.push(args);
          return options.document ? options.document(...args) : Promise.resolve({ data: { url: "https://storage.example.test/lesson.pdf", expiresIn: 120 } });
        },
        changeLessonBoard: async (...args) => {
          writes.push(args);
          if (options.change) return options.change(args, writes.length, currentBoard);
          const command = args[3];
          currentBoard = applyBoardCommand(currentBoard, command, removed);
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
  const button = (key) => oneNode(tree, (node) => node.type === "Button" && treeText(node) === (key === "liveLesson.clear" ? "liveLesson.clearPage" : key), key);
  const canvas = () => oneNode(tree, (node) => node.type === "View" && node.props.accessibilityLabel === "liveLesson.board");
  const pointer = (x, y) => ({ nativeEvent: { locationX: x, locationY: y } });
  const draw = (points) => {
    canvas().props.onPanResponderGrant(pointer(...points[0]));
    for (const point of points.slice(1)) canvas().props.onPanResponderMove(pointer(...point));
    canvas().props.onPanResponderRelease();
  };
  render();
  return { reads, writes, documentReads, timers, props, appState, button, canvas, draw, pointer, render, confirmations, closed: () => closed, tree: () => tree, unmount: renderer.unmount,
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
  const drawingLabels = new Set(["pen", "highlighter", "line", "rectangle", "ellipse", "note", "eraser", "black", "blue", "red", "green"].map((name) => `liveLesson.${name}`));
  for (const width of [2, 4, 8]) drawingLabels.add(`liveLesson.pen ${width}`);
  assert.ok(treeNodes(f.tree()).filter((node) => node.type === "Pressable" && drawingLabels.has(node.props.accessibilityLabel)).every((node) => node.props.disabled));
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
  assert.deepEqual(plain(pupil.writes[0][3]), { action: "stroke.remove", epoch: 0, id: own.id, documentId: null, page: 0 });
  pupil.unmount();
  const teacher = nativeBoardFixture({ initial: board(1, { strokes: [foreign] }) });
  await settle();
  teacher.render();
  teacher.button("liveLesson.clear").props.onPress();
  await settle();
  teacher.render();
  assert.equal(teacher.confirmations[0].title, "liveLesson.clearConfirm");
  assert.deepEqual(plain(teacher.writes[0][3]), { action: "page.clear", epoch: 0, documentId: null, page: 0 });
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

test("native drawing cancels when a remote clear arrives during a gesture", async () => {
  const f = nativeBoardFixture({
    load: async (index, current) => ({ data: index === 1 ? current : board(2, { epoch: 1 }) }),
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
  assert.equal(f.writes.length, 0, "remote clear cannot revive a gesture from the preceding epoch");
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Circle" || node.type === "Path").length, 0);
  f.unmount();
});

test("native shape and note tools save bounded geometry, then redo restores the removed annotation", async () => {
  const f = nativeBoardFixture();
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.rectangle").props.onPress();
  f.render(); f.draw([[100, 100], [200, 200], [300, 200]]);
  await settle(); f.render();
  assert.equal(f.writes[0][3].stroke.tool, "rectangle");
  assert.deepEqual(plain(f.writes[0][3].stroke.points), [{ x: 0.2, y: 0.333 }, { x: 0.6, y: 0.667 }]);
  assert.equal(boardStrokeInputSchema.safeParse(f.writes[0][3].stroke).success, true);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Rect").props.width, 400);
  f.button("liveLesson.undo").props.onPress();
  await settle(); f.render();
  f.button("liveLesson.redo").props.onPress();
  await settle(); f.render();
  assert.equal(f.writes[2][3].action, "stroke.restore");
  assert.equal(f.writes[2][3].id, f.writes[0][3].stroke.id);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Rect").props.width, 400);
  oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.note").props.onPress();
  f.render();
  oneNode(f.tree(), (node) => node.type === "TextInput").props.onChangeText("x = 2");
  f.render(); f.draw([[150, 150], [300, 200]]);
  await settle(); f.render();
  assert.equal(f.writes[3][3].stroke.text, "x = 2");
  assert.equal(boardStrokeInputSchema.safeParse(f.writes[3][3].stroke).success, true);
  f.unmount();
});

test("native PDF rendering gates drawing, keeps page scope and teacher navigation clears redo history", async () => {
  const documentId = randomUUID();
  const f = nativeBoardFixture({ initial: board(1, { documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }], documentId, page: 1 }) });
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 600, height: 840 } } });
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.onReady({ pageCount: 2, aspectRatio: 600 / 840 });
  f.render();
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), true);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Svg").props.viewBox, "0 0 1000 1400");
  f.draw([[150, 420], [300, 210]]);
  await settle(); f.render();
  assert.equal(f.writes[0][3].stroke.documentId, documentId);
  assert.equal(f.writes[0][3].stroke.page, 1);
  assert.deepEqual(plain(f.writes[0][3].stroke.points), [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "Path").props.d, "M250,700 L500,350");
  f.button("liveLesson.undo").props.onPress();
  await settle(); f.render();
  assert.equal(f.button("liveLesson.redo").props.disabled, false);
  f.button("liveLesson.nextPage").props.onPress();
  await settle(); f.render();
  assert.deepEqual(plain(f.writes[2][3]), { action: "document.select", epoch: 0, documentId, page: 2 });
  assert.equal(f.button("liveLesson.redo").props.disabled, true);
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  assert.equal(f.documentReads.length, 1, "page navigation reuses the loaded private PDF");
  f.unmount();
});

test("native guardians and completed teachers browse PDF pages locally without board mutations", async () => {
  const documentId = randomUUID();
  for (const viewerId of ["guardian-1", "teacher-1"]) {
    const initial = board(1, { viewerId, canEdit: false, canClear: false, documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }], documentId, page: 1 });
    const f = nativeBoardFixture({ initial });
    await settle(); f.render();
    assert.equal(f.button("liveLesson.nextPage").props.disabled, false);
    f.button("liveLesson.nextPage").props.onPress();
    await settle(); f.render();
    assert.equal(oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.page, 2);
    oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.onReady({ pageCount: 2, aspectRatio: 5 / 3 });
    f.render();
    assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
    assert.equal(f.button("liveLesson.previousPage").props.disabled, false);
    const follow = oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.followTeacher");
    assert.equal(follow.props.accessibilityState.selected, false);
    follow.props.onPress();
    f.render();
    assert.equal(oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.page, 1);
    assert.equal(oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.followTeacher").props.accessibilityState.selected, true);
    assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
    assert.equal(f.writes.length, 0, `${viewerId} navigation must stay local`);
    assert.equal(f.documentReads.length, 1);
    f.unmount();
  }
});

test("native students browse another document read-only and follow teacher restores shared drawing", async () => {
  const documentId = randomUUID();
  const f = nativeBoardFixture({ initial: board(1, { viewerId: "student-1", canClear: false, documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }] }) });
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), true);
  const document = oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "Denklemler.pdf");
  assert.equal(document.props.disabled, false);
  document.props.onPress();
  f.render(); await settle(); f.render();
  oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.onReady({ pageCount: 2, aspectRatio: 5 / 3 });
  f.render();
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  f.draw([[100, 100], [200, 200]]);
  f.button("liveLesson.nextPage").props.onPress();
  await settle(); f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "NativeBoardPdf").props.page, 2);
  assert.equal(f.writes.length, 0);
  oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.followTeacher").props.onPress();
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "NativeBoardPdf").length, 0);
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), true);
  f.draw([[100, 100]]);
  await settle(); f.render();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][3].action, "stroke.add");
  assert.equal(f.writes[0][3].stroke.documentId, null);
  assert.equal(f.writes[0][3].stroke.page, 0);
  f.unmount();
});

test("native zoom uses measured paper bounds and panning cannot accidentally create an annotation", async () => {
  const f = nativeBoardFixture();
  await settle(); f.render();
  oneNode(f.tree(), (node) => node.type === "View" && typeof node.props.onLayout === "function" && !node.props.accessibilityLabel).props.onLayout({ nativeEvent: { layout: { width: 500 } } });
  f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.canvas().props.onPanResponderGrant(f.pointer(125, 150));
  f.button("liveLesson.zoomIn").props.onPress();
  f.render();
  assert.equal(f.canvas().props.style.width, 750);
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 750, height: 450 } } });
  f.canvas().props.onPanResponderRelease();
  assert.equal(f.writes.length, 0, "changing zoom cancels the earlier gesture");
  f.draw([[187.5, 225]]);
  await settle(); f.render();
  assert.deepEqual(plain(f.writes[0][3].stroke.points), [{ x: 0.25, y: 0.5 }]);
  f.button("liveLesson.moveCanvas").props.onPress();
  f.render();
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  f.draw([[100, 100], [200, 200]]);
  assert.equal(f.writes.length, 1);
  f.unmount();
});

function nativePdfUploaderFixture(options = {}) {
  const requests = [], uploads = [];
  const id = randomUUID();
  const { uploadBoardPdf } = loadTestModule("apps/mobile/src/lesson-board-upload.ts", {
    dependencies: {
      "expo-document-picker": { getDocumentAsync: () => Promise.resolve({ canceled: false, assets: [{ uri: "file:///local/lesson.pdf", name: "Denklemler.pdf", size: 100 }] }) },
      "expo/fetch": { fetch: (url, init) => {
        uploads.push({ url, init });
        return options.send ? options.send(uploads.length) : Promise.resolve({ ok: true });
      } },
      "expo-crypto": { randomUUID, digest: () => Promise.resolve(new ArrayBuffer(32)), CryptoDigestAlgorithm: { SHA256: "SHA-256" } },
      "@derslik/contracts": { t: (key) => key },
      "./file-bytes": { readFileBytes: () => Promise.resolve(new Uint8Array(100)) },
      "./core": { request: (path, body, key) => {
        requests.push({ path, body, key });
        if (options.request) return options.request(path, body, key, requests.length, id);
        if (path.endsWith("/files")) return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
        if (path.includes("/download")) return Promise.resolve({ data: { url: "https://storage.example.test/lesson.pdf" } });
        return Promise.resolve({ data: { id, status: "READY" } });
      } },
    },
  });
  const reservations = new Map();
  return { requests, uploads, reservations, id, upload: () => uploadBoardPdf("ws/one", "student?two", reservations) };
}

test("native PDF upload retries completion without another reservation and reads the signed response envelope", async () => {
  let finishes = 0;
  const f = nativePdfUploaderFixture({ request: (path, _body, _key, _index, id) => {
    if (path.endsWith("/files")) return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
    if (path.includes("/download")) return Promise.resolve({ data: { url: "https://storage.example.test/lesson.pdf" } });
    if (++finishes === 1) return Promise.reject(new Error("Finish response lost"));
    return Promise.resolve({ data: { id, status: "READY" } });
  } });
  await assert.rejects(f.upload(), /Finish response lost/);
  const uploaded = await f.upload();
  assert.deepEqual(plain(uploaded), { id: f.id, name: "Denklemler.pdf", url: "https://storage.example.test/lesson.pdf" });
  assert.deepEqual(f.requests.map((entry) => entry.path), [
    "/media/ws%2Fone/student%3Ftwo/files", `/media/ws%2Fone/student%3Ftwo/files/${f.id}/finish`, `/media/ws%2Fone/student%3Ftwo/files/${f.id}/finish`, `/media/ws%2Fone/student%3Ftwo/files/${f.id}/download?inline=1`,
  ]);
  assert.equal(f.requests[0].body.purpose, "RESOURCE");
  assert.equal(f.requests[0].body.sizeBytes, 100);
  assert.equal(f.requests[1].key, f.requests[2].key);
  assert.notEqual(f.requests[0].key, f.requests[1].key);
  assert.equal(f.uploads[0].init.headers["x-upsert"], "false");
  assert.equal(f.uploads[0].init.method, "PUT");
  assert.equal(f.uploads.length, 1);
  assert.equal(f.reservations.size, 1, "the finished file stays reusable after the board attachment response is lost");
});

test("native PDF upload stores reservation identity before a lost reply and refreshes expired PUT URLs", async () => {
  let reserves = 0;
  const lost = nativePdfUploaderFixture({ request: (path, _body, _key, _index, id) => {
    if (path.endsWith("/files") && ++reserves === 1) return Promise.reject(new Error("Reserve response lost"));
    if (path.includes("/download")) return Promise.resolve({ data: { url: "https://storage.example.test/lesson.pdf" } });
    return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
  } });
  await assert.rejects(lost.upload(), /Reserve response lost/);
  assert.equal(lost.reservations.size, 1);
  assert.equal(lost.uploads.length, 0);
  assert.equal((await lost.upload()).id, lost.id);
  assert.equal(lost.requests[0].key, lost.requests[1].key);
  assert.deepEqual(plain(lost.requests[0].body), plain(lost.requests[1].body));
  let refreshed = 0;
  const expired = nativePdfUploaderFixture({
    request: (path, _body, _key, _index, id) => {
      if (path.endsWith("/files")) return Promise.resolve({ data: { id, uploadUrl: `https://storage.example.test/upload?token=${++refreshed}` } });
      return Promise.resolve({ data: path.includes("/download") ? { url: "https://storage.example.test/lesson.pdf" } : { id, status: "READY" } });
    },
    send: (attempt) => Promise.resolve({ ok: attempt > 1, status: attempt > 1 ? 200 : 403 }),
  });
  await assert.rejects(expired.upload(), /learn.uploadFailed/);
  assert.equal((await expired.upload()).id, expired.id);
  assert.equal(expired.requests[0].key, expired.requests[1].key);
  assert.equal(expired.uploads[0].url, "https://storage.example.test/upload?token=1");
  assert.equal(expired.uploads[1].url, "https://storage.example.test/upload?token=2");
  assert.equal(expired.requests.filter((entry) => entry.path.endsWith("/finish")).length, 1);
});

test("native PDF upload reuses READY material and download retries never upload or finish again", async () => {
  const ready = nativePdfUploaderFixture({ request: (path, _body, _key, _index, id) => Promise.resolve({ data: path.endsWith("/files") ? { id, status: "READY" } : { url: "https://storage.example.test/lesson.pdf" } }) });
  assert.equal((await ready.upload()).id, ready.id);
  assert.equal(ready.uploads.length, 0);
  assert.equal(ready.requests.filter((entry) => entry.path.endsWith("/finish")).length, 0);
  let downloads = 0;
  const lost = nativePdfUploaderFixture({ request: (path, _body, _key, _index, id) => {
    if (path.endsWith("/files")) return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
    if (path.includes("/download")) {
      if (++downloads === 1) return Promise.reject(new Error("Download response lost"));
      return Promise.resolve({ data: { url: "https://storage.example.test/refreshed.pdf" } });
    }
    return Promise.resolve({ data: { id, status: "READY" } });
  } });
  await assert.rejects(lost.upload(), /Download response lost/);
  assert.deepEqual(plain(await lost.upload()), { id: lost.id, name: "Denklemler.pdf", url: "https://storage.example.test/refreshed.pdf" });
  assert.equal(lost.uploads.length, 1);
  assert.equal(lost.requests.filter((entry) => entry.path.endsWith("/files")).length, 1);
  assert.equal(lost.requests.filter((entry) => entry.path.endsWith("/finish")).length, 1);
  assert.equal(downloads, 2);
});

test("native PDF HTML escapes file URLs and rejects malformed renderer messages or external navigation", () => {
  const renderer = createTsxFixture(), ready = [], errors = [];
  const source = loadTestModule("apps/mobile/src/lesson-board-pdf.tsx", {
    dependencies: {
      react: renderer.react, "react/jsx-runtime": renderer.jsx,
      "react-native-webview": { WebView: "WebView" },
      "./pdf-html": loadTestModule("apps/mobile/src/pdf-html.ts"),
    },
  });
  const url = "https://storage.example.test/file.pdf?name=</script><script>window.injected=1</script>";
  const html = source.nativeBoardPdfHtml(url, 2);
  assert.ok(html.includes(String.raw`\u003c/script>`));
  assert.equal(html.includes(url), false);
  assert.equal(html.split("<script").length - 1, 3, "file data cannot create another executable script element");
  const tree = renderer.render(source.NativeBoardPdf, { url, page: 2, onReady: (value) => ready.push(plain(value)), onError: () => errors.push(true) });
  tree.props.onMessage({ nativeEvent: { data: JSON.stringify({ pageNumber: 2, pageCount: 2, aspectRatio: 0.7 }) } });
  assert.deepEqual(ready, [{ pageCount: 2, aspectRatio: 0.7 }]);
  tree.props.onMessage({ nativeEvent: { data: JSON.stringify({ pageNumber: 1, pageCount: 2, aspectRatio: 0.7 }) } });
  assert.equal(ready.length, 1, "a previous page render cannot mark the current page ready");
  for (const data of ["invalid JSON", "null", JSON.stringify({ error: true }), JSON.stringify({ pageNumber: 2, pageCount: 101, aspectRatio: 1 }), JSON.stringify({ pageNumber: 2, pageCount: 1.5, aspectRatio: 1 }), JSON.stringify({ pageNumber: 2, pageCount: 2, aspectRatio: 0.01 }), JSON.stringify({ pageNumber: 2, pageCount: 2, aspectRatio: 11 })])
    tree.props.onMessage({ nativeEvent: { data } });
  assert.equal(errors.length, 7);
  assert.equal(tree.props.onShouldStartLoadWithRequest({ url: "about:blank" }), true);
  assert.equal(tree.props.onShouldStartLoadWithRequest({ url: "https://external.example.test" }), false);
  assert.equal(tree.props.onShouldStartLoadWithRequest({ url: "javascript:alert(1)" }), false);
  const scripts = [];
  tree.props.ref.current = { injectJavaScript: (script) => scripts.push(script) };
  const next = renderer.render(source.NativeBoardPdf, { url, page: 3, onReady: (value) => ready.push(plain(value)), onError: () => errors.push(true) });
  assert.equal(next.props.source.html, tree.props.source.html, "page navigation keeps the same loaded document and HTML");
  assert.ok(scripts[0].includes("renderBoardPdfPage(3)"));
  assert.equal(scripts[0].includes(url), false);
  renderer.unmount();
});

function pdfUploaderFixture(options = {}) {
  const requests = [], uploads = [];
  const id = randomUUID();
  const { BoardPdfUploader } = loadTestModule("apps/web/components/derslik/board-upload.ts", {
    dependencies: {
      "@derslik/contracts": { t: (key) => key },
      "./board-pdf": { readBoardPdf: options.read ?? (() => Promise.resolve(2)) },
      "@/lib/client": { backend: (path, body, key) => {
        requests.push({ path, body, key });
        if (options.request) return options.request(path, body, key, requests.length, id);
        return Promise.resolve({ data: path.endsWith("/files") ? { id, uploadUrl: "https://storage.example.test/upload" } : { id, status: "READY" } });
      } },
    },
    globals: { crypto: webcrypto, fetch: (url, init) => {
      uploads.push({ url, init });
      return options.send ? options.send(uploads.length) : Promise.resolve({ ok: true, status: 200 });
    } },
  });
  const uploader = new BoardPdfUploader(options.base ?? "/workspaces/workspace-1/students/student-1/lessons/lesson-1/board");
  return { uploader, requests, uploads, id };
}

test("web PDF upload preserves reservation and mutation identity after lost reserve or PUT replies", async () => {
  const file = new File(["%PDF-1.7 sample"], "Denklemler.pdf", { type: "application/pdf" });
  let reservations = 0;
  const lost = pdfUploaderFixture({ request: (path, _body, _key, _index, id) => {
    if (path.endsWith("/files") && ++reservations === 1) return Promise.reject(new Error("Reserve response lost"));
    return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
  } });
  await assert.rejects(lost.uploader.upload(file), /Reserve response lost/);
  assert.deepEqual(plain(await lost.uploader.upload(file)), { id: lost.id, pageCount: 2 });
  assert.equal(lost.requests[0].key, lost.requests[1].key);
  let refreshed = 0;
  const interrupted = pdfUploaderFixture({
    request: (path, _body, _key, _index, id) => Promise.resolve({ data: path.endsWith("/files") ? { id, uploadUrl: `https://storage.example.test/upload?token=${++refreshed}` } : { id, status: "READY" } }),
    send: (attempt) => Promise.resolve({ ok: attempt > 1, status: attempt > 1 ? 409 : 403 }),
  });
  await assert.rejects(interrupted.uploader.upload(file), /learn.uploadFailed/);
  assert.deepEqual(plain(await interrupted.uploader.upload(file)), { id: interrupted.id, pageCount: 2 });
  assert.equal(interrupted.requests.filter((entry) => entry.path.endsWith("/files")).length, 2);
  assert.equal(interrupted.requests[0].key, interrupted.requests[1].key);
  assert.equal(interrupted.uploads.length, 2);
  assert.equal(interrupted.uploads[0].url, "https://storage.example.test/upload?token=1");
  assert.equal(interrupted.uploads[1].url, "https://storage.example.test/upload?token=2");
  assert.equal(interrupted.uploads[0].init.headers["x-upsert"], "false");
});

test("web PDF upload reuses READY material and retries finish without uploading or reserving again", async () => {
  const file = new File(["%PDF-1.7 sample"], "Denklemler.pdf", { type: "application/pdf" });
  const ready = pdfUploaderFixture({ request: (_path, _body, _key, _index, id) => Promise.resolve({ data: { id, status: "READY" } }) });
  assert.deepEqual(plain(await ready.uploader.upload(file)), { id: ready.id, pageCount: 2 });
  assert.equal(ready.uploads.length, 0);
  assert.equal(ready.requests.length, 1);
  assert.deepEqual(plain(await ready.uploader.upload(file)), { id: ready.id, pageCount: 2 });
  assert.equal(ready.requests.length, 1);
  let finishes = 0;
  const interrupted = pdfUploaderFixture({ request: (path, _body, _key, _index, id) => {
    if (path.endsWith("/files")) return Promise.resolve({ data: { id, uploadUrl: "https://storage.example.test/upload" } });
    if (++finishes === 1) return Promise.reject(new Error("Finish response lost"));
    return Promise.resolve({ data: { id, status: "READY" } });
  } });
  await assert.rejects(interrupted.uploader.upload(file), /Finish response lost/);
  assert.deepEqual(plain(await interrupted.uploader.upload(file)), { id: interrupted.id, pageCount: 2 });
  assert.equal(interrupted.uploads.length, 1);
  assert.equal(interrupted.requests.filter((entry) => entry.path.endsWith("/files")).length, 1);
  assert.equal(finishes, 2);
});

test("web rejected PDFs never reserve storage and student paths cannot upload lesson documents", async () => {
  const file = new File(["broken PDF"], "lesson.pdf");
  const invalid = pdfUploaderFixture({ read: () => Promise.reject(new Error("Invalid PDF")) });
  await assert.rejects(invalid.uploader.upload(file), /Invalid PDF/);
  assert.equal(invalid.requests.length, 0);
  assert.equal(invalid.uploads.length, 0);
  const pupil = pdfUploaderFixture({ base: "/portal/workspace-1/student-1/lessons/lesson-1/board" });
  await assert.rejects(pupil.uploader.upload(file), /api.boardTeacherOnly/);
  assert.equal(pupil.requests.length, 0);
});

function pdfSourceFixture(options = {}) {
  const renderer = createTsxFixture(), requests = [], downloads = [], parsed = [], destroyed = [];
  const pdf = options.pdf ?? { numPages: 2, getPage: (number) => Promise.resolve({ number }) };
  const library = { GlobalWorkerOptions: {}, getDocument: (config) => {
    parsed.push(config);
    const loading = options.loading ? options.loading(parsed.length) : { promise: Promise.resolve(pdf) };
    loading.destroy = () => { destroyed.push(parsed.length); return Promise.resolve(); };
    return loading;
  } };
  const source = loadTestModule("apps/web/components/derslik/board-pdf.tsx", {
    dependencies: {
      react: options.element ? { ...renderer.react, useRef: () => ({ current: options.element }) } : renderer.react, "react/jsx-runtime": renderer.jsx,
      "@derslik/contracts": { ...liveContracts, t: (key) => key },
      "pdfjs-dist": library,
      "@/lib/client": { backend: (path) => {
        requests.push(path);
        return Promise.resolve({ data: { url: "https://storage.example.test/lesson.pdf" } });
      } },
    },
    globals: { fetch: (url, init) => {
      downloads.push({ url, init });
      return options.download ? options.download(init) : Promise.resolve(new Response("%PDF-1.7 local"));
    } },
  });
  const render = (props) => renderer.render((current) => {
    const document = source.useBoardPdf("/board", current.id, current.retry ?? 0);
    const page = source.useBoardPdfPage(document.pdf, current.page ?? 1);
    return { type: "State", props: { value: { document, page } } };
  }, props).props.value;
  return { source, render, renderer, parsed, destroyed, requests, downloads, library, unmount: renderer.unmount };
}

test("actual PDF parsing uses bytes, rejects unsupported files and destroys parse tasks", async () => {
  const f = pdfSourceFixture();
  const file = new File(["%PDF-1.7 sample"], "Denklemler.PDF");
  assert.equal(await f.source.readBoardPdf(file), 2);
  assert.equal(f.parsed[0].data.byteLength, file.size);
  assert.equal(Object.hasOwn(f.parsed[0], "url"), false);
  assert.equal(f.destroyed.length, 1);
  assert.match(f.library.GlobalWorkerOptions.workerSrc, /pdf\.worker\.min\.mjs$/);
  await assert.rejects(f.source.readBoardPdf(new File([], "empty.pdf")), /liveLesson.pdfLimit/);
  await assert.rejects(f.source.readBoardPdf(new File(["text"], "notes.txt")), /liveLesson.pdfLimit/);
  assert.equal(f.parsed.length, 1);
  const oversized = pdfSourceFixture({ pdf: { numPages: 101 } });
  await assert.rejects(oversized.source.readBoardPdf(file), /liveLesson.pdfLimit/);
  assert.equal(oversized.destroyed.length, 1);
  const malformed = pdfSourceFixture({ loading: () => ({ promise: Promise.reject(new Error("Malformed PDF")) }) });
  await assert.rejects(malformed.source.readBoardPdf(file), /Malformed PDF/);
  assert.equal(malformed.destroyed.length, 1);
});

test("actual PDF hooks retain full bytes across page changes and cancel stale document loads", async () => {
  const pages = [];
  const pdf = { numPages: 2, getPage: (number) => { pages.push(number); return Promise.resolve({ number }); } };
  const f = pdfSourceFixture({ pdf });
  f.render({ id: "document-1" });
  await settle(); f.render({ id: "document-1" });
  await settle();
  assert.equal(f.render({ id: "document-1" }).page.page.number, 1);
  f.render({ id: "document-1", page: 2 });
  await settle();
  assert.equal(f.render({ id: "document-1", page: 2 }).page.page.number, 2);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(f.downloads.length, 1, "later pages use retained bytes even if the signed URL has expired");
  assert.equal(Object.hasOwn(f.parsed[0], "url"), false);
  assert.ok(f.parsed[0].data.byteLength > 0);
  f.unmount();
  assert.equal(f.downloads[0].init.signal.aborted, true);
  assert.equal(f.destroyed.length, 1);
  const old = deferred(), fresh = deferred();
  const stale = pdfSourceFixture({ loading: (index) => ({ promise: index === 1 ? old.promise : fresh.promise }) });
  stale.render({ id: "old" });
  await settle();
  stale.render({ id: "fresh" });
  await settle();
  old.resolve({ numPages: 1, getPage: () => Promise.resolve({ number: 99 }) });
  fresh.resolve(pdf);
  await settle();
  assert.strictEqual(stale.render({ id: "fresh" }).document.pdf, pdf);
  assert.equal(stale.downloads[0].init.signal.aborted, true);
  stale.unmount();
});

test("actual PDF downloads fail with a retryable translated error and unmount aborts pending bytes", async () => {
  const failed = pdfSourceFixture({ download: () => Promise.resolve(new Response("Expired", { status: 403 })) });
  failed.render({ id: "document-1" });
  await settle();
  assert.equal(failed.render({ id: "document-1" }).document.error, "liveLesson.pdfError");
  assert.equal(failed.parsed.length, 0);
  failed.render({ id: "document-1", retry: 1 });
  await settle();
  assert.equal(failed.downloads.length, 2);
  failed.unmount();
  const bytes = deferred();
  const pending = pdfSourceFixture({ download: () => bytes.promise });
  pending.render({ id: "document-1" });
  await settle();
  pending.unmount();
  assert.equal(pending.downloads[0].init.signal.aborted, true);
  bytes.resolve(new Response("%PDF-1.7 late"));
  await settle();
  assert.equal(pending.parsed.length, 0);
  const unbounded = pdfSourceFixture({ pdf: { numPages: 101 } });
  unbounded.render({ id: "document-1" });
  await settle();
  assert.equal(unbounded.render({ id: "document-1" }).document.error, "liveLesson.pdfError");
  assert.ok(unbounded.destroyed.length > 0, "a previously uploaded PDF cannot bypass the page limit");
  unbounded.unmount();
});

test("actual PDF canvas bounds render dimensions, cancels old pages and ignores late render callbacks", async () => {
  const element = {}, first = deferred(), second = deferred(), ready = [], cancelled = [], renderCalls = [];
  const page = (number, result) => ({
    number, getViewport: ({ scale }) => ({ width: 3000 * scale, height: 6000 * scale }),
    render: (options) => { renderCalls.push(options); return { promise: result.promise, cancel: () => cancelled.push(number) }; },
  });
  const old = page(1, first), current = page(2, second);
  const f = pdfSourceFixture({ element });
  const props = { page: old, onReady: (saved) => ready.push(saved), onError: () => assert.fail("Valid PDF render failed") };
  f.renderer.render(f.source.BoardPdfCanvas, props);
  assert.equal(element.width, 800);
  assert.equal(element.height, 1600);
  assert.equal(renderCalls[0].annotationMode, 0);
  f.renderer.render(f.source.BoardPdfCanvas, { ...props, page: current });
  assert.deepEqual(cancelled, [1]);
  first.resolve(); second.resolve();
  await settle();
  assert.deepEqual(ready, [current]);
  f.unmount();
  assert.deepEqual(cancelled, [1, 2]);
  const waiting = deferred(), closedReady = [];
  const closed = pdfSourceFixture({ element: {} });
  closed.renderer.render(closed.source.BoardPdfCanvas, { page: page(3, waiting), onReady: (saved) => closedReady.push(saved), onError: () => assert.fail("Closed PDF reported an error") });
  closed.unmount(); waiting.resolve();
  await settle();
  assert.deepEqual(closedReady, []);
});

function webFixture(kind, options = {}) {
  const renderer = createTsxFixture();
  const reads = [], writes = [], confirmations = [], timers = new Map(), drafts = [], strokes = [], erased = [];
  const removed = new Map();
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
    "lucide-react": new Proxy({}, { get: (_target, name) => String(name) }),
    "@/lib/client": { backend: async (path, command, key) => {
      if (command === undefined) {
        reads.push(path);
        return options.load ? options.load(reads.length, currentBoard) : { data: currentBoard };
      }
      writes.push({ path, command: plain(command), key });
      if (options.change) return options.change(command, writes.length, currentBoard);
      currentBoard = applyBoardCommand(currentBoard, command, removed);
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
  const canvasSource = loadTestModule("apps/web/components/derslik/board-canvas.tsx", { dependencies, globals });
  dependencies["./board-canvas"] = canvasSource;
  dependencies["./board-controls"] = loadTestModule("apps/web/components/derslik/board-controls.tsx", { dependencies, globals });
  dependencies["./board-pdf"] = {
    useBoardPdf: () => options.pdf ?? {},
    useBoardPdfPage: (_pdf, page) => typeof options.pdfPage === "function" ? options.pdfPage(page) : options.pdfPage ?? {},
    readBoardPdf: options.readPdf ?? (() => Promise.resolve(2)),
    BoardPdfCanvas: "BoardPdfCanvas",
  };
  dependencies["./board-upload"] = { BoardPdfUploader: class { upload(file) { return options.upload ? options.upload(file) : Promise.resolve({ id: randomUUID(), pageCount: 2 }); } } };
  dependencies["./lesson-board.css"] = {};
  dependencies["./use-lesson-board"] = loadTestModule("apps/web/components/derslik/use-lesson-board.ts", { dependencies, globals });
  const source = loadTestModule(`apps/web/components/derslik/${kind === "canvas" || kind === "dialog" ? "lesson-board" : "live-lesson"}.tsx`, { dependencies, globals });
  let props;
  if (kind === "canvas") props = {
    board: currentBoard, editable: true, color: boardColors[0], width: 4, draft: null,
    onDraft: (next) => { drafts.push(next); props.draft = next; },
    onStroke: (stroke, epoch) => strokes.push({ stroke: plain(stroke), epoch }),
    onErase: (id) => erased.push(id),
  };
  else if (kind === "dialog") props = { initial: currentBoard, base, title: "Denklemler", onClose: () => closed++ };
  else if (kind === "actions") props = { lesson: { id: "lesson-1", student_id: "student-1", topic: "Denklemler", status: "SCHEDULED", meeting_url: "https://meet.google.com/abc-defg-hij" }, base, disabled: false };
  else props = { lesson: { id: "lesson-1", topic: "Denklemler", version: 4, meeting_url: "https://meet.google.com/abc-defg-hij" }, busy: false, mutate: async (command, message) => {
    writes.push({ command: plain(command), message });
    return options.mutate ? options.mutate(command, message) : true;
  }, onClose: () => closed++ };
  Object.assign(props, options.props);
  const components = { canvas: canvasSource.BoardCanvas, dialog: source.LessonBoardDialog, actions: source.LiveLessonActions, meeting: source.MeetingLinkDialog };
  let tree;
  const render = () => tree = renderer.render(components[kind], props);
  const button = (key) => {
    const labels = { "liveLesson.clear": "liveLesson.clearPage", "8": "liveLesson.strokeWidth 8" };
    const label = labels[key] ?? key;
    return oneNode(tree, (node) => ["Button", "button"].includes(node.type) && (treeText(node) === key || node.props["aria-label"] === label), key);
  };
  const canvas = () => oneNode(tree, (node) => node.type === "svg");
  const captures = [];
  const target = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 300, ...options.bounds }), setPointerCapture: (pointer) => captures.push(pointer) };
  const pointer = (x, y, extras = {}) => ({ clientX: x + 10, clientY: y + 20, pointerId: 7, button: 0, currentTarget: target, preventDefault() {}, ...extras });
  const draw = (points) => {
    canvas().props.onPointerDown(pointer(...points[0]));
    for (const point of points.slice(1)) canvas().props.onPointerMove(pointer(...point));
    canvas().props.onPointerUp(pointer(...points.at(-1)));
  };
  render();
  return { reads, writes, confirmations, timers, drafts, strokes, erased, document, props, captures, pointer, button, canvas, draw, render, closed: () => closed, tree: () => tree, unmount: renderer.unmount,
    fire() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

test("web board uses actual SVG bounds and pointer capture to normalize a completed gesture", () => {
  const f = webFixture("canvas");
  f.canvas().props.onPointerDown(f.pointer(125, 150));
  f.render();
  assert.deepEqual(f.captures, [7]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "circle").props.cx, 250);
  f.canvas().props.onPointerMove(f.pointer(250, 150, { pointerId: 99 }));
  assert.equal(f.drafts.at(-1).points.length, 1);
  f.canvas().props.onPointerMove(f.pointer(250, 150));
  f.canvas().props.onPointerUp(f.pointer(700, 900));
  f.render();
  assert.equal(f.strokes.length, 1);
  assert.equal(f.strokes[0].epoch, 0);
  assert.deepEqual(f.strokes[0].stroke.points, [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
  assert.equal(oneNode(f.tree(), (node) => node.type === "path").props.d, "M250,300 L500,300 L1000,600");
  f.unmount();
});

test("web remote page changes, clears and revoked editing cancel an unfinished pen gesture", () => {
  for (const update of [{ epoch: 1 }, { documentId: randomUUID(), page: 1 }, { canEdit: false }]) {
    const f = webFixture("canvas");
    f.canvas().props.onPointerDown(f.pointer(100, 100, { pointerType: "pen", pressure: 0.4 }));
    f.props.board = { ...f.props.board, ...update };
    if (update.canEdit === false) f.props.editable = false;
    f.render();
    f.canvas().props.onPointerMove(f.pointer(200, 200, { pointerType: "pen", pressure: 0.8 }));
    f.canvas().props.onPointerUp(f.pointer(200, 200, { pointerType: "pen", pressure: 0 }));
    assert.equal(f.strokes.length, 0, "unfinished work never appears on a different page or after clearing");
    assert.equal(f.drafts.at(-1), null);
    f.unmount();
  }
});

test("web PDF drawing remains page-scoped when its rendered aspect ratio or zoom changes", () => {
  const documentId = randomUUID();
  for (const bounds of [{ width: 600, height: 840 }, { width: 1200, height: 1680 }]) {
    const f = webFixture("canvas", { initial: board(1, { documentId, page: 2 }), bounds, props: { aspect: bounds.width / bounds.height } });
    f.draw([[bounds.width / 4, bounds.height / 2], [bounds.width / 2, bounds.height / 4]]);
    assert.deepEqual(f.strokes[0].stroke.points, [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }]);
    assert.equal(f.strokes[0].stroke.documentId, documentId);
    assert.equal(f.strokes[0].stroke.page, 2);
    assert.equal(f.canvas().props.preserveAspectRatio, "none");
    assert.equal(f.canvas().props.viewBox, "0 0 1000 1400");
    f.unmount();
  }
});

test("web shape, highlighter, literal note and eraser tools perform their selected operation", () => {
  for (const tool of ["line", "rectangle", "ellipse", "highlighter"]) {
    const f = webFixture("canvas", { props: { tool } });
    f.draw([[100, 100], [150, 150], [250, 250]]);
    assert.equal(f.strokes[0].stroke.tool, tool);
    assert.equal(f.strokes[0].stroke.points.length, tool === "highlighter" ? 3 : 2);
    assert.equal(boardStrokeInputSchema.safeParse(f.strokes[0].stroke).success, true);
    f.render();
    if (tool === "rectangle") assert.equal(oneNode(f.tree(), (node) => node.type === "rect").props.width, 300);
    if (tool === "ellipse") assert.equal(oneNode(f.tree(), (node) => node.type === "ellipse").props.rx, 150);
    if (tool === "highlighter") assert.equal(oneNode(f.tree(), (node) => node.type === "path").props.opacity, 0.3);
    f.unmount();
  }
  const note = webFixture("canvas", { props: { tool: "note", note: "  <b>x = 2</b>  " } });
  note.canvas().props.onPointerDown(note.pointer(100, 100));
  assert.equal(note.strokes[0].stroke.text, "<b>x = 2</b>");
  assert.equal(note.captures.length, 0);
  assert.equal(boardStrokeInputSchema.safeParse(note.strokes[0].stroke).success, true);
  note.props.draft = note.strokes[0].stroke;
  note.render();
  assert.equal(treeText(oneNode(note.tree(), (node) => node.type === "text")), "<b>x = 2</b>");
  note.unmount();
  const owned = { ...stroke({ points: [{ x: 0.2, y: 0.2 }] }), authorId: "student-1" };
  const erase = webFixture("canvas", { initial: board(1, { viewerId: "student-1", canClear: false, strokes: [owned] }), props: { tool: "eraser" } });
  erase.canvas().props.onPointerDown(erase.pointer(100, 60));
  assert.deepEqual(erase.erased, [owned.id]);
  assert.equal(erase.strokes.length, 0);
  erase.unmount();
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
  f.canvas().props.onPointerCancel(f.pointer(0, 0));
  f.canvas().props.onPointerUp(f.pointer(0, 0));
  assert.equal(f.drafts.at(-1), null);
  assert.equal(f.strokes.length, 0);
  f.unmount();
});

test("web active pen ignores another touch's move, release and cancellation", () => {
  const f = webFixture("canvas", { props: { color: boardColors[1], width: 8 } });
  const pen = (x, y, extra = {}) => f.pointer(x, y, { pointerType: "pen", pressure: 0.6, ...extra });
  const palm = (x, y) => f.pointer(x, y, { pointerId: 22, pointerType: "touch", isPrimary: false });
  f.canvas().props.onPointerDown(pen(125, 150));
  f.canvas().props.onPointerDown(palm(400, 250));
  f.canvas().props.onPointerMove(palm(450, 290));
  f.canvas().props.onPointerUp(palm(450, 290));
  f.canvas().props.onPointerCancel(palm(450, 290));
  f.canvas().props.onLostPointerCapture?.(palm(450, 290));
  f.canvas().props.onPointerMove(pen(250, 75, { pressure: 0.9, button: -1 }));
  f.canvas().props.onPointerUp(pen(375, 150, { pressure: 0, buttons: 0 }));
  assert.equal(f.strokes.length, 1, "an unrelated touch cancellation cannot discard the captured pen");
  assert.deepEqual(f.captures, [7]);
  assert.deepEqual(f.strokes[0].stroke.points, [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }]);
  assert.equal(f.strokes[0].stroke.color, boardColors[1]);
  assert.equal(f.strokes[0].stroke.width, 8, "varying hardware pressure retains the selected fixed width");
  assert.equal(boardStrokeInputSchema.safeParse(f.strokes[0].stroke).success, true);
  f.unmount();
});

test("web losing active pen capture cancels its draft and allows a fresh pen gesture", () => {
  const f = webFixture("canvas");
  const pen = (x, y, pointerId = 7) => f.pointer(x, y, { pointerId, pointerType: "pen" });
  f.canvas().props.onPointerDown(pen(100, 100));
  f.canvas().props.onPointerMove(pen(200, 150));
  f.canvas().props.onLostPointerCapture?.(pen(200, 150));
  assert.equal(f.drafts.at(-1), null, "capture loss must discard unfinished work without waiting for a release");
  f.canvas().props.onPointerUp(pen(300, 200));
  assert.equal(f.strokes.length, 0);
  f.canvas().props.onPointerDown(pen(125, 150, 8));
  f.canvas().props.onPointerUp(pen(250, 75, 8));
  f.canvas().props.onLostPointerCapture?.(pen(250, 75, 8));
  assert.equal(f.strokes.length, 1);
  assert.equal(f.drafts.at(-1).id, f.strokes[0].stroke.id, "normal capture loss after release retains the submitted draft until saving completes");
  assert.deepEqual(f.strokes[0].stroke.points, [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }]);
  f.unmount();
});

test("web pen barrel and eraser buttons never create ink, while the selected eraser respects ownership and page scope", () => {
  const documentId = randomUUID();
  const owned = { ...stroke({ documentId, page: 2, points: [{ x: 0.25, y: 0.5 }] }), authorId: "student-1" };
  const foreign = { ...owned, id: randomUUID(), authorId: "teacher-1" };
  const otherPage = { ...owned, id: randomUUID(), page: 1 };
  const f = webFixture("canvas", { initial: board(1, { viewerId: "student-1", canClear: false, documentId, page: 2, strokes: [owned, foreign, otherPage] }) });
  for (const button of [2, 5]) {
    f.canvas().props.onPointerDown(f.pointer(125, 150, { pointerType: "pen", button, buttons: button === 5 ? 32 : 2 }));
    f.canvas().props.onPointerUp(f.pointer(125, 150, { pointerType: "pen", button, buttons: 0 }));
  }
  assert.equal(f.strokes.length, 0);
  assert.equal(f.drafts.length, 0);
  f.props.tool = "eraser";
  f.render();
  f.canvas().props.onPointerDown(f.pointer(125, 150, { pointerType: "pen", button: 0 }));
  assert.deepEqual(f.erased, [owned.id]);
  assert.equal(f.strokes.length, 0);
  f.props.editable = false;
  f.render();
  f.canvas().props.onPointerDown(f.pointer(125, 150, { pointerType: "pen", button: 0 }));
  assert.deepEqual(f.erased, [owned.id]);
  f.unmount();
});

test("web pen shapes and literal notes retain portrait PDF geometry at both page zooms", () => {
  const documentId = randomUUID();
  for (const bounds of [{ width: 600, height: 840 }, { width: 1200, height: 1680 }]) {
    for (const tool of ["rectangle", "ellipse", "note"]) {
      const f = webFixture("canvas", { initial: board(1, { documentId, page: 2 }), bounds, props: { aspect: bounds.width / bounds.height, tool, note: "<script>literal</script>" } });
      const pen = (x, y) => f.pointer(x, y, { pointerType: "pen" });
      f.canvas().props.onPointerDown(pen(bounds.width / 4, bounds.height / 2));
      f.canvas().props.onPointerMove(pen(bounds.width / 2, bounds.height / 4));
      f.canvas().props.onPointerUp(pen(bounds.width / 2, bounds.height / 4));
      const saved = f.strokes[0].stroke;
      assert.equal(saved.documentId, documentId);
      assert.equal(saved.page, 2);
      assert.deepEqual(saved.points, tool === "note" ? [{ x: 0.25, y: 0.5 }] : [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.25 }]);
      assert.equal(boardStrokeInputSchema.safeParse(saved).success, true);
      f.props.draft = saved;
      f.render();
      assert.equal(f.canvas().props.viewBox, "0 0 1000 1400");
      if (tool === "rectangle") assert.equal(oneNode(f.tree(), (node) => node.type === "rect").props.height, 350);
      if (tool === "ellipse") assert.equal(oneNode(f.tree(), (node) => node.type === "ellipse").props.ry, 175);
      if (tool === "note") assert.equal(treeText(oneNode(f.tree(), (node) => node.type === "text")), "<script>literal</script>");
      f.unmount();
    }
  }
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
  oneNode(f.tree(), (node) => ["Button", "button"].includes(node.type) && node.props["aria-label"] === "liveLesson.red").props.onClick();
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
  assert.deepEqual(f.writes[1].command, { action: "stroke.remove", epoch: 0, id: f.writes[0].command.stroke.id, documentId: null, page: 0 });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 0);
  f.draw([[250, 150]]);
  await settle();
  f.render();
  f.button("liveLesson.clear").props.onClick();
  await settle();
  f.render();
  assert.equal(f.confirmations[0], "liveLesson.clearPageWarning");
  assert.deepEqual(f.writes[3].command, { action: "page.clear", epoch: 0, documentId: null, page: 0 });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "circle").length, 0);
  f.unmount();
  assert.equal(f.timers.size, 0);
});

test("web redo restores only a successful removal and clears are scoped to the active page", async () => {
  const f = webFixture("dialog");
  await settle(); f.render();
  f.button("liveLesson.rectangle").props.onClick();
  f.render(); f.draw([[100, 100], [250, 200]]);
  await settle(); f.render();
  assert.equal(f.writes[0].command.stroke.tool, "rectangle");
  f.button("liveLesson.undo").props.onClick();
  await settle(); f.render();
  assert.equal(f.button("liveLesson.redo").props.disabled, false);
  f.button("liveLesson.redo").props.onClick();
  await settle(); f.render();
  assert.deepEqual(f.writes[2].command, { action: "stroke.restore", epoch: 0, id: f.writes[0].command.stroke.id, documentId: null, page: 0 });
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "rect").length, 1);
  assert.equal(f.button("liveLesson.redo").props.disabled, true);
  f.button("liveLesson.clear").props.onClick();
  await settle(); f.render();
  assert.equal(f.writes[3].command.action, "page.clear");
  assert.equal(f.button("liveLesson.redo").props.disabled, true);
  f.unmount();
});

test("web remote clears and zoom changes remove unfinished drafts before another gesture can save them", async () => {
  const cleared = webFixture("dialog", { load: (index, current) => Promise.resolve({ data: index === 1 ? current : board(2, { epoch: 1 }) }) });
  await settle(); cleared.render();
  cleared.canvas().props.onPointerDown(cleared.pointer(100, 100, { pointerType: "pen" }));
  cleared.canvas().props.onPointerMove(cleared.pointer(200, 200, { pointerType: "pen" }));
  cleared.render();
  assert.equal(treeNodes(cleared.tree()).filter((node) => node.type === "path").length, 1);
  cleared.fire(); await settle(); cleared.render();
  assert.equal(treeNodes(cleared.tree()).filter((node) => node.type === "path").length, 0);
  cleared.canvas().props.onPointerUp(cleared.pointer(300, 200, { pointerType: "pen" }));
  assert.equal(cleared.writes.length, 0);
  cleared.unmount();
  const resized = webFixture("dialog");
  await settle(); resized.render();
  resized.canvas().props.onPointerDown(resized.pointer(100, 100, { pointerType: "pen" }));
  resized.render();
  assert.equal(treeNodes(resized.tree()).filter((node) => node.type === "circle").length, 1);
  resized.button("liveLesson.zoomIn").props.onClick();
  resized.render();
  assert.equal(treeNodes(resized.tree()).filter((node) => node.type === "circle").length, 0);
  resized.canvas().props.onPointerUp(resized.pointer(300, 200, { pointerType: "pen" }));
  assert.equal(resized.writes.length, 0);
  resized.unmount();
});

test("web revoked editing hides an active pen draft immediately and never saves its late release", async () => {
  const f = webFixture("dialog", { load: (index, current) => Promise.resolve({ data: { ...current, revision: index, canEdit: index !== 2, canClear: index !== 2 } }) });
  await settle(); f.render();
  f.canvas().props.onPointerDown(f.pointer(100, 100, { pointerType: "pen" }));
  f.canvas().props.onPointerMove(f.pointer(200, 200, { pointerType: "pen" }));
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 1);
  f.fire(); await settle(); f.render();
  assert.equal(f.canvas().props.style.cursor, "default");
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 0, "permission revocation hides the stale draft before another pointer event");
  f.fire(); await settle(); f.render();
  assert.equal(f.canvas().props.style.cursor, "crosshair");
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "path").length, 0, "restoring editing cannot revive the revoked draft");
  f.canvas().props.onPointerUp(f.pointer(300, 200, { pointerType: "pen" }));
  assert.equal(f.writes.length, 0);
  f.unmount();
});

test("web PDF loading and render errors block drawing, and rendered pages share teacher navigation", async () => {
  const documentId = randomUUID();
  const initial = board(1, { documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }], documentId, page: 1 });
  const pages = [null, { getViewport: () => ({ width: 600, height: 840 }) }, { getViewport: () => ({ width: 840, height: 600 }) }];
  const f = webFixture("dialog", { initial, pdf: { pdf: {} }, pdfPage: (page) => ({ page: pages[page] }) });
  await settle(); f.render();
  assert.equal(f.canvas().props.style.cursor, "default");
  assert.ok(treeText(f.tree()).includes("liveLesson.pdfLoading"));
  oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.onReady(pages[1]);
  f.render();
  assert.equal(f.canvas().props.style.cursor, "crosshair");
  f.draw([[100, 100]]);
  await settle(); f.render();
  assert.equal(f.writes[0].command.stroke.documentId, documentId);
  assert.equal(f.writes[0].command.stroke.page, 1);
  f.button("liveLesson.nextPage").props.onClick();
  await settle(); f.render();
  assert.deepEqual(f.writes[1].command, { action: "document.select", epoch: 0, documentId, page: 2 });
  assert.equal(f.canvas().props.style.cursor, "default");
  oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.onError();
  f.render();
  assert.ok(treeText(f.tree()).includes("liveLesson.pdfError"));
  assert.equal(f.canvas().props.style.cursor, "default");
  f.unmount();
  const pupil = webFixture("dialog", { initial: { ...initial, canClear: false } });
  await settle(); pupil.render();
  assert.equal(pupil.button("liveLesson.nextPage").props.disabled, false);
  assert.equal(treeNodes(pupil.tree()).filter((node) => node.type === "button" && treeText(node).includes("liveLesson.uploadPdf")).length, 0);
  pupil.unmount();
});

test("web guardians and completed teachers browse PDF pages locally without board mutations", async () => {
  const documentId = randomUUID();
  const pages = [null, { getViewport: () => ({ width: 600, height: 840 }) }, { getViewport: () => ({ width: 840, height: 600 }) }];
  for (const viewerId of ["guardian-1", "teacher-1"]) {
    const initial = board(1, { viewerId, canEdit: false, canClear: false, documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }], documentId, page: 1 });
    const f = webFixture("dialog", { initial, pdf: { pdf: {} }, pdfPage: (page) => ({ page: pages[page] }) });
    await settle(); f.render();
    assert.equal(f.button("liveLesson.nextPage").props.disabled, false);
    f.button("liveLesson.nextPage").props.onClick();
    f.render();
    assert.equal(oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.page, pages[2]);
    oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.onReady(pages[2]);
    f.render();
    assert.equal(f.canvas().props.style.cursor, "default");
    assert.equal(f.button("liveLesson.pen").props.disabled, true);
    assert.equal(f.button("liveLesson.previousPage").props.disabled, false);
    assert.equal(f.button("liveLesson.followTeacher").props["aria-pressed"], false);
    f.button("liveLesson.followTeacher").props.onClick();
    f.render();
    assert.equal(oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.page, pages[1]);
    assert.equal(f.button("liveLesson.followTeacher").props["aria-pressed"], true);
    assert.equal(f.canvas().props.style.cursor, "default");
    assert.equal(f.writes.length, 0, `${viewerId} navigation must stay local`);
    f.unmount();
  }
});

test("web students browse another document read-only and follow teacher restores shared drawing", async () => {
  const documentId = randomUUID();
  const pages = [null, { getViewport: () => ({ width: 600, height: 840 }) }, { getViewport: () => ({ width: 840, height: 600 }) }];
  const initial = board(1, { viewerId: "student-1", canClear: false, documents: [{ id: documentId, name: "Denklemler.pdf", pageCount: 2 }] });
  const f = webFixture("dialog", { initial, pdf: { pdf: {} }, pdfPage: (page) => ({ page: pages[page] }) });
  await settle(); f.render();
  assert.equal(f.canvas().props.style.cursor, "crosshair");
  const document = oneNode(f.tree(), (node) => node.type === "button" && node.props.title === "Denklemler.pdf");
  assert.equal(document.props.disabled, false);
  document.props.onClick();
  f.render();
  oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.onReady(pages[1]);
  f.render();
  assert.equal(f.canvas().props.style.cursor, "default");
  assert.equal(f.button("liveLesson.pen").props.disabled, true);
  f.draw([[100, 100], [200, 200]]);
  f.button("liveLesson.nextPage").props.onClick();
  f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "BoardPdfCanvas").props.page, pages[2]);
  assert.equal(f.writes.length, 0);
  f.button("liveLesson.followTeacher").props.onClick();
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "BoardPdfCanvas").length, 0);
  assert.equal(f.canvas().props.style.cursor, "crosshair");
  assert.equal(f.button("liveLesson.pen").props.disabled, false);
  f.draw([[100, 100]]);
  await settle(); f.render();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].command.action, "stroke.add");
  assert.equal(f.writes[0].command.stroke.documentId, null);
  assert.equal(f.writes[0].command.stroke.page, 0);
  f.unmount();
});

test("web failed stroke remains visible, blocks edits, retries the same key and can be discarded", async () => {
  let attempts = 0;
  const f = webFixture("dialog", { change: async (command, _index, current) => {
    if (++attempts === 1) throw new Error("Save failed");
    return { data: { ...current, revision: current.revision + 1, strokes: [{ ...command.stroke, authorId: current.viewerId }] } };
  } });
  await settle();
  f.render();
  f.canvas().props.onPointerDown(f.pointer(100, 100, { pointerType: "pen" }));
  f.canvas().props.onPointerUp(f.pointer(200, 200, { pointerType: "pen" }));
  f.canvas().props.onLostPointerCapture(f.pointer(200, 200, { pointerType: "pen" }));
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

test("web rapid pen gestures keep the first pending stroke visible and retry its original geometry", async () => {
  const reply = deferred();
  const f = webFixture("dialog", { change: (command, index, current) => index === 1 ? reply.promise : Promise.resolve({ data: { ...current, revision: 2, strokes: [{ ...command.stroke, authorId: current.viewerId }] } }) });
  await settle(); f.render();
  const pen = (x, y) => f.pointer(x, y, { pointerType: "pen" });
  f.canvas().props.onPointerDown(pen(100, 60));
  f.canvas().props.onPointerUp(pen(200, 120));
  f.canvas().props.onPointerDown(pen(400, 240));
  f.canvas().props.onPointerUp(pen(450, 270));
  assert.equal(f.writes.length, 1, "the synchronous save lock rejects a second submission");
  reply.reject(new Error("First pen stroke failed"));
  await settle(); f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "path").props.d, "M200,120 L400,240", "the retry preview must show the first command, even before controls rerendered");
  f.button("liveLesson.retry").props.onClick();
  await settle(); f.render();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].key, f.writes[0].key);
  assert.deepEqual(f.writes[1].command, f.writes[0].command);
  assert.equal(oneNode(f.tree(), (node) => node.type === "path").props.d, "M200,120 L400,240");
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
  assert.deepEqual(f.writes[1].command, { action: "page.clear", epoch: 0, documentId: null, page: 0 });
  assert.equal(f.writes[1].key, f.writes[0].key);
  f.unmount();
});

// Native gesture regressions exercise synthetic touch payloads; no tablet or
// pen hardware is represented by this fixture.
test("native force-bearing touch samples retain normalized coordinates and the selected fixed width", async () => {
  const f = nativeBoardFixture();
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  oneNode(f.tree(), (node) => node.type === "Pressable" && node.props.accessibilityLabel === "liveLesson.pen 8").props.onPress();
  f.render();
  const touch = (x, y, force) => ({ nativeEvent: {
    locationX: x, locationY: y, identifier: 17, force,
    touches: [{ identifier: 17, locationX: x, locationY: y, force }],
    changedTouches: [{ identifier: 17, locationX: x, locationY: y, force }],
  } });
  f.canvas().props.onPanResponderGrant(touch(100, 60, 0.1));
  f.canvas().props.onPanResponderMove(touch(250, 180, 0.95));
  f.canvas().props.onPanResponderRelease(touch(250, 180, 0));
  await settle(); f.render();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][3].stroke.width, 8, "force does not implement pressure-sensitive width");
  assert.deepEqual(plain(f.writes[0][3].stroke.points), [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 }]);
  assert.equal(boardStrokeInputSchema.safeParse(f.writes[0][3].stroke).success, true);
  f.unmount();
});

test("native release includes the final touch position when no final move event arrives", async () => {
  const f = nativeBoardFixture();
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.canvas().props.onPanResponderGrant(f.pointer(100, 60));
  f.canvas().props.onPanResponderRelease(f.pointer(300, 240));
  await settle(); f.render();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(plain(f.writes[0][3].stroke.points), [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.8 }]);
  f.unmount();
  const failed = nativeBoardFixture({ change: () => Promise.reject(new Error("Save failed")) });
  await settle(); failed.render();
  failed.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  failed.canvas().props.onPanResponderGrant(failed.pointer(100, 60));
  failed.canvas().props.onPanResponderRelease(failed.pointer(300, 240));
  await settle(); failed.render();
  assert.equal(oneNode(failed.tree(), (node) => node.type === "Path").props.d, "M200,120 L600,480", "failed saves retain the final release point in the visible retry draft");
  failed.unmount();
});

test("native revoked drawing permission immediately removes an unfinished local draft", async () => {
  const f = nativeBoardFixture({ load: (index, current) => Promise.resolve({ data: index === 1 ? current : { ...current, revision: current.revision + 1, canEdit: false, canClear: false } }) });
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.canvas().props.onPanResponderGrant(f.pointer(100, 60));
  f.render();
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Circle").length, 1);
  f.fire(); await settle(); f.render();
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  assert.equal(treeNodes(f.tree()).filter((node) => node.type === "Circle").length, 0);
  f.canvas().props.onPanResponderRelease(f.pointer(300, 240));
  await settle(); f.render();
  assert.equal(f.writes.length, 0);
  f.unmount();
});

test("native rapid gestures cannot replace the visible draft of an earlier pending save", async () => {
  const reply = deferred();
  const f = nativeBoardFixture({ change: () => reply.promise });
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.draw([[50, 30], [100, 60]]);
  f.draw([[400, 240], [450, 270]]);
  assert.equal(f.writes.length, 1);
  reply.reject(new Error("First save failed"));
  await settle(); f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "Path").props.d, "M100,60 L200,120");
  assert.equal(oneNode(f.tree(), (node) => node.type === "ErrorText").props.message, "First save failed");
  f.unmount();
});

test("native permission revocation preserves an already failed retry draft while blocking retry", async () => {
  const f = nativeBoardFixture({
    load: (index, current) => Promise.resolve({ data: index === 1 ? current : { ...current, revision: current.revision + 1, canEdit: false, canClear: false } }),
    change: () => Promise.reject(new Error("Save failed")),
  });
  await settle(); f.render();
  f.canvas().props.onLayout({ nativeEvent: { layout: { width: 500, height: 300 } } });
  f.draw([[100, 60], [300, 240]]);
  await settle(); f.render();
  f.fire(); await settle(); f.render();
  assert.equal(oneNode(f.tree(), (node) => node.type === "Path").props.d, "M200,120 L600,480");
  assert.equal(f.button("liveLesson.retry").props.disabled, true);
  assert.equal(f.canvas().props.onStartShouldSetPanResponder(), false);
  assert.equal(f.writes.length, 1);
  f.unmount();
});

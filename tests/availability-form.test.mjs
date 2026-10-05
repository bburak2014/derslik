import assert from "node:assert/strict";
import test from "node:test";
import * as booking from "../packages/contracts/src/booking.ts";
import * as bookingForm from "../packages/contracts/src/booking-form.ts";
import * as i18n from "../packages/contracts/src/i18n/index.ts";
import { dateKey } from "../packages/contracts/src/types.ts";
import { loadTestModule } from "../scripts/test-source-loader.mjs";

const contracts = { ...booking, ...bookingForm, ...i18n, dateKey };
const { ApiError } = loadTestModule("packages/api-client/src/index.ts", {
  dependencies: {
    "../../contracts/src/i18n/index.ts": i18n,
    "./uploads.ts": {},
    "./socket.ts": {},
    "./lesson-board.ts": {},
    "./board-tools.ts": {},
  },
});

// These adapter tests execute the real TSX render functions and event handlers.
// Native views/DOM widgets are descriptors, so layout and device behavior remain
// the responsibility of browser/device checks. Hook slots retain component
// state and callback dependencies across explicit test renders.
function hookRenderer() {
  const frames = new Map();
  let current;
  let effects = [];
  const sameDeps = (previous, next) =>
    previous?.length === next?.length &&
    previous.every((value, index) => Object.is(value, next[index]));
  const slot = () => {
    const index = current.cursor++;
    if (!current.hooks[index]) current.hooks[index] = {};
    return current.hooks[index];
  };
  const react = {
    useState(initial) {
      const cell = slot();
      if (!Object.hasOwn(cell, "value"))
        cell.value = typeof initial === "function" ? initial() : initial;
      return [
        cell.value,
        (next) => {
          cell.value = typeof next === "function" ? next(cell.value) : next;
        },
      ];
    },
    useReducer(reducer, initial, initialize) {
      const cell = slot();
      if (!Object.hasOwn(cell, "value"))
        cell.value = initialize ? initialize(initial) : initial;
      cell.dispatch ??= (action) => {
        cell.value = reducer(cell.value, action);
      };
      return [cell.value, cell.dispatch];
    },
    useCallback(callback, deps) {
      const cell = slot();
      if (!sameDeps(cell.deps, deps)) {
        cell.callback = callback;
        cell.deps = deps;
      }
      return cell.callback;
    },
    useEffect(callback, deps) {
      const cell = slot();
      if (!sameDeps(cell.deps, deps)) {
        cell.deps = deps;
        effects.push(() => {
          cell.cleanup?.();
          cell.cleanup = callback();
        });
      }
    },
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const jsx = { jsx: element, jsxs: element, Fragment: "Fragment" };

  function expand(node, path) {
    if (Array.isArray(node))
      return node.map((child, index) =>
        expand(child, `${path}/${child?.key ?? index}`),
      );
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function")
      return renderComponent(
        node.type,
        node.props,
        `${path}/${node.type.name}`,
      );
    return {
      ...node,
      path,
      props: {
        ...node.props,
        children: expand(node.props.children, `${path}/children`),
        action: expand(node.props.action, `${path}/action`),
      },
    };
  }
  function renderComponent(component, props, path) {
    const previous = current;
    const frame = frames.get(path) ?? { hooks: [], cursor: 0 };
    frames.set(path, frame);
    frame.cursor = 0;
    current = frame;
    const tree = component(props);
    current = previous;
    return expand(tree, `${path}/output`);
  }
  return {
    react,
    jsx,
    render(component, props) {
      const tree = renderComponent(component, props, "root");
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
      return tree;
    },
    unmount() {
      for (const frame of frames.values())
        for (const cell of frame.hooks) cell.cleanup?.();
      frames.clear();
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props.children), ...nodes(tree.props.action)];
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (!tree || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return text(tree.props.children);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
const initialSettings = () => ({
  enabled: true,
  durationMinutes: 60,
  noticeHours: 12,
  cancelHours: 24,
  location: "Çevrim içi",
  windows: [{ weekday: 1, start: "15:00", end: "19:00" }],
  blocks: [
    { from: "2026-10-14", to: "2026-10-16" },
    { from: "2026-10-20", to: "2026-10-22" },
  ],
  version: 7,
});

function fixture(platform, options = {}) {
  const renderer = hookRenderer();
  const calls = { reads: [], writes: [], saved: [], closed: 0, toast: [] };
  let read = options.read ?? (async () => ({ data: initialSettings() }));
  let write =
    options.write ??
    (async (payload) => ({ data: { ...payload, version: 8 } }));
  const readBooking = async (workspace) => {
    calls.reads.push(workspace);
    return read();
  };
  const writeBooking = async (payload) => {
    calls.writes.push(plain(payload));
    return write(payload);
  };
  const dependencies = {
    react: renderer.react,
    "react/jsx-runtime": renderer.jsx,
    "@derslik/contracts": contracts,
    "@derslik/api-client": { ApiError },
  };
  let viewModule;
  if (platform === "web") {
    Object.assign(dependencies, {
      sonner: { toast: { success: (message) => calls.toast.push(message) } },
      "lucide-react": { CalendarClock: "CalendarClock", Plus: "Plus", X: "X" },
      "@/lib/client": {
        backend: (path) => {
          assert.equal(path, "/workspaces/workspace-1/booking");
          return readBooking("workspace-1");
        },
        webRequest: (path, payload, method) => {
          assert.equal(path, "/api/backend/workspaces/workspace-1/booking");
          assert.equal(method, "PUT");
          return writeBooking(payload);
        },
      },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": Object.fromEntries(
        [
          "Dialog",
          "DialogContent",
          "DialogDescription",
          "DialogFooter",
          "DialogHeader",
          "DialogTitle",
        ].map((name) => [name, name]),
      ),
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/label": { Label: "Label" },
      "@/components/ui/select": Object.fromEntries(
        [
          "Select",
          "SelectContent",
          "SelectItem",
          "SelectTrigger",
          "SelectValue",
        ].map((name) => [name, name]),
      ),
      "@/components/ui/switch": { Switch: "Switch" },
      "./loading": { PageLoader: "PageLoader" },
      "./feedback": { FormError: "FormError" },
    });
    viewModule = loadTestModule(
      "apps/web/components/derslik/availability-dialog.tsx",
      {
        dependencies,
        suffix: "exports.AvailabilityDialog = AvailabilityDialog;",
      },
    );
  } else {
    Object.assign(dependencies, {
      "react-native": {
        KeyboardAvoidingView: "KeyboardAvoidingView",
        Modal: "Modal",
        Platform: { OS: options.os ?? "ios" },
        ScrollView: "ScrollView",
        Text: "Text",
        View: "View",
      },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "../core": {
        client: {
          booking: readBooking,
          saveBooking: (workspace, payload) => {
            assert.equal(workspace, "workspace-1");
            return writeBooking(payload);
          },
        },
      },
      "../ui": {
        ...Object.fromEntries(
          [
            "Button",
            "Card",
            "CloseButton",
            "ErrorText",
            "Field",
            "IconButton",
            "Input",
            "Loading",
            "Picker",
            "SectionHeading",
            "Toggle",
          ].map((name) => [name, name]),
        ),
        useTheme: () => ({
          colors: { surface: "white" },
          styles: {},
          section: {},
        }),
      },
    });
    viewModule = loadTestModule("apps/mobile/src/teacher/availability.tsx", {
      dependencies,
      suffix: "exports.AvailabilityBody = AvailabilityBody;",
    });
  }
  const props = {
    workspaceId: "workspace-1",
    onClose: () => calls.closed++,
    onSaved: (saved) => calls.saved.push(plain(saved)),
  };
  let tree;
  let component =
    platform === "web"
      ? viewModule.AvailabilityDialog
      : viewModule.AvailabilityBody;
  const render = () => (tree = renderer.render(component, props));
  const matching = (predicate) => nodes(tree).filter(predicate);
  const one = (predicate, description) => {
    const matches = matching(predicate);
    assert.equal(matches.length, 1, description);
    return matches[0];
  };
  const buttons = (key) =>
    matching(
      (node) =>
        (node.type === "Button" || node.type === "IconButton") &&
        (text(node).trim() === i18n.t(key) ||
          node.props["aria-label"] === i18n.t(key) ||
          node.props.label === i18n.t(key)),
    );
  const press = (node) =>
    platform === "web" ? node.props.onClick() : node.props.onPress();
  const input = (key, index = 0) =>
    matching(
      (node) =>
        node.type === "Input" &&
        (node.props["aria-label"] === i18n.t(key) ||
          node.props.accessibilityLabel === i18n.t(key) ||
          (key === "booking.location" && node.props.id === "booking-location")),
    )[index];
  const changeInput = (node, value) =>
    platform === "web"
      ? node.props.onChange({ target: { value } })
      : node.props.onChangeText(value);
  const picker = (key, index = 0) =>
    matching(
      (node) =>
        (node.type === "Picker" && node.props.label === i18n.t(key)) ||
        (node.type === "Select" &&
          nodes(node).some(
            (child) =>
              child.type === "SelectTrigger" &&
              (child.props["aria-label"] === i18n.t(key) ||
                child.props.id ===
                  (key === "booking.cancelWindow"
                    ? "booking-cancel"
                    : `booking-${key.split(".")[1]}`)),
          )),
    )[index];
  const changePicker = (node, value) =>
    platform === "web"
      ? node.props.onValueChange(value)
      : node.props.onChange(value);
  const save = () =>
    platform === "web"
      ? one((node) => node.type === "form", "loaded form").props.onSubmit({
          preventDefault() {},
        })
      : press(buttons("common.save")[0]);
  render();
  return {
    calls,
    viewModule,
    props,
    render,
    matching,
    one,
    buttons,
    press,
    input,
    changeInput,
    picker,
    changePicker,
    save,
    tree: () => tree,
    setRead: (next) => {
      read = next;
    },
    setWrite: (next) => {
      write = next;
    },
    useComponent: (next) => {
      component = next;
      renderer.unmount();
      render();
    },
    unmount: renderer.unmount,
  };
}

for (const platform of ["web", "mobile"]) {
  test(`${platform}: loading, row edits, deletion and saved API payload preserve values`, async () => {
    const f = fixture(platform);
    assert.equal(f.calls.reads.length, 1);
    assert.equal(
      f.matching(
        (node) => node.type === "PageLoader" || node.type === "Loading",
      ).length,
      1,
    );
    await settle();
    f.render();

    f.changeInput(f.input("booking.to", 1), "2026-10-24");
    f.render();
    const remainingPath = f.input("booking.to", 1).path;
    f.press(f.buttons("booking.removeClosedDays")[0]);
    f.render();
    assert.equal(f.input("booking.from").props.value, "2026-10-20");
    assert.equal(f.input("booking.to").props.value, "2026-10-24");
    assert.equal(f.input("booking.to").path, remainingPath);

    f.press(f.buttons("booking.addRange")[1]);
    f.render();
    const monday = booking.weekdayName(1);
    const start = f.matching((node) =>
      node.type === "Picker"
        ? node.props.label === i18n.t("booking.rangeStart", { day: monday })
        : node.type === "Select" &&
          nodes(node).some(
            (child) =>
              child.props["aria-label"] ===
              i18n.t("booking.rangeStart", { day: monday }),
          ),
    )[0];
    f.changePicker(start, "15:30");
    f.changeInput(f.input("booking.location"), "Stüdyo");
    f.render();
    await f.save();
    await settle();

    assert.equal(f.calls.writes.length, 1);
    const sent = f.calls.writes[0];
    assert.equal(booking.bookingSettingsSchema.safeParse(sent).success, true);
    assert.deepEqual(sent.blocks, [{ from: "2026-10-20", to: "2026-10-24" }]);
    assert.equal(sent.windows[0].start, "15:30");
    assert.equal(sent.windows[1].weekday, 2);
    assert.equal(sent.location, "Stüdyo");
    assert.equal(sent.version, 7);
    assert.equal(f.calls.saved[0].version, 8);
    assert.equal(f.calls.closed, 1);
    if (platform === "web")
      assert.deepEqual(f.calls.toast, [i18n.t("booking.saved")]);
  });

  test(`${platform}: invalid dates block network save and editing clears the row error`, async () => {
    const f = fixture(platform);
    await settle();
    f.render();
    f.changeInput(f.input("booking.to"), "2026-10-01");
    f.render();
    await f.save();
    await settle();
    f.render();
    assert.equal(f.calls.writes.length, 0);
    assert.ok(text(f.tree()).includes(i18n.t("api.blockOrder")));
    f.changeInput(f.input("booking.to"), "2026-10-16");
    f.render();
    assert.equal(text(f.tree()).includes(i18n.t("api.blockOrder")), false);
    await f.save();
    await settle();
    assert.equal(f.calls.writes.length, 1);
  });

  test(`${platform}: 409 offers reload, fresh settings clear stale error and version`, async () => {
    const f = fixture(platform, {
      write: async () => {
        throw new ApiError(409, "Başka yerde kaydedildi");
      },
    });
    await settle();
    f.render();
    await f.save();
    await settle();
    f.render();
    assert.equal(f.calls.closed, 0);
    assert.equal(f.buttons("booking.reload").length, 1);
    f.changeInput(f.input("booking.location"), "Kaydedilmemiş yer");
    f.render();
    assert.equal(f.buttons("booking.reload").length, 1);
    f.setRead(async () => ({
      data: { ...initialSettings(), version: 9, location: "Sunucudaki yer" },
    }));
    f.press(f.buttons("booking.reload")[0]);
    await settle();
    f.render();
    assert.equal(f.input("booking.location").props.value, "Sunucudaki yer");
    assert.equal(f.buttons("booking.reload").length, 0);
    f.setWrite(async (payload) => ({ data: payload }));
    await f.save();
    await settle();
    assert.equal(f.calls.writes[1].version, 9);
  });

  test(`${platform}: read failure exposes retry and successful retry opens the form`, async () => {
    const f = fixture(platform, {
      read: async () => {
        throw new Error("Sunucu kapalı");
      },
    });
    await settle();
    f.render();
    assert.equal(f.buttons("common.retry").length, 1);
    assert.equal(f.calls.writes.length, 0);
    f.setRead(async () => ({ data: initialSettings() }));
    f.press(f.buttons("common.retry")[0]);
    await settle();
    f.render();
    assert.equal(f.buttons("common.retry").length, 0);
    assert.equal(f.input("booking.location").props.value, "Çevrim içi");
    assert.equal(f.calls.reads.length, 2);
  });

  test(`${platform}: pending save disables cancel/close and prevents a second request`, async () => {
    let finish;
    const response = new Promise((resolve) => {
      finish = resolve;
    });
    const f = fixture(platform, { write: () => response });
    await settle();
    f.render();
    const pending = f.save();
    f.render();
    assert.equal(f.buttons("common.cancel")[0].props.disabled, true);
    const saving = f.buttons("common.saving")[0];
    if (platform === "web") {
      assert.equal(saving.props.disabled, true);
      f.one((node) => node.type === "Dialog", "dialog").props.onOpenChange(
        false,
      );
      await f
        .one((node) => node.type === "form", "form")
        .props.onSubmit({ preventDefault() {} });
    } else {
      assert.equal(saving.props.loading, true);
      assert.equal(
        f.one((node) => node.type === "CloseButton", "close button").props
          .disabled,
        true,
      );
      f.press(saving);
    }
    assert.equal(f.calls.closed, 0);
    assert.equal(f.calls.writes.length, 1);
    finish({ data: { ...f.calls.writes[0], version: 8 } });
    await pending;
    await settle();
    f.render();
    assert.equal(f.buttons("common.cancel")[0].props.disabled, false);
    assert.equal(f.calls.closed, 1);
  });

  test(`${platform}: all policy controls and newly added rows survive save`, async () => {
    const f = fixture(platform, {
      read: async () => ({
        data: {
          ...initialSettings(),
          blocks: [],
          windows: [{ weekday: 1, start: "00:00", end: "24:00" }],
        },
      }),
    });
    await settle();
    f.render();
    assert.equal(f.buttons("booking.addRange")[0].props.disabled, true);
    const toggle = f.one(
      (node) => node.type === "Switch" || node.type === "Toggle",
      "enabled control",
    );
    if (platform === "web") toggle.props.onCheckedChange(false);
    else toggle.props.onChange(false);
    f.changePicker(f.picker("booking.duration"), "75");
    f.changePicker(f.picker("booking.notice"), "0");
    f.changePicker(f.picker("booking.cancelWindow"), "0");
    f.press(f.buttons("booking.addClosedDays")[0]);
    f.press(f.buttons("booking.addClosedDays")[0]);
    f.render();
    f.changeInput(f.input("booking.from", 0), "2026-10-28");
    f.changeInput(f.input("booking.to", 0), "2026-10-30");
    f.render();
    f.press(f.buttons("booking.removeClosedDays")[1]);
    f.press(f.buttons("booking.addRange")[1]);
    f.render();
    f.press(f.buttons("booking.removeRange")[0]);
    f.render();
    const tuesday = booking.weekdayName(2);
    const end = f.matching((node) =>
      node.type === "Picker"
        ? node.props.label === i18n.t("booking.rangeEnd", { day: tuesday })
        : node.type === "Select" &&
          nodes(node).some(
            (child) =>
              child.props["aria-label"] ===
              i18n.t("booking.rangeEnd", { day: tuesday }),
          ),
    )[0];
    f.changePicker(end, "18:00");
    f.render();
    await f.save();
    await settle();
    assert.equal(f.calls.writes.length, 1);
    const sent = f.calls.writes[0];
    assert.equal(sent.enabled, false);
    assert.equal(sent.durationMinutes, 75);
    assert.equal(sent.noticeHours, 0);
    assert.equal(sent.cancelHours, 0);
    assert.deepEqual(sent.blocks, [{ from: "2026-10-28", to: "2026-10-30" }]);
    assert.deepEqual(sent.windows, [
      { weekday: 2, start: "15:00", end: "18:00" },
    ]);
  });

  test(`${platform}: general validation and non-conflict save failure keep edits available`, async () => {
    const f = fixture(platform, {
      write: async () => {
        throw new Error("Bağlantı kesildi");
      },
    });
    await settle();
    f.render();
    f.changeInput(f.input("booking.location"), "x".repeat(101));
    f.render();
    await f.save();
    await settle();
    f.render();
    assert.equal(f.calls.writes.length, 0);
    const errors =
      platform === "web"
        ? text(f.tree())
        : f
            .matching((node) => node.type === "Field")
            .map((node) => node.props.error)
            .join("");
    assert.ok(errors.includes(i18n.t("api.invalidFields")));
    f.changeInput(f.input("booking.location"), "Geçerli yer");
    f.render();
    await f.save();
    await settle();
    f.render();
    assert.equal(f.calls.writes.length, 1);
    assert.equal(f.calls.closed, 0);
    assert.equal(f.input("booking.location").props.value, "Geçerli yer");
    assert.equal(f.buttons("booking.reload").length, 0);
    assert.equal(f.buttons("common.cancel")[0].props.disabled, false);
    f.press(f.buttons("common.cancel")[0]);
    assert.equal(f.calls.closed, 1);
  });
}

test("web: toolbar status, open and saved callback follow the actual dialog", async () => {
  const f = fixture("web");
  await settle();
  f.useComponent(f.viewModule.AvailabilityButton);
  await settle();
  f.render();
  assert.ok(text(f.tree()).includes(i18n.t("booking.on")));
  f.press(
    f.one(
      (node) =>
        node.type === "Button" &&
        text(node).includes(i18n.t("booking.availability")),
      "toolbar button",
    ),
  );
  f.render();
  await settle();
  f.render();
  f.setWrite(async (payload) => ({ data: { ...payload, enabled: false } }));
  await f.save();
  await settle();
  f.render();
  assert.equal(f.matching((node) => node.type === "form").length, 0);
  assert.ok(text(f.tree()).includes(i18n.t("booking.off")));
  f.unmount();
});

test("web: failed toolbar status request leaves the availability action usable", async () => {
  const f = fixture("web", {
    read: async () => {
      throw new Error("Durum alınamadı");
    },
  });
  await settle();
  f.useComponent(f.viewModule.AvailabilityButton);
  await settle();
  f.render();
  assert.equal(f.matching((node) => node.type === "span").length, 0);
  assert.equal(f.matching((node) => node.type === "Button").length, 1);
  f.unmount();
});

test("mobile: hidden sheet delays reading and Android uses its platform branch", async () => {
  const f = fixture("mobile", { os: "android" });
  await settle();
  f.props.visible = false;
  f.useComponent(f.viewModule.AvailabilitySheet);
  assert.equal(f.calls.reads.length, 1);
  assert.equal(f.matching((node) => node.type === "SafeAreaView").length, 0);
  f.props.visible = true;
  f.render();
  await settle();
  f.render();
  assert.equal(f.calls.reads.length, 2);
  assert.equal(
    f.one((node) => node.type === "KeyboardAvoidingView", "keyboard view").props
      .behavior,
    undefined,
  );
  f.one(
    (node) => node.type === "Modal",
    "native modal adapter",
  ).props.onRequestClose();
  assert.equal(f.calls.closed, 1);
});

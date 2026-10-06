import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { loadTestModule } from "../scripts/test-source-loader.mjs";

// Runs the viewer's actual inline page script against a PDF.js and DOM
// adapter. Layout and real bitmap memory are device concerns; this checks
// which canvases exist and how large they are.
const { buildHtml } = loadTestModule("apps/mobile/src/PdfViewer.tsx", {
  dependencies: {
    react: {},
    "react/jsx-runtime": {},
    "react-native": {},
    "react-native-safe-area-context": {},
    "react-native-webview": {},
    "@expo/vector-icons": {},
    "expo-web-browser": {},
    "./ui": {},
    "@derslik/contracts": { t: (key) => key },
    "./pdf-html": loadTestModule("apps/mobile/src/pdf-html.ts"),
  },
  suffix: "module.exports.buildHtml = buildHtml;",
});

function viewer({ pages = 100, width = 390, ratio = 3 } = {}) {
  const html = buildHtml("https://fixture.invalid/notes.pdf", "#000", "#fff");
  const script = html.slice(
    html.lastIndexOf("<script>") + "<script>".length,
    html.lastIndexOf("</script>"),
  );
  const nodes = [],
    messages = [],
    cancelled = [];
  let watcher;
  const element = (tag) => {
    const node = {
      tag,
      style: {},
      dataset: {},
      children: [],
      width: 300,
      height: 150,
      parent: null,
      appendChild(child) {
        this.children.push(child);
        child.parent = this;
      },
      remove() {
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      getContext: () => ({}),
    };
    nodes.push(node);
    return node;
  };
  const holder = element("div");
  const page = {
    getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
    render() {
      const task = {
        promise: Promise.resolve(),
        cancel: () => cancelled.push(task),
      };
      return task;
    },
  };
  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({ numPages: pages, getPage: async () => page }),
    }),
  };
  class IntersectionObserver {
    constructor(callback, options) {
      watcher = { callback, options, targets: [] };
    }
    observe(target) {
      watcher.targets.push(target);
    }
  }
  runInNewContext(script, {
    window: {
      pdfjsLib,
      innerWidth: width,
      devicePixelRatio: ratio,
      ReactNativeWebView: { postMessage: (m) => messages.push(m) },
    },
    pdfjsLib,
    document: {
      getElementById: (id) => (id === "pages" ? holder : { style: {} }),
      createElement: element,
    },
    IntersectionObserver,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const show = async (from, to, visible = true) => {
    watcher.callback(
      watcher.targets
        .slice(from, to)
        .map((target) => ({ target, isIntersecting: visible })),
    );
    await settle();
  };
  return {
    settle,
    show,
    messages,
    watcher: () => watcher,
    drawn: () =>
      nodes.filter((n) => n.tag === "canvas" && n.parent && n.width > 0),
    released: () => nodes.filter((n) => n.tag === "canvas" && !n.parent),
  };
}

test("the PDF viewer draws only pages near the screen, at bounded size", async () => {
  const v = viewer();
  await v.settle();
  assert.equal(v.watcher().targets.length, 100, "one box per page");
  assert.equal(v.drawn().length, 0, "nothing is drawn before it is near");
  assert.equal(v.watcher().options.rootMargin, "100% 0px");
  await v.show(0, 3);
  const drawn = v.drawn();
  assert.equal(drawn.length, 3);
  for (const canvas of drawn) {
    // Pixel ratio 3 is capped at 2: 390 px wide → at most 780 canvas pixels.
    assert.ok(canvas.width <= 780, String(canvas.width));
    assert.ok(canvas.width * canvas.height <= 4_000_000);
  }
  assert.deepEqual(v.messages, ["ready"]);
});

test("pages that scroll away give their canvas back", async () => {
  const v = viewer();
  await v.settle();
  await v.show(0, 3);
  await v.show(0, 3, false);
  await v.show(50, 53);
  const drawn = v.drawn();
  assert.equal(drawn.length, 3);
  assert.ok(drawn.every((c) => Number(c.parent.dataset.page) > 50));
  const released = v.released();
  assert.equal(released.length, 3);
  assert.ok(released.every((c) => c.width === 0 && c.height === 0));
});

test("one very large page stays under the pixel cap", async () => {
  const v = viewer({ width: 1400, ratio: 3, pages: 1 });
  await v.settle();
  await v.show(0, 1);
  const [canvas] = v.drawn();
  assert.ok(canvas.width * canvas.height <= 4_000_000);
});

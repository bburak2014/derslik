// Tutorwise Academy logosu: işaretin sağ yarısı sol yarının aynası ve
// depodaki simgeler (favicon, mobil uygulama simgesi) packages/contracts/
// src/brand.ts'ten üretilmiş (scripts/brand-assets.mjs); elle değişmemiş.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTestModule } from "../scripts/test-source-loader.mjs";
import { createTsxFixture, treeNodes, treeText } from "./tsx-fixture.mjs";
import {
  MARK_CENTER,
  MARK_VIEWBOX,
  adaptiveIconSvg,
  brand,
  iconSvg,
  markParts,
  markSvg,
} from "../packages/contracts/src/brand.ts";

const numbers = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

test("the right half of the mark mirrors the left half", () => {
  for (const name of ["cover", "upper", "lower"]) {
    const left = numbers(markParts[name].left);
    const right = numbers(markParts[name].right);
    assert.equal(left.length, right.length);
    left.forEach((value, i) => {
      const expected = i % 2 === 0 ? 2 * MARK_CENTER - value : value;
      assert.ok(Math.abs(right[i] - expected) < 0.06, `${name}[${i}]`);
    });
  }
});

test("the dark-surface variant swaps navy for a light ink and keeps the page colors", () => {
  const onLight = markSvg({ tone: "on-light" });
  const onDark = markSvg({ tone: "on-dark" });
  assert.ok(onLight.includes(brand.navy));
  assert.ok(!onDark.includes(brand.navy));
  for (const color of [brand.orange, brand.sky]) assert.ok(onLight.includes(color) && onDark.includes(color));
});

test("the favicon and mobile icons are generated from the brand module", () => {
  assert.equal(readFileSync("apps/web/public/favicon.svg", "utf8"), iconSvg(64));
  assert.equal(readFileSync("apps/mobile/assets/icon.svg", "utf8"), iconSvg(1024));
  assert.equal(readFileSync("apps/mobile/assets/adaptive-icon.svg", "utf8"), adaptiveIconSvg(1024));
});

test("the icon generator reproduces the committed icons", async () => {
  const { brandAssets } = await import("../scripts/brand-assets.mjs");
  const files = await brandAssets();
  for (const file of ["apps/web/public/favicon.svg", "apps/mobile/assets/icon.svg", "apps/mobile/assets/adaptive-icon.svg"])
    assert.equal(files[file], readFileSync(file, "utf8"), file);
  // PNG başlığı: genişlik, yükseklik, renk türü (6 = saydamlıklı).
  const header = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] });
  for (const file of ["apps/mobile/assets/icon.png", "apps/mobile/assets/adaptive-icon.png"]) {
    assert.deepEqual(header(files[file]), header(readFileSync(file)), file);
    assert.equal(header(files[file]).width, 1024);
  }
});

test("upper keeps the brand name in plain capitals in every language", async () => {
  const { upper } = await import("../packages/contracts/src/i18n/index.ts");
  // Türkçe kuralı (i → İ) markaya uygulanmaz; metnin geri kalanına uygulanır.
  assert.equal(upper("Tutorwise hesabı", "tr"), "TUTORWISE HESABI");
  assert.equal(upper("Tutorwise'a hoş geldiniz", "tr"), "TUTORWISE'A HOŞ GELDİNİZ");
  assert.equal(upper("Tutorwise account", "en"), "TUTORWISE ACCOUNT");
});

// ── Uygulamadaki işaret bileşenleri ──
// Web (BrandMark) ve mobil (BrandMark/Brand) bileşenleri gerçek kaynaktan
// çalıştırılır; çizdikleri şekiller favicon'u üreten markSvg ile aynı olmalı.

const brandModule = await import("../packages/contracts/src/brand.ts");

/** Rengin rolü: mürekkep (lacivert kısımlar) INK, koyu mavi sayfa GRADIENT. */
function roleOf(color, ink) {
  if (color === ink) return "INK";
  if (color?.startsWith("url(")) return "GRADIENT";
  return color;
}

/** Şekillerin sırası, yolu ve rolü. */
function shapesOfSvg(svg) {
  return [...svg.matchAll(/<(path|circle) ([^>]*)\/>/g)].map(([, tag, attrs]) => {
    const get = (name) => new RegExp(`(?:^| )${name}="([^"]*)"`).exec(attrs)?.[1];
    return {
      tag,
      d: get("d") ?? `${get("cx")},${get("cy")},${get("r")}`,
      fill: roleOf(get("fill"), brand.navy),
      stroke: roleOf(get("stroke"), brand.navy),
    };
  });
}

function shapesOfTree(tree, ink) {
  return treeNodes(tree)
    .filter((node) => /^(path|circle)$/i.test(node.type))
    .map(({ type, props }) => ({
      tag: type.toLowerCase(),
      d: props.d ?? `${props.cx},${props.cy},${props.r}`,
      fill: roleOf(props.fill, ink),
      stroke: roleOf(props.stroke, ink),
    }));
}

function webBrand() {
  const renderer = createTsxFixture();
  let ids = 0;
  const exports = loadTestModule("apps/web/components/brand-mark.tsx", {
    dependencies: {
      react: { ...renderer.react, useId: () => `:r${++ids}:` },
      "react/jsx-runtime": renderer.jsx,
      "@derslik/contracts/brand": brandModule,
    },
  });
  return { renderer, ...exports };
}

test("the web mark draws the logo's shapes, with the navy parts in the text color", () => {
  const { renderer, BrandMark } = webBrand();
  const tree = renderer.render(BrandMark, { className: "mark" });
  const { x, y, width, height } = MARK_VIEWBOX;
  assert.equal(tree.type, "svg");
  assert.equal(tree.props.viewBox, `${x} ${y} ${width} ${height}`);
  assert.equal(tree.props.className, "mark");
  assert.equal(tree.props["aria-hidden"], "true");
  assert.deepEqual(shapesOfTree(tree, "currentColor"), shapesOfSvg(markSvg()));
});

test("each web mark points its dark page at its own gradient", () => {
  const { renderer, BrandMark } = webBrand();
  const gradientOf = (tree) => {
    const nodes = treeNodes(tree);
    const id = nodes.find((node) => node.type === "linearGradient").props.id;
    const used = nodes.filter((node) => node.props.fill?.startsWith("url(")).map((node) => node.props.fill);
    return { id, used };
  };
  const first = gradientOf(renderer.render(BrandMark, {}));
  const second = gradientOf(createTsxFixture().render(BrandMark, {}));
  assert.deepEqual(first.used, [`url(#${first.id})`]);
  assert.deepEqual(second.used, [`url(#${second.id})`]);
  assert.notEqual(first.id, second.id);
});

test("the web lockup shows the mark and the brand name", () => {
  const { renderer, BrandLockup } = webBrand();
  const tree = renderer.render(BrandLockup, {});
  assert.ok(treeNodes(tree).some((node) => node.type === "svg"));
  const name = treeNodes(tree).find((node) => node.type === "span");
  assert.equal(name.props.className, "brand-name");
  assert.equal(treeText(name), brandModule.BRAND_NAME);
});

const colors = { ink: "#141c4d", onNavyStrong: "#ffffff" };
function mobileBrand() {
  const renderer = createTsxFixture();
  const exports = loadTestModule("apps/mobile/src/ui/brand.tsx", {
    dependencies: {
      react: renderer.react,
      "react/jsx-runtime": renderer.jsx,
      "react-native": { Pressable: "Pressable", StyleSheet: { absoluteFill: {} }, Text: "Text", View: "View" },
      "@expo/vector-icons": { Ionicons: "Ionicons" },
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
      "react-native-svg": {
        __esModule: true,
        default: "Svg",
        Circle: "Circle",
        Defs: "Defs",
        LinearGradient: "LinearGradient",
        Path: "Path",
        Pattern: "Pattern",
        Rect: "Rect",
        Stop: "Stop",
      },
      "@derslik/contracts/brand": brandModule,
      "./tokens": {},
      "./theme": {
        useTheme: () => ({ colors, styles: { brand: { fontSize: 20 } }, section: { brandRow: { gap: 10 } } }),
      },
      "./buttons": { ripple: () => undefined },
    },
  });
  return { renderer, ...exports };
}

test("the mobile mark draws the logo's shapes in the given ink at the logo's proportions", () => {
  const { renderer, BrandMark } = mobileBrand();
  const tree = renderer.render(BrandMark, { size: 30, ink: "#123456" });
  const { width, height } = MARK_VIEWBOX;
  assert.equal(tree.type, "Svg");
  assert.equal(tree.props.height, 30);
  assert.equal(tree.props.width, (30 * width) / height);
  assert.deepEqual(shapesOfTree(tree, "#123456"), shapesOfSvg(markSvg()));
  const gradient = treeNodes(tree).find((node) => node.type === "LinearGradient").props.id;
  assert.deepEqual(
    treeNodes(tree).filter((node) => node.props.fill?.startsWith("url(")).map((node) => node.props.fill),
    [`url(#${gradient})`],
  );
});

test("the mobile brand names itself and switches ink on the dark surface", () => {
  const { renderer, Brand } = mobileBrand();
  const light = renderer.render(Brand, {});
  assert.equal(light.props.accessibilityLabel, brandModule.BRAND_NAME);
  assert.equal(light.props.accessibilityRole, "header");
  const lightMark = treeNodes(light).find((node) => node.type === "Svg");
  assert.equal(lightMark.props.height, 28);
  assert.ok(shapesOfTree(light, colors.ink).some((shape) => shape.fill === "INK"));
  assert.equal(treeText(treeNodes(light).find((node) => node.type === "Text")), brandModule.BRAND_NAME);

  const dark = createTsxFixture().render(Brand, { inverse: true });
  assert.equal(treeNodes(dark).find((node) => node.type === "Svg").props.height, 34);
  assert.ok(shapesOfTree(dark, colors.onNavyStrong).some((shape) => shape.fill === "INK"));
  const name = treeNodes(dark).find((node) => node.type === "Text");
  assert.equal(name.props.style.at(-1).color, colors.onNavyStrong);

  const compact = createTsxFixture().render(Brand, { compact: true });
  assert.ok(treeNodes(compact).some((node) => node.type === "Svg"));
  assert.ok(!treeNodes(compact).some((node) => node.type === "Text"));
});

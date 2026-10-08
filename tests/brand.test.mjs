// Tutorwise Academy logosu: işaretin sağ yarısı sol yarının aynası ve
// depodaki simgeler (favicon, mobil uygulama simgesi) packages/contracts/
// src/brand.ts'ten üretilmiş (scripts/brand-assets.mjs); elle değişmemiş.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARK_CENTER,
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

test("upper keeps the brand name in plain capitals in every language", async () => {
  const { upper } = await import("../packages/contracts/src/i18n/index.ts");
  // Türkçe kuralı (i → İ) markaya uygulanmaz; metnin geri kalanına uygulanır.
  assert.equal(upper("Tutorwise hesabı", "tr"), "TUTORWISE HESABI");
  assert.equal(upper("Tutorwise'a hoş geldiniz", "tr"), "TUTORWISE'A HOŞ GELDİNİZ");
  assert.equal(upper("Tutorwise account", "en"), "TUTORWISE ACCOUNT");
});

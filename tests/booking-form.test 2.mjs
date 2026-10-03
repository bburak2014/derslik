import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingBlockWithId,
  bookingEditorReducer,
  bookingSettingsFromForm,
  initialBookingEditorState,
  loadBookingForm,
  patchBookingWindow,
  removeBookingWindow,
  toBookingForm,
} from "../packages/contracts/src/booking-form.ts";
import { bookingSettingsSchema } from "../packages/contracts/src/booking.ts";

const settings = () => ({
  enabled: true,
  durationMinutes: 60,
  noticeHours: 12,
  cancelHours: 24,
  location: "Çevrim içi",
  windows: [
    { weekday: 1, start: "15:00", end: "17:00" },
    { weekday: 2, start: "18:00", end: "20:00" },
  ],
  blocks: [
    { from: "2026-10-14", to: "2026-10-20" },
    { from: "2026-10-25", to: "2026-10-25" },
  ],
  version: 7,
});

const editorWithForm = () =>
  bookingEditorReducer(initialBookingEditorState(), {
    type: "loaded",
    form: toBookingForm(settings()),
  });

test("kapalı gün kimlikleri formlar arasında eşsizdir ve düzenlemede sabittir", () => {
  const original = editorWithForm();
  const secondForm = toBookingForm(settings());
  const added = bookingBlockWithId({ from: "2026-11-01", to: "2026-11-03" });
  const edited = bookingEditorReducer(original, {
    type: "edited",
    change: (form) => ({
      ...form,
      blocks: [{ ...form.blocks[1], to: "2026-10-27" }, added],
    }),
  });

  assert.equal(edited.form.blocks[0].id, original.form.blocks[1].id);
  const ids = [...original.form.blocks, ...secondForm.blocks, added].map(
    (block) => block.id,
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(original.form.blocks.length, 2);
  assert.equal(original.form.blocks[1].to, "2026-10-25");
});

test("API gövdesi istemci kimliklerini atar, tarih sırasını ve sürümü korur", () => {
  const source = settings();
  const form = toBookingForm(source);
  const payload = bookingSettingsFromForm(form);

  assert.deepEqual(payload, source);
  assert.equal(bookingSettingsSchema.safeParse(payload).success, true);
  assert.equal(bookingSettingsSchema.safeParse(form).success, false);
  assert.deepEqual(payload.blocks.map(Object.keys), [
    ["from", "to"],
    ["from", "to"],
  ]);
  assert.ok(form.blocks.every((block) => typeof block.id === "string"));
  assert.notStrictEqual(payload.blocks, form.blocks);
});

test("saat aralığı düzenleme ve silme eski formu veya diğer satırı değiştirmez", () => {
  const form = toBookingForm(settings());
  Object.freeze(form.windows[0]);
  Object.freeze(form.windows[1]);
  Object.freeze(form.windows);
  Object.freeze(form);

  const updated = patchBookingWindow(form, 1, { start: "18:30" });
  assert.equal(updated.windows[1].start, "18:30");
  assert.equal(form.windows[1].start, "18:00");
  assert.strictEqual(updated.windows[0], form.windows[0]);
  assert.strictEqual(updated.blocks, form.blocks);

  const removed = removeBookingWindow(updated, 0);
  assert.equal(removed.windows.length, 1);
  assert.strictEqual(removed.windows[0], updated.windows[1]);
  assert.equal(updated.windows.length, 2);
  assert.deepEqual(patchBookingWindow(form, -1, { end: "23:00" }), form);
  assert.deepEqual(removeBookingWindow(form, 99), form);
});

test("alan değişikliği eski satır hatalarını temizler, 409 uyarısını korur", () => {
  const original = {
    ...editorWithForm(),
    issues: { "windows.1": "api.availabilityOrder" },
    error: "Ayar başka yerde değişti",
    stale: true,
  };
  const edited = bookingEditorReducer(original, {
    type: "edited",
    change: (form) => patchBookingWindow(form, 1, { end: "21:00" }),
  });

  assert.deepEqual(edited.issues, {});
  assert.equal(edited.form.windows[1].end, "21:00");
  assert.equal(edited.error, original.error);
  assert.equal(edited.stale, true);
  assert.equal(original.form.windows[1].end, "20:00");
  assert.deepEqual(original.issues, { "windows.1": "api.availabilityOrder" });
});

test("form yüklenmeden düzenleme yapılırsa değişiklik işlevi çalışmaz", () => {
  let changes = 0;
  const state = bookingEditorReducer(initialBookingEditorState(), {
    type: "edited",
    change: () => {
      changes++;
      throw new Error("Yüklenmeyen form düzenlenemez");
    },
  });
  assert.equal(changes, 0);
  assert.equal(state.form, null);
  assert.deepEqual(state.issues, {});
});

test("doğrulama ve kayıt başlangıcı mevcut formu ve eski sürüm uyarısını korur", () => {
  const original = {
    ...editorWithForm(),
    error: "Eski ağ hatası",
    stale: true,
  };
  const invalid = bookingEditorReducer(original, {
    type: "invalid",
    issues: { location: "api.invalidFields" },
  });
  assert.strictEqual(invalid.form, original.form);
  assert.equal(invalid.error, original.error);
  const saving = bookingEditorReducer(invalid, { type: "saving" });
  assert.equal(saving.error, "");
  assert.equal(saving.stale, true);
  assert.strictEqual(saving.issues, invalid.issues);
  assert.strictEqual(saving.form, original.form);
});

test("kayıt hatası 409 durumunu günceller; yükleme hatası önceki durumu korur", () => {
  const original = editorWithForm();
  const stale = bookingEditorReducer(original, {
    type: "failed",
    error: "Başka bir kayıt var",
    stale: true,
  });
  assert.equal(stale.stale, true);
  const loadFailed = bookingEditorReducer(stale, {
    type: "failed",
    error: "Yükleme başarısız",
  });
  assert.equal(loadFailed.stale, true);
  assert.strictEqual(loadFailed.form, original.form);
  assert.equal(loadFailed.error, "Yükleme başarısız");
  const otherSaveError = bookingEditorReducer(loadFailed, {
    type: "failed",
    error: "Ağ bağlantısı yok",
    stale: false,
  });
  assert.equal(otherSaveError.stale, false);
});

test("yeniden yükleme formu yeniler ve doğrulama, ağ, 409 hatalarını temizler", async () => {
  let state = {
    ...editorWithForm(),
    issues: { "blocks.0": "api.blockOrder" },
    error: "Başka yerde kaydedildi",
    stale: true,
  };
  const refreshed = { ...settings(), version: 8, location: "Yeni yer" };
  let reads = 0;
  await loadBookingForm(
    async () => {
      reads++;
      return refreshed;
    },
    (action) => {
      state = bookingEditorReducer(state, action);
    },
  );
  assert.equal(reads, 1);
  assert.deepEqual(bookingSettingsFromForm(state.form), refreshed);
  assert.deepEqual(state.issues, {});
  assert.equal(state.error, "");
  assert.equal(state.stale, false);
});

test("başarısız yükleme yarım form üretmez ve tekrar deneme için hatayı döndürür", async () => {
  let state = initialBookingEditorState();
  await loadBookingForm(
    async () => {
      throw new Error("Sunucu erişilemiyor");
    },
    (action) => {
      state = bookingEditorReducer(state, action);
    },
  );
  assert.equal(state.form, null);
  assert.equal(state.error, "Sunucu erişilemiyor");
  assert.deepEqual(state.issues, {});
  assert.equal(state.stale, false);
});

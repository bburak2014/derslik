import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_HORIZON_DAYS,
  bookingSettingsSchema,
  canCancelBooking,
  cancelDeadline,
  dayTimeLabel,
  findOverlap,
  groupSlotsByDay,
  halfHourOptions,
  minutesOf,
  nextWindow,
  presetOptions,
  settingsIssues,
  timeOf,
  weekdayName,
} from "../packages/contracts/src/booking.ts";

// Ders ayarlamanın ortak kuralları: web, mobil ve API aynı şemayı kullanır.
const valid = {
  enabled: true,
  durationMinutes: 60,
  noticeHours: 12,
  cancelHours: 24,
  location: "Çevrim içi",
  windows: [
    { weekday: 1, start: "15:00", end: "19:00" },
    { weekday: 1, start: "19:00", end: "21:00" },
  ],
  blocks: [{ from: "2026-10-14", to: "2026-10-20" }],
  version: 0,
};
const issues = (body) => {
  const r = bookingSettingsSchema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

test("saat ve dakika çevirileri yarım saatlik dilimlerle çalışır", () => {
  assert.equal(minutesOf("15:30"), 930);
  assert.equal(minutesOf("24:00"), 1440);
  assert.equal(timeOf(930), "15:30");
  assert.equal(timeOf(0), "00:00");
  const options = halfHourOptions();
  assert.equal(options.length, 49);
  assert.equal(options[0], "00:00");
  assert.equal(options[48], "24:00");
  assert.equal(BOOKING_HORIZON_DAYS, 28);
});

test("ayar şeması geçerli ayarı kabul eder; uç uca aralıklar çakışmaz", () => {
  assert.deepEqual(issues(valid), []);
  assert.equal(findOverlap(valid.windows), -1);
  // Farklı günlerde aynı saat çakışma değildir.
  assert.deepEqual(
    issues({
      ...valid,
      windows: [
        { weekday: 2, start: "10:00", end: "12:00" },
        { weekday: 3, start: "10:00", end: "12:00" },
      ],
    }),
    [],
  );
});

test("ayar şeması hatalı aralık, tarih ve sınırları reddeder", () => {
  assert.deepEqual(
    issues({
      ...valid,
      windows: [
        { weekday: 2, start: "10:00", end: "12:00" },
        { weekday: 2, start: "11:30", end: "13:00" },
      ],
    }),
    ["api.availabilityOverlap"],
  );
  assert.deepEqual(
    issues({ ...valid, windows: [{ weekday: 1, start: "15:15", end: "16:00" }] }),
    ["api.availabilityTime"],
  );
  assert.deepEqual(
    issues({ ...valid, windows: [{ weekday: 1, start: "16:00", end: "16:00" }] }),
    ["api.availabilityOrder"],
  );
  assert.equal(
    issues({ ...valid, windows: [{ weekday: 8, start: "10:00", end: "11:00" }] })
      .length,
    1,
  );
  assert.deepEqual(
    issues({ ...valid, blocks: [{ from: "2026-10-20", to: "2026-10-14" }] }),
    ["api.blockOrder"],
  );
  assert.deepEqual(
    issues({ ...valid, blocks: [{ from: "2026-02-31", to: "2026-03-01" }] }),
    ["api.invalidDate"],
  );
  assert.deepEqual(issues({ ...valid, durationMinutes: 62 }), [
    "api.bookingDuration",
  ]);
  assert.deepEqual(issues({ ...valid, durationMinutes: 10 }), [
    "api.bookingDuration",
  ]);
  assert.deepEqual(issues({ ...valid, noticeHours: 169 }), ["api.bookingHours"]);
  assert.equal(issues({ ...valid, location: "x".repeat(101) }).length, 1);
  assert.equal(issues({ ...valid, extra: true }).length, 1);
  // 51 çakışmayan aralık: yalnızca sınır hatası.
  const many = Array.from({ length: 51 }, (_, i) => ({
    weekday: (i % 7) + 1,
    start: timeOf(Math.floor(i / 7) * 30),
    end: timeOf(Math.floor(i / 7) * 30 + 30),
  }));
  assert.deepEqual(issues({ ...valid, windows: many }), [
    "api.availabilityTooMany",
  ]);
});

test("yeni aralık son aralığın bitişinden başlar, gün doluysa eklenmez", () => {
  assert.deepEqual(nextWindow([], 2), { weekday: 2, start: "15:00", end: "19:00" });
  assert.deepEqual(
    nextWindow(
      [
        { weekday: 2, start: "15:00", end: "19:00" },
        { weekday: 3, start: "20:00", end: "23:00" },
      ],
      2,
    ),
    { weekday: 2, start: "19:00", end: "21:00" },
  );
  assert.deepEqual(nextWindow([{ weekday: 2, start: "23:00", end: "23:30" }], 2), {
    weekday: 2,
    start: "23:30",
    end: "24:00",
  });
  assert.equal(nextWindow([{ weekday: 2, start: "20:00", end: "24:00" }], 2), null);
});

test("hazır seçeneklere şu anki değer eklenir; şema hataları yola göre eşlenir", () => {
  assert.deepEqual(presetOptions([30, 60], 45), [30, 45, 60]);
  assert.deepEqual(presetOptions([30, 60], 60), [30, 60]);
  const r = bookingSettingsSchema.safeParse({
    ...valid,
    location: "x".repeat(101),
    windows: [
      { weekday: 2, start: "10:00", end: "12:00" },
      { weekday: 2, start: "11:00", end: "13:00" },
    ],
  });
  assert.equal(r.success, false);
  const map = settingsIssues(r.error.issues);
  assert.equal(map["windows.1"], "api.availabilityOverlap");
  assert.ok(map.location);
});

test("boş saatler İstanbul gününe göre gruplanır", () => {
  const days = groupSlotsByDay([
    { startsAt: "2026-10-03T12:00:00.000Z", endsAt: "2026-10-03T13:00:00.000Z" },
    { startsAt: "2026-10-03T20:30:00.000Z", endsAt: "2026-10-03T21:30:00.000Z" },
    // İstanbul'da 4 Ekim 00:30.
    { startsAt: "2026-10-03T21:30:00.000Z", endsAt: "2026-10-03T22:30:00.000Z" },
  ]);
  assert.deepEqual(
    days.map((d) => [d.day, d.slots.length]),
    [
      ["2026-10-03", 2],
      ["2026-10-04", 1],
    ],
  );
});

test("iptal yalnızca öğrencinin ayarladığı planlı derste ve süre dolmadan", () => {
  const lesson = {
    status: "SCHEDULED",
    starts_at: "2026-10-10T12:00:00.000Z",
    booked_by: "u1",
  };
  const deadline = cancelDeadline(lesson.starts_at, 24).getTime();
  assert.equal(new Date(deadline).toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(canCancelBooking(lesson, 24, deadline), true);
  assert.equal(canCancelBooking(lesson, 24, deadline + 1), false);
  assert.equal(canCancelBooking({ ...lesson, booked_by: null }, 24, 0), false);
  assert.equal(canCancelBooking({ ...lesson, status: "CANCELLED" }, 24, 0), false);
  assert.equal(canCancelBooking(lesson, 0, Date.parse(lesson.starts_at)), true);
});

test("gün adları ve tarih-saat etiketi etkin dilde yazılır", () => {
  assert.equal(weekdayName(1), "Pazartesi");
  assert.equal(weekdayName(7), "Pazar");
  assert.equal(weekdayName(3, "short"), "Çar");
  assert.equal(dayTimeLabel("2026-10-09T12:00:00.000Z"), "9 Ekim Cuma 15:00");
});

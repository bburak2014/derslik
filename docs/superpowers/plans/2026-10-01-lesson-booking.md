# Öğrencinin Boş Saatten Ders Ayarlaması: Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Öğretmen haftalık boş saatlerini girer; öğretmene bağlı öğrenci bu saatlerden birini seçip dersi kendisi ayarlar ve süresi dolmadan iptal edebilir. Özellik web ve mobilde çalışır.

**Architecture:** Kurallar PostgreSQL'deki `SECURITY DEFINER` fonksiyonlarında tutulur (`open_slots`, `book_lesson`, `cancel_booking`). Öğrenci için RLS salt okur kalır. NestJS'teki yeni `booking` modülü bu fonksiyonları çağırır. Öğrencinin yazma istekleri mevcut `CommandService` portal yolundan geçer; tekrarlanan istek ikinci ders açmaz ve her işlem denetim kaydına yazılır. Ayar şeması ve yardımcılar `packages/contracts/src/booking.ts` içindedir; web, mobil ve API aynı kodu kullanır.

**Tech Stack:** NestJS 12, PostgreSQL (PGlite ile testler), zod 3, Next.js 16 (shadcn), Expo / React Native, node:test.

**Spec:** `docs/superpowers/specs/2026-10-01-lesson-booking-design.md`

## Global Constraints

- Komutlar depo kökünde, Node 24 ve pnpm 11.25 ile çalışır. İkisi de PATH'te olmalı (`~/.nvm/versions/node/v24.21.0/bin`).
- Dal `claude/lesson-booking`. Commit mesajları kısa ve Türkçedir, mevcut düzene uyar (`Ders ayarlama: …`). Her mesaj `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` satırıyla biter.
- Saat dilimi her yerde `Europe/Istanbul`. İstemciler saatleri `dayLabel` ve `timeLabel` ile gösterir. Öğrenci istemcisi seçtiği saati, sunucudan aldığı `startsAt` değeri olduğu gibi geri gönderir; saati yerel saatten yeniden kurmaz.
- Sabitler (spec ile aynı):
  - görünür gün sayısı 28 (bugün dahil),
  - başlangıç adımı 30 dk,
  - en fazla 50 aralık ve 50 kapalı gün,
  - ders süresi 15–180 dk ve 5'in katı,
  - önceden ayarlama ve iptal süreleri 0–168 saat,
  - varsayılanlar: süre 60 dk, önceden ayarlama 12 saat, iptal 24 saat, ayarlama kapalı.
- API hataları çeviri anahtarı olarak fırlatılır (`new ConflictException("api.bookingSlotTaken")`). Yeni anahtarlar 7 dilin hepsinde bulunur; `Messages` tipi bunu derlemede zorunlu kılar.
- Türkçe metinler, uygulamanın geri kalanı gibi "siz" diliyle yazılır. Spec'teki örnek arayüz metinlerinin "sen" diliyle yazılmış olanları buna çevrildi. Fransızcada `?` işaretinden önce bölünmez boşluk (` `) kullanılır.
- Kod yorumları Türkçedir ve çevredeki kodun yoğunluğundadır.
- Spec'ten bilinçli sapmalar:
  1. Göç iki dosyadır: `0017` tablolar, `0018` fonksiyonlar. Böylece yerel veritabanında iki görev arasında uygulanmış bir göç sonradan değiştirilmez.
  2. Paket ve boştaki hak hesabı, `booking_packages` adlı iç yardımcı fonksiyonda tek yerde durur.
  3. `packages/api-client` dosyasına yalnızca `booking()` ve `saveBooking()` yöntemleri eklenir. Öğrencinin boş saat, ayarlama ve iptal çağrıları, diğer portal işlemleri gibi mevcut `backend()` (web) ve `request()` (mobil) yardımcılarından geçer; bu yardımcılar ağ hatasından sonra aynı tekrar anahtarını kendiliğinden kullanır.

## Review Focus

Spec'in ima ettiği ama ayrı bir görevin sınamadığı, kullanıcıyı en çok yakabilecek beş durum. Her biri sahibi olan görevde bir testle sabitlendi:

1. **Aynı anın başka yazılışı:** Öğrenci `Z` yerine `+03:00` ile yazılmış aynı anı gönderse de aynı boş saat kabul edilmeli. Test: Görev 4, "iki öğrenci aynı saati aynı anda seçerse" (`${D24}T11:00:00+03:00`).
2. **Süreye sığmayan aralık:** 23:00–24:00 aralığı ve 90 dakikalık ders hata vermemeli; o aralık hiç saat üretmemeli. Test: Görev 4, "gece yarısı ve süreye sığmayan aralık".
3. **Gece yarısına yakın saatler:** İstanbul'da 00:00–02:00 olan saatler (UTC'de önceki gün) doğru güne düşmeli. Kapalı gün kontrolü ve gün gruplaması İstanbul gününe göre yapılmalı. Test: Görev 4, aynı test; Görev 1, `groupSlotsByDay`.
4. **Aynı öğrencinin son hakkıyla iki sekmeden iki farklı saat seçmesi:** Yalnızca biri ders olmalı. Test: Görev 4, "son boştaki hak için aynı anda iki ayarlama".
5. **Öğretmenin bütün aralıkları silmesi ya da ayarlamayı kapatması:** Ayarlanmış dersler yerinde kalmalı, öğrenci süresi içinde iptal edebilmeli, liste hata değil boş dönmeli. Test: Görev 4, "süresi geçen … iptal edemez" testinin son bölümü ve "veli, öğretmen, kapalı ayarlama …" testi.

---

## Dosya haritası

| Dosya | Görev | Sorumluluk |
| --- | --- | --- |
| `packages/contracts/src/booking.ts` (yeni) | 1 | Ayar tipleri, zod şeması, sabitler, saat ve gün yardımcıları |
| `tests/booking-rules.test.mjs` (yeni) | 1 | `booking.ts` birim testleri |
| `packages/contracts/src/i18n/{tr,en,de,fr,es,zh,ja}.ts` | 2 | Yeni `api.*`, `notice.*` ve `booking.*` metinleri |
| `apps/api/drizzle/0017_booking_settings.sql` (yeni) | 3 | Ayar tabloları, RLS, `lessons.booked_by` |
| `apps/api/drizzle/0018_lesson_booking.sql` (yeni) | 4 | Boş saat, ayarlama ve iptal fonksiyonları |
| `apps/api/src/booking/booking.service.ts` (yeni) | 3, 4 | Öğretmen ayarları ve öğrenci işlemleri |
| `apps/api/src/booking/booking.controller.ts` (yeni) | 3, 4 | HTTP uçları |
| `apps/api/src/learning/learning.service.ts` | 4 | Portal yanıtına `booking` ve `booked_by` alanları |
| `apps/api/tests/booking-cases.mjs` (yeni) | 3, 4 | API entegrasyon testleri |
| `packages/api-client/src/index.ts` | 4 | `booking()`, `saveBooking()`, `PortalData.booking` |
| `apps/web/components/derslik/availability-dialog.tsx` (yeni) | 5 | Öğretmenin "Müsaitlik" düğmesi ve penceresi |
| `apps/web/components/derslik/learning/booking.tsx` (yeni) | 6 | Öğrencinin ayarlama penceresi, etiket ve iptal |
| `apps/mobile/src/teacher/availability.tsx` (yeni) | 7 | Mobil müsaitlik ekranı |
| `apps/mobile/src/booking.tsx` (yeni) | 8 | Mobil ayarlama ekranı |

---

### Görev 1: Ortak ayarlama kuralları (contracts)

**Files:**
- Create: `packages/contracts/src/booking.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `tests/booking-rules.test.mjs`
- Modify: `package.json` (`scripts`)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `dateKey`, `dayLabel` ve `timeLabel` (`packages/contracts/src/types.ts`).
- Produces (sonraki görevler bu adları kullanır):
  - Sabitler: `BOOKING_HORIZON_DAYS`, `SLOT_STEP_MINUTES`, `MAX_WINDOWS`, `MAX_BLOCKS`, `DURATION_PRESETS`, `NOTICE_PRESETS`, `CANCEL_PRESETS`.
  - Tipler: `BookingWindow { weekday: number; start: string; end: string }`, `BookingBlock { from: string; to: string }`, `BookingSettings`, `BookingSlot { startsAt: string; endsAt: string }`, `BookingSlots`, `BookingPolicy`.
  - Fonksiyonlar:
    - `defaultBookingSettings(): BookingSettings`
    - `minutesOf(time: string): number`
    - `timeOf(minutes: number): string`
    - `halfHourOptions(): string[]`
    - `findOverlap(windows): number`
    - `nextWindow(windows, weekday): BookingWindow | null`
    - `presetOptions(presets, current): number[]`
    - `settingsIssues(issues): Record<string, string>`
    - `groupSlotsByDay(slots): { day: string; slots: BookingSlot[] }[]`
    - `cancelDeadline(startsAt, cancelHours): Date`
    - `canCancelBooking(lesson, cancelHours, now: number): boolean`
    - `dayTimeLabel(iso: string): string`
    - `weekdayName(weekday, style?): string`
  - Şemalar: `bookingSettingsSchema`, `bookLessonSchema`, `cancelBookingSchema`.

- [ ] **Adım 1: Başarısız testi yaz**

`tests/booking-rules.test.mjs`:

```js
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
```

- [ ] **Adım 2: Testin başarısız olduğunu gör**

Run: `node --experimental-strip-types --test tests/booking-rules.test.mjs`
Expected: FAIL. Hata `Cannot find module '…/packages/contracts/src/booking.ts'` olmalı.

- [ ] **Adım 3: Kuralları yaz**

`packages/contracts/src/booking.ts`:

```ts
import { z } from "zod";
import { dateKey, dayLabel, timeLabel } from "./types.ts";

// Öğrencinin boş saatten ders ayarlaması: öğretmen ayarlarının biçimi,
// sınırlar ve web, mobil ile API'nin ortak yardımcıları. Boş saatleri
// veritabanı üretir (apps/api/drizzle/0018_lesson_booking.sql,
// derslik.open_slots); buradaki sabitler onunla aynı olmalı.

/** Öğrencinin saat görebildiği gün sayısı, bugün dahil. */
export const BOOKING_HORIZON_DAYS = 28;
/** Boş saat başlangıçları arasındaki adım (dakika). */
export const SLOT_STEP_MINUTES = 30;
export const MAX_WINDOWS = 50;
export const MAX_BLOCKS = 50;
/** Ayar penceresindeki hazır seçenekler; API aralıktaki her değeri kabul eder. */
export const DURATION_PRESETS = [30, 40, 45, 50, 60, 75, 90, 120] as const;
export const NOTICE_PRESETS = [0, 1, 2, 6, 12, 24, 48] as const;
export const CANCEL_PRESETS = [0, 2, 6, 12, 24, 48] as const;

/** Haftalık aralık: ISO hafta günü (1 = Pazartesi), "HH:MM" sınırlar. */
export type BookingWindow = { weekday: number; start: string; end: string };
/** Kapalı günler; iki uç da dahil. */
export type BookingBlock = { from: string; to: string };
export type BookingSettings = {
  enabled: boolean;
  durationMinutes: number;
  noticeHours: number;
  cancelHours: number;
  location: string;
  windows: BookingWindow[];
  blocks: BookingBlock[];
  version: number;
};
export type BookingSlot = { startsAt: string; endsAt: string };
export type BookingSlots = {
  durationMinutes: number;
  location: string;
  cancelHours: number;
  freeCredits: number;
  slots: BookingSlot[];
};
/** Portal yanıtındaki özet; öğretmen ayarı hiç kaydetmemişse null. */
export type BookingPolicy = { enabled: boolean; cancelHours: number } | null;

/** Ayar hiç kaydedilmemişse öğretmenin gördüğü başlangıç değerleri. */
export const defaultBookingSettings = (): BookingSettings => ({
  enabled: false,
  durationMinutes: 60,
  noticeHours: 12,
  cancelHours: 24,
  location: "",
  windows: [],
  blocks: [],
  version: 0,
});

/** "15:30" → 930; "24:00" → 1440. */
export const minutesOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** 930 → "15:30". */
export const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Aralık sınırı seçenekleri: 00:00 … 24:00, yarım saat arayla. */
export const halfHourOptions = () =>
  Array.from({ length: 49 }, (_, i) => timeOf(i * SLOT_STEP_MINUTES));

/** Aynı gün içinde önceki bir aralıkla çakışan ilk aralığın sırası; yoksa -1.
 *  Uç uca aralıklar (10:00–12:00 ve 12:00–14:00) çakışmaz. */
export function findOverlap(windows: readonly BookingWindow[]) {
  for (let i = 0; i < windows.length; i++)
    for (let j = 0; j < i; j++)
      if (
        windows[i].weekday === windows[j].weekday &&
        minutesOf(windows[i].start) < minutesOf(windows[j].end) &&
        minutesOf(windows[j].start) < minutesOf(windows[i].end)
      )
        return i;
  return -1;
}

/** O güne eklenecek yeni aralık: ilk aralık 15:00–19:00, sonrakiler son
 *  aralığın bitişinden iki saat. Gün 24:00'e kadar doluysa null. */
export function nextWindow(
  windows: readonly BookingWindow[],
  weekday: number,
): BookingWindow | null {
  const ends = windows
    .filter((w) => w.weekday === weekday)
    .map((w) => minutesOf(w.end));
  if (!ends.length) return { weekday, start: "15:00", end: "19:00" };
  const start = Math.max(...ends);
  if (start >= 1440) return null;
  return {
    weekday,
    start: timeOf(start),
    end: timeOf(Math.min(start + 120, 1440)),
  };
}

/** Hazır seçenekler ve (listede yoksa) şu anki değer, küçükten büyüğe. */
export const presetOptions = (presets: readonly number[], current: number) =>
  [...new Set([...presets, current])].sort((a, b) => a - b);

const HHMM = /^(([01]\d|2[0-3]):(00|30)|24:00)$/;
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "api.invalidDate")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    "api.invalidDate",
  );
const windowSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    start: z.string().regex(HHMM, "api.availabilityTime"),
    end: z.string().regex(HHMM, "api.availabilityTime"),
  })
  .strict()
  .refine((w) => minutesOf(w.end) > minutesOf(w.start), {
    message: "api.availabilityOrder",
    path: ["end"],
  });
const blockSchema = z
  .object({ from: day, to: day })
  .strict()
  .refine((b) => b.to >= b.from, { message: "api.blockOrder", path: ["to"] });
const hours = z
  .number()
  .int()
  .min(0, "api.bookingHours")
  .max(168, "api.bookingHours");

/** Öğretmenin kaydettiği ayarların tamamı (PUT gövdesi). */
export const bookingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    durationMinutes: z
      .number()
      .int()
      .min(15, "api.bookingDuration")
      .max(180, "api.bookingDuration")
      .refine((v) => v % 5 === 0, "api.bookingDuration"),
    noticeHours: hours,
    cancelHours: hours,
    location: z.string().trim().max(100),
    windows: z.array(windowSchema).max(MAX_WINDOWS, "api.availabilityTooMany"),
    blocks: z.array(blockSchema).max(MAX_BLOCKS, "api.availabilityTooMany"),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    const index = findOverlap(v.windows);
    if (index !== -1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "api.availabilityOverlap",
        path: ["windows", index],
      });
  });
export const bookLessonSchema = z
  .object({ startsAt: z.string().datetime({ offset: true }) })
  .strict();
export const cancelBookingSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();

/** Şema hatalarını alan yoluna göre ("windows.2", "location") ilk iletiyle
 *  eşler; formlar hatayı ilgili satırın altında gösterir. */
export function settingsIssues(
  issues: readonly { path: (string | number)[]; message: string }[],
) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.slice(0, 2).join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Boş saatleri İstanbul takvim gününe göre gruplar; sıra korunur. */
export function groupSlotsByDay(slots: readonly BookingSlot[]) {
  const days: { day: string; slots: BookingSlot[] }[] = [];
  for (const slot of slots) {
    const key = dateKey(slot.startsAt);
    const last = days[days.length - 1];
    if (last && last.day === key) last.slots.push(slot);
    else days.push({ day: key, slots: [slot] });
  }
  return days;
}

/** Öğrencinin dersi en son iptal edebileceği an. */
export const cancelDeadline = (startsAt: string, cancelHours: number) =>
  new Date(Date.parse(startsAt) - cancelHours * 3_600_000);

/** Öğrenci bu dersi şimdi iptal edebilir mi. Kural API'deki
 *  derslik.cancel_booking ile aynı; son kararı sunucu verir. `now` çizim
 *  dışından gelir (bileşenler saati durumda tutar). */
export const canCancelBooking = (
  lesson: { status: string; starts_at: string; booked_by?: string | null },
  cancelHours: number,
  now: number,
) =>
  lesson.status === "SCHEDULED" &&
  !!lesson.booked_by &&
  now <= cancelDeadline(lesson.starts_at, cancelHours).getTime();

/** "9 Ekim Cuma 15:00" gibi gün ve saat, etkin dilde ve İstanbul saatiyle. */
export const dayTimeLabel = (iso: string) =>
  `${dayLabel(iso, { weekday: "long" })} ${timeLabel(iso)}`;

/** ISO hafta günü adı (1 = Pazartesi), etkin dilde. 1 Ocak 2024 Pazartesi. */
export const weekdayName = (
  weekday: number,
  style: "long" | "short" = "long",
) =>
  dayLabel(`2024-01-0${weekday}T12:00:00+03:00`, {
    weekday: style,
    day: undefined,
    month: undefined,
  });
```

`packages/contracts/src/index.ts` dosyasının sonuna ekle:

```ts
export * from "./booking.ts";
```

`package.json` → `scripts` içinde `"test:media"` satırının hemen altına ekle:

```json
    "test:booking": "node --experimental-strip-types --test tests/booking-rules.test.mjs",
```

`.github/workflows/ci.yml` dosyasında `Media config tests` adımının hemen altına ekle:

```yaml
      - name: Booking rules tests
        run: pnpm test:booking
```

- [ ] **Adım 4: Testin geçtiğini gör**

Run: `pnpm test:booking`
Expected: PASS (8 test).

Run: `pnpm typecheck`
Expected: Hata yok.

- [ ] **Adım 5: Commit**

```bash
git add packages/contracts/src/booking.ts packages/contracts/src/index.ts tests/booking-rules.test.mjs package.json .github/workflows/ci.yml
git commit -m "Ders ayarlama: ortak kurallar ve birim testleri

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 2: Yedi dilde metinler

**Files:**
- Modify: `packages/contracts/src/i18n/tr.ts`, `en.ts`, `de.ts`, `fr.ts`, `es.ts`, `zh.ts`, `ja.ts`

**Interfaces:**
- Produces: `api.availabilityOrder`, `api.availabilityOverlap`, `api.availabilityTime`, `api.availabilityTooMany`, `api.blockOrder`, `api.bookingCancelClosed`, `api.bookingDisabled`, `api.bookingDuration`, `api.bookingHours`, `api.bookingNoCredits`, `api.bookingNotYours`, `api.bookingSettingsChanged`, `api.bookingSlotTaken`, `notice.lessonBooked`, `notice.lessonCancelledByStudent` ve aşağıdaki `booking.*` anahtarlarının hepsi. Çoğul anahtarlar `count` alır: `booking.freeCredits`, `booking.hours`, `booking.hoursBefore`, `booking.minutes`. Yer tutucular: `booking.cancelBody` → `{when}`, `booking.cancelUntil` → `{time}`, `booking.rangeStart` ve `booking.rangeEnd` → `{day}`.

Her dosyada üç yere ekleme yapılır; bu satırlar yedi dosyada da birebir vardır:
1. `  api: {` satırının hemen altına `api` anahtarları.
2. `  notice: {` satırının hemen altına `notice` anahtarları.
3. `  calendar: {` satırının hemen üstüne `booking` bölümü.

Türkçe katalog biçimin kaynağıdır. Diğer diller eksik kalırsa `pnpm typecheck` hata verir. Bu görevin testi derlemedir.

- [ ] **Adım 1: Türkçe (`tr.ts`)**

`api` (en üste):

```ts
    availabilityOrder: "Aralığın bitişi başlangıcından sonra olmalı.",
    availabilityOverlap: "Aynı gündeki saat aralıkları çakışıyor.",
    availabilityTime:
      "Saatleri yarım saatlik dilimlerle seçin (ör. 15:00, 15:30).",
    availabilityTooMany:
      "En fazla 50 saat aralığı ve 50 kapalı gün eklenebilir.",
    blockOrder: "Kapalı günlerin bitiş tarihi başlangıcından önce olamaz.",
    bookingCancelClosed:
      "Bu dersin iptal süresi geçti. İptal için öğretmeninize yazın.",
    bookingDisabled: "Öğretmeniniz şu anda ders ayarlamaya kapalı.",
    bookingDuration:
      "Ders süresi 15 ile 180 dakika arasında ve 5'in katı olmalı.",
    bookingHours: "Süre 0 ile 168 saat arasında olmalı.",
    bookingNoCredits: "Boşta ders hakkınız yok. Öğretmeninizle görüşün.",
    bookingNotYours:
      "Bu dersi öğretmeniniz planladı. İptal için öğretmeninize yazın.",
    bookingSettingsChanged:
      "Ayarlar başka bir yerde değişti. Yeniden yükleyip tekrar deneyin.",
    bookingSlotTaken: "Bu saat artık boş değil. Lütfen başka bir saat seçin.",
```

`notice` (en üste):

```ts
    lessonBooked: "Öğrenci ders ayarladı",
    lessonCancelledByStudent: "Öğrenci dersi iptal etti",
```

`booking` (`  calendar: {` satırının üstüne):

```ts
  booking: {
    addClosedDays: "Kapalı gün ekle",
    addRange: "Aralık ekle",
    availability: "Müsaitlik",
    back: "Geri",
    book: "Ders ayarla",
    bookDescription: "Öğretmeninizin boş saatlerinden birini seçin.",
    booked: "Ders ayarlandı.",
    bookedByStudent: "Öğrenci ayarladı",
    bookedByYou: "Siz ayarladınız",
    cancel: "Dersi iptal et",
    cancelBody: "{when} dersi iptal edilecek. Ders hakkınız düşmez.",
    cancelClosed: "İptal için öğretmeninize yazın.",
    cancelTitle: "Ders iptal edilsin mi?",
    cancelUntil: "İptal için son an: {time}",
    cancelUntilStart: "Ders başlayana kadar",
    cancelWindow: "İptal için son süre",
    cancelled: "Ders iptal edildi.",
    closedDays: "Kapalı günler",
    closedDaysHint: "Tatil ve izin günlerinde öğrenciler ders ayarlayamaz.",
    confirm: "Ayarla",
    dayClosed: "Kapalı",
    description: "Öğrencilerinizin ders ayarlayabileceği boş saatleri girin.",
    duration: "Ders süresi",
    enabled: "Öğrenciler boş saatlerimden ders ayarlayabilsin",
    enabledHint:
      "Kapalıyken öğrenciler yeni ders ayarlayamaz; ayarlanmış dersler yerinde kalır.",
    freeCredits: {
      one: "Boşta {count} ders hakkınız var",
      other: "Boşta {count} ders hakkınız var",
    },
    from: "Başlangıç tarihi",
    hours: {
      one: "{count} saat",
      other: "{count} saat",
    },
    hoursBefore: {
      one: "{count} saat önce",
      other: "{count} saat önce",
    },
    location: "Ders yeri",
    locationPlaceholder: "Ör. Çevrim içi ya da adres",
    minutes: {
      one: "{count} dk",
      other: "{count} dk",
    },
    noClosedDays: "Kapalı gün eklenmedi.",
    noCredits: "Boşta ders hakkınız yok",
    noCreditsHint: "Yeni ders ayarlamak için öğretmeninizle görüşün.",
    noSlots: "Önümüzdeki 4 haftada boş saat yok",
    noSlotsHint: "Öğretmeniniz yeni saat açtığında burada görünür.",
    note: "Öğrenciler yalnızca boşta ders hakları varsa saat seçebilir. Kendi oluşturduğunuz dersler o saatleri kapatır.",
    notice: "En az ne kadar önceden",
    noticeNone: "Sınır yok",
    off: "Kapalı",
    on: "Açık",
    pickDay: "Gün seçin",
    pickTime: "Saat seçin",
    rangeEnd: "{day} bitiş saati",
    rangeStart: "{day} başlangıç saati",
    reload: "Yeniden yükle",
    removeClosedDays: "Kapalı günleri kaldır",
    removeRange: "Aralığı kaldır",
    saved: "Müsaitlik kaydedildi.",
    title: "Müsaitlik ve ders ayarlama",
    to: "Bitiş tarihi",
    weeklyHours: "Haftalık saatler",
    weeklyHoursHint: "Her hafta tekrar eden boş saatleriniz.",
    writeTeacher: "Öğretmeninize yazın",
  },
```

- [ ] **Adım 2: İngilizce (`en.ts`)**

`api`:

```ts
    availabilityOrder: "A time range must end after it starts.",
    availabilityOverlap: "Time ranges on the same day overlap.",
    availabilityTime: "Pick times in half-hour steps (e.g. 15:00, 15:30).",
    availabilityTooMany:
      "You can add up to 50 time ranges and 50 closed periods.",
    blockOrder: "A closed period cannot end before it starts.",
    bookingCancelClosed:
      "It's too late to cancel this lesson. Message your teacher to cancel.",
    bookingDisabled: "Your teacher isn't taking bookings right now.",
    bookingDuration:
      "Lesson length must be between 15 and 180 minutes, in steps of 5.",
    bookingHours: "Enter a value between 0 and 168 hours.",
    bookingNoCredits:
      "You have no lesson credits available. Talk to your teacher.",
    bookingNotYours:
      "Your teacher scheduled this lesson. Message your teacher to cancel.",
    bookingSettingsChanged:
      "These settings were changed elsewhere. Reload and try again.",
    bookingSlotTaken: "This time is no longer free. Please pick another time.",
```

`notice`:

```ts
    lessonBooked: "A student booked a lesson",
    lessonCancelledByStudent: "A student cancelled a lesson",
```

`booking`:

```ts
  booking: {
    addClosedDays: "Add closed days",
    addRange: "Add range",
    availability: "Availability",
    back: "Back",
    book: "Book a lesson",
    bookDescription: "Choose one of your teacher's free times.",
    booked: "Lesson booked.",
    bookedByStudent: "Booked by student",
    bookedByYou: "Booked by you",
    cancel: "Cancel lesson",
    cancelBody:
      "The lesson on {when} will be cancelled. You keep your lesson credit.",
    cancelClosed: "Message your teacher to cancel.",
    cancelTitle: "Cancel this lesson?",
    cancelUntil: "You can cancel until {time}",
    cancelUntilStart: "Until the lesson starts",
    cancelWindow: "Cancellation deadline",
    cancelled: "Lesson cancelled.",
    closedDays: "Closed days",
    closedDaysHint: "Students can't book lessons on holidays and days off.",
    confirm: "Book",
    dayClosed: "Closed",
    description: "Set the free times when your students can book lessons.",
    duration: "Lesson length",
    enabled: "Let students book lessons in my free times",
    enabledHint:
      "While this is off, students can't book new lessons; booked lessons stay as they are.",
    freeCredits: {
      one: "{count} lesson credit available",
      other: "{count} lesson credits available",
    },
    from: "Start date",
    hours: {
      one: "{count} hour",
      other: "{count} hours",
    },
    hoursBefore: {
      one: "{count} hour before",
      other: "{count} hours before",
    },
    location: "Lesson location",
    locationPlaceholder: "E.g. Online or an address",
    minutes: {
      one: "{count} min",
      other: "{count} min",
    },
    noClosedDays: "No closed days added.",
    noCredits: "No lesson credits available",
    noCreditsHint: "Talk to your teacher to book a new lesson.",
    noSlots: "No free times in the next 4 weeks",
    noSlotsHint: "New times will appear here when your teacher adds them.",
    note: "Students can only pick a time if they have lesson credits available. Lessons you create yourself block those times.",
    notice: "Minimum notice",
    noticeNone: "No minimum",
    off: "Off",
    on: "On",
    pickDay: "Choose a day",
    pickTime: "Choose a time",
    rangeEnd: "{day} end time",
    rangeStart: "{day} start time",
    reload: "Reload",
    removeClosedDays: "Remove closed days",
    removeRange: "Remove range",
    saved: "Availability saved.",
    title: "Availability and booking",
    to: "End date",
    weeklyHours: "Weekly hours",
    weeklyHoursHint: "Your free times that repeat every week.",
    writeTeacher: "Message your teacher",
  },
```

- [ ] **Adım 3: Almanca (`de.ts`)**

`api`:

```ts
    availabilityOrder: "Ein Zeitraum muss nach seinem Beginn enden.",
    availabilityOverlap: "Zeiträume am selben Tag überschneiden sich.",
    availabilityTime:
      "Wählen Sie Zeiten in halbstündigen Schritten (z. B. 15:00, 15:30).",
    availabilityTooMany:
      "Es sind höchstens 50 Zeiträume und 50 geschlossene Zeiträume möglich.",
    blockOrder: "Ein geschlossener Zeitraum kann nicht vor seinem Beginn enden.",
    bookingCancelClosed:
      "Die Frist zum Absagen dieser Stunde ist abgelaufen. Schreiben Sie Ihrer Lehrkraft, um abzusagen.",
    bookingDisabled: "Ihre Lehrkraft nimmt gerade keine Buchungen an.",
    bookingDuration:
      "Die Stundenlänge muss zwischen 15 und 180 Minuten liegen und durch 5 teilbar sein.",
    bookingHours: "Geben Sie einen Wert zwischen 0 und 168 Stunden ein.",
    bookingNoCredits:
      "Sie haben keine freien Stunden mehr. Sprechen Sie mit Ihrer Lehrkraft.",
    bookingNotYours:
      "Diese Stunde hat Ihre Lehrkraft geplant. Schreiben Sie Ihrer Lehrkraft, um abzusagen.",
    bookingSettingsChanged:
      "Die Einstellungen wurden an anderer Stelle geändert. Laden Sie neu und versuchen Sie es erneut.",
    bookingSlotTaken:
      "Diese Zeit ist nicht mehr frei. Bitte wählen Sie eine andere Zeit.",
```

`notice`:

```ts
    lessonBooked: "Ein Schüler hat eine Stunde gebucht",
    lessonCancelledByStudent: "Ein Schüler hat eine Stunde abgesagt",
```

`booking`:

```ts
  booking: {
    addClosedDays: "Geschlossene Tage hinzufügen",
    addRange: "Zeitraum hinzufügen",
    availability: "Verfügbarkeit",
    back: "Zurück",
    book: "Stunde buchen",
    bookDescription: "Wählen Sie eine der freien Zeiten Ihrer Lehrkraft.",
    booked: "Stunde gebucht.",
    bookedByStudent: "Vom Schüler gebucht",
    bookedByYou: "Von Ihnen gebucht",
    cancel: "Stunde absagen",
    cancelBody:
      "Die Stunde am {when} wird abgesagt. Ihr Stundenguthaben bleibt erhalten.",
    cancelClosed: "Schreiben Sie Ihrer Lehrkraft, um abzusagen.",
    cancelTitle: "Stunde absagen?",
    cancelUntil: "Absagen möglich bis {time}",
    cancelUntilStart: "Bis zum Stundenbeginn",
    cancelWindow: "Absagefrist",
    cancelled: "Stunde abgesagt.",
    closedDays: "Geschlossene Tage",
    closedDaysHint:
      "An Feiertagen und freien Tagen können Schüler keine Stunden buchen.",
    confirm: "Buchen",
    dayClosed: "Geschlossen",
    description:
      "Legen Sie die freien Zeiten fest, in denen Ihre Schüler Stunden buchen können.",
    duration: "Stundenlänge",
    enabled: "Schüler dürfen in meinen freien Zeiten Stunden buchen",
    enabledHint:
      "Solange dies aus ist, können Schüler keine neuen Stunden buchen; gebuchte Stunden bleiben bestehen.",
    freeCredits: {
      one: "{count} freie Stunde verfügbar",
      other: "{count} freie Stunden verfügbar",
    },
    from: "Startdatum",
    hours: {
      one: "{count} Stunde",
      other: "{count} Stunden",
    },
    hoursBefore: {
      one: "{count} Stunde vorher",
      other: "{count} Stunden vorher",
    },
    location: "Unterrichtsort",
    locationPlaceholder: "Z. B. Online oder eine Adresse",
    minutes: {
      one: "{count} Min.",
      other: "{count} Min.",
    },
    noClosedDays: "Keine geschlossenen Tage.",
    noCredits: "Keine freien Stunden verfügbar",
    noCreditsHint:
      "Sprechen Sie mit Ihrer Lehrkraft, um eine neue Stunde zu buchen.",
    noSlots: "In den nächsten 4 Wochen gibt es keine freien Zeiten",
    noSlotsHint:
      "Neue Zeiten erscheinen hier, sobald Ihre Lehrkraft sie freigibt.",
    note: "Schüler können nur eine Zeit wählen, wenn sie freie Stunden haben. Stunden, die Sie selbst anlegen, belegen diese Zeiten.",
    notice: "Mindestvorlauf",
    noticeNone: "Kein Mindestvorlauf",
    off: "Aus",
    on: "An",
    pickDay: "Tag wählen",
    pickTime: "Uhrzeit wählen",
    rangeEnd: "Endzeit am {day}",
    rangeStart: "Startzeit am {day}",
    reload: "Neu laden",
    removeClosedDays: "Geschlossene Tage entfernen",
    removeRange: "Zeitraum entfernen",
    saved: "Verfügbarkeit gespeichert.",
    title: "Verfügbarkeit und Buchung",
    to: "Enddatum",
    weeklyHours: "Wöchentliche Zeiten",
    weeklyHoursHint: "Ihre freien Zeiten, die sich jede Woche wiederholen.",
    writeTeacher: "Lehrkraft anschreiben",
  },
```

- [ ] **Adım 4: Fransızca (`fr.ts`)**

Katalogdaki öteki sorular gibi `?` işaretinden önce bölünmez boşluk gelir (` `).

`api`:

```ts
    availabilityOrder: "Une plage horaire doit se terminer après son début.",
    availabilityOverlap: "Des plages horaires du même jour se chevauchent.",
    availabilityTime:
      "Choisissez les heures par tranches d'une demi-heure (p. ex. 15:00, 15:30).",
    availabilityTooMany:
      "Vous pouvez ajouter au maximum 50 plages horaires et 50 périodes de fermeture.",
    blockOrder: "Une période de fermeture ne peut pas finir avant de commencer.",
    bookingCancelClosed:
      "Il est trop tard pour annuler ce cours. Écrivez à votre enseignant pour l'annuler.",
    bookingDisabled:
      "Votre enseignant n'accepte pas de réservations pour le moment.",
    bookingDuration:
      "La durée du cours doit être comprise entre 15 et 180 minutes, par pas de 5.",
    bookingHours: "Saisissez une valeur entre 0 et 168 heures.",
    bookingNoCredits:
      "Vous n'avez plus de séance disponible. Parlez-en à votre enseignant.",
    bookingNotYours:
      "Ce cours a été planifié par votre enseignant. Écrivez-lui pour l'annuler.",
    bookingSettingsChanged:
      "Ces réglages ont été modifiés ailleurs. Rechargez puis réessayez.",
    bookingSlotTaken:
      "Ce créneau n'est plus libre. Veuillez en choisir un autre.",
```

`notice`:

```ts
    lessonBooked: "Un élève a réservé un cours",
    lessonCancelledByStudent: "Un élève a annulé un cours",
```

`booking`:

```ts
  booking: {
    addClosedDays: "Ajouter des jours de fermeture",
    addRange: "Ajouter une plage",
    availability: "Disponibilités",
    back: "Retour",
    book: "Réserver un cours",
    bookDescription: "Choisissez l'un des créneaux libres de votre enseignant.",
    booked: "Cours réservé.",
    bookedByStudent: "Réservé par l'élève",
    bookedByYou: "Réservé par vous",
    cancel: "Annuler le cours",
    cancelBody:
      "Le cours du {when} sera annulé. Votre séance n'est pas décomptée.",
    cancelClosed: "Écrivez à votre enseignant pour annuler.",
    cancelTitle: "Annuler ce cours ?",
    cancelUntil: "Annulation possible jusqu'au {time}",
    cancelUntilStart: "Jusqu'au début du cours",
    cancelWindow: "Délai d'annulation",
    cancelled: "Cours annulé.",
    closedDays: "Jours de fermeture",
    closedDaysHint:
      "Les élèves ne peuvent pas réserver pendant les vacances et les jours de repos.",
    confirm: "Réserver",
    dayClosed: "Fermé",
    description:
      "Indiquez les créneaux libres où vos élèves peuvent réserver un cours.",
    duration: "Durée du cours",
    enabled: "Permettre aux élèves de réserver sur mes créneaux libres",
    enabledHint:
      "Désactivé, les élèves ne peuvent plus réserver. Les cours déjà réservés restent en place.",
    freeCredits: {
      one: "{count} séance disponible",
      other: "{count} séances disponibles",
    },
    from: "Date de début",
    hours: {
      one: "{count} heure",
      other: "{count} heures",
    },
    hoursBefore: {
      one: "{count} heure avant",
      other: "{count} heures avant",
    },
    location: "Lieu du cours",
    locationPlaceholder: "P. ex. en ligne ou une adresse",
    minutes: {
      one: "{count} min",
      other: "{count} min",
    },
    noClosedDays: "Aucun jour de fermeture.",
    noCredits: "Aucune séance disponible",
    noCreditsHint: "Parlez-en à votre enseignant pour réserver un nouveau cours.",
    noSlots: "Aucun créneau libre dans les 4 prochaines semaines",
    noSlotsHint:
      "Les nouveaux créneaux apparaîtront ici quand votre enseignant les ajoutera.",
    note: "Les élèves ne peuvent choisir un créneau que s'ils ont des séances disponibles. Les cours que vous créez vous-même bloquent ces créneaux.",
    notice: "Délai minimum de réservation",
    noticeNone: "Aucun délai",
    off: "Désactivé",
    on: "Activé",
    pickDay: "Choisissez un jour",
    pickTime: "Choisissez une heure",
    rangeEnd: "{day}, heure de fin",
    rangeStart: "{day}, heure de début",
    reload: "Recharger",
    removeClosedDays: "Retirer les jours de fermeture",
    removeRange: "Retirer la plage",
    saved: "Disponibilités enregistrées.",
    title: "Disponibilités et réservations",
    to: "Date de fin",
    weeklyHours: "Horaires hebdomadaires",
    weeklyHoursHint: "Vos créneaux libres qui se répètent chaque semaine.",
    writeTeacher: "Écrire à votre enseignant",
  },
```

- [ ] **Adım 5: İspanyolca (`es.ts`)**

`api`:

```ts
    availabilityOrder: "Un intervalo debe terminar después de empezar.",
    availabilityOverlap: "Hay intervalos del mismo día que se solapan.",
    availabilityTime:
      "Elige las horas en tramos de media hora (p. ej., 15:00, 15:30).",
    availabilityTooMany:
      "Puedes añadir como máximo 50 intervalos y 50 periodos cerrados.",
    blockOrder: "Un periodo cerrado no puede terminar antes de empezar.",
    bookingCancelClosed:
      "Ya no puedes cancelar esta clase. Escribe a tu profesor para cancelarla.",
    bookingDisabled: "Tu profesor no acepta reservas en este momento.",
    bookingDuration:
      "La duración de la clase debe estar entre 15 y 180 minutos, en múltiplos de 5.",
    bookingHours: "Introduce un valor entre 0 y 168 horas.",
    bookingNoCredits: "No tienes clases disponibles. Habla con tu profesor.",
    bookingNotYours:
      "Esta clase la programó tu profesor. Escríbele para cancelarla.",
    bookingSettingsChanged:
      "Estos ajustes se cambiaron en otro lugar. Recarga e inténtalo de nuevo.",
    bookingSlotTaken: "Esta hora ya no está libre. Elige otra hora.",
```

`notice`:

```ts
    lessonBooked: "Un alumno reservó una clase",
    lessonCancelledByStudent: "Un alumno canceló una clase",
```

`booking`:

```ts
  booking: {
    addClosedDays: "Añadir días cerrados",
    addRange: "Añadir intervalo",
    availability: "Disponibilidad",
    back: "Atrás",
    book: "Reservar clase",
    bookDescription: "Elige una de las horas libres de tu profesor.",
    booked: "Clase reservada.",
    bookedByStudent: "Reservada por el alumno",
    bookedByYou: "Reservada por ti",
    cancel: "Cancelar clase",
    cancelBody:
      "Se cancelará la clase del {when}. No perderás la clase de tu paquete.",
    cancelClosed: "Escribe a tu profesor para cancelarla.",
    cancelTitle: "¿Cancelar esta clase?",
    cancelUntil: "Puedes cancelar hasta el {time}",
    cancelUntilStart: "Hasta que empiece la clase",
    cancelWindow: "Plazo de cancelación",
    cancelled: "Clase cancelada.",
    closedDays: "Días cerrados",
    closedDaysHint:
      "En vacaciones y días libres los alumnos no pueden reservar clases.",
    confirm: "Reservar",
    dayClosed: "Cerrado",
    description:
      "Indica las horas libres en las que tus alumnos pueden reservar clases.",
    duration: "Duración de la clase",
    enabled: "Permitir que los alumnos reserven en mis horas libres",
    enabledHint:
      "Mientras esté desactivado, los alumnos no pueden reservar clases nuevas; las ya reservadas se mantienen.",
    freeCredits: {
      one: "Tienes {count} clase disponible",
      other: "Tienes {count} clases disponibles",
    },
    from: "Fecha de inicio",
    hours: {
      one: "{count} hora",
      other: "{count} horas",
    },
    hoursBefore: {
      one: "{count} hora antes",
      other: "{count} horas antes",
    },
    location: "Lugar de la clase",
    locationPlaceholder: "P. ej., en línea o una dirección",
    minutes: {
      one: "{count} min",
      other: "{count} min",
    },
    noClosedDays: "No hay días cerrados.",
    noCredits: "No tienes clases disponibles",
    noCreditsHint: "Habla con tu profesor para reservar una clase nueva.",
    noSlots: "No hay horas libres en las próximas 4 semanas",
    noSlotsHint: "Las nuevas horas aparecerán aquí cuando tu profesor las añada.",
    note: "Los alumnos solo pueden elegir una hora si tienen clases disponibles. Las clases que creas tú bloquean esas horas.",
    notice: "Antelación mínima",
    noticeNone: "Sin mínimo",
    off: "Desactivada",
    on: "Activada",
    pickDay: "Elige un día",
    pickTime: "Elige una hora",
    rangeEnd: "{day}: hora de fin",
    rangeStart: "{day}: hora de inicio",
    reload: "Recargar",
    removeClosedDays: "Quitar días cerrados",
    removeRange: "Quitar intervalo",
    saved: "Disponibilidad guardada.",
    title: "Disponibilidad y reservas",
    to: "Fecha de fin",
    weeklyHours: "Horario semanal",
    weeklyHoursHint: "Tus horas libres que se repiten cada semana.",
    writeTeacher: "Escribir a tu profesor",
  },
```

- [ ] **Adım 6: Çince (`zh.ts`)**

Çincede çoğul yalnızca `other` biçimindedir.

`api`:

```ts
    availabilityOrder: "时间段的结束时间必须晚于开始时间。",
    availabilityOverlap: "同一天的时间段有重叠。",
    availabilityTime: "请以半小时为单位选择时间（如 15:00、15:30）。",
    availabilityTooMany: "最多可添加 50 个时间段和 50 个休息时段。",
    blockOrder: "休息时段的结束日期不能早于开始日期。",
    bookingCancelClosed: "已过取消期限。如需取消，请给老师发消息。",
    bookingDisabled: "老师目前不接受预约。",
    bookingDuration: "课程时长须在 15 到 180 分钟之间，且为 5 的倍数。",
    bookingHours: "请输入 0 到 168 小时之间的数值。",
    bookingNoCredits: "你没有可用课时。请与老师沟通。",
    bookingNotYours: "这节课由老师安排。如需取消，请给老师发消息。",
    bookingSettingsChanged: "设置已在其他地方更改。请重新加载后再试。",
    bookingSlotTaken: "这个时间已被占用，请选择其他时间。",
```

`notice`:

```ts
    lessonBooked: "学生预约了课程",
    lessonCancelledByStudent: "学生取消了课程",
```

`booking`:

```ts
  booking: {
    addClosedDays: "添加休息日",
    addRange: "添加时间段",
    availability: "可预约时间",
    back: "返回",
    book: "预约课程",
    bookDescription: "从老师的空闲时间中选择一个。",
    booked: "已预约课程。",
    bookedByStudent: "学生预约",
    bookedByYou: "你预约的",
    cancel: "取消课程",
    cancelBody: "{when} 的课程将被取消，你的课时不会被扣除。",
    cancelClosed: "如需取消，请给老师发消息。",
    cancelTitle: "取消这节课？",
    cancelUntil: "可取消截止：{time}",
    cancelUntilStart: "直到上课开始",
    cancelWindow: "取消期限",
    cancelled: "课程已取消。",
    closedDays: "休息日",
    closedDaysHint: "节假日和休息日学生无法预约课程。",
    confirm: "预约",
    dayClosed: "休息",
    description: "设置学生可以预约课程的空闲时间。",
    duration: "课程时长",
    enabled: "允许学生在我的空闲时间预约课程",
    enabledHint: "关闭后学生无法预约新课程，已预约的课程保持不变。",
    freeCredits: {
      other: "可用课时 {count} 节",
    },
    from: "开始日期",
    hours: {
      other: "{count} 小时",
    },
    hoursBefore: {
      other: "提前 {count} 小时",
    },
    location: "上课地点",
    locationPlaceholder: "如：线上或地址",
    minutes: {
      other: "{count} 分钟",
    },
    noClosedDays: "未添加休息日。",
    noCredits: "没有可用课时",
    noCreditsHint: "请与老师沟通后再预约新课程。",
    noSlots: "未来 4 周没有空闲时间",
    noSlotsHint: "老师开放新的时间后会显示在这里。",
    note: "学生只有在有可用课时时才能选择时间。你自己创建的课程会占用这些时间。",
    notice: "最少提前预约时间",
    noticeNone: "不限",
    off: "已关闭",
    on: "已开启",
    pickDay: "选择日期",
    pickTime: "选择时间",
    rangeEnd: "{day}结束时间",
    rangeStart: "{day}开始时间",
    reload: "重新加载",
    removeClosedDays: "移除休息日",
    removeRange: "移除时间段",
    saved: "可预约时间已保存。",
    title: "可预约时间与课程预约",
    to: "结束日期",
    weeklyHours: "每周时间",
    weeklyHoursHint: "每周重复的空闲时间。",
    writeTeacher: "给老师发消息",
  },
```

- [ ] **Adım 7: Japonca (`ja.ts`)**

Japoncada çoğul yalnızca `other` biçimindedir.

`api`:

```ts
    availabilityOrder: "時間帯の終了は開始より後にしてください。",
    availabilityOverlap: "同じ日の時間帯が重なっています。",
    availabilityTime: "時刻は30分単位で選んでください（例: 15:00、15:30）。",
    availabilityTooMany: "時間帯と休業期間はそれぞれ50件まで追加できます。",
    blockOrder: "休業期間の終了日は開始日より前にできません。",
    bookingCancelClosed:
      "この授業のキャンセル期限を過ぎています。キャンセルするには講師にメッセージを送ってください。",
    bookingDisabled: "講師は現在予約を受け付けていません。",
    bookingDuration: "授業時間は15〜180分の範囲で、5分単位にしてください。",
    bookingHours: "0〜168時間の範囲で入力してください。",
    bookingNoCredits: "利用できる授業回数がありません。講師に相談してください。",
    bookingNotYours:
      "この授業は講師が予定したものです。キャンセルするには講師にメッセージを送ってください。",
    bookingSettingsChanged:
      "設定が別の場所で変更されました。再読み込みしてもう一度お試しください。",
    bookingSlotTaken: "この時間はすでに埋まりました。別の時間を選んでください。",
```

`notice`:

```ts
    lessonBooked: "生徒が授業を予約しました",
    lessonCancelledByStudent: "生徒が授業をキャンセルしました",
```

`booking`:

```ts
  booking: {
    addClosedDays: "休業日を追加",
    addRange: "時間帯を追加",
    availability: "空き時間",
    back: "戻る",
    book: "授業を予約",
    bookDescription: "講師の空き時間から1つ選んでください。",
    booked: "授業を予約しました。",
    bookedByStudent: "生徒が予約",
    bookedByYou: "あなたが予約",
    cancel: "授業をキャンセル",
    cancelBody: "{when}の授業がキャンセルされます。授業回数は減りません。",
    cancelClosed: "キャンセルするには講師にメッセージを送ってください。",
    cancelTitle: "この授業をキャンセルしますか？",
    cancelUntil: "キャンセル期限: {time}",
    cancelUntilStart: "授業開始まで",
    cancelWindow: "キャンセル期限",
    cancelled: "授業をキャンセルしました。",
    closedDays: "休業日",
    closedDaysHint: "休日や休みの日は生徒が授業を予約できません。",
    confirm: "予約する",
    dayClosed: "休み",
    description: "生徒が授業を予約できる空き時間を設定します。",
    duration: "授業時間",
    enabled: "空き時間に生徒が授業を予約できるようにする",
    enabledHint:
      "オフの間は生徒は新しい授業を予約できません。予約済みの授業はそのまま残ります。",
    freeCredits: {
      other: "利用できる授業 {count} 回",
    },
    from: "開始日",
    hours: {
      other: "{count} 時間",
    },
    hoursBefore: {
      other: "{count} 時間前",
    },
    location: "授業の場所",
    locationPlaceholder: "例: オンラインまたは住所",
    minutes: {
      other: "{count} 分",
    },
    noClosedDays: "休業日はありません。",
    noCredits: "利用できる授業回数がありません",
    noCreditsHint: "新しい授業を予約するには講師に相談してください。",
    noSlots: "今後4週間に空き時間はありません",
    noSlotsHint: "講師が新しい時間を開けるとここに表示されます。",
    note: "生徒は利用できる授業回数がある場合にのみ時間を選べます。ご自身で作成した授業はその時間を埋めます。",
    notice: "予約受付の締め切り",
    noticeNone: "制限なし",
    off: "オフ",
    on: "オン",
    pickDay: "日付を選択",
    pickTime: "時間を選択",
    rangeEnd: "{day}の終了時刻",
    rangeStart: "{day}の開始時刻",
    reload: "再読み込み",
    removeClosedDays: "休業日を削除",
    removeRange: "時間帯を削除",
    saved: "空き時間を保存しました。",
    title: "空き時間と予約",
    to: "終了日",
    weeklyHours: "毎週の時間",
    weeklyHoursHint: "毎週繰り返される空き時間です。",
    writeTeacher: "講師にメッセージを送る",
  },
```

- [ ] **Adım 8: Derlemenin geçtiğini gör**

Run: `pnpm typecheck && pnpm mobile:typecheck`
Expected: Hata yok. Bir dilde anahtar eksikse `Property 'booking' is missing` ya da `… is missing in type` hatası görülür; o dosyayı düzeltin.

Run: `pnpm test:booking`
Expected: PASS.

- [ ] **Adım 9: Commit**

```bash
git add packages/contracts/src/i18n
git commit -m "Ders ayarlama: yedi dilde metinler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 3: Müsaitlik tabloları ve öğretmen ayarları API'si

**Files:**
- Create: `apps/api/drizzle/0017_booking_settings.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0017_snapshot.json`
- Modify: `apps/api/src/db/schema.ts` (`lessons` tablosu)
- Modify: `packages/contracts/src/types.ts` (`Lesson`)
- Create: `apps/api/src/booking/booking.service.ts`
- Create: `apps/api/src/booking/booking.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/tests/booking-cases.mjs`
- Modify: `apps/api/tests/integration.test.mjs`

**Interfaces:**
- Consumes: Görev 1'den `bookingSettingsSchema`, `defaultBookingSettings`, `minutesOf`, `timeOf` ve `BookingSettings`.
- Produces:
  - `GET /v1/workspaces/:ws/booking` → `{ data: BookingSettings }`.
  - `PUT /v1/workspaces/:ws/booking` (gövde `BookingSettings`) → `{ data: BookingSettings }`. Yanıt 200, sürüm uyuşmazsa 409 `api.bookingSettingsChanged`.
  - Tablolar: `derslik.booking_settings`, `derslik.availability_windows`, `derslik.availability_blocks`.
  - `derslik.lessons.booked_by` sütunu ve `Lesson.booked_by?: string | null` tipi.
  - `BookingService` sınıfı: `settings(actor, ws)` ve `saveSettings(actor, ws, input)`.

- [ ] **Adım 1: Başarısız testi yaz**

`apps/api/tests/booking-cases.mjs`:

```js
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Öğrencinin boş saatten ders ayarlaması: öğretmen ayarları, boş saatler,
// ayarlama ve iptal. Saatler bugüne göre hesaplanır; İstanbul UTC+3'tür.
const DAY = 86_400_000,
  HOUR = 3_600_000;
/** Bugünden `offset` gün sonraki İstanbul takvim günü (YYYY-MM-DD). */
const istanbulDay = (offset = 0) =>
  new Date(Date.now() + 3 * HOUR + offset * DAY).toISOString().slice(0, 10);

export async function bookingCases({ t, request, ok, token }) {
  const teacher = randomUUID(),
    pupil = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil);
  let ws,
    base,
    version = 0;
  const save = (body) =>
    request(`${base}/booking`, { method: "PUT", body, auth: tokenTeacher });
  const settings = (overrides = {}) => ({
    enabled: true,
    durationMinutes: 60,
    noticeHours: 0,
    cancelHours: 24,
    location: "Çevrim içi",
    windows: [],
    blocks: [],
    version,
    ...overrides,
  });
  /** Ayarları kaydeder ve yeni sürümü saklar. */
  const configure = async (overrides = {}) => {
    const r = await save(settings(overrides));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    version = r.body.data.version;
    return r.body.data;
  };

  await t.test("öğretmen müsaitliğini sürüm kontrolüyle kaydeder", async () => {
    ws = (
      await ok("/v1/workspaces", { name: "Ayarlama Hoca" }, { auth: tokenTeacher })
    ).data.id;
    base = `/v1/workspaces/${ws}`;
    // Hiç kaydedilmemiş ayar varsayılanlarla gelir.
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      {
        enabled: false,
        durationMinutes: 60,
        noticeHours: 12,
        cancelHours: 24,
        location: "",
        windows: [],
        blocks: [],
        version: 0,
      },
    );
    const saved = await configure({
      windows: [
        { weekday: 3, start: "19:00", end: "21:00" },
        { weekday: 1, start: "10:00", end: "12:00" },
      ],
      blocks: [
        { from: istanbulDay(-10), to: istanbulDay(-3) },
        { from: istanbulDay(-1), to: istanbulDay(2) },
      ],
    });
    assert.equal(saved.version, 1);
    // Aralıklar gün ve saate göre sıralanır; bitmiş kapalı günler atılır.
    assert.deepEqual(saved.windows, [
      { weekday: 1, start: "10:00", end: "12:00" },
      { weekday: 3, start: "19:00", end: "21:00" },
    ]);
    assert.deepEqual(saved.blocks, [
      { from: istanbulDay(-1), to: istanbulDay(2) },
    ]);
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      saved,
    );
    // Eski sürümle ya da ikinci kez "ilk kayıt" olarak kayıt reddedilir.
    for (const stale of [0, 5]) {
      const r = await save(settings({ version: stale }));
      assert.equal(r.status, 409);
      assert.match(r.body.error.message, /başka bir yerde değişti/);
    }
    const overlap = await save(
      settings({
        windows: [
          { weekday: 2, start: "10:00", end: "12:00" },
          { weekday: 2, start: "11:00", end: "13:00" },
        ],
      }),
    );
    assert.equal(overlap.status, 400);
    assert.match(JSON.stringify(overlap.body.error.details), /çakışıyor/);
    assert.equal(
      (
        await save(
          settings({ windows: [{ weekday: 2, start: "10:15", end: "12:00" }] }),
        )
      ).status,
      400,
    );
    // Başka hesap bu ayarları okuyamaz ve değiştiremez.
    assert.equal(
      (await request(`${base}/booking`, { auth: tokenPupil })).status,
      403,
    );
    assert.equal(
      (
        await request(`${base}/booking`, {
          method: "PUT",
          body: settings(),
          auth: tokenPupil,
        })
      ).status,
      403,
    );
  });
}
```

`apps/api/tests/integration.test.mjs` dosyasında:
1. İçe aktarmalara, `import { calendarCases } from "./calendar-cases.mjs";` satırının altına ekle:

```js
import { bookingCases } from "./booking-cases.mjs";
```

2. `await calendarCases({ … });` çağrısının hemen altına ekle:

```js
      await bookingCases({ t, app, admin, request, ok, token });
```

- [ ] **Adım 2: Testin başarısız olduğunu gör**

Run: `pnpm test`
Expected: FAIL. `öğretmen müsaitliğini sürüm kontrolüyle kaydeder` testi `/v1/workspaces/<id>/booking: 400` hatası verir; çünkü bu adresi şimdilik `ApiController` içindeki `workspaces/:ws/:resource` ucu yakalıyor.

- [ ] **Adım 3: Göçü yaz**

`apps/api/drizzle/0017_booking_settings.sql`:

```sql
-- Öğrencinin boş saatten ders ayarlaması (1/2): öğretmen ayarları. Öğretmen
-- haftalık boş saatlerini, kapalı günlerini ve kurallarını girer. Tablolar
-- yalnızca öğretmene açıktır; öğrenci bunlara 0018'deki fonksiyonlarla ulaşır.
CREATE TABLE derslik.booking_settings (
 workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),
 enabled boolean NOT NULL DEFAULT false,
 duration_minutes int NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 180 AND duration_minutes%5=0),
 notice_hours int NOT NULL DEFAULT 12 CHECK(notice_hours BETWEEN 0 AND 168),
 cancel_hours int NOT NULL DEFAULT 24 CHECK(cancel_hours BETWEEN 0 AND 168),
 location text NOT NULL DEFAULT '' CHECK(char_length(location)<=100),
 version int NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Haftanın günü ISO'dur (1 = Pazartesi); saatler İstanbul saatiyle gün
-- başından dakikadır. Aynı gündeki aralıklar çakışamaz.
CREATE TABLE derslik.availability_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
 weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 start_minute smallint NOT NULL CHECK(start_minute BETWEEN 0 AND 1410 AND start_minute%30=0),
 end_minute smallint NOT NULL CHECK(end_minute BETWEEN 30 AND 1440 AND end_minute%30=0),
 CHECK(end_minute>start_minute),
 CONSTRAINT availability_no_overlap EXCLUDE USING gist(workspace_id WITH =,weekday WITH =,int4range(start_minute,end_minute) WITH &&)
);
-- Kapalı günler; iki uç da dahildir.
CREATE TABLE derslik.availability_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 CHECK(ends_on>=starts_on)
);
CREATE INDEX availability_blocks_workspace ON derslik.availability_blocks(workspace_id,ends_on);
-- Dersi ayarlayan öğrenci hesabı; boşsa dersi öğretmen oluşturmuştur.
ALTER TABLE derslik.lessons ADD COLUMN booked_by uuid REFERENCES derslik.users(id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['booking_settings','availability_windows','availability_blocks'] LOOP
  EXECUTE format('ALTER TABLE derslik.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE derslik.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_all ON derslik.%I FOR ALL USING (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id)) WITH CHECK (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id))',t);
 END LOOP;
END $$;
REVOKE ALL ON derslik.booking_settings,derslik.availability_windows,derslik.availability_blocks FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON derslik.booking_settings TO derslik_app;
GRANT SELECT,INSERT,DELETE ON derslik.availability_windows,derslik.availability_blocks TO derslik_app;
```

`apps/api/drizzle/meta/_journal.json` dosyasında `0016_message_events` kaydının arkasına virgül koy ve şu kaydı ekle:

```json
    {
      "idx": 17,
      "version": "7",
      "when": 1789640000000,
      "tag": "0017_booking_settings",
      "breakpoints": true
    }
```

Anlık görüntü dosyası, önceki göçlerdeki gibi bir öncekinin kopyasıdır. Yalnızca `id` ve `prevId` değişir:

```bash
node -e 'const fs=require("node:fs"),dir="apps/api/drizzle/meta/";const prev=JSON.parse(fs.readFileSync(dir+"0016_snapshot.json","utf8"));fs.writeFileSync(dir+"0017_snapshot.json",JSON.stringify({...prev,id:require("node:crypto").randomUUID(),prevId:prev.id},null,2)+"\n")'
```

`apps/api/src/db/schema.ts` dosyasında `lessons` tablosuna, `remindedAt` satırının altına ekle:

```ts
    bookedBy: uuid("booked_by").references(() => users.id),
```

`packages/contracts/src/types.ts` dosyasında `Lesson` tipine, `makeup_for_id?: string | null;` satırının altına ekle:

```ts
  /** Dersi öğretmenin boş saatinden ayarlayan öğrenci hesabı; öğretmen
   *  planladıysa null. */
  booked_by?: string | null;
```

- [ ] **Adım 4: Servisi ve uç noktaları yaz**

`apps/api/src/booking/booking.service.ts`:

```ts
import { ConflictException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { ISTANBUL_TODAY } from "../learning/learning.service.js";
import { istanbulDay } from "../lessons/lessons.service.js";
import {
  bookingSettingsSchema,
  defaultBookingSettings,
  minutesOf,
  timeOf,
  type BookingSettings,
} from "../../../../packages/contracts/src/booking.js";

/** Öğretmenin ayarları; hiç kaydedilmemişse varsayılanlar (sürüm 0).
 *  Bitişi geçmiş kapalı günler gelmez. */
async function readSettings(
  tx: PoolClient,
  ws: string,
): Promise<BookingSettings> {
  const row = (
    await tx.query(
      "SELECT enabled,duration_minutes,notice_hours,cancel_hours,location,version FROM derslik.booking_settings WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0];
  if (!row) return defaultBookingSettings();
  const windows = (
    await tx.query(
      "SELECT weekday,start_minute,end_minute FROM derslik.availability_windows WHERE workspace_id=$1 ORDER BY weekday,start_minute",
      [ws],
    )
  ).rows;
  const blocks = (
    await tx.query(
      `SELECT starts_on,ends_on FROM derslik.availability_blocks WHERE workspace_id=$1 AND ends_on>=${ISTANBUL_TODAY} ORDER BY starts_on,ends_on`,
      [ws],
    )
  ).rows;
  return {
    enabled: row.enabled,
    durationMinutes: row.duration_minutes,
    noticeHours: row.notice_hours,
    cancelHours: row.cancel_hours,
    location: row.location,
    windows: windows.map((w) => ({
      weekday: w.weekday,
      start: timeOf(w.start_minute),
      end: timeOf(w.end_minute),
    })),
    blocks: blocks.map((b) => ({ from: b.starts_on, to: b.ends_on })),
    version: row.version,
  };
}

@Injectable()
export class BookingService {
  constructor(private readonly db: DatabaseService) {}

  settings(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => ({
      data: await readSettings(tx, ws),
    }));
  }

  /** Ayarların tamamını değiştirir. Sürüm GET'ten gelir: satır yoksa 0
   *  beklenir ve satır sürüm 1 ile eklenir; varsa yalnızca aynı sürüm
   *  güncellenir. Ayar satırının kilidi, aynı anda ders ayarlayan öğrenciyi
   *  (derslik.book_lesson, FOR SHARE) bu kayıt bitene kadar bekletir. */
  saveSettings(actor: Actor, ws: string, input: unknown) {
    const c = bookingSettingsSchema.parse(input);
    const today = istanbulDay(new Date());
    return this.db.transaction(actor, ws, async (tx) => {
      const values = [
        ws,
        c.enabled,
        c.durationMinutes,
        c.noticeHours,
        c.cancelHours,
        c.location,
      ];
      const saved = (
        c.version === 0
          ? await tx.query(
              `INSERT INTO derslik.booking_settings(workspace_id,enabled,duration_minutes,notice_hours,cancel_hours,location,version)
               VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT (workspace_id) DO NOTHING RETURNING version`,
              values,
            )
          : await tx.query(
              `UPDATE derslik.booking_settings SET enabled=$2,duration_minutes=$3,notice_hours=$4,cancel_hours=$5,
                 location=$6,version=version+1,updated_at=now()
               WHERE workspace_id=$1 AND version=$7 RETURNING version`,
              [...values, c.version],
            )
      ).rows[0];
      if (!saved) throw new ConflictException("api.bookingSettingsChanged");
      await tx.query(
        "DELETE FROM derslik.availability_windows WHERE workspace_id=$1",
        [ws],
      );
      await tx.query(
        "DELETE FROM derslik.availability_blocks WHERE workspace_id=$1",
        [ws],
      );
      for (const w of c.windows)
        await tx.query(
          "INSERT INTO derslik.availability_windows(workspace_id,weekday,start_minute,end_minute) VALUES($1,$2,$3,$4)",
          [ws, w.weekday, minutesOf(w.start), minutesOf(w.end)],
        );
      // Bitişi geçmiş kapalı günler saklanmaz.
      for (const b of c.blocks.filter((b) => b.to >= today))
        await tx.query(
          "INSERT INTO derslik.availability_blocks(workspace_id,starts_on,ends_on) VALUES($1,$2,$3)",
          [ws, b.from, b.to],
        );
      await tx.query(
        "INSERT INTO derslik.audit_events (workspace_id,actor_id,action,resource_id,metadata) VALUES ($1,$2,$3,$4,$5)",
        [
          ws,
          actor.id,
          "booking.save",
          ws,
          JSON.stringify({
            enabled: c.enabled,
            windows: c.windows.length,
            blocks: c.blocks.length,
          }),
        ],
      );
      return { data: await readSettings(tx, ws) };
    });
  }
}
```

`apps/api/src/booking/booking.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { BookingService } from "./booking.service.js";

/** Öğrencinin boş saatten ders ayarlaması. ApiController'daki
 *  `workspaces/:ws/:resource` ucundan önce kaydedilir (app.module.ts). */
@Controller("v1")
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly booking: BookingService) {}
  @Get("workspaces/:ws/booking") settings(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ) {
    return this.booking.settings(req.actor, uuid.parse(ws));
  }
  @Put("workspaces/:ws/booking") save(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Body() body: unknown,
  ) {
    return this.booking.saveSettings(req.actor, uuid.parse(ws), body);
  }
}
```

`apps/api/src/app.module.ts`:
1. İçe aktarmaların sonuna ekle:

```ts
import { BookingController } from "./booking/booking.controller.js";
import { BookingService } from "./booking/booking.service.js";
```

2. `controllers` dizisinde `RealtimeController,` satırının altına (yani `ApiController` satırından önce) `BookingController,` ekle.
3. `providers` dizisinde `RealtimeService,` satırının altına `BookingService,` ekle.

- [ ] **Adım 5: Testin geçtiğini gör**

Run: `pnpm test`
Expected: PASS. Yeni test dahil bütün entegrasyon testleri geçer. Göçler iki kez çalışır ve ikinci çalıştırmada değişiklik yapılmaz.

Run: `pnpm typecheck && pnpm test:architecture`
Expected: Hata yok.

- [ ] **Adım 6: Commit**

```bash
git add apps/api/drizzle apps/api/src/db/schema.ts packages/contracts/src/types.ts apps/api/src/booking apps/api/src/app.module.ts apps/api/tests/booking-cases.mjs apps/api/tests/integration.test.mjs
git commit -m "Ders ayarlama: müsaitlik tabloları ve öğretmen ayarları API'si

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 4: Boş saat, ayarlama ve iptal API'si

**Files:**
- Create: `apps/api/drizzle/0018_lesson_booking.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0018_snapshot.json`
- Modify: `apps/api/src/booking/booking.service.ts` (tamamı değişir)
- Modify: `apps/api/src/booking/booking.controller.ts` (tamamı değişir)
- Modify: `apps/api/src/learning/learning.service.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `apps/api/tests/booking-cases.mjs` (tamamı değişir)

**Interfaces:**
- Consumes:
  - Görev 1'den `bookLessonSchema`, `cancelBookingSchema`.
  - Görev 3'ten tablolar, `readSettings` ve `BookingService.settings/saveSettings`.
  - Mevcut `CommandService.run(actor, ws, key, payload, execute, portal)` ve `DatabaseService.portalTransaction(actor, ws, student, permission, fn, write)`.
- Produces:
  - `GET /v1/portal/:ws/:student/booking/slots` → `{ data: BookingSlots }`.
  - `POST /v1/portal/:ws/:student/booking` (gövde `{ startsAt }`, başlık `Idempotency-Key`) → 201, `{ data: Lesson (camelCase), replayed }`.
  - `POST /v1/portal/:ws/:student/booking/:lesson/cancel` (gövde `{ version }`) → 201, `{ data: Lesson, replayed }`.
  - Portal yanıtı (`GET /v1/portal/:ws/:student`): `booking: { enabled, cancelHours } | null` ve her derste `booked_by`.
  - `DerslikClient.booking(ws)` ve `DerslikClient.saveBooking(ws, body)`.
  - `PortalData.booking: BookingPolicy`.
  - SQL fonksiyonları: `booking_student`, `booking_policy`, `open_slots`, `free_credits`, `book_lesson`, `cancel_booking`, ve iç yardımcı `booking_packages`.

- [ ] **Adım 1: Başarısız testleri yaz**

`apps/api/tests/booking-cases.mjs` dosyasının tamamını şununla değiştir. İlk test Görev 3'tekiyle aynıdır; yalnızca varsayılan ayar 10:00–13:00 aralığını ve 17. günü kapalı gün olarak içerir.

```js
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LessonRemindersService } from "../../../.api-build/apps/api/src/lessons/reminders.service.js";

// Öğrencinin boş saatten ders ayarlaması: öğretmen ayarları, boş saatler,
// ayarlama ve iptal. Saatler bugüne göre hesaplanır; İstanbul UTC+3'tür.
const DAY = 86_400_000,
  HOUR = 3_600_000;
/** Bugünden `offset` gün sonraki İstanbul takvim günü (YYYY-MM-DD). */
const istanbulDay = (offset = 0) =>
  new Date(Date.now() + 3 * HOUR + offset * DAY).toISOString().slice(0, 10);
/** Günün ISO hafta günü (1 = Pazartesi). */
const isoWeekday = (day) =>
  ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
/** İstanbul saatindeki an, API'nin döndürdüğü biçimde. */
const at = (day, time) => new Date(`${day}T${time}:00+03:00`).toISOString();
/** Bir anın İstanbul takvim günü. */
const dayOf = (iso) =>
  new Date(Date.parse(iso) + 3 * HOUR).toISOString().slice(0, 10);
/** Günlerdeki 10:00–13:00 aralığının 60 dakikalık boş saatleri. */
const morning = (days) =>
  days.flatMap((day) =>
    ["10:00", "10:30", "11:00", "11:30", "12:00"].map((time) => {
      const startsAt = at(day, time);
      return {
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + HOUR).toISOString(),
      };
    }),
  );

export async function bookingCases({ t, app, admin, request, ok, token }) {
  const teacher = randomUUID(),
    pupil = randomUUID(),
    parent = randomUUID(),
    rival = randomUUID(),
    third = randomUUID(),
    quiet = randomUUID(),
    loud = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil),
    tokenParent = await token(parent),
    tokenRival = await token(rival),
    tokenThird = await token(third),
    tokenQuiet = await token(quiet),
    tokenLoud = await token(loud);
  const D3 = istanbulDay(3),
    D10 = istanbulDay(10),
    D17 = istanbulDay(17),
    D24 = istanbulDay(24);
  // 3., 10., 17. ve 24. günün hafta günü: 10:00–13:00.
  const main = { weekday: isoWeekday(D3), start: "10:00", end: "13:00" };
  let ws,
    base,
    version = 0,
    ayse,
    mehmet,
    zeynep,
    kerem,
    ayseLesson,
    mehmetLesson,
    winner;
  const save = (body) =>
    request(`${base}/booking`, { method: "PUT", body, auth: tokenTeacher });
  const settings = (overrides = {}) => ({
    enabled: true,
    durationMinutes: 60,
    noticeHours: 0,
    cancelHours: 24,
    location: "Çevrim içi",
    windows: [main],
    blocks: [{ from: D17, to: D17 }],
    version,
    ...overrides,
  });
  /** Ayarları kaydeder ve yeni sürümü saklar. */
  const configure = async (overrides = {}) => {
    const r = await save(settings(overrides));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    version = r.body.data.version;
    return r.body.data;
  };
  const portal = (s) => `/v1/portal/${ws}/${s.id}`;
  const slotsOf = async (s, auth) =>
    (await ok(`${portal(s)}/booking/slots`, undefined, { auth })).data;
  const book = (s, startsAt, auth, key) =>
    request(`${portal(s)}/booking`, {
      method: "POST",
      body: { startsAt },
      auth,
      key,
    });
  const cancel = (s, lesson, lessonVersion, auth) =>
    request(`${portal(s)}/booking/${lesson.id}/cancel`, {
      method: "POST",
      body: { version: lessonVersion },
      auth,
    });

  await t.test("öğretmen müsaitliğini sürüm kontrolüyle kaydeder", async () => {
    ws = (
      await ok("/v1/workspaces", { name: "Ayarlama Hoca" }, { auth: tokenTeacher })
    ).data.id;
    base = `/v1/workspaces/${ws}`;
    // Hiç kaydedilmemiş ayar varsayılanlarla gelir.
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      {
        enabled: false,
        durationMinutes: 60,
        noticeHours: 12,
        cancelHours: 24,
        location: "",
        windows: [],
        blocks: [],
        version: 0,
      },
    );
    const saved = await configure({
      windows: [
        { weekday: 3, start: "19:00", end: "21:00" },
        { weekday: 1, start: "10:00", end: "12:00" },
      ],
      blocks: [
        { from: istanbulDay(-10), to: istanbulDay(-3) },
        { from: istanbulDay(-1), to: istanbulDay(2) },
      ],
    });
    assert.equal(saved.version, 1);
    // Aralıklar gün ve saate göre sıralanır; bitmiş kapalı günler atılır.
    assert.deepEqual(saved.windows, [
      { weekday: 1, start: "10:00", end: "12:00" },
      { weekday: 3, start: "19:00", end: "21:00" },
    ]);
    assert.deepEqual(saved.blocks, [
      { from: istanbulDay(-1), to: istanbulDay(2) },
    ]);
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      saved,
    );
    // Eski sürümle ya da ikinci kez "ilk kayıt" olarak kayıt reddedilir.
    for (const stale of [0, 5]) {
      const r = await save(settings({ version: stale }));
      assert.equal(r.status, 409);
      assert.match(r.body.error.message, /başka bir yerde değişti/);
    }
    const overlap = await save(
      settings({
        windows: [
          { weekday: 2, start: "10:00", end: "12:00" },
          { weekday: 2, start: "11:00", end: "13:00" },
        ],
      }),
    );
    assert.equal(overlap.status, 400);
    assert.match(JSON.stringify(overlap.body.error.details), /çakışıyor/);
    assert.equal(
      (
        await save(
          settings({ windows: [{ weekday: 2, start: "10:15", end: "12:00" }] }),
        )
      ).status,
      400,
    );
    // Başka hesap bu ayarları okuyamaz ve değiştiremez.
    assert.equal(
      (await request(`${base}/booking`, { auth: tokenPupil })).status,
      403,
    );
    assert.equal(
      (
        await request(`${base}/booking`, {
          method: "PUT",
          body: settings(),
          auth: tokenPupil,
        })
      ).status,
      403,
    );
  });

  await t.test(
    "boş saatler aralık, kapalı gün, ders, önceden ayarlama ve paket bitişine göre üretilir",
    async () => {
      const student = async (name, subject) =>
        (
          await ok(
            `${base}/students`,
            { name, grade: "", subject, phone: "", email: "" },
            { auth: tokenTeacher },
          )
        ).data;
      const packageFor = async (s, granted, expiresOn) =>
        (
          await ok(
            `${base}/packages`,
            {
              studentId: s.id,
              name: `${granted} ders`,
              granted,
              priceMinor: "100000",
              expiresOn,
            },
            { auth: tokenTeacher },
          )
        ).data;
      ayse = await student("Ayşe Ayarlar", "Fizik");
      mehmet = await student("Mehmet Rakip", "Kimya");
      zeynep = await student("Zeynep Yarış", "Biyoloji");
      kerem = await student("Kerem Arşiv", "Tarih");
      ayse.pack = await packageFor(ayse, 2, D10);
      mehmet.pack = await packageFor(mehmet, 4, null);
      zeynep.pack = await packageFor(zeynep, 2, null);
      for (const id of [pupil, parent, rival, third, quiet])
        await admin.query(
          "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT DO NOTHING",
          [id],
        );
      await admin.query(
        `INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES
          ($1,$2,$6,'STUDENT',ARRAY['lessons']),($1,$2,$7,'GUARDIAN',ARRAY['lessons']),
          ($1,$3,$8,'STUDENT',ARRAY['lessons']),($1,$4,$9,'STUDENT',ARRAY['lessons']),
          ($1,$5,$10,'STUDENT',ARRAY['lessons'])`,
        [ws, ayse.id, mehmet.id, zeynep.id, kerem.id, pupil, parent, rival, third, quiet],
      );
      await configure();
      // Ayşe'nin paketi 10. gün bitiyor: 17. gün kapalı, 24. gün paket dışı.
      assert.deepEqual(await slotsOf(ayse, tokenPupil), {
        durationMinutes: 60,
        location: "Çevrim içi",
        cancelHours: 24,
        freeCredits: 2,
        slots: morning([D3, D10]),
      });
      assert.deepEqual(
        (await slotsOf(mehmet, tokenRival)).slots,
        morning([D3, D10, D24]),
      );
      // Öğretmenin başka öğrenciyle dersi çakışan saatleri kapatır; kimin
      // dersi olduğu yanıtta görünmez. İptal edilen ders saati yeniden açar.
      const busy = (
        await ok(
          `${base}/sessions`,
          {
            studentId: mehmet.id,
            packageId: mehmet.pack.id,
            startsAt: at(D3, "10:30"),
            duration: 60,
            topic: "Öğretmenin dersi",
            location: "",
            weeks: 1,
          },
          { auth: tokenTeacher },
        )
      ).data.lessons[0];
      const around = await slotsOf(ayse, tokenPupil);
      const blocked = [at(D3, "10:00"), at(D3, "10:30"), at(D3, "11:00")];
      assert.deepEqual(
        around.slots.map((s) => s.startsAt),
        morning([D3, D10])
          .map((s) => s.startsAt)
          .filter((s) => !blocked.includes(s)),
      );
      assert.doesNotMatch(JSON.stringify(around), /Öğretmenin dersi|Mehmet/);
      await ok(
        `${base}/sessions/${busy.id}/cancel`,
        { version: busy.version },
        { auth: tokenTeacher },
      );
      assert.equal((await slotsOf(ayse, tokenPupil)).slots.length, 10);
      // En az 7 gün önceden: 3. günün saatleri düşer.
      await configure({ noticeHours: 168 });
      assert.deepEqual((await slotsOf(ayse, tokenPupil)).slots, morning([D10]));
      await configure();
    },
  );

  await t.test(
    "gece yarısı ve süreye sığmayan aralık İstanbul gününe göre değerlendirilir",
    async () => {
      const D4 = istanbulDay(4),
        D5 = istanbulDay(5),
        D12 = istanbulDay(12);
      await configure({
        durationMinutes: 90,
        windows: [
          main,
          { weekday: isoWeekday(D4), start: "23:00", end: "24:00" },
          { weekday: isoWeekday(D5), start: "00:00", end: "02:00" },
        ],
        blocks: [
          { from: D17, to: D17 },
          { from: D5, to: D5 },
        ],
      });
      const slots = (await slotsOf(mehmet, tokenRival)).slots.map(
        (s) => s.startsAt,
      );
      // 90 dakikalık ders 23:00–24:00 aralığına sığmaz: o günlerde saat yok.
      assert.ok(!slots.some((s) => isoWeekday(dayOf(s)) === isoWeekday(D4)));
      // Kapalı gün İstanbul gününe göre: 5. günün 00:00'ı UTC'de önceki gün.
      assert.ok(!slots.some((s) => dayOf(s) === D5));
      assert.deepEqual(
        slots.filter((s) => dayOf(s) === D12),
        [at(D12, "00:00"), at(D12, "00:30")],
      );
      assert.deepEqual(
        slots.filter((s) => dayOf(s) === D3),
        [at(D3, "10:00"), at(D3, "10:30"), at(D3, "11:00"), at(D3, "11:30")],
      );
      await configure();
    },
  );

  await t.test(
    "öğrenci boş saate ders ayarlar; ders öğretmenin takvimine ve bildirimine düşer",
    async () => {
      const key = randomUUID();
      const first = await book(ayse, at(D3, "11:30"), tokenPupil, key);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.replayed, false);
      ayseLesson = first.body.data;
      assert.equal(ayseLesson.topic, "Fizik");
      assert.equal(ayseLesson.location, "Çevrim içi");
      assert.equal(ayseLesson.bookedBy, pupil);
      assert.equal(ayseLesson.packageId, ayse.pack.id);
      assert.equal(ayseLesson.status, "SCHEDULED");
      assert.equal(Date.parse(ayseLesson.startsAt), Date.parse(at(D3, "11:30")));
      assert.equal(
        Date.parse(ayseLesson.endsAt) - Date.parse(ayseLesson.startsAt),
        HOUR,
      );
      // Aynı anahtarla yeniden gönderim aynı dersi döndürür.
      const again = await book(ayse, at(D3, "11:30"), tokenPupil, key);
      assert.equal(again.status, 201);
      assert.equal(again.body.replayed, true);
      assert.equal(again.body.data.id, ayseLesson.id);
      const snapshot = await ok(`${base}/snapshot`, undefined, {
        auth: tokenTeacher,
      });
      assert.equal(
        snapshot.lessons.filter((l) => l.booked_by === pupil).length,
        1,
      );
      assert.deepEqual(
        (
          await admin.query(
            "SELECT user_id,title,body,kind FROM derslik.notifications WHERE target_id=$1",
            [ayseLesson.id],
          )
        ).rows,
        [
          {
            user_id: teacher,
            title: "notice.lessonBooked",
            body: "Ayşe Ayarlar",
            kind: "LESSON",
          },
        ],
      );
      const view = await ok(portal(ayse), undefined, { auth: tokenPupil });
      assert.deepEqual(view.booking, { enabled: true, cancelHours: 24 });
      assert.equal(
        view.lessons.find((l) => l.id === ayseLesson.id).booked_by,
        pupil,
      );
      // Veli de özeti görür (düğmeyi istemci gizler).
      assert.deepEqual(
        (await ok(portal(ayse), undefined, { auth: tokenParent })).booking,
        { enabled: true, cancelHours: 24 },
      );
      // Takvim aboneliği (.ics) ayarlanan dersi de içerir.
      const feed = (await ok("/v1/calendar", {}, { auth: tokenPupil })).data
        .url;
      const feedToken = /\/api\/calendar\/([a-f0-9]{64})\.ics$/.exec(feed)[1];
      const ics = Buffer.from(
        (
          await request(`/v1/calendar/${feedToken}`, { auth: null, raw: true })
        ).body,
      ).toString("utf8");
      assert.match(ics, new RegExp(`\\r\\nUID:${ayseLesson.id}@derslik\\r\\n`));
      const after = await slotsOf(ayse, tokenPupil);
      assert.equal(after.freeCredits, 1);
      for (const time of ["11:00", "11:30", "12:00"])
        assert.ok(
          !after.slots.some((s) => s.startsAt === at(D3, time)),
          time,
        );
    },
  );

  await t.test(
    "son boştaki hak için aynı anda iki ayarlama: yalnızca biri ders olur",
    async () => {
      const results = await Promise.all(
        [at(D10, "10:00"), at(D10, "12:00")].map((startsAt) =>
          book(ayse, startsAt, tokenPupil),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.match(
        results.find((r) => r.status === 409).body.error.message,
        /Boşta ders hakkınız yok/,
      );
      const empty = await slotsOf(ayse, tokenPupil);
      assert.equal(empty.freeCredits, 0);
      assert.deepEqual(empty.slots, []);
      assert.equal((await book(ayse, at(D10, "11:00"), tokenPupil)).status, 409);
    },
  );

  await t.test(
    "iki öğrenci aynı saati aynı anda seçerse yalnızca biri alır",
    async () => {
      const slot = at(D24, "10:00");
      const results = await Promise.all(
        [
          [mehmet, tokenRival],
          [zeynep, tokenThird],
        ].map(([s, auth]) => book(s, slot, auth)),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.match(
        results.find((r) => r.status === 409).body.error.message,
        /artık boş değil/,
      );
      winner = results.find((r) => r.status === 201).body.data;
      // Aynı an başka biçimde (İstanbul saatiyle, +03:00) yazılsa da aynı saattir.
      const written = await book(mehmet, `${D24}T11:00:00+03:00`, tokenRival);
      assert.equal(written.status, 201, JSON.stringify(written.body));
      mehmetLesson = written.body.data;
      assert.equal(
        Date.parse(mehmetLesson.startsAt),
        Date.parse(at(D24, "11:00")),
      );
    },
  );

  await t.test(
    "veli, öğretmen, kapalı ayarlama, geri alınan ve arşivlenen hesap ders ayarlayamaz",
    async () => {
      const slot = at(D24, "12:00");
      assert.equal(
        (await request(`${portal(ayse)}/booking/slots`, { auth: tokenParent }))
          .status,
        403,
      );
      assert.equal((await book(ayse, slot, tokenParent)).status, 403);
      assert.equal(
        (await request(`${portal(mehmet)}/booking/slots`, { auth: tokenTeacher }))
          .status,
        403,
      );
      assert.equal((await book(mehmet, slot, tokenTeacher)).status, 403);
      // Ayarlama kapalıyken liste ve ayarlama 409; portal özeti kapalı.
      await configure({ enabled: false });
      assert.equal(
        (await request(`${portal(mehmet)}/booking/slots`, { auth: tokenRival }))
          .status,
        409,
      );
      const closed = await book(mehmet, slot, tokenRival);
      assert.equal(closed.status, 409);
      assert.match(closed.body.error.message, /ders ayarlamaya kapalı/);
      assert.deepEqual(
        (await ok(portal(mehmet), undefined, { auth: tokenRival })).booking,
        { enabled: false, cancelHours: 24 },
      );
      await configure();
      // Bağlantısı geri alınan öğrenci.
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [ws, third],
      );
      assert.equal(
        (await request(`${portal(zeynep)}/booking/slots`, { auth: tokenThird }))
          .status,
        403,
      );
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=NULL WHERE workspace_id=$1 AND user_id=$2",
        [ws, third],
      );
      // Arşivlenen öğrenci.
      await ok(
        `${base}/students/${kerem.id}/archive`,
        { version: kerem.version },
        { auth: tokenTeacher },
      );
      assert.equal(
        (await request(`${portal(kerem)}/booking/slots`, { auth: tokenQuiet }))
          .status,
        403,
      );
      assert.equal((await book(kerem, slot, tokenQuiet)).status, 403);
      // Dakikada 10'dan fazla ayarlama ya da iptal isteği reddedilir.
      const statuses = [];
      for (let i = 0; i < 11; i++)
        statuses.push((await book(kerem, slot, tokenLoud)).status);
      assert.deepEqual(statuses, [...Array(10).fill(403), 429]);
    },
  );

  await t.test("öğrenci kendi ayarladığı dersi süresi içinde iptal eder", async () => {
    assert.equal((await cancel(mehmet, mehmetLesson, 3, tokenRival)).status, 409);
    const done = await cancel(mehmet, mehmetLesson, 0, tokenRival);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.data.status, "CANCELLED");
    assert.deepEqual(
      (
        await admin.query(
          "SELECT user_id,body FROM derslik.notifications WHERE target_id=$1 AND title='notice.lessonCancelledByStudent'",
          [mehmetLesson.id],
        )
      ).rows,
      [{ user_id: teacher, body: "Mehmet Rakip" }],
    );
    // Saat yeniden boşalır; iptal edilmiş ders yeniden iptal edilemez.
    assert.ok(
      (await slotsOf(mehmet, tokenRival)).slots.some(
        (s) => s.startsAt === at(D24, "11:00"),
      ),
    );
    assert.equal((await cancel(mehmet, mehmetLesson, 1, tokenRival)).status, 409);
  });

  await t.test(
    "süresi geçen, öğretmenin planladığı, başkasının dersi ve veli iptal edemez",
    async () => {
      await configure({ cancelHours: 168 });
      const late = await cancel(ayse, ayseLesson, 0, tokenPupil);
      assert.equal(late.status, 409);
      assert.match(late.body.error.message, /iptal süresi geçti/);
      await configure();
      const planned = (
        await ok(
          `${base}/sessions`,
          {
            studentId: ayse.id,
            packageId: ayse.pack.id,
            startsAt: at(istanbulDay(5), "15:00"),
            duration: 60,
            topic: "Öğretmen planladı",
            location: "",
            weeks: 1,
          },
          { auth: tokenTeacher },
        )
      ).data.lessons[0];
      const notMine = await cancel(ayse, planned, 0, tokenPupil);
      assert.equal(notMine.status, 409);
      assert.match(notMine.body.error.message, /öğretmeniniz planladı/);
      assert.equal((await cancel(mehmet, ayseLesson, 0, tokenRival)).status, 404);
      assert.equal((await cancel(ayse, ayseLesson, 0, tokenParent)).status, 403);
      // Öğretmen bütün aralıkları kaldırsa da ayarlanmış ders yerinde kalır,
      // liste boş döner ve ders süresi içinde iptal edilebilir.
      await configure({ windows: [] });
      assert.deepEqual((await slotsOf(ayse, tokenPupil)).slots, []);
      assert.equal((await cancel(ayse, ayseLesson, 0, tokenPupil)).status, 201);
      await configure();
    },
  );

  await t.test(
    "öğretmen ayarlanan dersi taşır, tamamlar, geri alır; hatırlatma gider",
    async () => {
      const lessonPath = (action) => `${base}/sessions/${winner.id}/${action}`;
      const moved = (
        await ok(
          lessonPath("reschedule"),
          { version: 0, startsAt: at(D24, "15:00"), duration: 60 },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(moved.bookedBy, winner.bookedBy);
      const completed = (
        await ok(
          lessonPath("complete"),
          { version: moved.version },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(completed.status, "COMPLETED");
      const reversed = (
        await ok(
          lessonPath("reverse"),
          { version: completed.version },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(reversed.status, "SCHEDULED");
      // Yakında başlayan ayarlanmış ders diğer dersler gibi hatırlatılır.
      const soon = new Date(
        Math.ceil((Date.now() + 30 * 60_000) / 60_000) * 60_000,
      );
      await admin.query(
        "UPDATE derslik.lessons SET starts_at=$2,ends_at=$3,reminded_at=NULL WHERE id=$1",
        [winner.id, soon, new Date(soon.getTime() + HOUR)],
      );
      assert.ok((await app.get(LessonRemindersService).run()) >= 1);
      const reminded = (
        await admin.query(
          "SELECT user_id FROM derslik.notifications WHERE target_id=$1 AND title='notice.lessonReminder'",
          [winner.id],
        )
      ).rows.map((r) => r.user_id);
      assert.ok(reminded.includes(teacher) && reminded.includes(winner.bookedBy));
    },
  );
}
```

- [ ] **Adım 2: Testlerin başarısız olduğunu gör**

Run: `pnpm test`
Expected: FAIL. İlk test geçer. `boş saatler aralık, …` testi `/v1/portal/<ws>/<id>/booking/slots: 404` hatası verir.

- [ ] **Adım 3: Kural fonksiyonlarının göçünü yaz**

`apps/api/drizzle/0018_lesson_booking.sql`:

```sql
-- Öğrencinin boş saatten ders ayarlaması (2/2): kurallar. Öğrenci (yalnızca
-- STUDENT bağlantısı) boş saatleri görür, ders ayarlar ve kendi ayarladığı
-- dersi iptal eder. Fonksiyonlar SECURITY DEFINER'dır: öğrenci başka
-- öğrencilerin derslerini, ayar tablolarını ve (izni yoksa) paketlerini
-- doğrudan okumaz. Saatler İstanbul saatiyle hesaplanır.

-- Çağıran kişi bu öğrencinin geri alınmamış, Dersler izinli öğrenci hesabı mı
-- (öğrenci arşivde değil).
CREATE FUNCTION derslik.booking_student(ws uuid,student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.portal_links p
  JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
  WHERE p.workspace_id=ws AND p.student_id=student AND p.user_id=derslik.actor_id()
   AND p.role='STUDENT' AND p.revoked_at IS NULL AND 'lessons'=ANY(p.permissions) AND s.active);
$$;
--> statement-breakpoint
-- Portal ve ayarlama penceresi için ayarların gösterilebilen kısmı; çalışma
-- alanına erişimi olan herkes okur.
CREATE FUNCTION derslik.booking_policy(ws uuid)
RETURNS TABLE(enabled boolean,duration_minutes int,cancel_hours int,location text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT b.enabled,b.duration_minutes,b.cancel_hours,b.location FROM derslik.booking_settings b
 WHERE b.workspace_id=ws AND derslik.has_workspace_access(ws);
$$;
--> statement-breakpoint
-- Öğrencinin paketleri ve boştaki hakları: kalan hak − o pakete bağlı planlı
-- ders. Geçmişte kalıp hâlâ planlı görünen ders de sayılır; büyük olasılıkla
-- tamamlanacaktır.
CREATE FUNCTION derslik.booking_packages(ws uuid,student uuid)
RETURNS TABLE(id uuid,expires_on date,created_at timestamptz,free int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT p.id,p.expires_on,p.created_at,
  p.remaining-(SELECT count(*) FROM derslik.lessons l
   WHERE l.workspace_id=p.workspace_id AND l.package_id=p.id AND l.status='SCHEDULED')::int
 FROM derslik.packages p
 WHERE p.workspace_id=ws AND p.student_id=student AND derslik.booking_student(ws,student);
$$;
--> statement-breakpoint
-- Önümüzdeki 28 günün (bugün dahil) boş ders başlangıçları. Başlangıçlar
-- aralığın başından 30 dakikada birdir ve dersin tamamı aralığa sığar. Kapalı
-- günler, en az ne kadar önce kuralı, öğretmenin iptal edilmemiş bütün
-- dersleri ve öğrencinin o günü kapsayan boştaki hakkı denetlenir. Sabitler
-- packages/contracts/src/booking.ts ile aynı olmalı.
CREATE FUNCTION derslik.open_slots(ws uuid,student uuid)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH rules AS (
  SELECT b.duration_minutes,b.notice_hours FROM derslik.booking_settings b
  WHERE b.workspace_id=ws AND b.enabled AND derslik.booking_student(ws,student)
 ), credit AS (
  SELECT p.expires_on FROM derslik.booking_packages(ws,student) p WHERE p.free>0
 ), days AS (
  SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date+i AS on_day FROM generate_series(0,27) i
 ), candidates AS (
  SELECT d.on_day,r.duration_minutes,r.notice_hours,
   (d.on_day+make_interval(mins=>m)) AT TIME ZONE 'Europe/Istanbul' AS start_at
  FROM rules r CROSS JOIN days d
  JOIN derslik.availability_windows w ON w.workspace_id=ws AND w.weekday=extract(isodow FROM d.on_day)
  CROSS JOIN LATERAL generate_series(w.start_minute::int,w.end_minute-r.duration_minutes,30) m
 )
 SELECT c.start_at,c.start_at+make_interval(mins=>c.duration_minutes)
 FROM candidates c
 WHERE c.start_at>=now()+make_interval(hours=>c.notice_hours)
  AND NOT EXISTS(SELECT 1 FROM derslik.availability_blocks k
   WHERE k.workspace_id=ws AND c.on_day BETWEEN k.starts_on AND k.ends_on)
  AND NOT EXISTS(SELECT 1 FROM derslik.lessons l
   WHERE l.workspace_id=ws AND l.status<>'CANCELLED'
    AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(c.start_at,c.start_at+make_interval(mins=>c.duration_minutes),'[)'))
  AND EXISTS(SELECT 1 FROM credit k WHERE k.expires_on IS NULL OR k.expires_on>=c.on_day)
 ORDER BY 1;
$$;
--> statement-breakpoint
-- Bugün geçerli paketlerdeki boştaki haklar (ayarlama penceresinin özeti).
CREATE FUNCTION derslik.free_credits(ws uuid,student uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT COALESCE(sum(greatest(p.free,0)),0)::int FROM derslik.booking_packages(ws,student) p
 WHERE p.expires_on IS NULL OR p.expires_on>=(now() AT TIME ZONE 'Europe/Istanbul')::date;
$$;
--> statement-breakpoint
-- Ders ayarlama. Kilit sırası öğretmenin ders eklemesiyle aynıdır: takvim
-- kilidi (LessonsService.calendarLock), öğrenci satırı, paket. Ayar satırı
-- FOR SHARE tutulur; öğretmen ayarı kaydederken (UPDATE) ayarlama bekler ve
-- kapatılmış ayara ders yazılmaz. Saat open_slots'ta yoksa: o günü kapsayan
-- boştaki hak yoksa 'credits', varsa 'slot'.
CREATE FUNCTION derslik.book_lesson(ws uuid,student uuid,start_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE pupil derslik.students; rules derslik.booking_settings; on_day date; pack uuid; created derslik.lessons;
BEGIN
 IF NOT derslik.booking_student(ws,student) THEN
  RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calendar:'||ws::text,0));
 SELECT * INTO pupil FROM derslik.students s WHERE s.workspace_id=ws AND s.id=student FOR UPDATE;
 IF NOT pupil.active THEN
  RAISE EXCEPTION 'Student archived' USING ERRCODE='P0001',HINT='archived';
 END IF;
 SELECT * INTO rules FROM derslik.booking_settings b WHERE b.workspace_id=ws FOR SHARE;
 IF NOT FOUND OR NOT rules.enabled THEN
  RAISE EXCEPTION 'Booking disabled' USING ERRCODE='P0001',HINT='disabled';
 END IF;
 on_day:=(start_at AT TIME ZONE 'Europe/Istanbul')::date;
 IF NOT EXISTS(SELECT 1 FROM derslik.open_slots(ws,student) o WHERE o.starts_at=start_at) THEN
  IF NOT EXISTS(SELECT 1 FROM derslik.booking_packages(ws,student) p
   WHERE p.free>0 AND (p.expires_on IS NULL OR p.expires_on>=on_day)) THEN
   RAISE EXCEPTION 'No free credits' USING ERRCODE='P0001',HINT='credits';
  END IF;
  RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='P0001',HINT='slot';
 END IF;
 SELECT p.id INTO pack FROM derslik.booking_packages(ws,student) p
  WHERE p.free>0 AND (p.expires_on IS NULL OR p.expires_on>=on_day)
  ORDER BY p.expires_on NULLS LAST,p.created_at,p.id LIMIT 1;
 PERFORM 1 FROM derslik.packages p WHERE p.workspace_id=ws AND p.id=pack FOR UPDATE;
 INSERT INTO derslik.lessons(workspace_id,student_id,package_id,topic,starts_at,ends_at,location,booked_by)
 VALUES(ws,student,pack,left(pupil.subject,120),start_at,
  start_at+make_interval(mins=>rules.duration_minutes),rules.location,derslik.actor_id())
 RETURNING * INTO created;
 INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 SELECT ws,w.owner_id,student,'notice.lessonBooked',pupil.name,'LESSON',created.id
 FROM derslik.workspaces w WHERE w.id=ws;
 RETURN to_jsonb(created);
END $$;
--> statement-breakpoint
-- Öğrencinin kendi ayarladığı dersi iptali. Kilit sırası öğretmenin ders
-- işlemleriyle aynıdır (öğrenci satırı, ders). Kural sırası: ders yok ya da
-- başka öğrencinin ('notFound'), öğretmen planlamış ('notBooked'), planlı
-- değil ('state'), sürüm eski ('changed'), iptal süresi geçmiş ('deadline').
CREATE FUNCTION derslik.cancel_booking(ws uuid,student uuid,lesson uuid,expected_version int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE pupil derslik.students; target derslik.lessons; limit_hours int; cancelled derslik.lessons;
BEGIN
 IF NOT derslik.booking_student(ws,student) THEN
  RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO pupil FROM derslik.students s WHERE s.workspace_id=ws AND s.id=student FOR UPDATE;
 SELECT * INTO target FROM derslik.lessons l
  WHERE l.workspace_id=ws AND l.id=lesson AND l.student_id=student FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Lesson not found' USING ERRCODE='P0001',HINT='notFound';
 END IF;
 IF target.booked_by IS NULL THEN
  RAISE EXCEPTION 'Lesson not booked by the student' USING ERRCODE='P0001',HINT='notBooked';
 END IF;
 IF target.status<>'SCHEDULED' THEN
  RAISE EXCEPTION 'Lesson is not scheduled' USING ERRCODE='P0001',HINT='state';
 END IF;
 IF target.version<>expected_version THEN
  RAISE EXCEPTION 'Lesson changed' USING ERRCODE='P0001',HINT='changed';
 END IF;
 SELECT b.cancel_hours INTO limit_hours FROM derslik.booking_settings b WHERE b.workspace_id=ws;
 IF now()>target.starts_at-make_interval(hours=>COALESCE(limit_hours,0)) THEN
  RAISE EXCEPTION 'Cancellation deadline passed' USING ERRCODE='P0001',HINT='deadline';
 END IF;
 UPDATE derslik.lessons l SET status='CANCELLED',version=l.version+1
 WHERE l.workspace_id=ws AND l.id=lesson RETURNING * INTO cancelled;
 INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 SELECT ws,w.owner_id,student,'notice.lessonCancelledByStudent',pupil.name,'LESSON',lesson
 FROM derslik.workspaces w WHERE w.id=ws;
 RETURN to_jsonb(cancelled);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.booking_student(uuid,uuid),derslik.booking_policy(uuid),
 derslik.booking_packages(uuid,uuid),derslik.open_slots(uuid,uuid),derslik.free_credits(uuid,uuid),
 derslik.book_lesson(uuid,uuid,timestamptz),derslik.cancel_booking(uuid,uuid,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.booking_student(uuid,uuid),derslik.booking_policy(uuid),
 derslik.open_slots(uuid,uuid),derslik.free_credits(uuid,uuid),
 derslik.book_lesson(uuid,uuid,timestamptz),derslik.cancel_booking(uuid,uuid,uuid,int) TO derslik_app;
```

`apps/api/drizzle/meta/_journal.json` dosyasında `0017_booking_settings` kaydının arkasına virgül koy ve şunu ekle:

```json
    {
      "idx": 18,
      "version": "7",
      "when": 1789660000000,
      "tag": "0018_lesson_booking",
      "breakpoints": true
    }
```

```bash
node -e 'const fs=require("node:fs"),dir="apps/api/drizzle/meta/";const prev=JSON.parse(fs.readFileSync(dir+"0017_snapshot.json","utf8"));fs.writeFileSync(dir+"0018_snapshot.json",JSON.stringify({...prev,id:require("node:crypto").randomUUID(),prevId:prev.id},null,2)+"\n")'
```

- [ ] **Adım 4: Servisi ve uç noktaları tamamla**

`apps/api/src/booking/booking.service.ts` dosyasının tamamını şununla değiştir. `readSettings` ve `saveSettings` Görev 3'teki hâliyle kalır:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService, toDto } from "../common/command.service.js";
import { RateLimiter } from "../common/rate-limit.js";
import { ISTANBUL_TODAY } from "../learning/learning.service.js";
import { istanbulDay } from "../lessons/lessons.service.js";
import {
  bookLessonSchema,
  bookingSettingsSchema,
  cancelBookingSchema,
  defaultBookingSettings,
  minutesOf,
  timeOf,
  type BookingSettings,
} from "../../../../packages/contracts/src/booking.js";

/** Veritabanı fonksiyonlarının (book_lesson, cancel_booking) HINT değerleri
 *  ve karşılıkları olan çeviri anahtarlı HTTP hataları. */
const BOOKING_ERRORS: Record<string, () => Error> = {
  archived: () => new ConflictException("api.studentArchived"),
  disabled: () => new ConflictException("api.bookingDisabled"),
  slot: () => new ConflictException("api.bookingSlotTaken"),
  credits: () => new ConflictException("api.bookingNoCredits"),
  notFound: () => new NotFoundException("api.lessonNotFound"),
  notBooked: () => new ConflictException("api.bookingNotYours"),
  state: () => new ConflictException("api.lessonStateInvalid"),
  changed: () => new ConflictException("api.lessonChanged"),
  deadline: () => new ConflictException("api.bookingCancelClosed"),
};
function bookingError(error: unknown) {
  const { code, hint } = error as { code?: string; hint?: string };
  if (code === "42501") return new ForbiddenException("api.noStudentAccess");
  // Son güvence (teacher_calendar_no_overlap); takvim kilidi varken beklenmez.
  if (code === "23P01") return new ConflictException("api.bookingSlotTaken");
  const known = code === "P0001" && hint ? BOOKING_ERRORS[hint] : undefined;
  return known ? known() : error;
}

/** Öğretmenin ayarları; hiç kaydedilmemişse varsayılanlar (sürüm 0).
 *  Bitişi geçmiş kapalı günler gelmez. */
async function readSettings(
  tx: PoolClient,
  ws: string,
): Promise<BookingSettings> {
  const row = (
    await tx.query(
      "SELECT enabled,duration_minutes,notice_hours,cancel_hours,location,version FROM derslik.booking_settings WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0];
  if (!row) return defaultBookingSettings();
  const windows = (
    await tx.query(
      "SELECT weekday,start_minute,end_minute FROM derslik.availability_windows WHERE workspace_id=$1 ORDER BY weekday,start_minute",
      [ws],
    )
  ).rows;
  const blocks = (
    await tx.query(
      `SELECT starts_on,ends_on FROM derslik.availability_blocks WHERE workspace_id=$1 AND ends_on>=${ISTANBUL_TODAY} ORDER BY starts_on,ends_on`,
      [ws],
    )
  ).rows;
  return {
    enabled: row.enabled,
    durationMinutes: row.duration_minutes,
    noticeHours: row.notice_hours,
    cancelHours: row.cancel_hours,
    location: row.location,
    windows: windows.map((w) => ({
      weekday: w.weekday,
      start: timeOf(w.start_minute),
      end: timeOf(w.end_minute),
    })),
    blocks: blocks.map((b) => ({ from: b.starts_on, to: b.ends_on })),
    version: row.version,
  };
}

/** Boş saatler yalnızca öğrencinin kendi hesabına açılır; veli ve öğretmen
 *  portal kontrolünden geçse de burada durur. */
async function assertBookingStudent(
  tx: PoolClient,
  ws: string,
  student: string,
) {
  const allowed = (
    await tx.query("SELECT derslik.booking_student($1,$2) AS ok", [
      ws,
      student,
    ])
  ).rows[0].ok;
  if (!allowed) throw new ForbiddenException("api.noStudentAccess");
}

@Injectable()
export class BookingService {
  // Ders ayarlama ve iptal: kullanıcı başına dakikada 10 istek. Ayarla-iptal
  // döngüsü öğretmenin gelen kutusunu dolduramaz.
  private readonly limiter = new RateLimiter(10);

  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
  ) {}

  settings(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => ({
      data: await readSettings(tx, ws),
    }));
  }

  /** Ayarların tamamını değiştirir. Sürüm GET'ten gelir: satır yoksa 0
   *  beklenir ve satır sürüm 1 ile eklenir; varsa yalnızca aynı sürüm
   *  güncellenir. Ayar satırının kilidi, aynı anda ders ayarlayan öğrenciyi
   *  (derslik.book_lesson, FOR SHARE) bu kayıt bitene kadar bekletir. */
  saveSettings(actor: Actor, ws: string, input: unknown) {
    const c = bookingSettingsSchema.parse(input);
    const today = istanbulDay(new Date());
    return this.db.transaction(actor, ws, async (tx) => {
      const values = [
        ws,
        c.enabled,
        c.durationMinutes,
        c.noticeHours,
        c.cancelHours,
        c.location,
      ];
      const saved = (
        c.version === 0
          ? await tx.query(
              `INSERT INTO derslik.booking_settings(workspace_id,enabled,duration_minutes,notice_hours,cancel_hours,location,version)
               VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT (workspace_id) DO NOTHING RETURNING version`,
              values,
            )
          : await tx.query(
              `UPDATE derslik.booking_settings SET enabled=$2,duration_minutes=$3,notice_hours=$4,cancel_hours=$5,
                 location=$6,version=version+1,updated_at=now()
               WHERE workspace_id=$1 AND version=$7 RETURNING version`,
              [...values, c.version],
            )
      ).rows[0];
      if (!saved) throw new ConflictException("api.bookingSettingsChanged");
      await tx.query(
        "DELETE FROM derslik.availability_windows WHERE workspace_id=$1",
        [ws],
      );
      await tx.query(
        "DELETE FROM derslik.availability_blocks WHERE workspace_id=$1",
        [ws],
      );
      for (const w of c.windows)
        await tx.query(
          "INSERT INTO derslik.availability_windows(workspace_id,weekday,start_minute,end_minute) VALUES($1,$2,$3,$4)",
          [ws, w.weekday, minutesOf(w.start), minutesOf(w.end)],
        );
      // Bitişi geçmiş kapalı günler saklanmaz.
      for (const b of c.blocks.filter((b) => b.to >= today))
        await tx.query(
          "INSERT INTO derslik.availability_blocks(workspace_id,starts_on,ends_on) VALUES($1,$2,$3)",
          [ws, b.from, b.to],
        );
      await tx.query(
        "INSERT INTO derslik.audit_events (workspace_id,actor_id,action,resource_id,metadata) VALUES ($1,$2,$3,$4,$5)",
        [
          ws,
          actor.id,
          "booking.save",
          ws,
          JSON.stringify({
            enabled: c.enabled,
            windows: c.windows.length,
            blocks: c.blocks.length,
          }),
        ],
      );
      return { data: await readSettings(tx, ws) };
    });
  }

  /** Öğrencinin boş saatleri, süre, yer ve boştaki hak. Ayarlama kapalıysa 409. */
  slots(actor: Actor, ws: string, student: string) {
    return this.db.portalTransaction(
      actor,
      ws,
      student,
      "lessons",
      async (tx) => {
        await assertBookingStudent(tx, ws, student);
        const policy = (
          await tx.query(
            "SELECT enabled,duration_minutes,cancel_hours,location FROM derslik.booking_policy($1)",
            [ws],
          )
        ).rows[0];
        if (!policy?.enabled)
          throw new ConflictException("api.bookingDisabled");
        const slots = (
          await tx.query(
            "SELECT starts_at,ends_at FROM derslik.open_slots($1,$2)",
            [ws, student],
          )
        ).rows;
        const credits = (
          await tx.query("SELECT derslik.free_credits($1,$2) AS n", [
            ws,
            student,
          ])
        ).rows[0].n;
        return {
          data: toDto({
            duration_minutes: policy.duration_minutes,
            location: policy.location,
            cancel_hours: policy.cancel_hours,
            free_credits: credits,
            slots,
          }),
        };
      },
      true,
    );
  }

  /** Boş saate ders ayarlar; tekrar edilen anahtar aynı dersi döndürür. */
  book(actor: Actor, ws: string, student: string, key: string, input: unknown) {
    this.limiter.check(actor.id);
    const c = bookLessonSchema.parse(input);
    return this.commands.run(
      actor,
      ws,
      key,
      { action: "lesson.book", studentId: student, startsAt: c.startsAt },
      async (tx) => {
        try {
          const data = (
            await tx.query("SELECT derslik.book_lesson($1,$2,$3) AS data", [
              ws,
              student,
              c.startsAt,
            ])
          ).rows[0].data;
          return { data, audit: { startsAt: data.starts_at } };
        } catch (error) {
          throw bookingError(error);
        }
      },
      { studentId: student, permission: "lessons", write: true },
    );
  }

  /** Öğrencinin kendi ayarladığı dersi iptal eder. */
  cancel(
    actor: Actor,
    ws: string,
    student: string,
    lesson: string,
    key: string,
    input: unknown,
  ) {
    this.limiter.check(actor.id);
    const c = cancelBookingSchema.parse(input);
    return this.commands.run(
      actor,
      ws,
      key,
      {
        action: "lesson.cancelBooking",
        studentId: student,
        id: lesson,
        version: c.version,
      },
      async (tx) => {
        try {
          const data = (
            await tx.query(
              "SELECT derslik.cancel_booking($1,$2,$3,$4) AS data",
              [ws, student, lesson, c.version],
            )
          ).rows[0].data;
          return { data, audit: { startsAt: data.starts_at } };
        } catch (error) {
          throw bookingError(error);
        }
      },
      { studentId: student, permission: "lessons", write: true },
    );
  }
}
```

`apps/api/src/booking/booking.controller.ts` dosyasının tamamını şununla değiştir:

```ts
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { BookingService } from "./booking.service.js";

/** Öğrencinin boş saatten ders ayarlaması. ApiController'daki
 *  `workspaces/:ws/:resource` ucundan önce kaydedilir (app.module.ts). */
@Controller("v1")
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly booking: BookingService) {}
  @Get("workspaces/:ws/booking") settings(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ) {
    return this.booking.settings(req.actor, uuid.parse(ws));
  }
  @Put("workspaces/:ws/booking") save(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Body() body: unknown,
  ) {
    return this.booking.saveSettings(req.actor, uuid.parse(ws), body);
  }
  @Get("portal/:ws/:student/booking/slots") slots(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.booking.slots(req.actor, uuid.parse(ws), uuid.parse(student));
  }
  @Post("portal/:ws/:student/booking") book(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.booking.book(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
    );
  }
  @Post("portal/:ws/:student/booking/:lesson/cancel") cancel(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.booking.cancel(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(lesson),
      key,
      body,
    );
  }
}
```

- [ ] **Adım 5: Portal yanıtına ayarlama bilgisini ekle**

`apps/api/src/learning/learning.service.ts`:
1. Şu metin dosyada iki kez geçer (`read()` ve `portal()`). İkisini de değiştir (Edit, `replace_all`):

```text
location,status,version,makeup_for_id FROM derslik.lessons
```

yerine:

```text
location,status,version,makeup_for_id,booked_by FROM derslik.lessons
```

2. `portal()` içinde `if (!link) throw new ForbiddenException("api.portalAccessNotFound");` satırının hemen altına ekle:

```ts
        // Ders ayarlama özeti: "Ders ayarla" düğmesi ve iptal süresi için.
        const policy = (
          await tx.query(
            "SELECT enabled,cancel_hours FROM derslik.booking_policy($1)",
            [ws],
          )
        ).rows[0];
```

3. Aynı fonksiyonda `return rawDto({` nesnesinde `...link,` satırının altına ekle:

```ts
          booking: policy
            ? { enabled: policy.enabled, cancelHours: policy.cancel_hours }
            : null,
```

- [ ] **Adım 6: İstemci yöntemleri**

`packages/api-client/src/index.ts`:
1. `import { getLocale, t } from "../../contracts/src/i18n/index.ts";` satırının altına ekle:

```ts
import type {
  BookingPolicy,
  BookingSettings,
} from "../../contracts/src/booking.ts";
```

2. `decideLessonRequest(…) { … }` yönteminin kapanışının altına (sınıfın içinde) ekle:

```ts
  // --- Ders ayarlama (öğretmen) ----------------------------------------
  booking(ws: string) {
    return this.request<{ data: BookingSettings }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/booking`,
    );
  }
  saveBooking(ws: string, body: BookingSettings) {
    return this.request<{ data: BookingSettings }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/booking`,
      { method: "PUT", body },
    );
  }
```

3. `PortalData` tipine, `payments: WorkspaceData["payments"];` satırının altına ekle:

```ts
  /** Öğretmenin ders ayarlama özeti; ayar hiç kaydedilmemişse null. */
  booking: BookingPolicy;
```

- [ ] **Adım 7: Testlerin geçtiğini gör**

Run: `pnpm test`
Expected: PASS. `booking-cases.mjs` içindeki on testin hepsi ve mevcut testler geçer.

Run: `pnpm typecheck && pnpm mobile:typecheck && pnpm lint`
Expected: Hata yok.

- [ ] **Adım 8: Commit**

```bash
git add apps/api/drizzle apps/api/src/booking apps/api/src/learning/learning.service.ts packages/api-client/src/index.ts apps/api/tests/booking-cases.mjs
git commit -m "Ders ayarlama: boş saat, ayarlama ve iptal API'si

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 5: Web, öğretmenin müsaitlik penceresi

**Files:**
- Create: `apps/web/components/derslik/availability-dialog.tsx`
- Modify: `apps/web/components/derslik/views.tsx` (`CalendarView`, `LessonRows`)
- Modify: `apps/web/components/derslik/workspace.tsx` (`CalendarView` çağrısı)

**Interfaces:**
- Consumes: `GET/PUT /api/backend/workspaces/:ws/booking` (Görev 3); `booking.ts` yardımcıları (Görev 1); `booking.*` metinleri (Görev 2).
- Produces: `AvailabilityButton({ workspaceId: string })`. `CalendarView` yeni bir prop alır: `workspaceId: string`.

Arayüz için bileşen testi altyapısı yok. Mantık Görev 1'de birim testleriyle sınandı. Bu görevin denetimi derleme, lint ve Görev 9'daki tarayıcı denemesidir.

- [ ] **Adım 1: Müsaitlik penceresini yaz**

`apps/web/components/derslik/availability-dialog.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { toast } from "sonner";
import { CalendarClock, Plus, X } from "lucide-react";
import { ApiError } from "@derslik/api-client";
import {
  CANCEL_PRESETS,
  DURATION_PRESETS,
  NOTICE_PRESETS,
  bookingSettingsSchema,
  dateKey,
  halfHourOptions,
  isMessageKey,
  nextWindow,
  presetOptions,
  settingsIssues,
  t,
  weekdayName,
  type BookingSettings,
} from "@derslik/contracts";
import { backend, webRequest } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageLoader } from "./loading";
import { FormError } from "./feedback";

// Öğretmenin müsaitliği: öğrencilerin ders ayarlayabileceği haftalık boş
// saatler, kapalı günler ve kurallar (mobil: apps/mobile/src/teacher/availability.tsx).

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TIMES = halfHourOptions();
/** Şema iletisi bir çeviri anahtarıysa etkin dilde; değilse genel uyarı. */
const issueText = (message: string) =>
  isMessageKey(message) ? t(message) : t("api.invalidFields");

/** Takvim araç çubuğundaki "Müsaitlik" düğmesi; yanında açık/kapalı durumu. */
export function AvailabilityButton({ workspaceId }: { workspaceId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    backend<{ data: BookingSettings }>(`/workspaces/${workspaceId}/booking`)
      .then((r) => {
        if (alive) setEnabled(r.data.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock /> {t("booking.availability")}
        {enabled !== null && (
          <span className={enabled ? "text-(--ok)" : "text-muted-foreground"}>
            · {enabled ? t("booking.on") : t("booking.off")}
          </span>
        )}
      </Button>
      {open && (
        <AvailabilityDialog
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
          onSaved={(saved) => setEnabled(saved.enabled)}
        />
      )}
    </>
  );
}

function AvailabilityDialog({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  onClose: () => void;
  onSaved: (settings: BookingSettings) => void;
}) {
  const [form, setForm] = useState<BookingSettings | null>(null),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await backend<{ data: BookingSettings }>(
        `/workspaces/${workspaceId}/booking`,
      );
      setForm(r.data);
      setIssues({});
      setStale(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  /** Formu değiştirir; eski satır hataları artık yanlış satırı gösterebilir. */
  const edit = (change: (f: BookingSettings) => BookingSettings) => {
    setIssues({});
    setForm((f) => (f ? change(f) : f));
  };
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form || busy) return;
    const parsed = bookingSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error.issues));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await webRequest<{ data: BookingSettings }>(
        `/api/backend/workspaces/${workspaceId}/booking`,
        parsed.data,
        "PUT",
      );
      onSaved(r.data);
      toast.success(t("booking.saved"));
      onClose();
    } catch (err) {
      // 409: ayar başka yerde (ör. mobilde) kaydedilmiş; yeniden yükleme sunulur.
      setStale(err instanceof ApiError && err.status === 409);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const issue = (key: string) =>
    issues[key] ? (
      <p className="text-destructive text-sm">{issueText(issues[key])}</p>
    ) : null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("booking.title")}</DialogTitle>
          <DialogDescription>{t("booking.description")}</DialogDescription>
        </DialogHeader>
        {!form ? (
          error ? (
            <div className="grid gap-3">
              <FormError>{error}</FormError>
              <Button
                type="button"
                variant="outline"
                onClick={() => void load()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <PageLoader compact />
          )
        ) : (
          <form onSubmit={save} className="grid gap-6">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="grid gap-1">
                <Label htmlFor="booking-enabled">{t("booking.enabled")}</Label>
                <p className="text-muted-foreground text-sm">
                  {t("booking.enabledHint")}
                </p>
              </div>
              <Switch
                id="booking-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => edit((f) => ({ ...f, enabled }))}
              />
            </div>
            <section className="grid gap-3">
              <div className="grid gap-1">
                <h3 className="font-semibold">{t("booking.weeklyHours")}</h3>
                <p className="text-muted-foreground text-sm">
                  {t("booking.weeklyHoursHint")}
                </p>
              </div>
              {issue("windows")}
              {WEEKDAYS.map((weekday) => {
                const day = weekdayName(weekday);
                const rows = form.windows
                  .map((window, index) => ({ window, index }))
                  .filter((x) => x.window.weekday === weekday);
                const next = nextWindow(form.windows, weekday);
                return (
                  <div
                    key={weekday}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{day}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!next}
                        onClick={() =>
                          next &&
                          edit((f) => ({ ...f, windows: [...f.windows, next] }))
                        }
                      >
                        <Plus /> {t("booking.addRange")}
                      </Button>
                    </div>
                    {!rows.length && (
                      <p className="text-muted-foreground text-sm">
                        {t("booking.dayClosed")}
                      </p>
                    )}
                    {rows.map(({ window, index }) => (
                      <div key={index} className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <TimeSelect
                            label={t("booking.rangeStart", { day })}
                            value={window.start}
                            options={TIMES.slice(0, -1)}
                            onChange={(start) =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.map((w, i) =>
                                  i === index ? { ...w, start } : w,
                                ),
                              }))
                            }
                          />
                          <span aria-hidden="true">–</span>
                          <TimeSelect
                            label={t("booking.rangeEnd", { day })}
                            value={window.end}
                            options={TIMES.slice(1)}
                            onChange={(end) =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.map((w, i) =>
                                  i === index ? { ...w, end } : w,
                                ),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("booking.removeRange")}
                            onClick={() =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            <X />
                          </Button>
                        </div>
                        {issue(`windows.${index}`)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
            <section className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <h3 className="font-semibold">{t("booking.closedDays")}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t("booking.closedDaysHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    edit((f) => ({
                      ...f,
                      blocks: [...f.blocks, { from: dateKey(), to: dateKey() }],
                    }))
                  }
                >
                  <Plus /> {t("booking.addClosedDays")}
                </Button>
              </div>
              {issue("blocks")}
              {!form.blocks.length && (
                <p className="text-muted-foreground text-sm">
                  {t("booking.noClosedDays")}
                </p>
              )}
              {form.blocks.map((block, index) => (
                <div key={index} className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      className="w-auto"
                      aria-label={t("booking.from")}
                      value={block.from}
                      onChange={(e) => {
                        const from = e.target.value;
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.map((b, i) =>
                            i === index ? { ...b, from } : b,
                          ),
                        }));
                      }}
                    />
                    <span aria-hidden="true">–</span>
                    <Input
                      type="date"
                      className="w-auto"
                      aria-label={t("booking.to")}
                      value={block.to}
                      min={block.from}
                      onChange={(e) => {
                        const to = e.target.value;
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.map((b, i) =>
                            i === index ? { ...b, to } : b,
                          ),
                        }));
                      }}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("booking.removeClosedDays")}
                      onClick={() =>
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  {issue(`blocks.${index}`)}
                </div>
              ))}
            </section>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberSelect
                id="booking-duration"
                label={t("booking.duration")}
                value={form.durationMinutes}
                options={presetOptions(DURATION_PRESETS, form.durationMinutes)}
                format={(n) => t("booking.minutes", { count: n })}
                onChange={(durationMinutes) =>
                  edit((f) => ({ ...f, durationMinutes }))
                }
              />
              <NumberSelect
                id="booking-notice"
                label={t("booking.notice")}
                value={form.noticeHours}
                options={presetOptions(NOTICE_PRESETS, form.noticeHours)}
                format={(n) =>
                  n ? t("booking.hours", { count: n }) : t("booking.noticeNone")
                }
                onChange={(noticeHours) => edit((f) => ({ ...f, noticeHours }))}
              />
              <NumberSelect
                id="booking-cancel"
                label={t("booking.cancelWindow")}
                value={form.cancelHours}
                options={presetOptions(CANCEL_PRESETS, form.cancelHours)}
                format={(n) =>
                  n
                    ? t("booking.hoursBefore", { count: n })
                    : t("booking.cancelUntilStart")
                }
                onChange={(cancelHours) => edit((f) => ({ ...f, cancelHours }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="booking-location">{t("booking.location")}</Label>
              <Input
                id="booking-location"
                value={form.location}
                maxLength={100}
                placeholder={t("booking.locationPlaceholder")}
                onChange={(e) => {
                  const location = e.target.value;
                  edit((f) => ({ ...f, location }));
                }}
              />
              {issue("location")}
            </div>
            <p className="text-muted-foreground text-sm">{t("booking.note")}</p>
            {error && (
              <FormError>
                {error}
                {stale && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 ps-2"
                    onClick={() => void load()}
                  >
                    {t("booking.reload")}
                  </Button>
                )}
              </FormError>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberSelect({
  id,
  label,
  value,
  options,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: number[];
  format: (n: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {format(n)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Adım 2: Takvime bağla**

`apps/web/components/derslik/views.tsx`:
1. `import { CalendarFeedButton } from "./calendar-feed";` satırının altına ekle:

```tsx
import { AvailabilityButton } from "./availability-dialog";
```

2. `CalendarView` imzasını değiştir:

```tsx
export function CalendarView({
  data,
  actions,
  selectedDay,
  onSelectDay,
  busy,
  workspaceId,
}: {
  data: WorkspaceData;
  actions: Actions;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  busy: boolean;
  /** Müsaitlik ayarları bu çalışma alanınındır. */
  workspaceId: string;
}) {
```

3. Aynı fonksiyonda `<CalendarFeedButton size="sm" />` satırının üstüne ekle:

```tsx
          <AvailabilityButton workspaceId={workspaceId} />
```

4. `LessonRows` içinde, `meta-credit` sınıflı `span`'ın kapanışının (`</span>`) altına ve `lesson-meta` `div`'inin kapanışından önce ekle:

```tsx
                {l.booked_by && (
                  <ToneBadge tone="info">
                    {t("booking.bookedByStudent")}
                  </ToneBadge>
                )}
```

`apps/web/components/derslik/workspace.tsx` dosyasında `<CalendarView` çağrısına, `busy={busy}` satırının altına ekle:

```tsx
                  workspaceId={connected.id}
```

- [ ] **Adım 3: Derleme ve lint**

Run: `pnpm typecheck && pnpm lint`
Expected: Hata yok.

- [ ] **Adım 4: Commit**

```bash
git add apps/web/components/derslik/availability-dialog.tsx apps/web/components/derslik/views.tsx apps/web/components/derslik/workspace.tsx
git commit -m "Ders ayarlama (web): öğretmen müsaitlik penceresi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 6: Web, öğrencinin ders ayarlaması ve iptali

**Files:**
- Create: `apps/web/components/derslik/learning/booking.tsx`
- Modify: `apps/web/components/derslik/learning/shared.tsx` (`LessonSchedule`, `LessonItem`)
- Modify: `apps/web/components/derslik/learning-panel.tsx`
- Modify: `apps/web/components/derslik/learning/use-learning-panel.tsx` (`LearningPanelProps`)
- Modify: `apps/web/components/derslik/portal.tsx`

**Interfaces:**
- Consumes:
  - Görev 4'ten `/portal/:ws/:student/booking/slots`, `/booking` ve `/booking/:lesson/cancel` uçları.
  - `PortalData.booking` ve `Lesson.booked_by`.
  - `LearningCtx`: `student`, `data`, `base`, `busy`, `setBusy`, `setConfirmation`, `reload`, `workspaceId`, `studentId`.
- Produces:
  - `BookButton({ ctx, onOpenMessages })` ve `BookedLessonExtra({ ctx, lesson, now })`.
  - `LessonSchedule` yeni bir prop alır: `extra?: (lesson, now) => ReactNode`.
  - `LearningPanelProps` yeni bir prop alır: `onOpenMessages?: () => void`.

Portal şu ana kadar bildirim (toast) göstermiyordu: `Toaster` yalnızca öğretmen çalışma alanında takılıydı. Ayarlama ve iptal sonuçları için portala da eklenir.

- [ ] **Adım 1: Ayarlama bileşenlerini yaz**

`apps/web/components/derslik/learning/booking.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, Wallet } from "lucide-react";
import { ApiError } from "@derslik/api-client";
import {
  canCancelBooking,
  cancelDeadline,
  dayLabel,
  dayTimeLabel,
  groupSlotsByDay,
  t,
  timeLabel,
  type BookingSlot,
  type BookingSlots,
} from "@derslik/contracts";
import { backend } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { PageLoader } from "@/components/derslik/loading";
import { FormError, ToneBadge } from "../feedback";
import { EmptyNote, type PortalLesson } from "./shared";
import type { LearningCtx } from "./use-learning-panel";

// Öğrencinin boş saatten ders ayarlaması: "Ders ayarla" düğmesi, ayarlama
// penceresi, derslerdeki etiket ve iptal (mobil: apps/mobile/src/booking.tsx).

/** Yalnızca öğrencide ve öğretmen ayarlamayı açtıysa görünür. */
export function BookButton({
  ctx,
  onOpenMessages,
}: {
  ctx: LearningCtx;
  onOpenMessages?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const booking = "booking" in ctx.data ? ctx.data.booking : null;
  if (!ctx.student || !booking?.enabled) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus /> {t("booking.book")}
      </Button>
      {open && (
        <BookingDialog
          workspaceId={ctx.workspaceId}
          studentId={ctx.studentId}
          onClose={() => setOpen(false)}
          onChanged={() => void ctx.reload()}
          onOpenMessages={onOpenMessages}
        />
      )}
    </>
  );
}

function BookingDialog({
  workspaceId,
  studentId,
  onClose,
  onChanged,
  onOpenMessages,
}: {
  workspaceId: string;
  studentId: string;
  onClose: () => void;
  /** Ders listesi ve ayarlama özeti yenilensin (portal verisi). */
  onChanged: () => void;
  onOpenMessages?: () => void;
}) {
  const base = `/portal/${workspaceId}/${studentId}/booking`;
  const [slots, setSlots] = useState<BookingSlots | null>(null),
    [error, setError] = useState(""),
    [day, setDay] = useState(""),
    [chosen, setChosen] = useState<BookingSlot | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSlots((await backend<{ data: BookingSlots }>(base + "/slots")).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  const days = slots ? groupSlotsByDay(slots.slots) : [];
  const current = days.find((d) => d.day === day) ?? days[0];
  async function book() {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      // Saat, sunucunun döndürdüğü değerle olduğu gibi gönderilir.
      await backend(base, { startsAt: chosen.startsAt });
      toast.success(t("booking.booked"));
      onChanged();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Saat dolmuş, hak bitmiş ya da ayarlama kapanmış olabilir: liste ve
        // portal yenilenir, pencere seçime döner.
        toast.error(e.message);
        setChosen(null);
        onChanged();
        await load();
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const summary = slots
    ? [
        t("booking.minutes", { count: slots.durationMinutes }),
        slots.location || t("lesson.noLocation"),
        t("booking.freeCredits", { count: slots.freeCredits }),
      ].join(" · ")
    : t("booking.bookDescription");
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("booking.book")}</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        {!slots ? (
          error ? (
            <FormError>{error}</FormError>
          ) : (
            <PageLoader compact />
          )
        ) : slots.freeCredits < 1 ? (
          <EmptyNote icon={Wallet} title={t("booking.noCredits")}>
            {t("booking.noCreditsHint")}
            {onOpenMessages && (
              <Button
                variant="link"
                className="h-auto p-0 ps-1"
                onClick={() => {
                  onClose();
                  onOpenMessages();
                }}
              >
                {t("booking.writeTeacher")}
              </Button>
            )}
          </EmptyNote>
        ) : !current ? (
          <EmptyNote icon={CalendarDays} title={t("booking.noSlots")}>
            {t("booking.noSlotsHint")}
          </EmptyNote>
        ) : chosen ? (
          <div className="grid gap-4">
            <Item variant="outline">
              <ItemMedia variant="icon">
                <CalendarDays />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {dayLabel(chosen.startsAt, { weekday: "long" })}
                  {" · "}
                  {timeLabel(chosen.startsAt)}–{timeLabel(chosen.endsAt)}
                </ItemTitle>
                <ItemDescription>
                  {slots.location || t("lesson.noLocation")}
                </ItemDescription>
              </ItemContent>
            </Item>
            <p className="text-muted-foreground text-sm">
              {t("booking.cancelUntil", {
                time: dayTimeLabel(
                  cancelDeadline(
                    chosen.startsAt,
                    slots.cancelHours,
                  ).toISOString(),
                ),
              })}
            </p>
            {error && <FormError>{error}</FormError>}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setChosen(null)}
              >
                {t("booking.back")}
              </Button>
              <Button disabled={busy} onClick={() => void book()}>
                {t("booking.confirm")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div
              role="group"
              aria-label={t("booking.pickDay")}
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {days.map((d) => (
                <Button
                  key={d.day}
                  type="button"
                  size="sm"
                  className="flex-none"
                  variant={d.day === current.day ? "default" : "outline"}
                  aria-pressed={d.day === current.day}
                  onClick={() => setDay(d.day)}
                >
                  {dayLabel(d.day + "T12:00:00+03:00", {
                    weekday: "short",
                    month: "short",
                  })}
                </Button>
              ))}
            </div>
            <div
              role="group"
              aria-label={t("booking.pickTime")}
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {current.slots.map((s) => (
                <Button
                  key={s.startsAt}
                  type="button"
                  variant="outline"
                  onClick={() => setChosen(s)}
                >
                  {timeLabel(s.startsAt)}
                </Button>
              ))}
            </div>
            {error && <FormError>{error}</FormError>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Öğrencinin ayarladığı derste etiket. Öğrenciye, iptal süresi dolmadıysa
 *  "Dersi iptal et" düğmesi, dolduysa öğretmene yazma notu gösterilir. */
export function BookedLessonExtra({
  ctx,
  lesson,
  now,
}: {
  ctx: LearningCtx;
  lesson: PortalLesson;
  now: number;
}) {
  const booking = "booking" in ctx.data ? ctx.data.booking : null;
  const upcoming =
    lesson.status === "SCHEDULED" && Date.parse(lesson.ends_at) > now;
  return (
    <>
      <ToneBadge tone="info">
        {ctx.student ? t("booking.bookedByYou") : t("booking.bookedByStudent")}
      </ToneBadge>
      {ctx.student &&
        upcoming &&
        (canCancelBooking(lesson, booking?.cancelHours ?? 0, now) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ctx.busy}
            onClick={() =>
              ctx.setConfirmation({
                title: t("booking.cancelTitle"),
                description: t("booking.cancelBody", {
                  when: dayTimeLabel(lesson.starts_at),
                }),
                action: t("booking.cancel"),
                perform: () => cancelBooking(ctx, lesson),
              })
            }
          >
            {t("booking.cancel")}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">
            {t("booking.cancelClosed")}
          </span>
        ))}
    </>
  );
}

async function cancelBooking(ctx: LearningCtx, lesson: PortalLesson) {
  ctx.setBusy(true);
  try {
    await backend(`${ctx.base}/booking/${lesson.id}/cancel`, {
      version: lesson.version,
    });
    toast.success(t("booking.cancelled"));
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    ctx.setBusy(false);
    await ctx.reload();
  }
}
```

- [ ] **Adım 2: Ders listesine ek öğe yeri aç**

`apps/web/components/derslik/learning/shared.tsx`:
1. `LessonSchedule` imzasını değiştir:

```tsx
export function LessonSchedule({
  lessons,
  children,
  extra,
}: {
  lessons: PortalLesson[];
  /** Başlığın yanındaki düğmeler (yenile). */
  children?: React.ReactNode;
  /** Dersin yanındaki ek öğe (ayarlama etiketi, iptal). `now` bileşenin
   *  dakikada bir ilerleyen saatidir. */
  extra?: (lesson: PortalLesson, now: number) => React.ReactNode;
}) {
```

2. Yaklaşan dersler listesindeki `<LessonItem` çağrısına, `day={day(l.starts_at)}` satırının altına ekle:

```tsx
              extra={extra?.(l, clock)}
```

3. Geçmiş derslerdeki çağrıyı değiştir:

```tsx
              <LessonItem key={l.id} lesson={l} day={day(l.starts_at)} status />
```

yerine:

```tsx
              <LessonItem
                key={l.id}
                lesson={l}
                day={day(l.starts_at)}
                status
                extra={extra?.(l, clock)}
              />
```

4. `LessonItem` imzasına `extra` ekle:

```tsx
export function LessonItem({
  lesson: l,
  day,
  chip,
  status = false,
  extra,
}: {
  lesson: PortalLesson;
  day: string;
  /** Sıradaki ya da süren ders: kart fosforlu, yanında bu etiket. */
  chip?: string;
  /** Geçmiş derslerde durum rozeti; yaklaşanların hepsi zaten planlı. */
  status?: boolean;
  /** Satırın sağındaki ek öğe (ör. ayarlama etiketi ve iptal). */
  extra?: React.ReactNode;
}) {
```

5. Aynı bileşende:

```tsx
      {(chip || status) && (
        <ItemActions className="ml-auto">
```

yerine:

```tsx
      {(chip || status || extra) && (
        <ItemActions className="ml-auto flex-wrap justify-end">
```

Aynı `ItemActions` içinde, `{status && ( … )}` bloğunun kapanışının altına `{extra}` ekle.

- [ ] **Adım 3: Panele ve portala bağla**

`apps/web/components/derslik/learning/use-learning-panel.tsx` → `LearningPanelProps` tipine, `chat?: …` alanının üstüne ekle:

```ts
  /** Portalda Mesajlar sayfasını açar; boşta hak yokken "Öğretmeninize
   *  yazın" bağlantısı bunu kullanır. */
  onOpenMessages?: () => void;
```

`apps/web/components/derslik/learning-panel.tsx`:
1. `import { ActionForm, ConfirmDialog, LessonSchedule } from "./learning/shared";` satırının altına ekle:

```tsx
import { BookButton, BookedLessonExtra } from "./learning/booking";
```

2. Dersler sekmesi bloğunu değiştir:

```tsx
      {tab === "lessons" && "lessons" in data && (
        <LessonSchedule lessons={data.lessons}>
          {view && refresh}
          {/* Öğretmen kendi takvimini Takvim sayfasından bağlar. */}
          {!owner && <CalendarFeedButton />}
        </LessonSchedule>
      )}
```

yerine:

```tsx
      {tab === "lessons" && "lessons" in data && (
        <LessonSchedule
          lessons={data.lessons}
          extra={(lesson, now) =>
            lesson.booked_by ? (
              <BookedLessonExtra ctx={ctx} lesson={lesson} now={now} />
            ) : null
          }
        >
          <BookButton ctx={ctx} onOpenMessages={props.onOpenMessages} />
          {view && refresh}
          {/* Öğretmen kendi takvimini Takvim sayfasından bağlar. */}
          {!owner && <CalendarFeedButton />}
        </LessonSchedule>
      )}
```

`apps/web/components/derslik/portal.tsx`:
1. `import { Button } from "@/components/ui/button";` satırının altına ekle:

```tsx
import { Toaster } from "@/components/ui/sonner";
```

2. `<LearningPanel` çağrısına, `focus={panelFocus}` satırının altına ekle:

```tsx
        onOpenMessages={
          tabs.some((x) => x.id === "messages")
            ? () => openThread(null)
            : undefined
        }
```

3. Bileşenin son `</SidebarProvider>` satırının hemen üstüne (çıkış onay penceresinden sonra) ekle:

```tsx
      <Toaster position="bottom-right" richColors closeButton />
```

- [ ] **Adım 4: Derleme ve lint**

Run: `pnpm typecheck && pnpm lint`
Expected: Hata yok.

- [ ] **Adım 5: Commit**

```bash
git add apps/web/components/derslik/learning/booking.tsx apps/web/components/derslik/learning/shared.tsx apps/web/components/derslik/learning-panel.tsx apps/web/components/derslik/learning/use-learning-panel.tsx apps/web/components/derslik/portal.tsx
git commit -m "Ders ayarlama (web): öğrencinin ders ayarlaması ve iptali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 7: Mobil, öğretmenin müsaitlik ekranı

**Files:**
- Create: `apps/mobile/src/teacher/availability.tsx`
- Modify: `apps/mobile/src/teacher/calendar.tsx`
- Modify: `apps/mobile/src/teacher/use-teacher-screen.tsx` (`lessonCard`)

**Interfaces:**
- Consumes: Görev 4'ten `client.booking(ws)` ve `client.saveBooking(ws, body)`; Görev 1'den `booking.ts` yardımcıları; mevcut `../ui` bileşenleri (`Toggle`, `Picker`, `Input`, `Field`, `Card`, `SectionHeading`, `IconButton`, `Button`, `CloseButton`, `ErrorText`, `Loading`, `useTheme`).
- Produces: `AvailabilitySheet({ visible, workspaceId, onClose, onSaved })`.

- [ ] **Adım 1: Müsaitlik ekranını yaz**

`apps/mobile/src/teacher/availability.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@derslik/api-client";
import {
  CANCEL_PRESETS,
  DURATION_PRESETS,
  NOTICE_PRESETS,
  bookingSettingsSchema,
  dateKey,
  halfHourOptions,
  isMessageKey,
  nextWindow,
  presetOptions,
  settingsIssues,
  t,
  weekdayName,
  type BookingSettings,
} from "@derslik/contracts";
import { client } from "../core";
import {
  Button,
  Card,
  CloseButton,
  ErrorText,
  Field,
  IconButton,
  Input,
  Loading,
  Picker,
  SectionHeading,
  Toggle,
  useTheme,
} from "../ui";

// Öğretmenin müsaitliği (web: components/derslik/availability-dialog.tsx).

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TIMES = halfHourOptions();
const STARTS = TIMES.slice(0, -1).map((v) => ({ value: v, label: v }));
const ENDS = TIMES.slice(1).map((v) => ({ value: v, label: v }));
/** Şema iletisi bir çeviri anahtarıysa etkin dilde; değilse genel uyarı. */
const issueText = (message: string) =>
  isMessageKey(message) ? t(message) : t("api.invalidFields");

type Props = {
  workspaceId: string;
  onClose: () => void;
  onSaved: (settings: BookingSettings) => void;
};

export function AvailabilitySheet({
  visible,
  ...props
}: Props & { visible: boolean }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      {visible && <AvailabilityBody {...props} />}
    </Modal>
  );
}

function AvailabilityBody({ workspaceId, onClose, onSaved }: Props) {
  const { colors, styles, section } = useTheme();
  const [form, setForm] = useState<BookingSettings | null>(null),
    [issues, setIssues] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setForm((await client.booking(workspaceId)).data);
      setIssues({});
      setStale(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  /** Formu değiştirir; eski satır hataları artık yanlış satırı gösterebilir. */
  const edit = (change: (f: BookingSettings) => BookingSettings) => {
    setIssues({});
    setForm((f) => (f ? change(f) : f));
  };
  async function save() {
    if (!form || busy) return;
    const parsed = bookingSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(settingsIssues(parsed.error.issues));
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved((await client.saveBooking(workspaceId, parsed.data)).data);
      onClose();
    } catch (e) {
      // 409: ayar başka yerde (ör. webde) kaydedilmiş; yeniden yükleme sunulur.
      setStale(e instanceof ApiError && e.status === 409);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rowIssue = (key: string) =>
    issues[key] ? (
      <Text style={section.fieldError}>{issueText(issues[key])}</Text>
    ) : null;
  const numberOptions = (
    presets: readonly number[],
    current: number,
    label: (n: number) => string,
  ) =>
    presetOptions(presets, current).map((n) => ({
      value: String(n),
      label: label(n),
    }));
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {t("booking.title")}
          </Text>
          <Text style={styles.muted} numberOfLines={2}>
            {t("booking.description")}
          </Text>
        </View>
        <CloseButton onPress={onClose} disabled={busy} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.body, { gap: 20 }]}
        >
          {!form ? (
            error ? (
              <>
                <ErrorText message={error} />
                <Button secondary onPress={() => void load()}>
                  {t("common.retry")}
                </Button>
              </>
            ) : (
              <Loading />
            )
          ) : (
            <>
              <Toggle
                label={t("booking.enabled")}
                hint={t("booking.enabledHint")}
                value={form.enabled}
                onChange={(enabled) => edit((f) => ({ ...f, enabled }))}
              />
              <SectionHeading
                title={t("booking.weeklyHours")}
                description={t("booking.weeklyHoursHint")}
              />
              {!!issues.windows && (
                <ErrorText message={issueText(issues.windows)} />
              )}
              {WEEKDAYS.map((weekday) => {
                const day = weekdayName(weekday);
                const rows = form.windows
                  .map((window, index) => ({ window, index }))
                  .filter((x) => x.window.weekday === weekday);
                const next = nextWindow(form.windows, weekday);
                return (
                  <Card key={weekday}>
                    <View
                      style={[styles.row, { justifyContent: "space-between" }]}
                    >
                      <Text style={styles.h2}>{day}</Text>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="add"
                        disabled={!next}
                        onPress={() =>
                          next &&
                          edit((f) => ({ ...f, windows: [...f.windows, next] }))
                        }
                      >
                        {t("booking.addRange")}
                      </Button>
                    </View>
                    {!rows.length && (
                      <Text style={styles.muted}>{t("booking.dayClosed")}</Text>
                    )}
                    {rows.map(({ window, index }) => (
                      <View key={index} style={{ gap: 4 }}>
                        <View
                          style={[styles.row, { flexWrap: "nowrap", gap: 8 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Picker
                              label={t("booking.rangeStart", { day })}
                              value={window.start}
                              options={STARTS}
                              onChange={(start) =>
                                edit((f) => ({
                                  ...f,
                                  windows: f.windows.map((w, i) =>
                                    i === index ? { ...w, start } : w,
                                  ),
                                }))
                              }
                            />
                          </View>
                          <Text style={styles.muted}>–</Text>
                          <View style={{ flex: 1 }}>
                            <Picker
                              label={t("booking.rangeEnd", { day })}
                              value={window.end}
                              options={ENDS}
                              onChange={(end) =>
                                edit((f) => ({
                                  ...f,
                                  windows: f.windows.map((w, i) =>
                                    i === index ? { ...w, end } : w,
                                  ),
                                }))
                              }
                            />
                          </View>
                          <IconButton
                            icon="close"
                            ghost
                            label={t("booking.removeRange")}
                            onPress={() =>
                              edit((f) => ({
                                ...f,
                                windows: f.windows.filter((_, i) => i !== index),
                              }))
                            }
                          />
                        </View>
                        {rowIssue(`windows.${index}`)}
                      </View>
                    ))}
                  </Card>
                );
              })}
              <SectionHeading
                title={t("booking.closedDays")}
                description={t("booking.closedDaysHint")}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="add"
                    onPress={() =>
                      edit((f) => ({
                        ...f,
                        blocks: [
                          ...f.blocks,
                          { from: dateKey(), to: dateKey() },
                        ],
                      }))
                    }
                  >
                    {t("booking.addClosedDays")}
                  </Button>
                }
              />
              {!!issues.blocks && (
                <ErrorText message={issueText(issues.blocks)} />
              )}
              {!form.blocks.length && (
                <Text style={styles.muted}>{t("booking.noClosedDays")}</Text>
              )}
              {form.blocks.map((block, index) => (
                <View key={index} style={{ gap: 4 }}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 8 }]}>
                    <View style={{ flex: 1 }}>
                      <Input
                        accessibilityLabel={t("booking.from")}
                        value={block.from}
                        placeholder={t("mt.datePattern")}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        onChangeText={(from) =>
                          edit((f) => ({
                            ...f,
                            blocks: f.blocks.map((b, i) =>
                              i === index ? { ...b, from } : b,
                            ),
                          }))
                        }
                      />
                    </View>
                    <Text style={styles.muted}>–</Text>
                    <View style={{ flex: 1 }}>
                      <Input
                        accessibilityLabel={t("booking.to")}
                        value={block.to}
                        placeholder={t("mt.datePattern")}
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                        onChangeText={(to) =>
                          edit((f) => ({
                            ...f,
                            blocks: f.blocks.map((b, i) =>
                              i === index ? { ...b, to } : b,
                            ),
                          }))
                        }
                      />
                    </View>
                    <IconButton
                      icon="close"
                      ghost
                      label={t("booking.removeClosedDays")}
                      onPress={() =>
                        edit((f) => ({
                          ...f,
                          blocks: f.blocks.filter((_, i) => i !== index),
                        }))
                      }
                    />
                  </View>
                  {rowIssue(`blocks.${index}`)}
                </View>
              ))}
              <Field label={t("booking.duration")}>
                <Picker
                  label={t("booking.duration")}
                  value={String(form.durationMinutes)}
                  options={numberOptions(
                    DURATION_PRESETS,
                    form.durationMinutes,
                    (n) => t("booking.minutes", { count: n }),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, durationMinutes: Number(v) }))
                  }
                />
              </Field>
              <Field label={t("booking.notice")}>
                <Picker
                  label={t("booking.notice")}
                  value={String(form.noticeHours)}
                  options={numberOptions(NOTICE_PRESETS, form.noticeHours, (n) =>
                    n ? t("booking.hours", { count: n }) : t("booking.noticeNone"),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, noticeHours: Number(v) }))
                  }
                />
              </Field>
              <Field label={t("booking.cancelWindow")}>
                <Picker
                  label={t("booking.cancelWindow")}
                  value={String(form.cancelHours)}
                  options={numberOptions(CANCEL_PRESETS, form.cancelHours, (n) =>
                    n
                      ? t("booking.hoursBefore", { count: n })
                      : t("booking.cancelUntilStart"),
                  )}
                  onChange={(v) =>
                    edit((f) => ({ ...f, cancelHours: Number(v) }))
                  }
                />
              </Field>
              <Field
                label={t("booking.location")}
                error={issues.location ? issueText(issues.location) : undefined}
              >
                <Input
                  accessibilityLabel={t("booking.location")}
                  value={form.location}
                  placeholder={t("booking.locationPlaceholder")}
                  maxLength={100}
                  onChangeText={(location) => edit((f) => ({ ...f, location }))}
                />
              </Field>
              <Text style={styles.hint}>{t("booking.note")}</Text>
              <ErrorText message={error} />
              {stale && (
                <Button secondary onPress={() => void load()}>
                  {t("booking.reload")}
                </Button>
              )}
            </>
          )}
        </ScrollView>
        {!!form && (
          <View style={section.footer}>
            <Button
              secondary
              disabled={busy}
              onPress={onClose}
              style={{ flex: 1 }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              loading={busy}
              onPress={() => void save()}
              style={{ flex: 2 }}
            >
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Adım 2: Takvim bölümüne ve ders kartına bağla**

`apps/mobile/src/teacher/calendar.tsx`:
1. İçe aktarmaları şöyle değiştir (ilk satıra React kancaları, sona istemci ve ekran gelir):

```tsx
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { addDays, dateKey, dayLabel, isDateKey, t } from "@derslik/contracts";
import { Button, EmptyState, IconButton, Input } from "../ui";
import { CalendarFeed } from "../calendar-feed";
import { client } from "../core";
import { AvailabilitySheet } from "./availability";
import { type TeacherCtx } from "./use-teacher-screen";
```

2. Fonksiyonun ilk satırlarını şöyle değiştir:

```tsx
export function CalendarSection({ ctx }: { ctx: TeacherCtx }) {
  const { styles, data, day, setDay, newLesson, lessonCard, access } = ctx;
  const [availability, setAvailability] = useState(false),
    [enabled, setEnabled] = useState<boolean | null>(null);
  // Düğmede ayarlamanın açık mı kapalı mı olduğu görünür.
  useEffect(() => {
    let alive = true;
    client
      .booking(access.id)
      .then((r) => {
        if (alive) setEnabled(r.data.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [access.id]);
```

3. Şu bloğu:

```tsx
      <Button icon="add" onPress={() => newLesson()}>
        {t("ws.planLesson")}
      </Button>
```

şununla değiştir:

```tsx
      <View style={[styles.row, { gap: 8 }]}>
        <Button icon="add" onPress={() => newLesson()} style={{ flex: 1 }}>
          {t("ws.planLesson")}
        </Button>
        <Button
          secondary
          icon="time-outline"
          onPress={() => setAvailability(true)}
          style={{ flex: 1 }}
        >
          {enabled === null
            ? t("booking.availability")
            : `${t("booking.availability")} · ${enabled ? t("booking.on") : t("booking.off")}`}
        </Button>
      </View>
      <AvailabilitySheet
        visible={availability}
        workspaceId={access.id}
        onClose={() => setAvailability(false)}
        onSaved={(saved) => setEnabled(saved.enabled)}
      />
```

`apps/mobile/src/teacher/use-teacher-screen.tsx` → `lessonCard` içinde, telafi rozetini (`t("mt.makeupBadge")`) gösteren `{!!l.makeup_for_id && ( … )}` bloğunun hemen altına ekle:

```tsx
            {!!l.booked_by && (
              <View style={{ marginTop: 4 }}>
                <Badge tone="info" icon="person-outline">
                  {t("booking.bookedByStudent")}
                </Badge>
              </View>
            )}
```

- [ ] **Adım 3: Derleme ve lint**

Run: `pnpm mobile:typecheck && pnpm lint && pnpm mobile:security-test`
Expected: Hata yok.

- [ ] **Adım 4: Commit**

```bash
git add apps/mobile/src/teacher/availability.tsx apps/mobile/src/teacher/calendar.tsx apps/mobile/src/teacher/use-teacher-screen.tsx
git commit -m "Ders ayarlama (mobil): öğretmen müsaitlik ekranı

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 8: Mobil, öğrencinin ders ayarlaması ve iptali

**Files:**
- Create: `apps/mobile/src/booking.tsx`
- Modify: `apps/mobile/src/LearningScreen.tsx`

**Interfaces:**
- Consumes: Görev 4'ün öğrenci uçları (mevcut `request()` ile); `PortalData.booking`; `canCancelBooking`, `cancelDeadline`, `dayTimeLabel`, `groupSlotsByDay`.
- Produces: `BookingSheet({ visible, workspaceId, studentId, onClose, onChanged, onMessage })`.

- [ ] **Adım 1: Ayarlama ekranını yaz**

`apps/mobile/src/booking.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@derslik/api-client";
import {
  cancelDeadline,
  dayLabel,
  dayTimeLabel,
  groupSlotsByDay,
  t,
  timeLabel,
  type BookingSlot,
  type BookingSlots,
} from "@derslik/contracts";
import { request } from "./core";
import {
  Button,
  Card,
  CloseButton,
  EmptyState,
  ErrorText,
  Loading,
  useTheme,
} from "./ui";

// Öğrencinin boş saatten ders ayarlaması (web: components/derslik/learning/booking.tsx).

type Props = {
  workspaceId: string;
  studentId: string;
  onClose: () => void;
  /** Ders listesi ve ayarlama özeti yenilensin. */
  onChanged: () => void;
  /** Mesajlar sekmesini açar; boşta hak yokken gösterilir. */
  onMessage?: () => void;
};

export function BookingSheet({
  visible,
  ...props
}: Props & { visible: boolean }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      {visible && <BookingBody {...props} />}
    </Modal>
  );
}

function BookingBody({
  workspaceId,
  studentId,
  onClose,
  onChanged,
  onMessage,
}: Props) {
  const { colors, styles, section, type } = useTheme();
  const base = `/portal/${workspaceId}/${studentId}/booking`;
  const [slots, setSlots] = useState<BookingSlots | null>(null),
    [error, setError] = useState(""),
    [day, setDay] = useState(""),
    [chosen, setChosen] = useState<BookingSlot | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setSlots((await request<{ data: BookingSlots }>(base + "/slots")).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void load();
  }, [load]);
  const days = slots ? groupSlotsByDay(slots.slots) : [];
  const current = days.find((d) => d.day === day) ?? days[0];
  async function book() {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      // Saat, sunucunun döndürdüğü değerle olduğu gibi gönderilir.
      await request(base, { startsAt: chosen.startsAt });
      onChanged();
      onClose();
    } catch (e) {
      const message = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) {
        // Saat dolmuş, hak bitmiş ya da ayarlama kapanmış olabilir: liste ve
        // dersler yenilenir, seçime dönülür.
        setChosen(null);
        onChanged();
        await load();
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  const summary = slots
    ? [
        t("booking.minutes", { count: slots.durationMinutes }),
        slots.location || t("lesson.noLocation"),
        t("booking.freeCredits", { count: slots.freeCredits }),
      ].join(" · ")
    : t("booking.bookDescription");
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      edges={["top", "bottom"]}
    >
      <View style={section.sheetHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={section.sheetTitle} numberOfLines={1}>
            {t("booking.book")}
          </Text>
          <Text style={styles.muted} numberOfLines={2}>
            {summary}
          </Text>
        </View>
        <CloseButton onPress={onClose} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { gap: 16 }]}>
        {!slots ? (
          error ? (
            <ErrorText message={error} />
          ) : (
            <Loading />
          )
        ) : slots.freeCredits < 1 ? (
          <EmptyState
            icon="wallet-outline"
            title={t("booking.noCredits")}
            description={t("booking.noCreditsHint")}
            action={
              onMessage ? (
                <Button
                  secondary
                  size="sm"
                  icon="chatbubble-outline"
                  onPress={() => {
                    onClose();
                    onMessage();
                  }}
                >
                  {t("booking.writeTeacher")}
                </Button>
              ) : undefined
            }
          />
        ) : !current ? (
          <EmptyState
            icon="calendar-clear-outline"
            title={t("booking.noSlots")}
            description={t("booking.noSlotsHint")}
          />
        ) : chosen ? (
          <Card tone="brand">
            <Text style={styles.h2}>
              {dayLabel(chosen.startsAt, { weekday: "long" })} ·{" "}
              {timeLabel(chosen.startsAt)}–{timeLabel(chosen.endsAt)}
            </Text>
            <Text style={styles.muted}>
              {slots.location || t("lesson.noLocation")}
            </Text>
            <Text style={styles.caption}>
              {t("booking.cancelUntil", {
                time: dayTimeLabel(
                  cancelDeadline(
                    chosen.startsAt,
                    slots.cancelHours,
                  ).toISOString(),
                ),
              })}
            </Text>
          </Card>
        ) : (
          <>
            <Text style={styles.label}>{t("booking.pickDay")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {days.map((d) => {
                const on = d.day === current.day;
                return (
                  <Pressable
                    key={d.day}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setDay(d.day)}
                    style={{
                      minHeight: 40,
                      justifyContent: "center",
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.brandLine : colors.lineControl,
                      backgroundColor: on ? colors.brandSoft : colors.surface,
                    }}
                  >
                    <Text style={{ ...type.medium, color: colors.ink }}>
                      {dayLabel(d.day + "T12:00:00+03:00", {
                        weekday: "short",
                        month: "short",
                      })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.label}>{t("booking.pickTime")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {current.slots.map((s) => (
                <Button
                  key={s.startsAt}
                  secondary
                  size="sm"
                  onPress={() => setChosen(s)}
                  style={{ minWidth: 88 }}
                >
                  {timeLabel(s.startsAt)}
                </Button>
              ))}
            </View>
          </>
        )}
        {!!slots && <ErrorText message={error} />}
      </ScrollView>
      {chosen && (
        <View style={section.footer}>
          <Button
            secondary
            disabled={busy}
            onPress={() => setChosen(null)}
            style={{ flex: 1 }}
          >
            {t("booking.back")}
          </Button>
          <Button
            loading={busy}
            onPress={() => void book()}
            style={{ flex: 2 }}
          >
            {t("booking.confirm")}
          </Button>
        </View>
      )}
    </SafeAreaView>
  );
}
```

- [ ] **Adım 2: Dersler sekmesine bağla**

`apps/mobile/src/LearningScreen.tsx`:
1. `@derslik/contracts` içe aktarmasına `canCancelBooking,` (`canEditSubmission,` satırının üstüne) ve `dayTimeLabel,` (`dayLabel,` satırının altına) ekle. `import { request } from "./core";` satırının altına ekle:

```tsx
import { BookingSheet } from "./booking";
```

2. `[links, setLinks] = useState<StudentAccessList | null>(null);` satırının altına ekle:

```tsx
  // Ders ayarlama penceresi ve iptal düğmesinin saati (liste yenilenince ilerler).
  const [booking, setBooking] = useState(false),
    [clock, setClock] = useState(() => Date.now());
```

3. `reload` içinde `setData(result);` satırının altına ekle:

```tsx
      setClock(Date.now());
```

4. Dersler sekmesinde `{!owner && <CalendarFeed />}` satırının üstüne ekle:

```tsx
            {student && (data as PortalData).booking?.enabled && (
              <Button icon="add" onPress={() => setBooking(true)}>
                {t("booking.book")}
              </Button>
            )}
```

5. Ders kartında, konumu gösteren satırın (`location-outline` simgeli ve `{l.location || t("lesson.noLocation")}` metinli `View`) kapanışının altına, `{ flex: 1, gap: 3 }` sütununun kapanışından önce ekle:

```tsx
                    {!!l.booked_by && (
                      <View
                        style={[
                          styles.row,
                          { gap: 8, marginTop: 4, flexWrap: "wrap" },
                        ]}
                      >
                        <Badge tone="info" icon="person-outline">
                          {student
                            ? t("booking.bookedByYou")
                            : t("booking.bookedByStudent")}
                        </Badge>
                        {student &&
                          l.status === "SCHEDULED" &&
                          Date.parse(l.ends_at) > clock &&
                          (canCancelBooking(
                            l,
                            (data as PortalData).booking?.cancelHours ?? 0,
                            clock,
                          ) ? (
                            <Button
                              variant="danger"
                              size="sm"
                              icon="close"
                              disabled={busy}
                              onPress={() =>
                                confirmAction(
                                  t("booking.cancelTitle"),
                                  t("booking.cancelBody", {
                                    when: dayTimeLabel(l.starts_at),
                                  }),
                                  async () => {
                                    try {
                                      await request(
                                        `${base}/booking/${l.id}/cancel`,
                                        { version: l.version },
                                      );
                                    } finally {
                                      await reload();
                                    }
                                  },
                                  setError,
                                )
                              }
                            >
                              {t("booking.cancel")}
                            </Button>
                          ) : (
                            <Text style={styles.caption}>
                              {t("booking.cancelClosed")}
                            </Text>
                          ))}
                      </View>
                    )}
```

6. `<FormSheet form={form} onClose={() => setForm(null)} />` satırının altına ekle:

```tsx
      {student && (
        <BookingSheet
          visible={booking}
          workspaceId={access.id}
          studentId={studentId}
          onClose={() => setBooking(false)}
          onChanged={() => void reload()}
          onMessage={
            ((data as PortalData).permissions || []).includes("lessons")
              ? () => setTab("messages")
              : undefined
          }
        />
      )}
```

- [ ] **Adım 3: Derleme ve lint**

Run: `pnpm mobile:typecheck && pnpm lint && pnpm mobile:security-test`
Expected: Hata yok.

- [ ] **Adım 4: Commit**

```bash
git add apps/mobile/src/booking.tsx apps/mobile/src/LearningScreen.tsx
git commit -m "Ders ayarlama (mobil): öğrencinin ders ayarlaması ve iptali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Görev 9: Uçtan uca doğrulama ve teslim

**Files:** Kod değişikliği beklenmez. Bulunan hatalar ilgili görevin dosyasında düzeltilir ve ayrı commit'lenir.

**Interfaces:**
- Consumes: Görev 1–8'in hepsi.
- Produces: Doğrulanmış dal, ekran görüntüleri ve güncel PR.

- [ ] **Adım 1: CI'daki bütün denetimleri yerelde çalıştır**

```bash
pnpm typecheck && pnpm mobile:typecheck && pnpm lint && pnpm mobile:security-test && pnpm test && node --test tests/media-config.test.mjs && pnpm test:booking && pnpm test:architecture && pnpm web:build && pnpm web:test
```

Expected: Hepsi geçer. Bir adım kalırsa çıktıyı oku, sorunu ilgili görevin dosyasında düzelt ve komutu yeniden çalıştır.

- [ ] **Adım 2: Web arayüzünü tarayıcıda dene**

1. `preview_start` aracını `{ name: "dev" }` ile çalıştır (`.claude/launch.json`; komut `pnpm dev`, port 3000). Bu komut PostgreSQL'i, göçleri, API'yi ve webi başlatır.
2. Giriş Supabase üzerinden yapıldığı için kullanıcıdan tarayıcı panelinde öğretmen hesabıyla oturum açmasını iste. Şifre ya da hesap bilgisi girme.
3. Öğretmen olarak:
   - Takvim sayfasında "Müsaitlik · Kapalı" düğmesini gör ve pencereyi aç.
   - Bir güne 15:00–19:00 aralığı ekle.
   - Aynı güne çakışan ikinci aralık ekle ve satırın altında "çakışıyor" uyarısını gör; aralığı düzelt.
   - Anahtarı aç ve kaydet. Düğme "Müsaitlik · Açık" olmalı.
   - Ekran görüntüsü al.
4. Bu öğretmenin paketi olan bir öğrenci hesabıyla (kullanıcı oturum açar) portalda Dersler sekmesini aç:
   - "Ders ayarla" düğmesine bas, gün ve saat seç, onay adımında iptal son anını gör ve "Ayarla" de.
   - Dersin "Siz ayarladınız" etiketi ve "Dersi iptal et" düğmesiyle listede göründüğünü gör.
   - Ekran görüntüsü al.
5. Öğretmen hesabında:
   - Takvimde "Öğrenci ayarladı" etiketini ve gelen kutusunda "Öğrenci ders ayarladı" bildirimini gör.
   - Bildirime tıklayınca takvimin açıldığını doğrula.
6. Öğrenci hesabında dersi iptal et. Öğretmene "Öğrenci dersi iptal etti" bildirimi düşmeli.
7. `read_console_messages` ile tarayıcı konsolunda hata olmadığını doğrula.
8. Ekran görüntülerini kullanıcıyla paylaş.

- [ ] **Adım 3: Mobil arayüzü simülatörde dene**

iOS simülatörü varsa uygulamayı çalıştır. Simülatörde de oturumu kullanıcı açar.
- Öğretmen tarafında Takvim sekmesinde "Müsaitlik" ekranını açıp kaydet.
- Öğrenci tarafında Dersler sekmesinde ders ayarla ve iptal et.
- Ekran görüntüsü al.

Simülatör yoksa bunu kullanıcıya açıkça söyle ve mobil denetimi `pnpm mobile:typecheck` ile sınırlı bildir.

- [ ] **Adım 4: Bütün dalı gözden geçir**

`superpowers:requesting-code-review` ile `main...claude/lesson-booking` farkını gözden geçirt. Çıkan bulguları `superpowers:receiving-code-review` ile değerlendirip düzelt; ardından Adım 1'i yeniden çalıştır.

- [ ] **Adım 5: Gönder**

```bash
git push
```

PR açıksa kendiliğinden güncellenir. Açık değilse kullanıcıya açma bağlantısını ver; bu makinede `gh` kurulu değil.

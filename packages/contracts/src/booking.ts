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

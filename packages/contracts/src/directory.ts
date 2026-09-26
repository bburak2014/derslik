import { z } from "zod";

// Öğretmen vitrini: öğretmenler kendilerini listeler, öğrenciler seçip ders
// isteği gönderir. Branş ve seviye serbest metin değil sabit anahtarlardır;
// filtreler ve yedi dildeki adları (`dir.subject.*`, `dir.level.*`) böylece
// her yerde aynı çalışır.
export const teacherSubjects = [
  "math",
  "turkish",
  "literature",
  "english",
  "german",
  "french",
  "spanish",
  "physics",
  "chemistry",
  "biology",
  "science",
  "history",
  "geography",
  "philosophy",
  "coding",
  "music",
  "art",
  "general",
] as const;
export type TeacherSubject = (typeof teacherSubjects)[number];

export const teacherLevels = [
  "primary",
  "middle",
  "high",
  "exam",
  "university",
  "adult",
] as const;
export type TeacherLevel = (typeof teacherLevels)[number];

export const lessonModes = ["ONLINE", "IN_PERSON"] as const;
export type LessonMode = (typeof lessonModes)[number];

export const priceCurrencies = ["TRY", "EUR", "USD", "GBP"] as const;
export type PriceCurrency = (typeof priceCurrencies)[number];

/** Vitrinde konuşulan diller; arayüz dilleriyle aynı kodlar ve birkaç ek. */
export const teachingLanguages = [
  "tr",
  "en",
  "de",
  "fr",
  "es",
  "zh",
  "ja",
  "ar",
  "ru",
  "it",
] as const;
export type TeachingLanguage = (typeof teachingLanguages)[number];

export const teacherSorts = ["recommended", "price", "rating", "new"] as const;
export type TeacherSort = (typeof teacherSorts)[number];

/** Ücret filtresinin hazır üst sınırları (TL/saat); web ve mobil ortak. */
export const priceSteps = [300, 500, 750, 1000, 1500, 2000] as const;

export const requestStatuses = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

/** Vitrin fotoğrafı: istemci kare olarak küçültüp JPEG gönderir. */
export const PHOTO_MAX_BYTES = 300 * 1024;
export const PHOTO_SIZE = 400;
/** Bir öğrencinin 24 saatte gönderebileceği istek sayısı. */
export const REQUESTS_PER_DAY = 10;
/** Reddedilen istekten sonra aynı öğretmene yeniden istek için bekleme. */
export const DECLINE_COOLDOWN_DAYS = 7;

const text = (max: number) => z.string().trim().max(max);
const unique = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .transform((v) => [...new Set(v)] as z.infer<T>[]);

export const teacherProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    headline: text(120),
    bio: text(2000),
    subjects: unique(z.enum(teacherSubjects), 6).refine(
      (v) => v.length > 0,
      "api.pickSubject",
    ),
    levels: unique(z.enum(teacherLevels), teacherLevels.length),
    lessonModes: unique(z.enum(lessonModes), 2).refine(
      (v) => v.length > 0,
      "api.pickLessonMode",
    ),
    city: text(60),
    hourlyPrice: z.number().int().min(0).max(1_000_000).nullable(),
    currency: z.enum(priceCurrencies),
    languages: unique(z.enum(teachingLanguages), teachingLanguages.length),
    experienceYears: z.number().int().min(0).max(80).nullable(),
    published: z.boolean(),
  })
  .strict()
  .refine((v) => !v.lessonModes.includes("IN_PERSON") || v.city.length > 0, {
    message: "api.cityRequired",
    path: ["city"],
  });
export type TeacherProfileInput = z.input<typeof teacherProfileSchema>;

export const teacherFilterSchema = z
  .object({
    q: text(80).optional(),
    subject: z.enum(teacherSubjects).optional(),
    level: z.enum(teacherLevels).optional(),
    mode: z.enum(lessonModes).optional(),
    city: text(60).optional(),
    maxPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
    sort: z.enum(teacherSorts).default("recommended"),
    page: z.coerce.number().int().min(1).max(500).default(1),
  })
  .strip();
export type TeacherFilter = z.input<typeof teacherFilterSchema>;
export const TEACHERS_PER_PAGE = 24;

export const lessonRequestSchema = z
  .object({
    studentName: z.string().trim().min(2).max(100),
    subject: z.enum(teacherSubjects),
    level: z.union([z.literal(""), z.enum(teacherLevels)]),
    phone: text(30),
    message: text(1000),
  })
  .strict();
export type LessonRequestInput = z.input<typeof lessonRequestSchema>;

export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: text(500),
  })
  .strict();
export type ReviewInput = z.input<typeof reviewSchema>;

export const photoSchema = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z
      .string()
      .max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

/** Vitrin kartı ve profil: API'nin herkese açık döndürdüğü alanlar. */
export type PublicTeacher = {
  id: string;
  displayName: string;
  headline: string;
  bio: string;
  subjects: TeacherSubject[];
  levels: TeacherLevel[];
  lessonModes: LessonMode[];
  city: string;
  hourlyPrice: number | null;
  currency: PriceCurrency;
  languages: TeachingLanguage[];
  experienceYears: number | null;
  photoVersion: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  publishedAt: string;
};
export type PublicReview = {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};
export type TeacherProfile = Omit<
  PublicTeacher,
  "id" | "ratingAverage" | "ratingCount" | "publishedAt"
> & {
  published: boolean;
  publishedAt: string | null;
};
export type LessonRequest = {
  id: string;
  workspaceId: string;
  studentName: string;
  subject: TeacherSubject;
  level: TeacherLevel | "";
  phone: string;
  email: string;
  message: string;
  status: RequestStatus;
  studentId: string | null;
  createdAt: string;
  decidedAt: string | null;
};
/** Öğrencinin kendi istekleri; öğretmenin vitrin adı ve fotoğrafıyla. */
export type MyLessonRequest = LessonRequest & {
  teacherName: string;
  teacherPhotoVersion: number | null;
};
/** Giriş yapmış kişinin bir öğretmenle ilişkisi (profil sayfasındaki düğmeler). */
export type TeacherRelation = {
  isOwn: boolean;
  isStudent: boolean;
  request: LessonRequest | null;
  canReview: boolean;
  review: PublicReview | null;
  /** Reddedildiyse yeniden istek gönderilebilecek an. */
  retryAfter: string | null;
};
export type Showcase = {
  profile: TeacherProfile | null;
  requests: LessonRequest[];
  reviews: PublicReview[];
  ratingAverage: number | null;
  ratingCount: number;
};

/** "Ayşe Kaya" → "Ayşe K."; yorumlarda öğrencinin tam adı görünmez. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(" ")} ${last.charAt(0).toLocaleUpperCase("tr")}.`;
}

export const photoPath = (id: string, version: number | null) =>
  version ? `/v1/teachers/${id}/photo?v=${version}` : null;

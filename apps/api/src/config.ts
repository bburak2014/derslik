import { z } from "zod";

export const CONFIG = Symbol("API_CONFIG");
export type ApiConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      API_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
      API_HOST: z.string().default("127.0.0.1"),
      DATABASE_URL: z.string().url(),
      DATABASE_SSL: z.enum(["true", "false"]).default("false"),
      AUTH_ISSUER: z.string().url(),
      AUTH_AUDIENCE: z.string().default("authenticated"),
      CORS_ORIGINS: z.string().default(""),
      WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
      SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
      SUPABASE_SECRET_KEY: z.string().optional(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
      STORAGE_BUCKET: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .default("derslik-materials"),
      CLOUDFLARE_ACCOUNT_ID: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
      CLOUDFLARE_STREAM_TOKEN: z.string().optional(),
      LEMONSQUEEZY_API_KEY: z.string().optional(),
      LEMONSQUEEZY_STORE_ID: z.string().regex(/^\d+$/).optional(),
      LEMONSQUEEZY_VARIANT_ID: z.string().regex(/^\d+$/).optional(),
      LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional(),
      LEMONSQUEEZY_TEST_MODE: z.enum(["true", "false"]).default("true"),
      CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),
      // Davet e-postası. İkisi de tanımlı değilse gönderim atlanır.
      RESEND_API_KEY: z.string().optional(),
      MAIL_FROM: z.string().optional(),
      // Ders hatırlatması dersten kaç dakika önce gitsin. 0 kapatır.
      LESSON_REMINDER_MINUTES: z.coerce
        .number()
        .int()
        .min(0)
        .max(1440)
        .default(60),
      // Hız sınırı (dakikada istek). 0 kapatır. Oturumlu istekler hesap
      // başına, herkese açık vitrin istekleri IP başına sayılır.
      RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().min(0).default(600),
      RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(0).default(120),
      // Takvim akışı bağlantı başına sayılır: Google ve Apple bütün
      // abonelikleri birkaç ortak sunucudan okur, IP başına sınır onları keserdi.
      RATE_LIMIT_CALENDAR_PER_MINUTE: z.coerce
        .number()
        .int()
        .min(0)
        .default(30),
      // İstemci IP'si X-Forwarded-For'dan yalnızca bu adreslerden gelen
      // isteklerde okunur (Express "trust proxy"). Varsayılan: aynı makine ve
      // özel ağ (web sunucusu, Docker ağı, yük dengeleyici).
      TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal"),
    })
    .parse(
      Object.fromEntries(
        Object.entries(env).map(([key, value]) => [
          key,
          value === "" ? undefined : value,
        ]),
      ),
    );
  const issuer = parsed.AUTH_ISSUER.replace(/\/$/, "");
  const url = new URL(issuer);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("AUTH_ISSUER must be a plain issuer URL.");
  }
  if (parsed.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production AUTH_ISSUER requires HTTPS.");
  }
  const origins = parsed.CORS_ORIGINS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (origin === "*" || new URL(origin).origin !== origin) {
      throw new Error(
        "CORS_ORIGINS must contain exact origins, without paths or wildcards.",
      );
    }
  }
  return { ...parsed, AUTH_ISSUER: issuer, origins };
}

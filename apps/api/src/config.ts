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

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { syncEnv } from "./sync-env.mjs";
const root = resolve(import.meta.dirname, "..");
async function create(file, contents) {
  try {
    await writeFile(resolve(root, file), contents, { flag: "wx", mode: 0o600 });
    console.log(file + " oluşturuldu.");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    console.log(file + " zaten var; korundu.");
  }
}
const admin = randomBytes(32).toString("hex"),
  runtime = randomBytes(32).toString("hex");
await create(
  ".env.api",
  `# Yerel ayarlar. Git'e eklemeyin.
POSTGRES_PASSWORD=${admin}
API_DATABASE_PASSWORD=${runtime}
POSTGRES_PORT=5433
API_HTTP_PORT=3001
API_BIND_ADDRESS=0.0.0.0
MOBILE_API_HOST=
API_PUBLIC_URL=
WEB_HTTP_PORT=3000
AUTH_ISSUER=https://YOUR_PROJECT.supabase.co/auth/v1
AUTH_AUDIENCE=authenticated
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STORAGE_BUCKET=derslik-materials
CORS_ORIGINS=http://localhost:3000
APP_ORIGIN=http://localhost:3000
WEB_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://derslik_app:${runtime}@127.0.0.1:5433/derslik
DATABASE_ADMIN_URL=postgresql://postgres:${admin}@127.0.0.1:5433/derslik
DATABASE_SSL=false
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_STREAM_TOKEN=
CLOUDFLARE_STREAM_WEBHOOK_SECRET=
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_VARIANT_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_TEST_MODE=true
`,
);
await syncEnv();
console.log(
  "Kurulum: docs/kurulum.md. Bağlantı bilgilerini yalnızca .env.api dosyasında doldurun; sonra pnpm dev çalıştırın.",
);

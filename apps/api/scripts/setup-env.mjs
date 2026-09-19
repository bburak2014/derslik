import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const admin = randomBytes(32).toString("hex"),
  runtime = randomBytes(32).toString("hex");
const target = resolve(".env.api");
const contents = `# Local configuration. Never commit this file.
POSTGRES_PASSWORD=${admin}
API_DATABASE_PASSWORD=${runtime}
POSTGRES_PORT=5433
API_HTTP_PORT=3001
AUTH_ISSUER=https://YOUR_PROJECT.supabase.co/auth/v1
AUTH_AUDIENCE=authenticated
CORS_ORIGINS=http://localhost:3000
DATABASE_URL=postgresql://derslik_app:${runtime}@127.0.0.1:5433/derslik
DATABASE_ADMIN_URL=postgresql://postgres:${admin}@127.0.0.1:5433/derslik
DATABASE_SSL=false
`;
try {
  await writeFile(target, contents, { flag: "wx", mode: 0o600 });
  console.log(
    ".env.api oluşturuldu. AUTH_ISSUER alanına kendi Supabase proje adresinizi yazın.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(".env.api zaten var; mevcut ayarlar değiştirilmedi.");
  process.exitCode = 1;
}

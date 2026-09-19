import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { clientEnvironment } from "../scripts/sync-env.mjs";

test("web runtime has no independent database or teaching service", async () => {
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inspect(path);
      else if (/\.[jt]sx?$/.test(entry.name)) {
        const code = await readFile(path, "utf8");
        assert.doesNotMatch(
          code,
          /cloudflare:workers|D1Database|R2Bucket|drizzle-orm|from ["']pg["']|getDb\(|\/api\/teaching/,
          path,
        );
      }
    }
  }
  for (const path of [
    "apps/web/app",
    "apps/web/lib",
    "apps/web/components/derslik",
  ])
    await inspect(path);
});

test("one configuration points web and mobile to one API without copying backend secrets", () => {
  const api = {
    API_PUBLIC_URL: "https://api.example.test",
    API_HTTP_PORT: "3001",
    AUTH_ISSUER: "https://auth.example.test/auth/v1",
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    DATABASE_URL: "postgresql://private-secret",
    SUPABASE_SERVICE_ROLE_KEY: "private-secret",
    CLOUDFLARE_STREAM_TOKEN: "private-secret",
    LEMONSQUEEZY_API_KEY: "private-secret",
  };
  const result = clientEnvironment(api, "192.168.1.50");
  assert.equal(result.web.API_BASE_URL, result.mobile.EXPO_PUBLIC_API_URL);
  assert.equal(result.web.SUPABASE_URL, result.mobile.EXPO_PUBLIC_SUPABASE_URL);
  assert.doesNotMatch(JSON.stringify(result), /private-secret/);
  const local = clientEnvironment(
    { ...api, API_PUBLIC_URL: "" },
    "192.168.1.50",
  );
  assert.equal(local.web.API_BASE_URL, "http://127.0.0.1:3001");
  assert.equal(local.mobile.EXPO_PUBLIC_API_URL, "http://192.168.1.50:3001");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaProviders } from "../.api-build/apps/api/src/media/providers.js";
import { merge } from "../scripts/sync-env.mjs";

const config = {
  NODE_ENV: "development",
  AUTH_ISSUER: "https://example.supabase.co/auth/v1",
  STORAGE_BUCKET: "derslik-materials",
};
test("modern storage keys use apikey, legacy JWT keys retain Bearer", async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ public: false });
    };
    const modern = new MediaProviders({
      ...config,
      SUPABASE_SECRET_KEY: "sb_secret_test",
      SUPABASE_SERVICE_ROLE_KEY: "old.jwt",
    });
    assert.equal((await modern.capabilities()).files, true);
    assert.equal(calls[0].init.headers.apikey, "sb_secret_test");
    assert.equal(calls[0].init.headers.Authorization, undefined);
    const legacy = new MediaProviders({
      ...config,
      SUPABASE_SERVICE_ROLE_KEY: "old.jwt",
    });
    await legacy.storage("/bucket/derslik-materials");
    assert.equal(calls[1].init.headers.Authorization, "Bearer old.jwt");
    globalThis.fetch = async () => Response.json({ public: true });
    assert.equal((await modern.capabilities()).files, false);
    globalThis.fetch = async () => new Response("", { status: 503 });
    assert.equal((await modern.capabilities()).files, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("missing media config stays unavailable; local video permits manual verification but production requires webhook", async () => {
  const missing = new MediaProviders(config);
  assert.deepEqual(await missing.capabilities(), {
    files: false,
    videos: false,
    fileMessage:
      "Dosya yükleme şu anda kullanılamıyor. Lütfen daha sonra yeniden deneyin.",
    videoMessage: "Video yükleme henüz kullanıma açılmadı.",
  });
  assert.throws(() => missing.streamReady(), /yapılandırılmamış/);
  const local = {
    ...config,
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_STREAM_TOKEN: "test",
  };
  assert.doesNotThrow(() => new MediaProviders(local).streamReady());
  assert.throws(() =>
    new MediaProviders({ ...local, NODE_ENV: "production" }).streamReady(),
  );
  assert.doesNotThrow(() =>
    new MediaProviders({
      ...local,
      NODE_ENV: "production",
      CLOUDFLARE_STREAM_WEBHOOK_SECRET: "test",
    }).streamReady(),
  );
});
test("syncing unchanged client settings leaves file mtime untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "derslik-env-"));
  try {
    const file = join(dir, "client.env");
    await merge(file, { EXPO_PUBLIC_API_URL: "http://192.0.2.1:3001" });
    const before = await stat(file, { bigint: true });
    await merge(file, { EXPO_PUBLIC_API_URL: "http://192.0.2.1:3001" });
    assert.equal((await stat(file, { bigint: true })).mtimeNs, before.mtimeNs);
    await merge(file, { EXPO_PUBLIC_API_URL: "http://192.0.2.2:3001" });
    assert.notEqual(
      (await stat(file, { bigint: true })).mtimeNs,
      before.mtimeNs,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

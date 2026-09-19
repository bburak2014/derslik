// Run from the root after filling .env.api:
// node --env-file=.env.api apps/api/scripts/setup-storage.mjs
const issuer = process.env.AUTH_ISSUER,
  key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket = process.env.STORAGE_BUCKET || "derslik-materials";
if (!issuer || !key || !/^[a-z0-9-]+$/.test(bucket))
  throw new Error(
    "AUTH_ISSUER, SUPABASE_SECRET_KEY (veya eski service_role anahtarı) ve geçerli STORAGE_BUCKET gerekli.",
  );
const root = new URL("/storage/v1/bucket", issuer).href,
  headers = {
    ...(!key.startsWith("sb_secret_")
      ? { Authorization: `Bearer ${key}` }
      : {}),
    apikey: key,
    "Content-Type": "application/json",
  };
const existing = await fetch(root + "/" + bucket, { headers });

if (!existing.ok) {
  const detail = await existing.json().catch(() => ({}));

  const bucketMissing =
    detail.code === "NoSuchBucket" ||
    (existing.status === 400 &&
      /^bucket not found\.?$/i.test(detail.message || ""));

  if (!bucketMissing) {
    const message = String(
      detail.message || detail.error || "Ayrıntı bulunamadı"
    ).replaceAll(key, "[GİZLENDİ]");

    throw new Error(
      `Storage hatası (${existing.status}): ${message}`
    );
  }
}
const body = {
  id: bucket,
  name: bucket,
  public: false,
  file_size_limit: 10485760,
  allowed_mime_types: [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
};
const response = await fetch(existing.ok ? root + "/" + bucket : root, {
  method: existing.ok ? "PUT" : "POST",
  headers,
  body: JSON.stringify(body),
});
if (!response.ok)
  throw new Error("Özel depolama alanı yapılandırılamadı: " + response.status);
console.log(
  "Özel dosya alanı hazır: " +
    bucket +
    " (10 MB; PDF/JPG/PNG/WebP). Doğrudan istemci erişim politikası eklemeyin.",
);

import { readApiEnv } from "./sync-env.mjs";
const env = await readApiEnv();
const url = env.SUPABASE_URL || env.AUTH_ISSUER?.replace(/\/auth\/v1\/?$/, "");
async function check(label, action) {
  try {
    console.log(`${label}: ${await action()}`);
  } catch {
    console.log(
      `${label}: bağlantı doğrulanamadı. Hesap, anahtar ve ağ erişimini kontrol edin.`,
    );
    process.exitCode = 1;
  }
}
await check("Sosyal giriş", async () => {
  if (!url || !env.SUPABASE_PUBLISHABLE_KEY)
    return "SUPABASE_URL ve SUPABASE_PUBLISHABLE_KEY eksik.";
  const r = await fetch(new URL("/auth/v1/settings", url), {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error();
  const settings = await r.json();
  const enabled = ["google", "apple", "azure"].filter(
    (p) => settings.external?.[p] === true,
  );
  return enabled.length
    ? enabled.join(", ") +
        " etkin. Gerçek giriş ve dönüş adreslerini ayrıca deneyin."
    : "Google/Apple/Microsoft kapalı. Supabase Authentication > Providers bölümünden etkinleştirin.";
});
await check("PDF ve dosyalar", async () => {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return "SUPABASE_SECRET_KEY eksik; yalnızca .env.api içine ekleyin, ardından pnpm storage:setup çalıştırın.";
  const r = await fetch(
    new URL(
      "/storage/v1/bucket/" + (env.STORAGE_BUCKET || "derslik-materials"),
      url,
    ),
    {
      headers: {
        apikey: key,
        ...(!key.startsWith("sb_secret_")
          ? { Authorization: `Bearer ${key}` }
          : {}),
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (r.status === 404)
    return "Depolama alanı yok. pnpm storage:setup çalıştırın.";
  if (!r.ok) throw Error();
  const bucket = await r.json();
  return bucket.public === false
    ? "Özel depolama alanına erişildi."
    : "Alan public; pnpm storage:setup ile özel alana dönüştürün.";
});
await check("Video", async () => {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_TOKEN)
    return "CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_STREAM_TOKEN eksik. Cloudflare Stream hesabı gerekli.";
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID))
    return "CLOUDFLARE_ACCOUNT_ID geçersiz; 32 karakterli hesap kimliğini kullanın.";
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream?limit=1`,
    {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_STREAM_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!r.ok || !(await r.json()).success) throw Error();
  return env.CLOUDFLARE_STREAM_WEBHOOK_SECRET
    ? "Hesaba erişildi. Webhook teslimini gerçek yükleme ile doğrulayın."
    : "Hesaba erişildi. Yerelde Durumu yenile kullanılabilir; üretimde webhook secret gerekli.";
});

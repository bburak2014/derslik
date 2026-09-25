# Canlıya geçiş kontrol listesi (v4 → v6)

Bu liste `docs/kurulum.md`, `docs/guncelleme-v6.md` ve `docs/veri-gecisi.md` belgelerini tek sıraya dizer. Hiçbir adım bu belgeyle uygulanmadı; canlı v4 Site, D1 veritabanı ve R2 dosyaları olduğu gibi duruyor.

İşaretler:

- 🔑 **Senin hesabın gerekir**: panelde hesap açma, ödeme, doğrulama, anahtar üretme. Bunu yalnızca sen yapabilirsin.
- 🛠 **Kod/komut**: depo içinden yapılabilir; hesap anahtarlarını sen verdikten sonra Claude da hazırlayabilir.
- ⚠️ **Geri alınamaz veya canlıyı etkiler**: yalnızca sen açıkça “başla” dediğinde.

## 0. Başlamadan önce bilinmesi gerekenler

- [ ] **Veri aktarım aracı yok.** `pnpm migration:check` yalnızca yedeği denetler (`scripts/legacy-preflight.mjs`); veritabanına yazan bir importer, dosya/video taşıyıcı depoda bulunmuyor. Adım 6 ve 7 için önce bu araçların yazılıp test edilmesi gerekir. 🛠
- [ ] **Resend ayarları `.env.api` örneğinde yok.** Kod `RESEND_API_KEY` ve `MAIL_FROM` okuyor (`apps/api/src/config.ts`, `apps/api/src/access/mail.ts`) ama `apps/api/.env.example` ve kurulum belgesinde geçmiyor. Tanımlı değilse davet e-postası sessizce atlanır; bağlantı kopyalama yine çalışır. 🛠
- [ ] Sunucu ve alan adları seçilmeli: API için bir Node/Docker sunucusu (Nest, Sites Worker içinde çalışmaz), PostgreSQL, API alan adı (örn. `api.alanadin.com`) ve web alan adı. 🔑

## 1. Sunucu ve PostgreSQL

- [ ] Sunucu/container ortamını kirala; Node 24, Docker ve HTTPS reverse proxy kur. 🔑
- [ ] API ve web alan adlarının DNS kayıtlarını sunucuya yönlendir, TLS sertifikası al. 🔑
- [ ] Üretim PostgreSQL'ini kur (Compose'daki `postgres` veya yönetilen servis). Yönetilen servisse sertifikalı TLS ile `DATABASE_SSL=true`. 🔑
- [ ] `node apps/api/scripts/setup-env.mjs` ile güçlü `POSTGRES_PASSWORD` / `API_DATABASE_PASSWORD` üret; üretim `.env.api` dosyasını yalnızca sunucuda tut. 🛠
- [ ] Göçleri admin rolüyle uygula: `0000`–`0004` (`apps/api/drizzle/`), `pnpm api:migrate`. API runtime'ı kısıtlı `derslik_app` rolüyle çalışmalı, `DATABASE_ADMIN_URL` runtime'a verilmemeli. 🛠
- [ ] Günlük veritabanı yedeği ve bir geri yükleme denemesi, istek hız sınırı, log izleme. 🔑🛠

## 2. Supabase (Auth + Storage)

- [ ] Üretim için Supabase projesi aç (geliştirme projesinden ayrı önerilir). 🔑
- [ ] Authentication: e-posta/şifre girişi ve e-posta doğrulaması açık; imzalama anahtarı **ES256 veya RS256** (HS256 kabul edilmez). 🔑
- [ ] Site URL = canlı web adresi. Redirect URLs: `https://WEB/api/auth/callback`, `https://WEB/api/auth/callback?next=/reset-password`, `derslik://auth/callback`, `derslik://auth/confirm`, `derslik://auth/recovery`. **`exp://**` ve `localhost` satırlarını canlı projeye ekleme.** 🔑
- [ ] Kendi SMTP ayarını gir (Supabase'in yerleşik e-postası düşük limitlidir); doğrulama ve şifre sıfırlama e-postasını gerçek bir adrese gönderip dene. 🔑
- [ ] İstenirse Google / Apple / Microsoft sağlayıcılarını aç; Client ID/secret yalnızca Supabase paneline. Dönüş adresi `https://PROJE.supabase.co/auth/v1/callback`. Google'ı test modundan çıkar, Apple secret'ının bitiş tarihini takvime yaz. 🔑
- [ ] Yeni bir `sb_secret_...` anahtarı üret. Daha önce sohbette veya başka yerde paylaşılmış anahtar varsa iptal et. 🔑
- [ ] `STORAGE_BUCKET=derslik-materials` ile `pnpm storage:setup` çalıştır (private, 10 MB, PDF/JPEG/PNG/WebP). 🛠

## 3. Cloudflare Stream

- [ ] Stream'i Cloudflare hesabında etkinleştir; ücretli plan seç. 🔑
- [ ] Yalnızca Stream düzenleme yetkili bir API token oluştur; 32 karakterlik hesap kimliğini not al. 🔑
- [ ] Webhook hedefini `https://API/v1/webhooks/stream` olarak kaydet, verilen secret'ı al. Hesapta tek video webhook'u olduğundan başka ürün kullanıyorsa önce kontrol et. 🔑
- [ ] Üretimde webhook secret zorunlu: `NODE_ENV=production` iken secret yoksa video yükleme kapalı görünür (`apps/api/src/media/providers.ts`). 🛠

## 4. Lemon Squeezy (Derslik Pro aboneliği)

- [ ] Mağazayı aç ve hesap/kimlik doğrulamasını tamamla (onay birkaç gün sürebilir; erken başla). 🔑
- [ ] Aylık abonelik ürünü ve variant oluştur, fiyatı belirle. 🔑
- [ ] Webhook: `https://API/v1/webhooks/subscriptions`; oluşturma, güncelleme, iptal, devam, sona erme olayları. 🔑
- [ ] Önce `LEMONSQUEEZY_TEST_MODE=true` ile checkout, yenileme, iptal ve webhook'u kendi hesabınla dene. 🔑🛠
- [ ] Canlıya geçerken canlı API key / store / variant / webhook secret ile değiştir ve `LEMONSQUEEZY_TEST_MODE=false`. Test ve canlı olaylar karışırsa reddedilir. 🔑⚠️

## 5. Resend (davet e-postaları)

- [ ] Resend hesabı aç, gönderen alan adını ekle ve DNS'te SPF/DKIM kayıtlarını doğrula. 🔑
- [ ] API key üret. 🔑
- [ ] `.env.api` içine `RESEND_API_KEY` ve `MAIL_FROM` (örn. `Derslik <davet@alanadin.com>`) ekle; `.env.example` ve `kurulum.md`'ye de eklenmeli. 🛠
- [ ] Bir öğrenci/veli daveti gönderip e-postanın geldiğini ve bağlantının açıldığını doğrula. 🔑🛠

## 6. Üretim ortam değişkenleri

**API (`.env.api`, yalnızca sunucuda):**

| Değişken | Kaynak | Not |
| --- | --- | --- |
| `NODE_ENV=production` | — | HTTPS issuer ve webhook secret zorunluluğunu açar |
| `DATABASE_URL`, `DATABASE_SSL` | Adım 1 | runtime rolü `derslik_app` |
| `POSTGRES_PASSWORD`, `API_DATABASE_PASSWORD` | Adım 1 | `setup-env.mjs` üretir |
| `AUTH_ISSUER` | Supabase 🔑 | `https://PROJE.supabase.co/auth/v1` |
| `AUTH_AUDIENCE=authenticated` | — | |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase 🔑 | |
| `SUPABASE_SECRET_KEY` | Supabase 🔑 | yalnızca backend |
| `STORAGE_BUCKET=derslik-materials` | — | |
| `APP_ORIGIN`, `WEB_ORIGIN`, `CORS_ORIGINS` | alan adı | tam origin, yol ve `*` yok |
| `API_PUBLIC_URL` | alan adı | `https://API`; web ve mobil bunu kullanır |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | Cloudflare 🔑 | |
| `LEMONSQUEEZY_API_KEY`, `_STORE_ID`, `_VARIANT_ID`, `_WEBHOOK_SECRET`, `_TEST_MODE` | Lemon Squeezy 🔑 | |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend 🔑 | örnek dosyada eksik |

**Web (Sites ortamı):** `API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`. Hiçbir secret web ortamına girmez. ⚠️ Bunları canlı Site'a vermek v5/v6'yı yayına almak demektir; Adım 9'a kadar bekle.

**Mobil (derlemeye gömülür):** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `pnpm env:sync` ile `.env.api`'den üretilir.

- [ ] `pnpm services:check` üretim `.env.api` ile her sağlayıcı için olumlu sonuç versin. 🛠

## 7. v4 verisini hazırla ve aktar (`docs/veri-gecisi.md`)

- [ ] ⚠️ Eski Site'da kayıt ve yüklemeyi durdur (bakım duyurusu). UPLOADING/DELETING dosyaları tamamla veya iptal et. 🔑
- [ ] D1'deki 11 tablonun **tam** dışa aktarımını al (ekrandaki ilk 25 satır değil) ve tüm R2 nesnelerini indir. Platform bu erişimi vermiyorsa dur, v4'ü koru. 🔑
- [ ] Orijinal D1 SQL, R2 dosyaları ve varsa `.wrangler/state` kopyasını Git dışında güvenli yerde sakla. 🔑
- [ ] Yedeği `derslik-d1-v4` JSON zarfına koy; para değerlerini tam sayı string olarak, dosyaları `objects/teaching/WORKSPACE_UUID/FILE_UUID` anahtarıyla. 🛠
- [ ] `pnpm migration:check snapshot.json objects aktarim-on-kontrol.json` → `sourceValidated=true`. 🛠
- [ ] Canlı olmayan hedefte eski owner'ı **doğrulanmış Supabase kullanıcı UUID'sine** eşle; öğretmenin yeni Supabase hesabını önce aç. 🔑
- [ ] **Importer'ı yaz ve test veritabanında dene** (şu an yok): tek transaction, aynı UUID/sürüm/tarihler, kredi hareketlerini yeniden üretmeden doğrudan kopyalama, ödemeleri paket borçlarına deterministik dağıtma, çakışma raporu, aktarım makbuzu, kör `upsert` yok. 🛠
- [ ] PDF/görselleri private bucket'a taşı; boyut, MIME ve imza doğrulamasından sonra READY. 🛠
- [ ] R2 videolarını Stream'e signed URL zorunlu olarak yeniden yükle, UID'yi yaz, işlenme ve private oynatmayı doğrula. 🛠
- [ ] ⚠️ Importer'ı üretim veritabanında çalıştır. 🛠 (onayınla)

## 8. Doğrulama

- [ ] Her çalışma alanında öğrenci/ödev/ders/paket/ödeme/hareket sayıları, kalan haklar, tahsilat ve borç toplamları kaynakla eşleşiyor. 🛠
- [ ] Her READY dosya indirilebiliyor, her video izlenebiliyor. 🔑🛠
- [ ] Aynı hesapla web ve mobilde aynı UUID ve durumlar; bir tarafta açılan kayıt diğerinde görünüyor. 🔑
- [ ] Başka öğretmen/veli hesabı bu verilere erişemiyor. 🔑
- [ ] Giriş, şifre sıfırlama, sosyal giriş, PDF, video, abonelik checkout ve davet e-postası canlı adreslerle çalışıyor. 🔑

## 9. Geçiş

- [ ] ⚠️ Sites web ortamına Adım 6'daki dört değişkeni gir ve v6 web sürümünü yayımla. 🔑
- [ ] Mobil: kendi Expo/Apple/Google hesaplarınla `eas.json` profilleriyle APK/TestFlight derlemesi al, mağaza kaydını yap. 🔑
- [ ] Yeni kayıt yazılmaya başladıktan sonra v4'e kör geri dönüş yok; geri dönüş gerekirse yeni kayıtları koruyan ters aktarım planlanmalı.
- [ ] Doğrulama tamamlanıp bir süre sorunsuz çalışana kadar eski D1/R2 bağlamalarını ve yedekleri **silme**. ⚠️

## Özet: senden gereken hesaplar

| Hesap | Neden | Ne zaman |
| --- | --- | --- |
| Sunucu + alan adı + PostgreSQL | API Sites'da çalışamaz | ilk |
| Supabase (üretim projesi) | giriş, dosyalar | ilk |
| Cloudflare Stream (ücretli) | ders videoları | video taşımadan önce |
| Lemon Squeezy | Pro aboneliği | mağaza onayı sürdüğü için erken |
| Resend + gönderen alan adı | davet e-postaları | yayından önce |
| Google/Apple/Microsoft geliştirici | sosyal giriş (isteğe bağlı) | yayından önce |
| Expo / Apple Developer / Google Play | mobil yayın | web geçişinden sonra olabilir |
| Mevcut Sites/D1/R2 erişimi | tam yedek | veri aktarımından önce |

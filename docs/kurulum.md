# Derslik v0.5 — tek backend ile kurulum

## 1. Projeyi aç

ZIP'i çıkarıp ana `derslik` klasörünü Cursor/VS Code ile aç. Frontend `apps/web`, backend `apps/api`, mobil `apps/mobile` içindedir. Komutların çoğu ana klasörde çalışır.

Node.js 24 ve pnpm 11.25.0 kullan:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm run setup
```

Kurulum aracı güçlü veritabanı parolalarını `.env.api` dosyasına yazar; mevcut `.env.api` dosyasını korur. Bağlantı ayarlarını **yalnızca bu dosyada** düzenle. `pnpm env:sync`, `pnpm dev` ve `pnpm mobile:start`, web/mobile bağlantı dosyalarını buradan yeniden üretir. Özel sağlayıcı anahtarlarını yalnızca API kullanır.

## 2. Supabase Auth

Kendi Supabase projenin URL'sini ve **publishable/anon public key** değerini `.env.api` dosyasına gir. API'nin `AUTH_ISSUER` değeri `https://PROJE.supabase.co/auth/v1` olmalıdır. Aynı projenin public key'ini API'nin `SUPABASE_PUBLISHABLE_KEY` alanına da gir.

E-posta/şifre girişini ve e-posta doğrulamasını etkinleştir. ES256 veya RS256 imzalama anahtarı kullan; backend HS256 ortak sırrını veya servis rolü token'ını kullanıcı token'ı olarak kabul etmez. Auth'un Site URL ve Redirect URL ayarlarında geliştirme ve üretimde kullandığın gerçek adresleri tanımla:

```text
http://localhost:3000/api/auth/callback
http://localhost:3000/api/auth/callback?next=/reset-password
derslik://auth/callback
derslik://auth/confirm
derslik://auth/recovery
exp://**
```

`exp://**` satırı yalnızca Expo Go ile yerel denemeler içindir; canlı projede ekleme.
Supabase çıplak IP host'lu dönüş adreslerini kabul etmediği için Expo Go'yu varsayılan
LAN IP'siyle değil `pnpm mobile:tunnel` ile başlat; tünel adresinin host'u isimdir ve
bu satırla eşleşir.

Üretimde web callback adreslerini kendi HTTPS alan adına çevir. PKCE bağlantıları akışın başlatıldığı tarayıcı/uygulamada açılır. E-posta iletimini gerçek kullanıcı denemesi için kendi SMTP ayarlarınla doğrula. [Supabase sunucu istemcisi](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [mobil deep link](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

Web oturumu HttpOnly çerezde tutulur. Mobil oturum, parçalara ayrılmış Keychain/Keystore değerleriyle saklanır. `SUPABASE_SECRET_KEY` (veya eski `SUPABASE_SERVICE_ROLE_KEY`), Stream token ve abonelik API key **yalnızca backend** ortamında bulunur. Hiçbirini `EXPO_PUBLIC_` veya `NEXT_PUBLIC_` değişkenine koyma.

## 3. Web + API + PostgreSQL

`.env.api` içine en az şunları doldur:

```dotenv
AUTH_ISSUER=https://PROJE.supabase.co/auth/v1
SUPABASE_URL=https://PROJE.supabase.co
SUPABASE_PUBLISHABLE_KEY=PUBLIC_KEY
APP_ORIGIN=http://localhost:3000
WEB_ORIGIN=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
```

Geliştirme için ana klasörde:

```sh
pnpm dev
```

Komut ortak ayarları günceller; Docker’da yalnızca PostgreSQL’i başlatır, API’yi derler ve yeni göçleri uygular. Sonra tek NestJS API’yi ve Next.js webi başlatır. API kaynak değişiklikleri izlenip yeniden derlenir. Web `http://localhost:3000`, API `http://localhost:3001/health/ready` adresindedir. Ctrl+C web/API süreçlerini durdurur; PostgreSQL verisi kalır.

Eski sürümden Docker içinde API/web çalışıyorsa önce bu projeye ait süreçleri durdur:

```sh
docker compose --env-file .env.api -f compose.api.yml stop api web
pnpm dev
```

`pnpm dev` açıkken ayrıca `pnpm api:local` veya ikinci bir Docker API çalıştırma. İş kuralları yalnızca tek API’de yürür; Next geliştirme sunucusunun ayrı süreç olması ikinci iş backend’i demek değildir.

Tamamını Docker’da çalıştırmak için `pnpm dev`i kapat ve:

```sh
pnpm env:sync
docker compose --env-file .env.api -f compose.api.yml up --build -d web
```

Bu da aynı API/veritabanını kullanır. Compose admin rolüyle göçleri, kısıtlı `derslik_app` rolüyle API’yi başlatır. API runtime’a `DATABASE_ADMIN_URL` verilmez. Veriler `postgres_data` volume’ünde korunur; sıradan güncellemede volume silme. `.env.api` parolasını değiştirmek mevcut PostgreSQL rolünün parolasını kendiliğinden değiştirmez.

Yerel üretim derlemesi: `pnpm build:local`. Hazır PostgreSQL/göçler ile `pnpm start`, derlenmiş API ve Next sunucusunu birlikte açar. `pnpm build` / `pnpm site:build` ise yalnızca Sites dağıtım paketi içindir.

## 4. Mobil uygulamayı ayağa kaldır

`.env.api`:

```dotenv
API_BIND_ADDRESS=0.0.0.0
MOBILE_API_HOST=192.168.1.50
API_PUBLIC_URL=
```

IP örnektir; Windows’ta `ipconfig`, macOS/Linux’ta ağ ayarlarından bilgisayarının IP’sini bul. `MOBILE_API_HOST` boşsa özel ağdaki ilk adres seçilir. Telefon ve bilgisayar aynı Wi-Fi’da olmalı. Android emülatöründe `MOBILE_API_HOST=10.0.2.2`, iOS simülatöründe `127.0.0.1` kullanılabilir. Eski ayar dosyasında `API_BIND_ADDRESS=127.0.0.1` varsa fiziksel telefon için yukarıdaki gibi değiştirip API’yi yeniden başlat.

Bir terminalde `pnpm dev` açık kalsın. İkinci terminalde, yine ana klasörde:

```sh
pnpm mobile:start
```

Telefon tarayıcısından `http://BILGISAYAR_IP:3001/health/ready` açılarak API erişimi kontrol edilebilir. Erişilemiyorsa IP, güvenlik duvarının özel ağ izni ve Wi-Fi izolasyonunu kontrol et. Mobil için ayrı API başlatma. Webde kullandığın hesapla giriş yap; aynı çalışma alanını seç. Değişiklikleri diğer cihazda yenilediğinde aynı kayıtlar görünür.

`API_PUBLIC_URL=https://api.senin-alan-adin` ayarlanırsa web ve mobil bu tek uzak API adresini kullanır. Yerel API için boş bırak. İstemci ortam dosyalarını elle farklı adreslere çevirmek yerine `.env.api` üzerinden `pnpm env:sync` çalıştır. API portunu değiştirirsen `API_HTTP_PORT`, web portunu değiştirirsen `WEB_HTTP_PORT`, `APP_ORIGIN`, `WEB_ORIGIN`, `CORS_ORIGINS` alanlarını uyumlu tut.

QR ile temel ekranları Expo Go’da deneyebilirsin. Sosyal girişi Expo Go’da denemek
için `pnpm mobile:tunnel` kullan ve Supabase Redirect URLs listesinde `exp://**`
bulunsun; normal `pnpm mobile:start` LAN IP'si verdiğinden sosyal giriş dönemez. Mağaza davranışının
birebir aynısı ve `derslik://` giriş dönüşleri için native development build kullan. Android SDK/JDK veya macOS/Xcode kurulu olduğunda:

```sh
pnpm env:sync
pnpm mobile:android
pnpm mobile:ios
```

İlgili platform komutunu kullan. `apps/mobile/eas.json` APK/TestFlight derleme profillerini içerir; Expo/Apple/Google hesapları ve imzalama ayarları sana aittir. Bu teslimde APK/IPA veya mağaza yayını oluşturulmadı.

## 5. Ödev dosyaları

Backend `.env.api` içinde `SUPABASE_SECRET_KEY=sb_secret_...` (eski projelerde `SUPABASE_SERVICE_ROLE_KEY` da desteklenir) ve `STORAGE_BUCKET=derslik-materials` tanımla:

```sh
pnpm storage:setup
```

Araç yalnızca bu adlı bucket'ı oluşturur/günceller: private, 10 MB, PDF/JPEG/PNG/WebP. İstemciye doğrudan bucket erişimi açan politika ekleme. Backend önce izin ve kota kontrolü yapar; tek nesneye imzalı yükleme URL'si verir. Tamamlama isteğinde gerçek boyut, MIME ve dosya imzası kontrol edilir. İndirme bağlantısı iki dakika geçerlidir. İmza kontrolü tam antivirüs taraması değildir. Yarım kalan dosya rezervasyonları kota içinde kalır; web/mobil PDF ve dosyalar bölümünden silinebilir. Silme isteği yeni indirme bağlantısını hemen kapatır; provider onayından sonra kotayı boşaltır. Başarısız silme tekrar denenebilir. Otomatik retention işçisi yoktur.

## 6. Ders videoları

Cloudflare Stream hesabında backend için Stream düzenleme token'ı oluştur. `.env.api` alanları:

```dotenv
CLOUDFLARE_ACCOUNT_ID=32_KARAKTER_HEX_HESAP_ID
CLOUDFLARE_STREAM_TOKEN=BACKEND_TOKEN
CLOUDFLARE_STREAM_WEBHOOK_SECRET=WEBHOOK_SECRET
```

Provider hesabındaki webhook hedefi `https://API_ALAN_ADI/v1/webhooks/stream` olmalıdır; kayıt sırasında verilen secret'ı backend'e gir. Stream hesabında tek video webhook'u bulunduğundan mevcut aboneliği değiştirmeden önce aynı hesapta başka ürün kullanılıp kullanılmadığını kontrol et. Yerel sunucuya provider'dan webhook gelmesi için erişilebilir HTTPS adresi gerekir. Geliştirme ortamında webhook olmadan yükleyip “Durumu yenile” ile gerçek Stream durumunu sorgulayabilirsin. Üretimde webhook secret zorunludur. Stream ücretli bir hizmettir; hesap ve token olmadan video yüklenemez.

Yükleme 2 GB / iki saat ile sınırlıdır. Backend süre kotasını ayırır; istemci 8 MB parçalarla TUS yükler. Mobil uygulama dosyanın tamamını belleğe almaz. Kayıtlar signed URL gerektirerek oluşturulur. İşlenmiş, private video webhook'u geldiğinde izlemeye açılır. İzleme bağlantısı beş dakika için üretilir; oynatıcı süre dolmadan yeniler. Erişimin kaldırılması yeni URL verilmesini engeller; önceden verilmiş bağlantı süresi dolana kadar geçerli olabilir.

Yükleme yanıtı belirsiz kaldığında aynı rezervasyon ikinci provider kaydı açmaz. İşlem listede görünür; durumu yenileyebilir veya silebilirsin. Silme önce yeni izlemeyi kapatır, provider onayı sonrası kotayı boşaltır. Provider silme başarısızsa “Silme bekliyor” kaydı yeniden denenebilir. [TUS](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/), [webhook imzası](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/), [izleme token'ı](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/).

## 7. Derslik aboneliği

Öğrenci tahsilatları manuel muhasebe kayıtlarıdır. Derslik Pro aboneliği ayrı tablolarda ve ayrı provider'da tutulur.

Lemon Squeezy hesabında aylık abonelik ürünü/variant oluştur ve mağazanı gerekli hesap doğrulamasıyla hazırla. Ücreti provider panelinde sen belirlersin. Backend ayarları:

```dotenv
LEMONSQUEEZY_API_KEY=BACKEND_KEY
LEMONSQUEEZY_STORE_ID=NUMERIC_STORE_ID
LEMONSQUEEZY_VARIANT_ID=NUMERIC_VARIANT_ID
LEMONSQUEEZY_WEBHOOK_SECRET=WEBHOOK_SECRET
LEMONSQUEEZY_TEST_MODE=true
```

Webhook hedefi `https://API_ALAN_ADI/v1/webhooks/subscriptions`; abonelik oluşturma, güncelleme, iptal, devam etme ve sona erme olaylarını seç. Webde **Bildirimler ve kullanım → Derslik aboneliği** alanından ödeme sayfası açılır. İmza doğrulandıktan sonra backend provider'dan güncel aboneliği tekrar okur; checkout dönüş sayfasına güvenerek Pro açmaz. Aynı olay kotayı ikinci kez artırmaz. İptal, `ends_at` süresine kadar geçerlidir; sona ermede limitler Pilot'a döner, mevcut kayıtlar silinmez. Ödemesi başarısız/pause/unpaid statüsü de Pilot sınırlarını kullanır. Müşteri portalında iptal/ödeme yöntemi yönetilir.

Önce test modunda checkout, yenileme, iptal ve webhook'ları kendi hesabında doğrula. Canlıya geçerken gerçek hesap/variant/token kullanıp `LEMONSQUEEZY_TEST_MODE=false` yap. Test ve canlı olaylar karışırsa reddedilir. Fiyat/vergiler checkout sayfasında gösterilir. [Checkout API](https://docs.lemonsqueezy.com/api/checkouts/create-checkout), [webhook senkronizasyonu](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks), [abonelik statüleri](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object).

## 8. Sunucu ve mevcut Sites yayını

Nest backend uzun yaşayan Node/PostgreSQL bağlantısı kullanır; Sites Worker'ın içine Nest/ham TCP PostgreSQL yerleştirilmez. API ve PostgreSQL'i kendi sunucunda/container ortamında çalıştır. Web aynı Compose ile veya ayrı Next Node barındırmasında çalışabilir. HTTPS reverse proxy, veritabanı yedekleri, geri yükleme denemesi, istek hız sınırı ve log izleme üretim işletimine aittir. Üretimde sertifikalı PostgreSQL TLS kullanıyorsan `DATABASE_SSL=true` yap.

Yeni kaynak sürümünde webin D1/R2 okuma/yazma yolu kaldırıldı. Mevcut canlı v4 yayın, Nest/PostgreSQL kurulup veri aktarımı doğrulanana kadar korunuyor. Canlı Site’da henüz API ortam ayarları yok; bu kod değişikliği canlı geçiş anlamına gelmez.

API hazır olduğunda Sites web ortamında `API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN` aynı backend/Auth projesine ayarlanır; hiçbir backend sırrı web ortamına konmaz. Yeni sürüm ancak eski kayıtlar için [veri geçişi](veri-gecisi.md) tamamlandıktan sonra yayımlanır. Yayındaki eski veritabanı veya bucket bu çalışma sırasında silinmedi.

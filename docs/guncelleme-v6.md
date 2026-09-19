# Web ve mobil arayüz güncellemesi

Web ve mobil aynı Nest API'yi kullanmaya devam eder. PostgreSQL yerelde Docker'dadır; kimlik doğrulama ve dosyalar Supabase, ders videoları Cloudflare Stream kullanır.

## Mevcut projeyi güncelle

Çalışan terminalleri Ctrl+C ile durdur. Mevcut `.env.api` dosyanı güvenli bir yerde yedekle. Yeni ZIP'i ayrı bir klasöre çıkar ve eski `.env.api` dosyanı bu yeni `derslik` klasörünün köküne kopyala. Eski node_modules veya derleme klasörlerini kopyalama. Docker veri birimini silme; aynı compose proje adı `derslik` veriyi korur.

Yeni klasörde:

```sh
pnpm install --frozen-lockfile
pnpm env:sync
pnpm services:check
pnpm dev
```

Başka bir terminalde aynı klasörü aç:

```sh
pnpm mobile:clear
```

Mobil oturum okuma/yazma işlemleri sıraya alındı; aynı OAuth dönüş kodu iki kez işlenmez. Değişmeyen ortam dosyaları yeniden yazılmaz. Metro, web/API derleme çıktıları ile Git dosyalarını izlemez. macOS ve Windows'ta API yalnızca kendi derleme klasörünü izler. Böylece API/web geliştirmesi mobil giriş ekranını gereksiz yere yenilemez. Expo'nun geliştirme sırasında gerçek kod değişikliğinde gösterdiği kısa yenileme bildirimi normaldir.

## Google, Apple ve Microsoft

Supabase panelinde Authentication > Sign In / Providers altında istediğin sağlayıcıları etkinleştir. Her sağlayıcı için ilgili geliştirici konsolunda OAuth uygulaması aç ve Client ID/secret değerlerini **Supabase paneline** gir. Bu sağlayıcı sırları web veya mobil ortama yazılmaz.

Sağlayıcı konsolundaki yetkili dönüş adresi:

```text
https://PROJE_KIMLIGI.supabase.co/auth/v1/callback
```

Supabase Authentication > URL Configuration > Redirect URLs listesine:

```text
http://localhost:3000/api/auth/callback
http://localhost:3000/api/auth/callback?next=/reset-password
derslik://auth/callback
derslik://auth/confirm
derslik://auth/recovery
exp://**
```

Son satır Expo Go içindir: Expo Go özel şemaları açamadığı için mobil dönüş adresi
`exp://BILGISAYAR_ADI:8081/--/auth/callback` biçiminde olur.

**Önemli:** Supabase, host'u **loopback olmayan çıplak IP** olan dönüş adreslerini
kabul etmez — izin listesine tam adresi yazsan bile. Ölçülen davranış:

| Dönüş adresi | Sonuç |
| --- | --- |
| `exp://192.168.1.102:8081/--/auth/callback` | reddedilir, Site URL'e düşer |
| `exp://127.0.0.1:8081/--/auth/callback` | kabul (loopback muaf) |
| `exp://localhost:8081/--/auth/callback` | kabul |
| `exp://xxx.exp.direct/--/auth/callback` | kabul (`exp://**` ile) |
| `derslik://auth/callback` | kabul |

`pnpm mobile:start` LAN IP'si verdiği için sosyal giriş dönemez; tarayıcı Site URL'ine
gider ve telefonda "localhost bağlanamadı" görürsün. Bunun yerine:

```sh
pnpm mobile:localhost   # emülatör veya USB'li cihaz: exp://127.0.0.1:8081
pnpm mobile:tunnel      # farklı ağdaki gerçek telefon: exp://...exp.direct
```

`mobile:localhost` Android için `adb reverse`'ü kendi kurar. Tünel yolu için izin
listesinde `exp://**` bulunmalıdır; bu joker yalnızca kendi geliştirme makinende
kullanılmalı, canlı projeye ekleme. Native geliştirme veya mağaza derlemesinde aynı kod
`derslik://auth/callback` üretir; o adres zaten listede olduğundan hiçbirine gerek kalmaz.

Canlı web kullanırken kendi HTTPS web callback adresini de ekle; `.env.api` içindeki APP_ORIGIN bunun kök adresi olmalı. Google test modundaysa kullanacağın hesapları test kullanıcılarına ekle. Microsoft girişinde uygulama `email` kapsamını ister. Apple web OAuth için Services ID ve imzalama anahtarı ayarlarını tamamlamalısın; sağlayıcı secret süresini takip et.

Düğmeler yalnızca Supabase ayarlarında etkin sağlayıcılar için açılır. Etkinleştirdikten sonra giriş ekranını yeniden aç. Hesap yapılandırması tamamlanmadan düğme eklemek tek başına gerçek Google/Apple/Microsoft girişi sağlamaz.

Mobil sosyal giriş artık Expo Go'da da çalışır: uygulama dönüş adresini çalıştığı
ortama göre üretir (Expo Go'da `exp://`, derlenmiş uygulamada `derslik://`). Expo
Go'da denemek için yukarıdaki `exp://**` satırının Supabase Redirect URLs listesinde
olması gerekir. Mağazaya çıkacak sürüm ve tam native davranış için yine kendi
geliştirme derlemeni al; bu sürüm yeni native bağımlılık içerir, eski kurulu
uygulamayı yeniden derlemelisin:

```sh
# Mac + Xcode ile iOS; çalışan diğer Expo terminalini önce durdur
pnpm mobile:ios
# Android SDK/emülatör ile Android
pnpm mobile:android
```

Telefon ve bilgisayar aynı ağda olmalı; `.env.api` içindeki MOBILE_API_HOST gerekirse Mac'in yerel IP adresidir. `pnpm env:sync` sonrasında mobil sunucuyu yeniden başlat. Gerçek cihazda localhost telefonun kendisidir.

Resmî kurulum: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Microsoft](https://supabase.com/docs/guides/auth/social-login/auth-azure), [Expo sosyal giriş](https://docs.expo.dev/guides/authentication/).

## PDF yükleme

`.env.api` içinde yalnızca backend'in kullanacağı yeni Supabase secret anahtarını tanımla:

```dotenv
SUPABASE_SECRET_KEY=YENI_SB_SECRET_ANAHTARIN
STORAGE_BUCKET=derslik-materials
```

Daha önce sohbet veya başka yerde paylaşılmış secret anahtarını Supabase panelinden iptal edip yenisini kullan. Bu sürüm modern `sb_secret_` anahtarını doğru `apikey` başlığıyla kullanır; eski service_role JWT anahtarı da desteklenir.

```sh
pnpm storage:setup
pnpm services:check
```

API'yi yeniden başlat. “PDF ve dosyalar” veya ödev ekinde “Tekrar kontrol et” düğmesine bas. Alan özel kalır; en fazla 10 MB PDF/JPG/PNG/WebP kabul edilir. Kullanıcı izinleri ve dosya içeriği API tarafından doğrulanır.

## Video yükleme

Cloudflare Stream hesabını etkinleştir; Stream düzenleme yetkili token ve hesap kimliğini `.env.api` içinde doldur:

```dotenv
CLOUDFLARE_ACCOUNT_ID=HESAP_KIMLIGI
CLOUDFLARE_STREAM_TOKEN=STREAM_TOKEN
```

`pnpm services:check` ile erişimi kontrol et, API'yi yeniden başlat. Geliştirmede yükleme ardından video işlenirken “Durumu yenile”yi kullan. Bu düğme Cloudflare'ın gerçek işlenme ve özel video durumunu kontrol eder. Üretimde ayrıca `CLOUDFLARE_STREAM_WEBHOOK_SECRET` ve API'ye ulaşan webhook gerekir; ayrıntılar `docs/kurulum.md` içindedir.

Hizmet ayarları yoksa uygulama yüklemeyi başlatmadan durumu açıklar. Bu, eksik hesabı oluşturmaz veya ücretli Stream hizmetini ücretsiz hale getirmez. Gerçek sağlayıcı hesapları bu teslim ortamında yapılandırılmadı.

## Doğrulama sınırı

Derleme ve otomatik testler kaynak kod üzerinde yürütülür. Gerçek Google/Apple/Microsoft hesaplarıyla giriş, fiziksel telefonda yenileme davranışı ve kendi Supabase/Cloudflare hesabına gerçek dosya yükleme ayrıca yerel ortamında doğrulanmalıdır. Canlı eski siteye veya yerel bilgisayarındaki dosyalara otomatik değişiklik uygulanmaz.

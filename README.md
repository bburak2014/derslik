# Derslik — web ve mobil

Web ve mobil **aynı NestJS API’yi ve aynı PostgreSQL veritabanını** kullanır. Öğrenci, ders, paket, tahsilat, ödev, dosya ve video kuralları `apps/api` içindedir. Frontend ve mobil dahil bütün kaynaklar aynı `derslik` klasöründedir.

Yeni arayüz, sosyal giriş, mobil yenileme düzeltmeleri ve PDF/video kurulumu: [v6 güncelleme rehberi](docs/guncelleme-v6.md).

## Kodu aç

`derslik-kaynak-kod-v6.zip` dosyasını çıkar; VS Code veya Cursor’da çıkan `derslik` klasörünü aç.

| Klasör                | Görevi                                                             |
| --------------------- | ------------------------------------------------------------------ |
| `apps/api`            | Tek NestJS modüler monolit backend, PostgreSQL göçleri ve testleri |
| `apps/web`            | Next.js web, öğretmen paneli ve öğrenci/veli ekranları             |
| `apps/mobile`         | Expo / React Native Android ve iOS uygulaması                      |
| `packages/contracts`  | Ortak tipler ve doğrulama                                          |
| `packages/api-client` | Web ve mobilin ortak API istemcisi                                 |
| `scripts`             | Yerel başlatma, ortak ayarlar ve eski veri ön kontrolü             |

Webdeki `/api/backend`, `/api/session` ve `/api/workspace` yolları oturum çerezlerini yönetir ve isteği Nest’e iletir. Burada veritabanı veya iş kuralları çalışmaz. Webin ayrı D1/R2 servisi ve `/api/teaching` yolları kaldırıldı. API kesildiğinde bir başka veritabanına geçilmez.

## Yerelde başlat

Node.js 24, pnpm 11.25.0 ve çalışan Docker Desktop / Docker Compose gerekir. Ana klasörde:

```sh
pnpm install --frozen-lockfile
pnpm setup
```

`.env.api` içindeki `AUTH_ISSUER`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` alanlarını kendi Supabase projenle doldur. Ardından:

```sh
pnpm dev
```

Bu komut PostgreSQL’i başlatır, göçleri uygular, **bir Nest API** ve webi çalıştırır. Web: `http://localhost:3000`. API: `http://localhost:3001/health/ready`. Geliştirme için ayrıca API başlatma.

Telefonda denemek için aynı klasörde ikinci terminal:

```sh
pnpm mobile:start
```

Bilgisayar ile telefon aynı ağa bağlı olmalı. `.env.api` içindeki `MOBILE_API_HOST` boşsa bilgisayarın yerel IP’si seçilir; yanlış ağ seçilirse bu alana doğru IP’yi yaz. Android emülatörü için `10.0.2.2` kullanılabilir. Web ve mobilde **aynı hesapla** giriş yap. Mobil için başka backend veya veritabanı kurulmaz.

`pnpm setup` mevcut `.env.api` dosyasını korur. `pnpm env:sync`, `pnpm dev` ve `pnpm mobile:start` istemci bağlantı dosyalarını bu tek kaynaktan günceller; backend sırlarını istemcilere kopyalamaz.

## Ödev, PDF ve video

Web sol menüsünde **Ödevler**, **PDF ve dosyalar**, **Ders videoları** bulunur. Öğrenci seçip işlem yap. Öğrenci detayında da aynı içerikler açılır. Mobilde öğrenci dosyasındaki aynı sekmeler kullanılır.

- Ödev ver, düzenle, tamamlandı/iptal durumunu seç; öğrenci teslim etsin, öğretmen geri bildirim yazsın.
- Ödeve bağlı veya bağımsız PDF/görsel yükle, indir ve sil. Dosya başına 10 MB; private Supabase Storage kullanılır.
- Bir derse bağlı veya genel video yükle; süreli özel bağlantıyla izle, kaldığın yere dön, belirli saniyeye soru ekle. Cloudflare Stream kullanılır; üst sınır 2 GB / iki saat.
- Öğretmene özel notlar, öğrenci/veli davetleri, haftalık özetler, bildirimler ve manuel tahsilatlar aynı API’dedir.

Dosya ve video sağlayıcı ayarları [kurulum kılavuzunda](docs/kurulum.md). Bunlar tek API’nin kullandığı dış hizmetlerdir; ikinci bir Derslik backend’i çalıştırılmaz.

## Kaynak ve yayın durumu

Bu v5 paketindeki mimari tek backend’e geçirildi. **Mevcut canlı Site hâlâ önceki v4 yayınıdır.** Canlı Nest sunucusu ve Site API ayarları olmadığı için yapılandırılmamış v5’i çalışan yayının üzerine çıkarmadık. Eski D1/R2 kayıtları silinmedi ve PostgreSQL’e aktarılmış sayılmıyor.

Eski veriler için [geçiş kılavuzu ve ön kontrol](docs/veri-gecisi.md) hazır. Kökteki değişmemiş `drizzle/` ve `.openai/hosting.json`, mevcut yayının veri geçmişini korur; yeni uygulama bu bağlamaları kullanmaz. `build` / `site:build` Sites için web paketi üretir; `build:local` API ve Next üretim derlemelerini üretir.

Gerçek Supabase/Stream/abonelik hesapları bağlanmadı. APK/IPA ve mağaza yayını bu paketin içinde değildir. Mobil JavaScript/Hermes export ile cihaz veya mağaza testi aynı şey değildir. Güncel kontroller: [doğrulama kaydı](docs/validation-v5.md).

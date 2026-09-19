# v0.5 doğrulama — 14 Eylül 2026

## Geçen kontroller

| Kontrol | Sonuç |
| --- | --- |
| NestJS TypeScript derlemesi | Geçti; paylaşılan istemci Node çıktısında da derlendi |
| NestJS / PGlite / imzalı JWT entegrasyonu | 20 test geçti (19 alt senaryo + üst test) |
| Next.js üretim çıktısı üzerinde gerçek HTTP testi | 1 test geçti: HttpOnly oturum, CSRF, sabit API hedefi, yetki ve kesinti |
| Tek backend ve ayar eşleme testleri | 2 test geçti |
| Eski veri / dosya yedeği ön kontrol testi | 1 test geçti |
| Root/web ve mobil TypeScript kontrolü | Geçti |
| Sites/Vinext web derlemesi | Geçti, 2058 client modülü |
| Expo Android export | Geçti, 719 modül / yaklaşık 2.5 MB Hermes paketi |
| Expo iOS export | Geçti, 722 modül / yaklaşık 2.5 MB Hermes paketi |
| Git fark / script sözdizimi kontrolleri | Geçti |

Yeni ortak istemci senaryosu iki DerslikClient örneğini gerçek Nest HTTP sunucusuna bağlar. Web istemcisinin oluşturduğu ödev mobil istemcide görülür; mobil durum değişikliği web istemcisinde görülür. İstek tekrarı/sürüm çakışması, kapalı ödev tesliminin reddi, bağımsız PDF, öğrenciye indirme yetkisi, yabancı çalışma alanı engeli, dosya silme kesintisi/tekrarı ve derse bağlanmamış video test edilir.

Web HTTP testi gerçek Next üretim sunucusunu başlatır. Auth ve upstream API yerel test sunucularıyla temsil edilir. Eski `DERSLIK_HOSTING=sites` bayrağı verilse bile `/api/teaching` yoktur; merkezi API hatasında web 503 döndürür.

## Sınırlar

- API testinde SQL, RLS, migration, JWT doğrulaması ve Nest HTTP gerçek kodla çalışır; dış Auth/Storage/Stream/abonelik sağlayıcıları test doubles kullanır.
- PGlite aynı PostgreSQL motorunun WASM sürümüdür; socket çoklaması native PostgreSQL eşzamanlılık/işletim testi yerine geçmez.
- Docker bu ortamda kurulu değildir. `pnpm dev` içindeki Docker başlatma adımı, Compose konteynerleri ve yerel üretim süreç yönetimi gerçek Docker üzerinde uçtan uca denenmedi. Yeni ayar eşleme ve sırların istemciye kopyalanmaması test edildi.
- Android/iOS export APK/IPA değildir. Fiziksel telefon, simülatör/emülatör ve mağaza yayını denenmedi.
- Canlı Nest sunucusu ve sağlayıcı hesapları bağlanmadı. Mevcut Site ortam değişkenleri kontrolünde API ayarı bulunmadı; v5 canlıya çıkarılmadı.
- Eski canlı D1/R2 verileri silinmedi, aktarılmadı. `migration:check` salt okunur ön kontroldür; import veya canlı geçiş yapmaz.

Üretimde mevcut v4 yayınını değiştirmeden önce `veri-gecisi.md` adımları ve gerçek sağlayıcı/cihaz kontrolleri tamamlanmalıdır.

# Bağımsız API doğrulama kaydı

Tarih: 13 Eylül 2026. Node.js 24.19.0, TypeScript 5.9.3, NestJS 12.0.1, pg 8.23.0; PGlite 0.5.8 / pglite-socket 0.2.11.

| Kontrol                             | Sonuç                                                               |
| ----------------------------------- | ------------------------------------------------------------------- |
| `tsc -p apps/api/tsconfig.json`     | Geçti                                                               |
| Web `tsc --noEmit`                  | Geçti                                                               |
| API/PGlite HTTP entegrasyonu        | 9 senaryo geçti; Node raporunda üst testle birlikte 10 test, 0 hata |
| Mevcut SQLite alan testleri         | 11 test geçti                                                       |
| D1/Miniflare çalışma zamanı         | 1 test geçti                                                        |
| Sites web üretim derlemesi          | Geçti                                                               |
| Compose YAML yapısı                 | Ayrıştırıldı; API ve göç ortamları ayrı doğrulandı                  |
| Native PostgreSQL 18 başlatma       | Ortam normal kullanıcıya geçişi engelledi; çalıştırılamadı          |
| Docker imajı / Compose çalıştırması | Docker bulunmadığı için çalıştırılamadı                             |
| Gerçek Supabase projesiyle giriş    | Proje yapılandırılmadığı için çalıştırılmadı                        |
| Tarayıcı / görsel QA                | Bu aşamanın kapsamında çalıştırılmadı                               |

HTTP testleri üretim controller, guard, servisler ve SQL göçlerini kullanır. ES256 test anahtarı ve JWKS sunucusu yalnızca test sürecinde oluşturulur. Geçersiz imza, yanlış issuer/audience, süresi dolan token, anonim kullanıcı ve service role 401 alır. Kısıtlı veritabanı rolüyle çalışma alanı ayrımı, özel not erişimi ve eklemeli kayıt izinleri sınanır.

Testlerde bulunan ilk göç sorunları düzeltildi: özel şemanın göçe eklenmesi ve bileşik dış anahtarların dayandığı benzersizliğin tablo oluşturulurken constraint olarak kurulması. Bunlar henüz hiçbir canlı PostgreSQL veritabanına uygulanmamış ilk göçlerdir. Yayındaki D1 göçü değiştirilmedi.

PGlite tek PostgreSQL oturumunu çoklar. Aynı anda HTTP isteği gönderilen senaryolar iş kurallarının sonuçlarını doğrular; gerçek PostgreSQL süreçleri arasındaki satır kilitlerini ve izolasyonu kanıtlamaz. Native test aynı senaryoları geçici gerçek sunucu ve ayrı bağlantılarla çalıştıracak şekilde hazırlanmıştır. API'nin canlıya alınması için bu testin geçmesi, gerçek Supabase girişinin ve barındırma yapılandırmasının doğrulanması gerekir.

# v0.3 doğrulama kaydı

Tarih: 14 Eylül 2026. Testler yerel, geçici verilerle çalıştırıldı. Canlı öğrenci kaydı veya gerçek ödeme kullanılmadı.

| Kontrol                       | Sonuç / kapsam                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| NestJS TypeScript derlemesi   | Geçti                                                                                                |
| Web TypeScript kontrolü       | Geçti                                                                                                |
| Next.js üretim derlemesi      | Geçti; giriş, callback, API aracısı, davet, portal ve şifre sıfırlama yolları                        |
| Sites/Vinext Worker derlemesi | Geçti; mevcut Site için aynı frontend kaynağı                                                        |
| Mobil TypeScript              | Geçti                                                                                                |
| Expo Android + iOS export     | Geçti; iki platform için Hermes paketleri                                                            |
| API/PGlite                    | 18 senaryo, Node raporunda üst test dahil 19 test geçti                                              |
| Next BFF HTTP testi           | HttpOnly oturum, CSRF, erişim seçimi, sabit API hedefi, merkezi API kesintisinde D1'e dönmeme, çıkış |
| D1 / domain                   | 11 iş kuralı testi + 1 gerçek Miniflare D1 senaryosu geçti                                           |

API senaryoları: JWT imza/issuer/audience/süre/rol; workspace ve öğrenci; idempotency/versiyon; son ders hakkı yarışması; haftalık seri/çakışma; ödeme dağıtımı/iptali; tenant ve özel not ayrımı; RLS/havuz; arşivleme; ortak snapshot/command; doğrulanmış e-postaya bağlı tek kullanımlık davet; öğrenci teslimi/veli yazma reddi/geri bildirim; paylaşım kitlesi ve onaylı özet; dosya boyut/MIME/imza/kota/erişim; video rezervasyonu/webhook/token/zaman damgası/kota/silme; telafi; SaaS checkout/webhook/limit ve öğrenci tahsilatından ayrım; erişim kaldırma/arşiv etkisi.

PGlite gerçek PostgreSQL SQL/RLS kodunu çalıştırır fakat bağlantıları tek PostgreSQL oturumuna çoklar. Native PostgreSQL satır kilitleri, gerçek çok bağlantılı yarışlar, SCRAM/TLS ve Docker yürütmesi bununla doğrulanmış sayılmaz. Ortam normal kullanıcıya geçişi engellediği ve Docker sağlamadığı için native sunucu/Compose testi burada çalıştırılamadı. Native senaryolar aynı test dosyasında hazırdır.

Supabase Auth için BFF testinde yerel HTTP test servisi; API testinde gerçek ES256 imzası ve yerel JWKS kullanıldı. Stream, Storage ve Lemon Squeezy dış çağrıları test provider'larıyla sınandı. Gerçek hizmet hesapları, gerçek ödeme, canlı e-posta callback'i ve fiziksel cihaz testleri yapılmadı. Mobil export, APK/IPA veya mağaza onayı değildir.

```sh
pnpm typecheck
pnpm api:test:pglite
pnpm test
pnpm test:d1
pnpm web:build
pnpm web:test
pnpm mobile:typecheck
pnpm mobile:export
```

Normal kullanıcı ve native PostgreSQL çalıştırılabilen ortam:

```sh
pnpm api:test
```

Docker ortamında:

```sh
docker compose --env-file .env.api -f compose.api.yml --profile test run --build --rm api-test
```

Gerçek hesaplarla ilk kabul denemesi: öğretmen oluştur → öğrenci/paket/ders → e-postası doğrulanmış öğrenci ve veli daveti → öğrenci ödev teslimi → öğretmen geri bildirimi → video upload/webhook/izleme/soru → erişim kaldırma → test abonelik checkout/iptal → kota kontrolü. Mağaza dağıtımı bu doğrulamadan sonra yapılır.

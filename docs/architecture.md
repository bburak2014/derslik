# Derslik v0.5 mimarisi

Tek depo ve tek NestJS modüler monolit. Bütün kaynaklar `derslik` kök klasöründedir.

| Bileşen | Bağlantı / sorumluluk |
| --- | --- |
| Next.js web | HttpOnly oturum; sabit API adresine HTTP aracısı |
| Expo mobil | Bearer oturum; aynı `/v1` API’si |
| NestJS API | Kimlik/erişim, öğrenci, ders, kredi, tahsilat, ödev, dosya/video ve abonelik iş kuralları |
| PostgreSQL | Bütün Derslik iş kayıtları, RLS ve transaction’lar |
| Supabase Auth / Storage, Stream | Tek API’nin kullandığı kimlik ve özel medya hizmetleri |

Web ve mobil aynı Supabase hesabıyla aynı çalışma alanını görür. `packages/api-client` ortak istemci, `packages/contracts` ortak tip/doğrulama kodudur. Webin Next route handler’ları yeni öğrenci/ödev üretmez, SQL çalıştırmaz ve kendi depolama bağlantısı yoktur. API bağlantısı kesilirse hata gösterilir; ayrı kayıt açılmaz.

`apps/api` içindeki modüller aynı veritabanını kullanır. Öğrenci, ders, kredi ve ödeme güncellemelerinde sürüm kontrolü ve UUID işlem anahtarı kullanılır. Para kuruş string’i / BigInt olarak işlenir. Ders tamamlama, kredi hareketi, audit ve işlem makbuzu aynı transaction içinde commit olur.

Ödevler oluşturulabilir, düzenlenebilir, tamamlanabilir veya iptal edilebilir. Kapanmış ödev öğrenci teslimine kapalıdır. Öğretmen bağımsız PDF materyali veya ödev eki yükleyebilir. Öğrenci yalnızca izinli kendi ödevine teslim dosyası ekleyebilir. Öğrenci/veli izinleri PostgreSQL RLS ve API kontrolleri ile korunur; özel öğretmen notları ayrıdır.

Dosya ve video büyük gövdeleri API RAM’inden geçirilmez: API yetki/kota kontrolünden sonra özel yükleme adresi verir. Bütün metadata PostgreSQL’dedir. PDF tamamlama gerçek boyut/tür ve imzayı doğrular. Silme başarısız olursa kayıt ve kota korunur; yeni indirme/izleme adresleri kapatılır ve tekrar denenebilir. Önceden verilmiş süreli URL’ler süresi bitene kadar geçerli olabilir.

`.env.api` yerel bağlantı ayarlarının kaynağıdır. `scripts/sync-env.mjs` yalnızca izin verilen API/Auth adreslerini ve public key’i web/mobile aktarır. `scripts/dev.mjs` PostgreSQL hazırlığını, tek API’yi ve web geliştirme sunucusunu başlatır. Next sunucusu iş kurallarını tutan ikinci backend değildir.

## Eski Site verileri

v4’te eklenen web D1/R2 servisi, `/api/teaching` uçları ve D1 komut uygulaması kaynak runtime’dan kaldırıldı. Yeni backend’in SQL göçü `apps/api/drizzle/0004_single_backend_teaching.sql` dosyasındadır. Önceden uygulanmış PostgreSQL ve D1 göçleri değiştirilmedi.

Kökteki `drizzle/` ve hosting bağlama bildirimi eski canlı verileri koruyan yayın geçmişidir; web bunları kullanmaz. Canlı v4 kaynak commit’i `47e1ba6415acc0173c6a8d3d33b7275a0cc8a923` olarak saklıdır. Canlı geçiş için [veri geçişi kılavuzunu](veri-gecisi.md) kullan. Sadece yeni ZIP’i açmak canlı Site’ı veya kullanıcının daha önce indirdiği klasörü değiştirmez.

# v4 D1/R2 → tek PostgreSQL backend geçişi

**Canlı veri aktarımı yapılmadı.** Bu sürümde yeni kaynak kodunun D1/R2 yolu kaldırıldı; mevcut v4 Site ve verileri korundu. Yeni Nest sunucusu, hedef veritabanı bağlantısı ve eski Sites hesabı → Supabase kullanıcı UUID eşlemesi olmadan canlıya geçilmez. Kaynak kodunu indirmek eski kayıtları otomatik taşımaz.

Bu doküman bir geçiş runbook’udur. `migration:check` yalnızca yedeğin ön kontrolünü yapar; SQL import aracı veya tamamlanmış veri aktarımı değildir.

## 1. Kaynağı dondur ve yedekle

Eski Site’da kayıt ve yükleme işlemlerini durdur. UPLOADING/DELETING dosyaları tamamla veya eski uygulamadan iptal et. Bütün D1 tablolarının tam yedeğini al; sadece ekranda görünen ilk 25 satırı kullanma. Mevcut platformun veritabanı erişimi üzerinden eksiksiz dışa aktarım ve özel R2 nesnelerinin indirilebildiği doğrulanmalıdır. Bu izinler yoksa aktarımı başlatma ve eski yayını koru.

Korunacak tablolar: workspaces, students, packages, lessons, credit_entries, payments, private_notes, commands, teaching_assignments, teaching_files, teaching_parts. Orijinal D1 SQL ve bütün dosyaları ayrıca sakla. Yerel v4 kurulumu kullanılıyorsa `.wrangler/state` dizininin bir kopyasını da al; bu kopyayı Git’e ekleme.

Tam tablo dışa aktarımını aşağıdaki JSON zarfına yerleştir. Her tabloda bütün satırlar olmalıdır; `complete` ve `writesPaused` alanlarını ancak gerçekten doğruladıktan sonra true yap:

```json
{
  "format": "derslik-d1-v4",
  "complete": true,
  "writesPaused": true,
  "tables": {
    "workspaces": [], "students": [], "packages": [], "lessons": [],
    "credit_entries": [], "payments": [], "private_notes": [], "commands": [],
    "teaching_assignments": [], "teaching_files": [], "teaching_parts": []
  }
}
```

JSON’daki boş diziler biçim örneğidir; gerçek kayıtları atlamak için kullanılmaz. Büyük para değerlerini kayıpsız tam sayı string’i olarak dışa aktar. Dosya yedeği anahtarları `objects/teaching/WORKSPACE_UUID/FILE_UUID` olmalıdır; dosya uzantısı ekleme.

```sh
pnpm migration:check snapshot.json objects aktarim-on-kontrol.json
```

Araç çalışma alanı/öğrenci ilişkilerini, paket kalan haklarıyla kredi hareketlerinin toplamını, tahsilat toplamlarını ve READY dosyaların boyut/SHA-256 değerlerini denetler. Hiçbir veritabanına bağlanmaz ve kayıt değiştirmez. Eksik dosya veya yarım upload varsa başarısız çıkar. `sourceValidated=true` sadece kaynak ön kontrolünün geçtiğini gösterir; `cutoverReady` daima false’tur.

## 2. Hedefi hazırla ve eşle

PostgreSQL 0000–0004 göçlerini uygula. Canlıya açılmamış hedef çalışma alanında eski owner kimliğini **doğrulanmış Supabase kullanıcı UUID’sine** eşle. Eski Sites owner kimliği yeni Auth hesabı değildir. Eski öğrenci e-postalarına otomatik hesap/portal yetkisi verme.

| Kaynak | PostgreSQL karşılığı / dönüşüm |
| --- | --- |
| workspaces | workspaces + users + OWNER membership; aynı workspace UUID |
| students | students; active integer → boolean; aynı öğrenci UUID |
| packages | packages + her paket için charges; fiyatı kuruş olarak koru |
| lessons | lessons; UUID, sürüm ve statüyü koru |
| credit_entries | credit_entries; revision ve reverses_id dahil aynı hareketler |
| payments | payments + aktif tahsilatların payment_allocations dağıtımı |
| private_notes | private_notes; sadece öğretmene erişim |
| teaching_assignments | assignments; description → instructions; due_on null olabilir; status/version koru |
| teaching_files (document) | materials; assignment varsa ASSIGNMENT, yoksa RESOURCE |
| teaching_files (video) | videos + özel Cloudflare Stream nesnesi |
| commands / teaching_parts | Orijinal yedekte denetim geçmişi; yeni kullanıcı işlem anahtarı olarak tekrar oynatma |

Kredi hareketlerini importer üzerinden yeniden “ders tamamla” komutlarıyla üretme; bu kalan hakları ikinci kez düşürür. UUID/sürüm/tarih/ters hareketleri doğrudan kontrollü veri aktarımıyla koru. Aktif ödemeleri paket borçlarına deterministik sırayla dağıt ve fazla ödeme olup olmadığını incele. Para değerleri BigInt/kuruş olmalı. Hedef doluysa kör `upsert` kullanma; çakışmaları önceden raporla. İçe aktarım transaction ve aktarım makbuzu ile yapılmalıdır.

## 3. Gerçek dosya ve videoları taşı

Sadece metadata taşımak yeterli değildir. PDF/görselleri hedef private Storage bucket’a `workspace/student/file` anahtarıyla aktar; gerçek boyut, MIME ve imza doğrulamasından sonra READY yap. Kaynak dosya başlığı, adı ve eski bağlantı eşlemesini aktarım raporunda tut.

R2 videolarını Stream’e **signed URL zorunlu** olarak yeniden yükle. Provider UID’sini hedef videos kaydına yaz, işleme tamamlanmasını ve private oynatmayı doğrula. Her eski READY dosya için hedef kimliği ve başarılı kontrol bulunmadan aktarımı tamamlandı sayma. Yarım yüklemeleri veya orijinal R2 URL’lerini çalışıyormuş gibi READY yapma.

## 4. Doğrula ve geçiş yap

Her çalışma alanında öğrenci/ödev/ders/paket/ödeme/hareket sayıları, kalan haklar, tahsilat ve borç toplamları eşleşmeli. Her READY dosya hedefte indirilmeli/izlenmeli. Aynı hesapla web ve mobilde aynı UUID ve durumu gör; bir tarafta yeni kayıt açıp diğer tarafta yenile. Başka öğretmenin/velinin erişemediğini kontrol et.

Sonra Site ortamında API_BASE_URL / SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / APP_ORIGIN ayarlarını ver ve v5 web sürümünü yayımla. Hedefe yeni kayıt yazılmaya başlanınca eski v4’e kör geri dönüş yapma; önce yeni kayıtların korunacağı ters aktarımı planla. Eski D1/R2 bağlamalarını ve yedekleri doğrulama tamamlanmadan silme.

Mevcut v4 kaynak commit’i: `47e1ba6415acc0173c6a8d3d33b7275a0cc8a923`. Uygulanmış `drizzle/0000_jittery_tempest.sql` ve `0001_fancy_titania.sql` bu sürümde değiştirilmedi.

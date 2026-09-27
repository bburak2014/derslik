# Güvenlik taramaları

Bu kurulum Semgrep, Trivy, ZAP ve MobSF'yi Docker imajlarıyla çalıştırır. Docker Desktop açık olmalıdır. Raporlar `reports/security/` altında tutulur ve Git'e eklenmez; raporlar uygulama yolları ve güvenlik bulguları içerebilir.

Ana klasörde:

```sh
pnpm security:status
pnpm security:code
pnpm security:dependencies
```

`security:code` kaynak kodunu Semgrep ile inceler. `security:dependencies` kilit dosyaları, yapılandırma ve kaynak dosyalardaki sırları Trivy ile tarar. Yerel `.env` dosyaları ve üretilmiş klasörler bu komutların kapsamı dışındadır. İlk çalıştırma kural/veri tabanlarını indirebilir. JSON raporları `reports/security/semgrep.json` ve `reports/security/trivy.json` dosyalarına yazılır. Bulgular otomatik olarak düzeltme veya hata anlamına gelmez; doğrulayın.

Bu komutlar başlangıçta rapor üretir; bulgu sayısına göre CI'yi başarısız kılacak bir eşik tanımlı değildir.

## Web ve API

Önce yerel uygulamayı `pnpm dev` ile açın. Ayrı terminalde:

```sh
pnpm security:web
```

Bu komut `http://host.docker.internal:3000` adresini ZAP ile **pasif** tarar ve HTML/JSON rapor üretir. Test ortamındaki başka bir adres için:

```sh
bash scripts/security-scan.sh web https://test-ortami.example.com
```

Hedef adresi yalnızca test yetkiniz olan ortamlarda kullanın. Varsayılan tarama giriş ekranından öteye geçemez. Yetkili öğretmen, öğrenci ve veli akışları için ayrı test hesapları ve oturum bağlamı gerekir. Canlı veriye karşı aktif saldırı taraması bu komuta eklenmemiştir.

## Mobil

```sh
pnpm security:mobile
```

MobSF arayüzü `http://127.0.0.1:8000` adresinde açılır; yalnızca bu bilgisayardan erişilebilir. Varsayılan giriş bilgileri `mobsf` / `mobsf`'dir. Expo'nun `preview` profiliyle üretilen Android APK'sını veya iOS IPA'sını arayüze yükleyin. Bu depoda hazır APK/IPA yoktur. Dinamik analiz için ayrıca desteklenen emülatör veya test cihazı gerekir.

İşi bitirince `pnpm security:mobile:stop` komutuyla arayüzü kapatın. MobSF tarama geçmişi `derslik-mobsf-data` adlı Docker volume'ünde kalır.

## Kapsam sınırı

Otomatik tarayıcılar kullanıcılar arası yetki ve iş kuralı hatalarının tamamını doğrulamaz. API'nin mevcut entegrasyon testlerine ek olarak öğretmen, öğrenci ve veli hesaplarıyla başka bir kullanıcının öğrenci, dosya, video ve çalışma alanı kimliklerine erişim denemeleri yapılmalıdır.

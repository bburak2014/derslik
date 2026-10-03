# Kod kalitesi analizi (SonarQube + jscpd)

Yerelde hesap veya bulut gerekmez; her şey bu makinede, Docker içinde çalışır.
CI'da SonarCloud'un kalite kapısı ve projenin sıfır sorun kuralı birlikte
denetlenir (aşağıda "CI: SonarCloud").

## Commit kancası ve kapı

    pnpm quality:gate

Kapı çalışma kopyasını yerel SonarQube'de tarar. Açık sorun, inceleme
bekleyen güvenlik noktası ya da %3'ü aşan kod tekrarı varsa sorunları dosya ve
satırıyla listeler (`reports/sonar-gate.json`) ve 1 ile çıkar. Test kapsamı
kurala girmez. Her `git commit` öncesinde `.githooks/pre-commit` bu kapıyı
çalıştırır; kapı geçmezse commit atılmaz.

- Kanca `pnpm install` ile açılır (`prepare` → `git config core.hooksPath .githooks`).
- Kanca PATH'te Node 22.13+ bulamazsa nvm'de kurulu sürümleri dener.
- Kapı diskteki dosyaları tarar; commit'e eklenmemiş bir değişiklikteki sorun da commit'i durdurur.
- Worktree'ler parolayı (`reports/.sonar-admin`), yerel tarayıcıyı ve önbelleği ana checkout'tan alır. Aynı anda tek kapı çalışır (`.git/sonar-gate.lock`); öteki sırasını bekler.
- `git commit --no-verify` kancayı atlar; yalnızca kullanıcının açık onayıyla kullanılır (`AGENTS.md`).

SonarQube imajı (`sonarqube:26.9.0.129388-community`) ve Docker tarayıcı
imajı `scripts/sonar-local.mjs`'te tam sürüme sabittir. Yönetilen kapsayıcı
`derslik-sonarqube` farklı bir imajla ya da bütün ağ arayüzlerine açık
çalışıyorsa veri birimleri korunarak yeniden kurulur. `SONAR_CONTAINER` ile
seçilen kapsayıcı hiçbir zaman silinmez, yalnızca uymazsa uyarı yazılır.

Susturma kuralı ve göndermeden önceki kontrol listesi: kökteki `AGENTS.md`.

ESLint'te SonarJS kuralları da vardır (`pnpm lint`); sorunların çoğunu saniyeler içinde, kapıdan önce gösterir.

## CI: SonarCloud

`.github/workflows/ci.yml`'deki `sonar` işi (`checks` ile paralel) üç
adımda doğrular:

1. **Gerçek test kapsamı.** `pnpm test:coverage` API ve web'i derler; PGlite
   API entegrasyon testlerini, mobil güvenlik testlerini ve bütün
   `tests/*.test.mjs` testlerini V8 kapsamı açıkken çalıştırır. c8, derleme
   ve VM kaynak haritalarıyla kapsamı asıl TypeScript satırlarına eşler;
   `reports/coverage/lcov.info` taramadan önce üretilir. Testlerden biri
   başarısızsa tarama yapılmaz. Mobil testler gerçek uygulama işlevlerini
   sahte native/ağ adaptörleriyle çalıştırır; cihaz kapsamı sayılmaz.
2. **Tarama ve SonarCloud kalite kapısı.** `SonarSource/sonarqube-scan-action`
   `sonar-project.properties` ile çalışır; kaynak/test kapsamı ve gerekçeli
   susturmalar yerel taramayla aynıdır. Organizasyon `bburak2014`, proje
   anahtarı `bburak2014_derslik`, `sonar.scm.disabled=false` ve
   `sonar.qualitygate.wait=true` komut satırından verilir. LCOV,
   `sonar.javascript.lcov.reportPaths` üzerinden içeri alınır. SonarCloud'un
   kapısı kırmızıysa (yeni kod kapsamı %80'in altında veya yeni kod tekrarı
   %3'ün üstünde dahil) tarama adımı başarısız olur.
3. **Sıfır sorun kapısı.** `pnpm quality:cloud` (`scripts/sonar-cloud-gate.mjs`)
   tamamlanan analizi bekleyip yerel kapıyla aynı ek kuralı uygular: açık
   sorun 0, `TO_REVIEW` güvenlik noktası 0, toplam kod tekrarı en çok %3.
   Sorunlar dosya ve satırıyla yazdırılır; `reports/sonar-gate.json`, kırmızı
   işte `sonar-gate` artifact'ı olarak yüklenir. Bu ek kural SonarCloud'un
   kendi kapısının yerine geçmez. LCOV ve kapsam özeti de `test-coverage`
   artifact'ında saklanır.

Kapı kapalıyken güvenlidir: token yoksa, görev FAILED/CANCELED/zaman aşımıysa,
API hata verirse ya da sorun listesi eksik gelirse çıkış kodu 0 olmaz.

Kurulum:

- SonarCloud'da projenin **otomatik analizi kapalı** olmalı (Administration >
  Analysis Method); aksi halde CI taraması "otomatik analiz açık" hatasıyla
  reddedilir.
- GitHub'da depoya `SONAR_TOKEN` secret'ı eklenir (Settings > Secrets and
  variables > Actions). Token SonarCloud'da projeyi tarama (Execute
  Analysis) yetkisiyle üretilir. Fork PR'larına secret verilmediği için iş orada çalışmaz; main'e
  push'ta her zaman çalışır.

Kapsam: main'e push'ta projenin tamamı (`branch=<dal>`) denetlenir. Çekme
isteklerinde (`pullRequest=<numara>`) SonarCloud yalnızca yeni kodun
sorunlarını raporlar; kapının yerel kapı kadar sıkı olması için asıl güvence
main push'udur. SonarCloud'a özel ek kurallar (taint analizi gibi) yerel
SonarQube Community'de yoktur; ilk taramada yeni bulgular çıkabilir ve
düzeltilmeden CI yeşile dönmez.

Yerelde denemek için (taramayı önce CI'daki gibi çalıştırmış olmak gerekir):

```bash
SONAR_TOKEN=... pnpm quality:cloud --branch main
SONAR_TOKEN=... pnpm quality:cloud --pull-request 12
```

## SonarQube

```bash
pnpm install          # tür bilgisi için bağımlılıklar kurulu olmalı
pnpm quality:sonar
```

İlk çalıştırmada sabit sürümlü SonarQube kapsayıcısı (`derslik-sonarqube`) kurulur,
yönetici parolası rastgele üretilip `ana checkout'taki reports/.sonar-admin` dosyasına yazılır
(git'e girmez). Sonraki çalıştırmalar aynı kapsayıcıyı kullanır, geçmiş
analizler kaybolmaz. Sonuçlar: http://localhost:9000/dashboard?id=derslik
(kullanıcı `admin`, parola o dosyada).

Script scanner'ın ürettiği `ceTaskId` ile bu taramanın işlenmesini bekler;
başarısız, iptal edilmiş ve zaman aşımına uğramış görevlerde hata verir.
Kalite kapısını tamamlanan analizin `analysisId` değeriyle sorgular ve sonuçları
`reports/quality/sonar-summary.json` dosyasına yazar. Kalite kapısı `OK`
olmadığında komut başarısız olur. Kapsamı içeri almak için önce:

```bash
pnpm test:coverage
pnpm quality:sonar
```

`test:coverage` derlemeleri de yapar; önceden üretilmiş bir web/API derlemesi
gerekmez. Kapsam dosyaları Git'e girmez. c8, `sonar.sources` ve
`sonar.exclusions` ayarlarını doğrudan okur; testte hiç yüklenmeyen kaynakları
da %0 ile rapora katar. Kapsamı artırmak amacıyla ek kaynak hariç bırakılmaz.
Üretim Next sunucusunun minify edilmiş SSR haritaları kapsam ölçümüne
katılmaz: bu haritalar hiç çağrılmamış istemci işlevlerini çalışmış
gösterebiliyor. HTTP testleri yine üretim derlemesine karşı çalışır; asıl web
kaynakları raporda kalır ve doğrudan kaynak testleriyle ölçülür. VM haritası
regresyon testi, hiç çağrılmamış bir TypeScript işlevinin satırının %0
kaldığını doğrular.

LCOV satırları var olan depo dosyaları ve geçerli satır numaralarıyla
karşılaştırılır; boş veya hiç çalıştırılmamış bir rapor başarılı sayılmaz.
`coverageReportImported` alanı, geçerli LCOV ile Sonar'ın kapsam ölçümünün
ve en az bir kapsanmış Sonar satırının birlikte doğrulandığını belirtir;
Sonar'ın rapor olmadan döndürdüğü otomatik sıfır değerinin içeri aktarılmış kapsam olduğu kabul edilmez.

Kapsayıcı yalnızca `127.0.0.1:<SONAR_PORT>` üzerinde dinler (varsayılan 9000).
`derslik-sonarqube` bütün arayüzlere açık ise yeniden kurulur.

Mevcut yerel sunucudan bağımsız bir analiz ortamı açmak için:

```bash
SONAR_CONTAINER=derslik-quality-sonar \
SONAR_NETWORK=derslik-quality-sonar \
SONAR_PORT=9001 \
SONAR_ADMIN_FILE=reports/quality/.sonar-admin \
pnpm quality:sonar
```

Bu adlandırma farklı veri ve eklenti volume'ları oluşturur. Gerekirse
`SONAR_DATA_VOLUME`, `SONAR_EXTENSIONS_VOLUME` ve yerel API adresi için
`SONAR_HOST_URL` ayrı belirlenebilir.

Tarayıcı Node heap sınırı varsayılan olarak 3072 MiB, Java heap sınırı 512 MiB'dır.
`SONAR_NODE_MAXSPACE=2048` ve `SONAR_SCANNER_JAVA_OPTS=-Xmx1024m` ile
makinenin belleğine göre ayarlanabilir. Tarayıcı başarısız olursa script
hata kodunu aktarır; önceki analiz sonuçları başarı olarak gösterilmez.

Apple Silicon gibi ortamlarda Docker scanner emülasyonu yerine resmi platform
CLI'si kullanılabilir. Yerli tarayıcı ve önbelleği ana checkout'taki
`reports/quality/tool-cache/sonar-scanner-*/bin/sonar-scanner` ve
`reports/quality/cache` konumlarında bulur. Farklı bir yol ya da önbellek için
`SONAR_SCANNER_PATH` / `SONAR_USER_HOME` kullanılabilir. Yerli scanner mevcut
native Node executable'ını kullanır; sunucu Docker'da kalır, token yalnızca
ortam değişkeniyle iletilir.

Resmi platform paketleri: [SonarScanner CLI indirme ve kurulum](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/scanners/sonarscanner).

Ne analiz edildiği `sonar-project.properties` içinde:

- Dahil: `apps/api/src`, `apps/web` (app, components, hooks, lib),
  `apps/mobile/src`, `packages/*/src`, `scripts`; ayrıca web `proxy.ts`,
  API/Web/Metro yapılandırmaları, `build/sites-vite-plugin.ts` ve root
  Next/Vite/Drizzle/ESLint/PostCSS yapılandırmaları. Testler ayrı sayılır.
- Hariç: derleme çıktısı, `apps/mobile/android`, eski v4 migration'ları
  (`drizzle/`, `apps/api/drizzle/`) ve `apps/web/components/ui` (shadcn'den
  olduğu gibi kopyalanan bileşenler, bilerek değiştirilmiyor).
- Çeviri dosyaları (`packages/contracts/src/i18n`) tekrar sayımına girmez.

Kapsayıcıyı durdurmak: `docker stop derslik-sonarqube`.
Tamamen sıfırlamak (ana checkout'tan çalıştırın):

```bash
docker rm -f derslik-sonarqube
docker volume rm derslik-sonar-data derslik-sonar-extensions
rm reports/.sonar-admin
```

## Kod tekrarı (jscpd)

SonarQube en az 10 satırlık tekrarları sayar. Daha küçük kopyalar (web ile
mobil arasında taşınmış yardımcılar gibi) için:

```bash
pnpm quality:dup
```

Ayarlar `.jscpd.json` içinde (en az 5 satır / 50 belirteç; shadcn, çeviriler
ve derleme çıktısı hariç). Uygulama, paket, script ve `tests` kaynakları
ile `build` plugin ve root kod yapılandırmaları analiz edilir. HTML rapor
`reports/jscpd/html/index.html`, makine tarafından
okunabilir rapor `reports/jscpd/jscpd-report.json`.

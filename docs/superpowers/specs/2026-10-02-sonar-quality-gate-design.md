# Sonar kalite kapısı: tasarım

- Tarih: 2026-10-02
- Durum: Tasarım onaylandı, uygulama planı bekleniyor
- Dal: `sonar-quality-gate`

## Amaç

Her geliştirmede kod Sonar kurallarıyla denetlenir ve bulunan sorunlar `main`'e gönderilmeden düzeltilir. Önce projede kalan bütün Sonar sorunları temizlenir; sonra hiçbir sorunla gönderilmez.

Başarı ölçütleri:

1. `pnpm lint`, Sonar'ın JavaScript/TypeScript kurallarını (SonarJS) da çalıştırır ve projede hiç ihlal yoktur.
2. `pnpm quality:gate`, yerel SonarQube'de projenin tamamını tarar. Açık sorun ya da inceleme bekleyen güvenlik noktası yoksa ve kod tekrarı sınırın altındaysa geçer. Aksi hâlde sorunları dosya ve satırıyla listeleyip başarısız olur.
3. CI'daki "Sonar" işi aynı kapıyı her `main` gönderiminde ve her PR'da çalıştırır; kapı başarısızsa CI kırmızıdır.
4. Mevcut kod tabanındaki Sonar sorunlarının sayısı sıfırdır.
5. Kökteki `AGENTS.md` (ve onu okutan `CLAUDE.md`), birleştirmeden önce bu kontrolleri zorunlu kılar; her oturum bu kuralı görür.
6. Mevcut testler ve CI adımları geçmeye devam eder.

## Kullanıcıyla verilen kararlar

- **Kapsam:** Projedeki bütün sorunlar. Yalnızca yeni kod değil; hedef sıfır sorun.
- **Yer:** Hem yerelde (birleştirmeden önce) hem CI'da.
- **Yaklaşım:** İki katman: ESLint'te SonarJS (hızlı, yazarken) ve yerel SonarQube kapısı (tam tarama). Hesap ve bulut yok; SonarCloud ileride üçüncü katman olarak eklenebilir.

## Mevcut durum

- `pnpm quality:sonar` (`scripts/sonar.mjs`, #21): Docker'da `sonarqube:community` kapsayıcısını (`derslik-sonarqube`) açar, `sonarsource/sonar-scanner-cli` ile tarar ve ölçü özetini yazar. Başarısız olmaz, sorunları listelemez. İmajlar sürüme sabitli değildir.
- `sonar-project.properties`: kaynaklar (`apps/api/src`, `apps/web/{app,components,hooks,lib}`, `apps/mobile/src`, `apps/mobile/index.ts`, `packages/*/src`, `scripts`), testler (`apps/api/tests`, `tests`), hariçler (derleme çıktısı, `apps/mobile/android`, `apps/web/components/ui`, `apps/web/vendor`, `drizzle/`, `apps/api/drizzle/`). Çeviri dosyaları tekrar sayımına girmez.
- `pnpm quality:dup` (jscpd): küçük tekrarlar için ayrı araç.
- ESLint 9, düz yapılandırma (`eslint.config.mjs`), `eslint-config-next`. Sonar eklentisi yok.
- CI (`.github/workflows/ci.yml`): `main`'e gönderimde ve PR'larda tek iş (`checks`); eylemler SHA'ya sabitli.
- SonarQube kapsayıcısı ve veri birimleri şu an makinede yok; ilk çalıştırma yeniden kurar.

## Kapsam dışı

- SonarCloud ve taint analizi (enjeksiyon açıklarının izlenmesi; SonarQube Community'de yok).
- Görsel sorunlar (ör. pencerenin boyunun değişmesi). Sonar bunları yakalamaz; tarayıcıda ölçümle denetlenir (aşağıdaki çalışma kuralında yer alır).
- jscpd'nin kapıya bağlanması. `pnpm quality:dup` olduğu gibi kalır.
- Git kancası (pre-push). Tarama dakikalar sürdüğü için kancaya konmaz.
- Dal ve PR analizi (Community'de yok). Kapı her zaman projenin tamamını değerlendirir.

## Bileşenler

### 1. ESLint'te SonarJS

- `eslint-plugin-sonarjs`, sabit sürümle geliştirme bağımlılığı olur.
- `eslint.config.mjs`'e eklentinin önerilen kural seti (`sonarjs.configs.recommended`) eklenir. Kurallar, Sonar'ın taradığı dosyalarla aynı kapsamda uygulanır: `sonar-project.properties`'teki kaynak ve test klasörleri. Shadcn'den olduğu gibi alınan dosyalar (`apps/web/components/ui/**`, `apps/web/hooks/use-mobile.ts`) dışarıda kalır.
- Önerilen setteki bütün kurallar hata (`error`) düzeyinde uygulanır. Uyarı düzeyinde bırakılan bir SonarJS kuralı `pnpm lint`'i başarısız yapmadığı için sıfır ihlal hedefini sağlamaz. Diğer eklentilerin mevcut uyarıları bu işin kapsamında değildir.
- Tip bilgisi gerektiren kurallar ESLint'te tip bilgisi olmadığı için çalışmaz; bu kuralları tam tarama denetler.
- Bir kural Next ya da React Native kurallarıyla çakışırsa ya da sistematik yanlış alarm verirse, yapılandırmada gerekçesi yazılarak kapatılır. Gerekçesiz kapatma yoktur.

### 2. Kapı: `pnpm quality:gate`

`scripts/sonar.mjs`'e bir kapı modu eklenir. `pnpm quality:sonar` bugünkü gibi çalışmaya devam eder: tarar ve özet yazar. `pnpm quality:gate` ise taramadan sonra şunları yapar:

1. Raporun sunucuda işlenmesini bekler (mevcut bekleme döngüsü).
2. Açık sorunları çeker (`/api/issues/search`, `resolved=false`, sayfalı): hata, güvenlik açığı ve kod kokusu, her önem düzeyi.
3. İnceleme bekleyen güvenlik noktalarını çeker (`/api/hotspots/search`, `status=TO_REVIEW`, sayfalı).
4. Kod tekrarı oranını (`duplicated_lines_density`) okur.
5. Sonuçları dosyaya göre gruplanmış olarak yazdırır (`yol:satır önem kural mesaj`); güvenlik noktaları ayrı başlık altında. Tam liste `reports/sonar-gate.json`'a yazılır (`reports/` git dışında).
6. Açık sorun ya da inceleme bekleyen güvenlik noktası varsa veya kod tekrarı sınırı aşıyorsa çıkış kodu 1 olur; yoksa 0.

Ayrıntılar:

- **Kod tekrarı sınırı:** Varsayılan %3 (Sonar'ın "Sonar way" kapısının yeni kod değeri). İlk taramadan sonra kullanıcıyla kesinleşir; betikte gerekçeli bir sabit olarak durur.
- **Sabit sürümler:** SonarQube ve tarayıcı imajları, uygulama sırasında güncel olan Community Build ve tarayıcı sürümlerinin tam etiketine sabitlenir. Aynı sabitler yerelde ve CI'da kullanılır, böylece kurallar iki yerde aynıdır. Sürüm yükseltme ayrı bir iştir.
- **Yönetici parolası:** Mevcut düzen korunur (`reports/.sonar-admin` ya da `SONAR_ADMIN_PASSWORD`). CI'da her çalıştırmada yeni bir rastgele parola üretilir.
- **Hatalar:** Docker çalışmıyorsa, sunucu açılmıyorsa ya da tarama başarısız olursa net bir mesajla 0 dışında bir kodla çıkılır. Kapı hiçbir durumda "geçti" sanılmaz.
- **Worktree'ler:** Tarama, betiğin çalıştırıldığı çalışma kopyasını tarar. Bütün kopyalar aynı `derslik` projesine yazar; son tarama geçerlidir.

### 3. CI işi

- `.github/workflows/ci.yml`'e `checks` ile paralel çalışan bir `sonar` işi eklenir: `ubuntu-latest`, 30 dakika zaman aşımı, adımlar: checkout, pnpm, Node, `pnpm install --frozen-lockfile`, `pnpm quality:gate`.
- Kapı başarısız olursa `reports/sonar-gate.json` bir artifact olarak yüklenir (`actions/upload-artifact`, mevcut eylemler gibi SHA'ya sabitli).
- İki iş de geçmeden CI yeşil olmaz.
- İş, başlangıç temizliği bitip kapı yerelde geçtikten sonra eklenir; böylece CI arada kırmızıya düşmez.

### 4. Çalışma kuralı

- Kökte `AGENTS.md`. Birleştirmeden (ya da `main`'e göndermeden) önce şu kontroller geçer:
  - `pnpm typecheck`
  - `pnpm mobile:typecheck`
  - `pnpm lint`
  - `pnpm test` ve değişikliğe ilgili testler
  - `pnpm web:build`
  - `pnpm quality:gate`

  Sıfır Sonar sorunu kuralı burada yazılıdır. Susturmalar yalnızca gerekçeyle yapılır: kodda `// NOSONAR: <gerekçe>` ya da `eslint-disable-next-line <kural> -- <gerekçe>`; ayarda gerekçeli `sonar.issue.ignore.multicriteria`. Pencere (modal) kuralı da kısaca buradadır: pencere son boyutunda açılır, içerik gelince ya da değişince boyu değişmez; değişen her pencerede tarayıcıda yükseklik ölçülür.
- Kökte `@AGENTS.md` satırını içeren bir `CLAUDE.md` (`apps/web` ile aynı düzen).
- `docs/sonar.md` kapıyı, CI işini ve susturma kuralını anlatacak şekilde güncellenir.

## Başlangıç temizliği

1. SonarJS lint ihlalleri düzeltilir.
2. `pnpm quality:gate` çalıştırılır. Sorunlar türlerine (hata, açık, koku, güvenlik noktası) ve klasörlere göre sayılıp kullanıcıya gösterilir. Kod tekrarı oranı da gösterilir ve sınır kesinleşir.
3. Sorunlar klasör klasör düzeltilir: API, web, mobil, ortak paketler, betikler, testler. Her bölüm ayrı commit'tir; her commit'ten sonra testler çalışır.
4. Güvenlik noktaları kodla giderilir. Gerçekten güvenliyse ayarda gerekçeli `sonar.issue.ignore.multicriteria` ile hariç tutulur. Sunucudaki "Güvenli" işareti CI'da kalıcı olmadığı için kullanılmaz.
5. Yanlış alarmlar gerekçeli `// NOSONAR` ya da multicriteria ile susturulur. Gerekçesiz susturma yoktur.
6. Düzeltmeler davranışı değiştirmez. Davranışı değiştirmesi gereken bir düzeltme çıkarsa testle korunur ve kullanıcıya ayrıca bildirilir.

## Test ve doğrulama

- **Kapının kendisi:** Bilerek bir Sonar sorunu eklenmiş bir dosyayla `pnpm quality:gate` başarısız olur; sorun dosya ve satırıyla listelenir. Sorun kaldırılınca kapı geçer. İki çıktı da kaydedilir.
- **Lint katmanı:** Bilinen bir SonarJS ihlali eklenince `pnpm lint` başarısız olur; kaldırılınca geçer.
- **CI:** Dal bir PR ile gönderildiğinde `sonar` işinin çalıştığı ve yeşil olduğu görülür.
- **Gerileme:** Mevcut bütün testler ve CI adımları yeşil kalır.

## Riskler

- **İlk temizlik büyük olabilir.** Bölüm bölüm, davranış değiştirmeden ve her adımda testlerle ilerlenir; sayılar başta kullanıcıya gösterilir.
- **CI süresi:** Sonar işi yaklaşık 6–8 dakika sürer. `checks` ile paralel çalışır; toplam süreyi uzun olan iş belirler.
- **Kaynak kullanımı:** SonarQube yerelde yaklaşık 2 GB bellek kullanır. İş bitince `docker stop derslik-sonarqube` ile kapatılabilir.
- **Kural değişimi:** İmaj sürümleri sabit olduğu için kurallar kendiliğinden değişmez. Sürüm yükseltmek ayrı iştir ve yeni sorunlar getirebilir.

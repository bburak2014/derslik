# Sonar kalite kapısı: tasarım

- Tarih: 2026-10-02 (aynı gün güncellendi: commit kancası eklendi)
- Durum: Tasarım (commit kancası güncellemesiyle) onaylandı. `docs/superpowers/plans/2026-10-02-sonar-quality-gate.md` bu güncellemeden önce yazıldı; uygulamadan önce bu tasarıma göre yenilenecek.
- Dal: `sonar-quality-gate`

## Amaç

Her commit'te kod Sonar kurallarıyla denetlenir; Sonar'da açık sorun varsa commit atılamaz. Önce projede kalan bütün Sonar sorunları temizlenir; sonra hiçbir sorunla commit atılmaz ve `main`'e gönderilmez.

Başarı ölçütleri:

1. Her `git commit` öncesinde kanca `pnpm quality:gate`'i çalıştırır. Kapı geçmezse commit atılmaz ve sorunlar dosya ve satırıyla listelenir. Bu, ana checkout'ta ve bütün worktree'lerde geçerlidir.
2. `pnpm lint`, Sonar'ın JavaScript/TypeScript kurallarını (SonarJS) da çalıştırır ve projede hiç ihlal yoktur.
3. `pnpm quality:gate`, yerel SonarQube'de projenin tamamını tarar. Açık sorun ya da inceleme bekleyen güvenlik noktası yoksa ve kod tekrarı sınırın altındaysa geçer. Aksi hâlde sorunları dosya ve satırıyla listeleyip başarısız olur.
4. CI'daki "Sonar" işi aynı kapıyı her `main` gönderiminde ve her PR'da çalıştırır; kapı başarısızsa CI kırmızıdır.
5. Mevcut kod tabanındaki Sonar sorunlarının sayısı sıfırdır.
6. Kökteki `AGENTS.md` (ve onu okutan `CLAUDE.md`), birleştirmeden önce bu kontrolleri zorunlu kılar ve `--no-verify` kuralını yazar; her oturum bu kuralları görür.
7. Mevcut testler ve CI adımları geçmeye devam eder.

## Kullanıcıyla verilen kararlar

- **Kapsam:** Projedeki bütün sorunlar. Yalnızca yeni kod değil; hedef sıfır sorun.
- **Yer:** Her commit'te yerelde (kanca) ve CI'da.
- **Yaklaşım:** İki katman: ESLint'te SonarJS (hızlı, yazarken) ve yerel SonarQube kapısı (tam tarama). Hesap ve bulut yok; SonarCloud ileride üçüncü katman olarak eklenebilir.
- **Commit kancası (güncelleme):** Kanca hemen ve "projede sıfır sorun" kuralıyla açılır. Temizlik bitene kadar her commit engellenir. Önceki tasarımda kanca, taramanın dakikalar süreceği varsayımıyla kapsam dışıydı. Yerel (native) tarayıcıyla tarama yaklaşık 31 saniye sürdüğü için bu karar kalktı.
- **Kanca düzeneği:** Bağımlılık eklemeyen düz git kancası (`.githooks/pre-commit` ve `core.hooksPath`). Husky aynı işi ek paketle yaptığı için seçilmedi.
- **Sunucu:** Tek sunucu, `derslik-sonarqube`. Yalnızca bu bilgisayardan erişilir.

## Mevcut durum

- `pnpm quality:sonar` (`scripts/sonar.mjs` ve `scripts/sonar-report.mjs`; Codex denetimi, `daebad5`):
  - Docker'da SonarQube kapsayıcısını açar. `SONAR_SCANNER_PATH` verilirse yerel tarayıcıyla, verilmezse `sonarsource/sonar-scanner-cli` imajıyla tarar.
  - Tarayıcının yazdığı `ceTaskId`'yi bekler, kalite kapısını bu analizin `analysisId`'siyle sorgular ve `reports/quality/sonar-summary.json` yazar. Sonar'ın kendi kapısı OK değilse çıkış kodu 1'dir. Açık sorunları listelemez.
  - Ayarlar ortam değişkenleriyle değişir (`SONAR_PORT`, `SONAR_CONTAINER`, `SONAR_ADMIN_FILE`, `SONAR_SCANNER_PATH` …). Yeni kapsayıcı yalnızca `127.0.0.1`'e bağlanır.
  - İmajlar sürüme sabitli değildir (`sonarqube:community`). Çalışan sunucu 26.9.0.129388 Community Build.
- Sonar'ın kendi kalite kapısı ("Sonar way") şu an ERROR. İki neden var: test kapsamı ölçülmediği için yeni kodda kapsam %0, ve `build/` taramaya eklenince 2 yeni ihlal çıktı.
- Son analiz (Codex denetimi): 51.413 satır; 3 hata (bug), 19 güvenlik açığı, 449 kod kokusu, 0 güvenlik noktası; kod tekrarı %0,5.
- `sonar-project.properties`: kaynaklar (`apps/api/src`, `apps/web/{app,components,hooks,lib}`, `apps/web/proxy.ts`, `apps/mobile/src`, `apps/mobile/index.ts`, `packages/*/src`, `scripts`, `build`, kökteki ve uygulamalardaki Next/Vite/Drizzle/ESLint/PostCSS/Metro yapılandırmaları), testler (`apps/api/tests`, `tests`), hariçler (derleme çıktısı, `apps/mobile/android`, `apps/web/components/ui`, `apps/web/vendor`, `drizzle/`, `apps/api/drizzle/`). Çeviri dosyaları tekrar sayımına girmez.
- Makinede iki SonarQube sunucusu çalışıyor:
  - `derslik-sonarqube`: port 9000, `0.0.0.0`'a bağlı (yerel ağdan erişilebilir). Veri `derslik-sonar-data` ve `derslik-sonar-extensions` birimlerinde. Yönetici parolası `.claude/worktrees/lesson-booking/reports/.sonar-admin` dosyasında.
  - `derslik-quality-sonar`: Codex denetiminin sunucusu, port 9001, yalnızca `127.0.0.1`. Parolası ana checkout'ta `reports/quality/.sonar-admin`.
- Yerel tarayıcı, ana checkout'ta `reports/quality/tool-cache/sonar-scanner-8.1.0.6389-macosx-aarch64/` altında (git dışında).
- Git kancası yok; `core.hooksPath` ayarlı değil.
- Makinenin PATH'indeki `node` v20.14. Node 24 ve pnpm nvm'de. `package.json`'da `engines.node` `>=22.13.0`; `.nvmrc` yok.
- `pnpm quality:dup` (jscpd): küçük tekrarlar için ayrı araç.
- ESLint 9, düz yapılandırma (`eslint.config.mjs`), `eslint-config-next`. Sonar eklentisi yok.
- CI (`.github/workflows/ci.yml`): `main`'e gönderimde ve PR'larda tek iş (`checks`); eylemler SHA'ya sabitli. `pnpm test:quality` adımı var.

## Kapsam dışı

- SonarCloud ve taint analizi (enjeksiyon açıklarının izlenmesi; SonarQube Community'de yok).
- Görsel sorunlar (ör. pencerenin boyunun değişmesi). Sonar bunları yakalamaz; tarayıcıda ölçümle denetlenir (aşağıdaki çalışma kuralında yer alır).
- jscpd'nin kapıya bağlanması. `pnpm quality:dup` olduğu gibi kalır.
- Dal ve PR analizi (Community'de yok). Kapı her zaman projenin tamamını değerlendirir.
- Test kapsamının (coverage) ölçülmesi ve kapıya bağlanması.
- Yalnızca commit'e eklenen (stage edilen) içeriğin taranması. Kapı çalışma kopyasını tarar (bkz. Bileşen 2).

## Bileşenler

### 1. Commit kancası

- `.githooks/pre-commit`: POSIX `sh`, çalıştırılabilir dosya.
- `package.json`'a `"prepare": "git config core.hooksPath .githooks"` eklenir. `pnpm install` kancayı açar. Ayar repo genelinde geçerli olduğu için ana checkout'ta ve bütün worktree'lerde çalışır. Git deposu olmayan bir ortamda `prepare` hata vermeden atlar.
- Kanca şu adımları izler:
  1. **Node seçimi:** PATH'teki `node`, `engines` sürümünü (`>=22.13.0`) karşılamıyorsa `$NVM_DIR/nvm.sh` (varsayılan `~/.nvm`) yüklenir ve `nvm use 24` ile Node 24 seçilir. Uygun Node bulunamazsa commit durur ve ne yapılacağı yazılır.
  2. `node scripts/sonar.mjs --gate` çalışır; pnpm gerekmez.
  3. Çıkış kodu 0 değilse commit durur.
- **Açılış sırası:** Kanca dosyaları commit edildikten sonra `core.hooksPath` ayarlanır. Böylece kanca kendi commit'ini engellemez.
- **Atlatma:** Git'in `--no-verify` seçeneği kancayı atlar. Yalnızca kullanıcının o commit (ya da temizlik bölümü) için verdiği açık onayla kullanılır. Kural `AGENTS.md`'de yazılıdır.
- **Kancanın çalışmadığı durumlar:** `git merge --ff-only` ve `git rebase` pre-commit kancasını çalıştırmaz. Bunlar engellenmez; `main`'e giden kodu CI kapısı denetler.

### 2. Kapı: `pnpm quality:gate`

`scripts/sonar.mjs`'e `--gate` modu eklenir; `package.json`'a `"quality:gate": "node scripts/sonar.mjs --gate"` girer. `pnpm quality:sonar`'ın `daebad5`'teki davranışı değişmez. Kapı modu şu adımları izler:

1. Kilidi alır (aşağıda).
2. Çalışma kopyasını tarar.
3. Bu taramanın sunucu görevini mevcut `waitForAnalysis` ile bekler. Görev FAILED, CANCELED ya da zaman aşımıyla biterse kapı başarısız olur.
4. Açık sorunları çeker: `/api/issues/search`, `componentKeys=derslik`, `resolved=false`, sayfalı. Bütün türler (hata, güvenlik açığı, kod kokusu) ve bütün önem düzeyleri.
5. İnceleme bekleyen güvenlik noktalarını çeker: `/api/hotspots/search`, `project=derslik`, `status=TO_REVIEW`, sayfalı.
6. Kod tekrarı oranını (`duplicated_lines_density`) mevcut `collectAnalysisReport` ile okur.
7. Sonuçları dosyaya göre gruplayıp yazdırır (`yol:satır önem kural mesaj`); güvenlik noktaları ayrı başlık altındadır. Tam liste çalışma kopyasının `reports/sonar-gate.json` dosyasına yazılır (`reports/` git dışında).
8. Açık sorun ya da inceleme bekleyen güvenlik noktası varsa veya kod tekrarı sınırı aşıyorsa çıkış kodu 1, yoksa 0'dır.

Ayrıntılar:

- **Geçme kuralı:** Açık sorun 0, inceleme bekleyen güvenlik noktası 0, kod tekrarı en fazla %3. Sonar'ın kendi kalite kapısı bu kararda kullanılmaz, çünkü yalnızca yeni koda bakar ve test kapsamı şartı içerir.
- **Kod tekrarı sınırı:** %3, Sonar'ın "Sonar way" kapısının yeni kod değeri. Betikte gerekçeli bir sabit olarak durur. Şu anki oran %0,5.
- **Ortak yollar:** Ana checkout'un kökü, `git rev-parse --path-format=absolute --git-common-dir` çıktısının üst klasörüdür. İki mod da şu yolları buradan bulur:
  - Yönetici parolası: `<ana checkout>/reports/.sonar-admin`. `SONAR_ADMIN_PASSWORD` ve `SONAR_ADMIN_FILE` önceliklidir.
  - Yerel tarayıcı: `SONAR_SCANNER_PATH` verilmemişse `<ana checkout>/reports/quality/tool-cache/sonar-scanner-*/bin/sonar-scanner` aranır. Bulunamazsa Docker tarayıcısı kullanılır; Apple Silicon'da emülasyonla çalıştığı için yavaştır.
- **Kilit:** `<git ortak klasörü>/sonar-gate.lock` klasörü. `mkdir` atomik olduğu için aynı anda tek kapı çalışır. Klasöre sahibinin pid'i yazılır. O pid artık yaşamıyorsa kilit bayat sayılır ve alınır. Kilit beklenirken "başka bir commit taranıyor" yazılır. 10 dakikada alınamazsa kapı başarısız olur. Kilit, kapı her nasıl biterse bitsin bırakılır.
- **Çalışma kopyası:** Tarama diskteki dosyaları görür. Stage edilmemiş değişiklikler ve git'e eklenmemiş (ama yok sayılmayan) dosyalar da taranır. Commit'e girmeyen bir dosyadaki sorun da commit'i durdurur.
- **Worktree'ler:** Her kopya kendi çalışma kopyasını tarar ve hepsi aynı `derslik` projesine yazar. Kilit sayesinde bir kopyanın sonucu ötekininkiyle karışmaz.
- **Sabit sürümler:** SonarQube imajı, çalışan sunucunun sürümüne (26.9.0.129388 Community Build) karşılık gelen tam etikete, Docker tarayıcı imajı da tam etiketine sabitlenir. Yerel tarayıcı 8.1.0.6389'dur. Kurallar sunucudan geldiği için iki tarayıcı da aynı kuralları uygular. Aynı sabitler CI'da da kullanılır. Sürüm yükseltme ayrı bir iştir.
- **Yönetici parolası (CI):** CI'da her çalıştırmada yeni bir rastgele parola üretilir.
- **Hatalar:** Docker çalışmıyorsa, sunucu açılmıyorsa, tarama ya da Sonar API isteği başarısız olursa net bir mesajla 0 dışında bir kodla çıkılır. Kapı hiçbir durumda "geçti" sanılmaz.

### 3. Sunucu düzeni (bir kerelik)

- `derslik-sonarqube` kapsayıcısı silinir ve betikle yeniden oluşturulur; port yalnızca `127.0.0.1:9000`'e bağlanır. Veri birimlerde kaldığı için analizler ve yönetici parolası korunur.
- Parola dosyası `.claude/worktrees/lesson-booking/reports/.sonar-admin` konumundan ana checkout'taki `reports/.sonar-admin` dosyasına taşınır (izin 600).
- `derslik-quality-sonar` durdurulur, silinmez. Silmek kullanıcının kararıdır.
- Bu adımlar uygulama sırasında kullanıcıya gösterilir ve onayıyla yapılır.

### 4. ESLint'te SonarJS

- `eslint-plugin-sonarjs`, sabit sürümle geliştirme bağımlılığı olur.
- `eslint.config.mjs`'e eklentinin önerilen kural seti (`sonarjs.configs.recommended`) eklenir. Kurallar, Sonar'ın taradığı dosyalarla aynı kapsamda uygulanır: `sonar-project.properties`'teki kaynak ve test klasörleri. Shadcn'den olduğu gibi alınan dosyalar (`apps/web/components/ui/**`, `apps/web/hooks/use-mobile.ts`) dışarıda kalır.
- Önerilen setteki bütün kurallar hata (`error`) düzeyinde uygulanır. Uyarı düzeyinde bırakılan bir SonarJS kuralı `pnpm lint`'i başarısız yapmadığı için sıfır ihlal hedefini sağlamaz. Diğer eklentilerin mevcut uyarıları bu işin kapsamında değildir.
- Tip bilgisi gerektiren kurallar ESLint'te tip bilgisi olmadığı için çalışmaz; bu kuralları tam tarama denetler.
- Bir kural Next ya da React Native kurallarıyla çakışırsa ya da sistematik yanlış alarm verirse, yapılandırmada gerekçesi yazılarak kapatılır. Gerekçesiz kapatma yoktur.

### 5. CI işi

- `.github/workflows/ci.yml`'e `checks` ile paralel çalışan bir `sonar` işi eklenir: `ubuntu-latest`, 30 dakika zaman aşımı, adımlar: checkout, pnpm, Node, `pnpm install --frozen-lockfile`, `pnpm quality:gate`. CI'da yerel tarayıcı olmadığı için Docker tarayıcısı kullanılır.
- Kapı başarısız olursa `reports/sonar-gate.json` bir artifact olarak yüklenir (`actions/upload-artifact`, mevcut eylemler gibi SHA'ya sabitli).
- İki iş de geçmeden CI yeşil olmaz.
- İş, başlangıç temizliği bitip kapı yerelde geçtikten sonra eklenir; böylece CI arada kırmızıya düşmez.

### 6. Çalışma kuralı

- Kökte `AGENTS.md`. Birleştirmeden (ya da `main`'e göndermeden) önce şu kontroller geçer:
  - `pnpm typecheck`
  - `pnpm mobile:typecheck`
  - `pnpm lint`
  - `pnpm test` ve değişikliğe ilgili testler
  - `pnpm web:build`
  - `pnpm quality:gate`

  Sıfır Sonar sorunu kuralı burada yazılıdır. Her commit'te kancanın çalıştığı ve `git commit --no-verify`'ın yalnızca kullanıcının açık onayıyla kullanılacağı da yazılıdır. Susturmalar yalnızca gerekçeyle yapılır: kodda `// NOSONAR: <gerekçe>` ya da `eslint-disable-next-line <kural> -- <gerekçe>`; ayarda gerekçeli `sonar.issue.ignore.multicriteria`. Pencere (modal) kuralı da kısaca buradadır: pencere son boyutunda açılır, içerik gelince ya da değişince boyu değişmez; değişen her pencerede tarayıcıda yükseklik ölçülür.
- Kökte `@AGENTS.md` satırını içeren bir `CLAUDE.md` (`apps/web` ile aynı düzen).
- `docs/sonar.md` kancayı, kapıyı, CI işini ve susturma kuralını anlatacak şekilde güncellenir.

## Uygulama sırası

1. Kapı modu, commit kancası, sunucu düzeni, `AGENTS.md` ve `CLAUDE.md`. Bu adımın commit'i atıldıktan sonra `core.hooksPath` ayarlanır ve kanca açılır.
2. ESLint'te SonarJS.
3. Başlangıç temizliği (aşağıda).
4. Kapı yerelde geçer; kanca artık temiz commit'leri engellemez.
5. CI işi.

Kanca 1. adımdan sonra açık olduğu için 2. ve 3. adımların commit'leri kapıdan geçemez. Bu commit'ler `--no-verify` ile atılır. Her bölümün commit'i için kullanıcıdan ayrı onay alınır.

## Başlangıç temizliği

1. SonarJS lint ihlalleri düzeltilir.
2. `pnpm quality:gate` çalıştırılır. Sorunlar türlerine (hata, açık, koku, güvenlik noktası) ve klasörlere göre sayılıp kullanıcıya gösterilir.
3. Sorunlar klasör klasör düzeltilir: API, web, mobil, ortak paketler, betikler, `build` ve yapılandırmalar, testler. Her bölüm ayrı commit'tir; her commit'ten önce testler çalışır.
4. Güvenlik noktaları kodla giderilir. Gerçekten güvenliyse ayarda gerekçeli `sonar.issue.ignore.multicriteria` ile hariç tutulur. Sunucudaki "Güvenli" işareti CI'da kalıcı olmadığı için kullanılmaz.
5. Yanlış alarmlar gerekçeli `// NOSONAR` ya da multicriteria ile susturulur. Gerekçesiz susturma yoktur.
6. Düzeltmeler davranışı değiştirmez. Davranışı değiştirmesi gereken bir düzeltme çıkarsa testle korunur ve kullanıcıya ayrıca bildirilir.

## Test ve doğrulama

- **Kapının kendisi:** Bilerek bir Sonar sorunu eklenmiş bir dosyayla `pnpm quality:gate` başarısız olur; sorun dosya ve satırıyla listelenir. Sorun kaldırılınca kapı geçer. İki çıktı da kaydedilir.
- **Kanca:**
  - Kapı başarısızken `git commit` engellenir ve sorunlar listelenir.
  - Docker kapalıyken `git commit` engellenir ve mesaj Docker'ı söyler.
  - Bir worktree'de `git commit` kancayı çalıştırır; yerel tarayıcı ve parola ana checkout'tan bulunur.
  - PATH'te yalnızca Node 20 varken kanca Node 24'ü bulup kullanır.
  - Temizlikten sonra temiz bir commit kanca tarafından geçirilir.
- **Kilit (birim testi):** Kilit tutulurken ikinci kapı bekler. Sahibi yaşamayan bayat kilit alınır. Kapı hata ile bitse de kilit bırakılır.
- **Lint katmanı:** Bilinen bir SonarJS ihlali eklenince `pnpm lint` başarısız olur; kaldırılınca geçer.
- **CI:** Dal bir PR ile gönderildiğinde `sonar` işinin çalıştığı ve yeşil olduğu görülür.
- **Gerileme:** Mevcut bütün testler ve CI adımları yeşil kalır.

## Riskler

- **Commit süresi:** Her commit yaklaşık 40–60 saniye uzar (tarama ve sunucuda işleme). Tarayıcı önbelleği boşken ya da sunucu kapalıyken (ilk açılış 1–2 dakika) daha uzun sürer.
- **Temizlik bitene kadar her commit engellenir.** O süre boyunca commit'ler kullanıcı onayı ve `--no-verify` gerektirir. Bu, diğer oturumları ve worktree'leri de etkiler.
- **Docker Desktop kapalıyken commit atılamaz.** SonarQube yerelde yaklaşık 2 GB bellek kullanır ve kanca için açık kalmalıdır; kapalıysa kanca onu açar.
- **Çalışma kopyası taraması:** Stage edilmemiş bir değişiklikteki sorun da commit'i durdurur.
- **İlk temizlik büyük olabilir.** Bölüm bölüm, davranış değiştirmeden ve her adımda testlerle ilerlenir; sayılar başta kullanıcıya gösterilir.
- **CI süresi:** Sonar işi yaklaşık 6–8 dakika sürer. `checks` ile paralel çalışır; toplam süreyi uzun olan iş belirler.
- **Kural değişimi:** İmaj sürümleri sabit olduğu için kurallar kendiliğinden değişmez. Sürüm yükseltmek ayrı iştir ve yeni sorunlar getirebilir.

# Kod kalitesi analizi (SonarQube + jscpd)

Hesap veya bulut gerekmez; her şey bu makinede, Docker içinde çalışır.

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
imajı `scripts/sonar-local.mjs`'te tam sürüme sabittir. Var olan kapsayıcı
farklı bir imajla ya da bütün ağ arayüzlerine açık çalışıyorsa veri birimleri
korunarak yeniden kurulur.

Susturma kuralı ve göndermeden önceki kontrol listesi: kökteki `AGENTS.md`.

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
olmadığında komut başarısız olur. Testlerin başarılı olması test kapsamının
ölçüldüğü anlamına gelmez: LCOV raporu içeri alınmadığı için kapsam ayrıca
`coverageReportImported: false` alanıyla belirtilir. `coverageMeasured` yalnızca
Sonar'ın bir kapsam metriği döndürüp döndürmediğini ifade eder; otomatik sıfır
kapsam değeri test raporu aktarımı olarak kabul edilmez.

Kapsayıcı yalnızca `127.0.0.1:9000` üzerinde dinler; bütün arayüzlere açık eski bir kapsayıcı yeniden kurulur.

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
CLI'si kullanılabilir. İndirilen executable yolunu `SONAR_SCANNER_PATH` ile
verin. Sunucu Docker'da kalır, scanner yerelde çalışır; token yalnızca ortam
değişkeniyle iletilir. Varsayılan yerel cache `reports/quality/cache`, farklı
konum için `SONAR_USER_HOME` kullanılabilir. Yerel scanner mevcut native Node
executable'ını kullanır.

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
Tamamen sıfırlamak:

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

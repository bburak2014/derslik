# Kod kalitesi analizi (SonarQube + jscpd)

Hesap veya bulut gerekmez; her şey bu makinede, Docker içinde çalışır.

## SonarQube

```bash
pnpm install          # tür bilgisi için bağımlılıklar kurulu olmalı
pnpm quality:sonar
```

İlk çalıştırmada `sonarqube:community` kapsayıcısı (`derslik-sonarqube`) kurulur,
yönetici parolası rastgele üretilip `reports/.sonar-admin` dosyasına yazılır
(git'e girmez). Sonraki çalıştırmalar aynı kapsayıcıyı kullanır, geçmiş
analizler kaybolmaz. Sonuçlar: http://localhost:9000/dashboard?id=derslik
(kullanıcı `admin`, parola o dosyada).

Ne analiz edildiği `sonar-project.properties` içinde:

- Dahil: `apps/api/src`, `apps/web` (app, components, hooks, lib),
  `apps/mobile/src`, `packages/*/src`, `scripts`; testler ayrı sayılır.
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
ve derleme çıktısı hariç). HTML rapor `reports/jscpd/html/index.html`.

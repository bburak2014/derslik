# Derslik: çalışma kuralları

Bu dosya, bu depoda çalışan herkes ve her yapay zekâ oturumu içindir.

## Commit kancası

Her `git commit` öncesinde `.githooks/pre-commit` Sonar kapısını
(`pnpm quality:gate`) çalıştırır. Projede açık Sonar sorunu, inceleme
bekleyen güvenlik noktası ya da sınırı aşan kod tekrarı varsa commit atılmaz;
sorunlar dosya ve satırıyla listelenir. Bir commit yaklaşık 40–60 saniye
sürer ve Docker'ın açık olmasını ister. Kanca `pnpm install` ile açılır.

`git commit --no-verify` kancayı atlar. Yalnızca kullanıcının o commit için
verdiği açık onayla kullanılır; onay bir sonraki commit'e geçmez.

Kapı diskteki dosyaları tarar: commit'e eklenmemiş bir değişiklikteki sorun
da commit'i durdurur.

## Göndermeden önce

`main`'e birleştirmeden ya da göndermeden önce şunların hepsi geçer:

- `pnpm typecheck`
- `pnpm mobile:typecheck`
- `pnpm lint`
- `pnpm test`, değişikliğe ilgili testler ve `pnpm test:quality`
- `pnpm web:build`
- `pnpm quality:gate` (yerel SonarQube; Docker açık olmalı)

Biri kırmızıysa gönderilmez; önce düzeltilir.

## Sıfır Sonar sorunu

Projede açık Sonar sorunu ve inceleme bekleyen güvenlik noktası yoktur; kod
tekrarı sınırı geçmez. Yeni kod da sorun getirmez.

Gerçekten yanlış bir bulgu yalnızca gerekçeyle susturulur:

- kodda `// NOSONAR: <gerekçe>`
- ESLint'te `// eslint-disable-next-line sonarjs/<kural> -- <gerekçe>`
- `sonar-project.properties`'te yorumuyla `sonar.issue.ignore.multicriteria`

SonarQube arayüzündeki "False positive", "Safe" ya da "Accept" işaretleri
kullanılmaz; CI'daki sunucu her çalıştırmada sıfırdan açılır.
`pnpm test:quality` gerekçesiz susturmayı yakalar. Ayrıntı: `docs/sonar.md`.

## Pencereler (modal)

Pencere son boyutunda açılır; içerik gelince ya da değişince boyu değişmez,
kaymaz.

- İçerik tek seferde geliyorsa önce veri istenir, düğmede dönen gösterge
  çıkar, pencere veri gelince açılır.
- Pencerenin birkaç durumu varsa gövde sabit yüksekliktedir, iskelet son
  düzenin biçimindedir, uzun listeler gövdenin içinde kayar.
- Değişen her pencerede tarayıcıda yükseklik bütün durumlarda ölçülür.

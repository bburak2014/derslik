# DevTools ağ ve WebSocket testleri

Bu katman Jest/node:test birim testlerinin yerine geçmez. Gerçek Chrome'u Chrome DevTools Protocol (CDP) ile açıp tarayıcının gördüğü ağ, console ve WebSocket davranışını denetler.

## Ne yakalar?

- Aynı API `GET` isteğinin kısa süre içinde gereksiz tekrarını.
- API'den dönen `4xx/5xx` cevapları ve tarayıcı ağ hatalarını.
- Sayfadaki `console.error` ve yakalanmamış JavaScript hatalarını.
- WebSocket bağlantısının kurulup kurulmadığını ve frame akışını.
- Mesaj gönderiminde çift `POST` oluşmasını.
- Gönderen tarafında mesaj `POST` işleminden hemen sonra thread, mesaj listesi veya inbox'ın gereksiz `GET` ile yeniden çekilmesini.

> Uzun aralıklı polling ayrı tutulur. Varsayılan duplicate penceresi 800 ms'dir; `DEVTOOLS_DUPLICATE_WINDOW_MS` ile değiştirilebilir.

## Birim testleri

```bash
pnpm test:devtools:unit
```

Bunlar CDP denetleyicisinin kurallarını test eder ve CI'da çalışır.

## Gerçek tarayıcı testi

Önce uygulamayı normal şekilde çalıştırın:

```bash
pnpm dev
```

Başka bir terminalde public sayfayı denetleyin:

```bash
pnpm test:devtools
```

Chrome otomatik bulunamazsa:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:devtools
```

### Öğretmen ekranlarının tamamı

Oturum açılmış tarayıcıdan uygulama cookie'lerini alın ve yalnızca yerel test terminalinde kullanın; cookie'yi commit etmeyin.

```bash
DEVTOOLS_PROFILE=teacher \
DEVTOOLS_COOKIE='cookie1=...; cookie2=...' \
pnpm test:devtools
```

Varsayılan öğretmen rotaları:

- Genel bakış
- Ders takvimi
- Öğrenciler
- Mesajlar
- Tahsilatlar
- Ödevler
- PDF ve dosyalar
- Ders videoları
- Vitrin ve istekler

### Öğrenci / veli portalının tamamı

```bash
DEVTOOLS_PROFILE=portal \
DEVTOOLS_COOKIE='cookie1=...; cookie2=...' \
pnpm test:devtools
```

Varsayılan portal rotaları dersler, mesajlar, ödevler, dosyalar, videolar, paylaşımlar, bakiye, öğretmen bul ve isteklerim ekranlarını kapsar.

### Belirli rotalar

Varsayılan profil listesinin yerine virgülle ayrılmış rota verilebilir:

```bash
DEVTOOLS_ROUTES='/?view=overview,/?view=students,/?view=messages' \
DEVTOOLS_COOKIE='...' \
pnpm test:devtools
```

## Mesajlaşma regresyon testi

Açık bir yazışmanın URL'sini verin:

```bash
DEVTOOLS_PROFILE=teacher \
DEVTOOLS_COOKIE='...' \
DEVTOOLS_MESSAGE_URL='/?view=messages&thread=<thread-id>' \
pnpm test:devtools
```

Bu test gönderim başlamadan önce sayfanın yüklenmesini bekler, sonra yalnızca gönderim penceresindeki trafiği inceler. Beklenen davranış:

```text
POST /.../messages/<thread>      1 kez
GET  /.../messages/<thread>      0 kez (gönderen için)
GET  /.../messages               0 kez (gönderen için)
GET  /api/backend/inbox          0 kez (gönderen için)
WebSocket                         bağlı
```

Socket bağlantısının test ortamında bilerek kapalı olduğu bir senaryoda geçici olarak `DEVTOOLS_ALLOW_NO_SOCKET=1` kullanılabilir. Normal mesajlaşma regresyon testinde bunu kullanmayın.

## Rapor

Her gerçek tarayıcı çalışması ayrıntılı JSON raporunu şu dosyaya yazar:

```text
reports/devtools-audit.json
```

Yol `DEVTOOLS_REPORT` ile değiştirilebilir. `reports/` zaten git tarafından yok sayılır.

## Tasarım notu

Bu testler uygulama davranışını değiştirmez. Network optimizasyonu veya socket mesaj formatı ayrı bir uygulama değişikliğidir. Bu branch yalnızca gözlemlenebilir tarayıcı davranışını otomatik olarak ölçer ve regresyon olduğunda testi kırmızıya düşürür.

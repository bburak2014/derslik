# Canlı ders ve ortak tahta

Dersin görüntülü görüşmesi Meet, Zoom, Teams veya Jitsi bağlantısıyla açılır. Derslik ortak çizim tahtasını derse kaydeder. Görüşme bağlantısını öğretmen ekler; uygulama dış hizmette toplantı oluşturmaz.

## Kullanım

1. Öğretmen, **Ders planla** formundaki isteğe bağlı **Görüşme bağlantısı** alanına ders adresini girer. Mevcut planlı derste bağlantı simgesinden adresi değiştirebilir veya boşaltabilir.
2. Öğretmen ve öğrenci ders kartındaki **Canlı derse katıl** ile görüşmeyi açar. **Ortak tahta**, o derse ait tahtayı açar. Telefon uygulaması da aynı tahtayı kullanır.
3. Renk ve çizgi kalınlığı seçilerek çizim yapılır. Öğrenci kendi son çizimini geri alabilir; öğretmen son çizimi geri alabilir veya tüm tahtayı temizleyebilir. Temizleme onay ister.
4. Bağlantı koparsa kaydedilemeyen çizim ekranda kalır. **Yeniden dene** aynı işlem anahtarını kullanır; **Çizimi bırak** kaydedilmemiş çizimi kaldırır.
5. İsteğe bağlı ders kaydı, öğretmenin mevcut **Ders videoları / Video yükle** akışından ilgili derse bağlanır. Otomatik toplantı kaydı yoktur. Video yükleme mevcut depolama hizmetinin kullanılabilirliğine ve ücretlerine bağlıdır.

Veli tahtayı yalnız görüntüleyebilir. Tamamlanan dersin tahtası salt okunur; iptal edilen ders için tahta açılmaz. Bağlantı yalnız planlı derste düzenlenir.

## Yerel çalıştırma

Yeni veritabanı şeması `apps/api/drizzle/0020_live_lesson.sql` migration'ındadır. Bu çalışma sırasında mevcut **yerel** PostgreSQL veritabanına uygulandı. Başka ortamlarda API derlemesinden sonra migration uygulanmalıdır:

```sh
pnpm api:build
pnpm api:migrate
pnpm dev
```

`pnpm dev` yerel API'nin derlemesini ve migration'larını da yönetir. Önceden açık bir geliştirme süreci varsa yeni kaynaklarla yeniden başlatın.

Expo Go için:

```sh
pnpm env:sync
pnpm mobile:tunnel
```

Telefon ve API bilgisayarı aynı yerel ağa erişebilmelidir. `.env.api` içindeki `MOBILE_API_HOST` bilgisayarın yerel IP'sini, `API_BIND_ADDRESS` ise gerekli durumda `0.0.0.0` değerini kullanır. Metro tüneli API sunucusunu tünellemez.

## Senkronizasyon ve sınırlar

Tahta açık ve uygulama görünürken yaklaşık iki saniyede bir sürüm kontrolü yapılır. Sürüm değişmemişse çizim verisi tekrar gönderilmez. Kapalı tahta için polling yapılmaz. Bu sürüm çizgiler ve noktalar içerir; metin, PDF üzerine yazma ve otomatik video kaydı içermez.

Tahta en fazla 500 çizim işlemi ve çizim başına 128 nokta saklar. Geri alınan çizimler de temizlenene kadar işlem sınırına dahildir. Öğretmen tahtayı temizleyince yeni dönem başlar; eski dönemden gecikmiş çizimler reddedilir.

Okuma ve yazma, dersin çalışma alanı ve öğrenci erişimiyle denetlenir. Portal erişimi kaldırılan veya arşivlenen öğrenci yeni isteklerde erişemez. Çizim ve bağlantı değişiklikleri mevcut işlem anahtarı ve denetim kaydı altyapısını kullanır.

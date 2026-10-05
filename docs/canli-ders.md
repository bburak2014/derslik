# Canlı ders ve ortak tahta

Dersin görüntülü görüşmesi Meet, Zoom, Teams veya Jitsi bağlantısıyla açılır. Derslik ortak çizim tahtasını derse kaydeder. Görüşme bağlantısını öğretmen ekler; uygulama dış hizmette toplantı oluşturmaz.

## Kullanım

1. Öğretmen, **Ders planla** formundaki isteğe bağlı **Görüşme bağlantısı** alanına ders adresini girer. Mevcut planlı derste bağlantı simgesinden adresi değiştirebilir veya boşaltabilir.
2. Öğretmen ve öğrenci ders kartındaki **Canlı derse katıl** ile görüşmeyi açar. **Ortak tahta**, o derse ait tahtayı açar. Telefon uygulaması da aynı tahtayı kullanır.
3. Kalem, fosforlu kalem, çizgi, dikdörtgen, elips veya metin notu seçilir. Renk ve çizgi kalınlığı değiştirilebilir. Silgi yalnız yetki verilen çizimi kaldırır. Öğrenci kendi çizimlerini, öğretmen bütün çizimleri geri alabilir ve yeniden yapabilir.
4. Öğretmen **PDF ekle** ile özel depolamaya ders belgesi ekler. Öğretmen sayfa değiştirince öğrenci ve veli aynı sayfayı görür; öğretmen ve öğrenci PDF'in üzerine çizer. Her PDF sayfasının çizimleri ve beyaz tahtanın çizimleri ayrı saklanır. **Temizle** yalnız açık sayfadaki çizimleri siler ve onay ister.
5. Bağlantı koparsa kaydedilemeyen çizim ekranda kalır. **Yeniden dene** aynı işlem anahtarını kullanır; **Çizimi bırak** kaydedilmemiş çizimi kaldırır. PDF görüntülenemezse sayfa üzerinde çizim kapalı kalır ve yeniden yükleme sunulur.
6. İsteğe bağlı ders kaydı, öğretmenin mevcut **Ders videoları / Video yükle** akışından ilgili derse bağlanır. Otomatik toplantı kaydı yoktur. Video yükleme mevcut depolama hizmetinin kullanılabilirliğine ve ücretlerine bağlıdır.

Veli tahtayı yalnız görüntüleyebilir. Tamamlanan dersin tahtası salt okunur; iptal edilen ders için tahta açılmaz. Bağlantı yalnız planlı derste düzenlenir.

Öğrenci ve veli farklı belge veya sayfa seçerek kendi görünümünde inceleme yapabilir; öğretmenin ortak sayfası değişmez ve bu yerel görünümde çizim kapalıdır. **Öğretmeni takip et** ortak görünüme dönmeyi sağlar. Tamamlanan derste de bütün belgeler ve sayfalar bu şekilde okunabilir.

Büyütme yalnız kendi görünümünüzü değiştirir. Mobilde **Tahtayı taşı** açıkken büyütülmüş sayfa kaydırılır; çizim araçlarından biri seçilince çizim yeniden açılır. Koordinatlar sayfaya göre saklandığı için farklı büyütmelerdeki çizimler aynı yerde görünür.

## Yerel çalıştırma

Canlı ders şeması `apps/api/drizzle/0020_live_lesson.sql`, PDF ve araçların ek alanları `0021_lesson_board_documents.sql` migration'ındadır. Başka ortamlarda API derlemesinden sonra migration uygulanmalıdır:

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

Tahta açık ve uygulama görünürken yaklaşık iki saniyede bir sürüm kontrolü yapılır. Sürüm değişmemişse çizim verisi tekrar gönderilmez. Kapalı tahta için polling yapılmaz. Seçili belge ve sayfa dersin ortak durumudur; öğretmen yönetir. Sayfa, dönem veya çizim izni değişince devam eden çizim iptal edilir.

Tahta açık belgeler ve beyaz tahta için en fazla 500 çizim işlemi ve çizim başına 128 nokta kabul eder. Geri alınan çizimler de temizlenene kadar işlem sınırına dahildir. Silinen PDF'lerin açıklamaları bu sınırı doldurmaz. En fazla 5 PDF, PDF başına 100 sayfa ve 10 MB kabul edilir. Metin notları en fazla 300 karakterdir. Öğretmen sayfayı temizleyince yeni dönem başlar; eski dönemden gecikmiş çizimler reddedilir, diğer sayfaların çizimleri korunur.

Kaynak PDF silindiğinde belge yuvası yeniden kullanılabilir. Sonraki belge eklemesinde silinen PDF'in tahta bağlantısı ve açıklamaları temizlenir; diğer PDF'lerin ve beyaz tahtanın çizimleri korunur.

PDF dosyaları mevcut özel Supabase Storage akışından `RESOURCE` olarak yüklenir; API gerçek dosya boyutunu ve imzasını doğrular. Tahta belge bağlantısı yalnız hazır PDF'e bağlanabilir. Öğrenci ve veli, genel dosya erişimleri bulunmasa da yetkili oldukları dersin bağlı PDF'ini iki dakikalık imzalı adresle açabilir. Silinmekte olan dosya için yeni adres verilmez. PDF'in içeriği değişmez; açıklamalar Derslik'in veritabanında ayrı saklanır.

Mobil uygulamada PDF'in yalnız açık sayfası WebView içindeki pdf.js tuvaline çizilir; tuval en fazla 4 milyon pikseldir ve çizimler sayfanın gerçek oranına hizalanmış yerel SVG katmanında gösterilir. Görüntüleyiciye erişim belirteci aktarılmaz; yalnız süreli dosya adresi verilir. PDF betikleri ve bağlantı eylemleri çalıştırılmaz, pdf.js değerlendirmesi kapalıdır. Kitaplık CDN'den yüklenir; özel PDF dosyası doğrudan depolamadan alınır. PDF sayfasının görüntülenmesi 20 saniyede tamamlanmazsa yeniden deneme sunulur.

Okuma ve yazma, dersin çalışma alanı ve öğrenci erişimiyle denetlenir. Portal erişimi kaldırılan veya arşivlenen öğrenci yeni isteklerde erişemez. Çizim ve bağlantı değişiklikleri mevcut işlem anahtarı ve denetim kaydı altyapısını kullanır.

# Öğrencinin boş saatten ders ayarlaması: tasarım

- Tarih: 2026-10-01
- Durum: Tasarım onaylandı, uygulama planı bekleniyor
- Dal: `claude/lesson-booking`

## Amaç

Bugün dersi yalnızca öğretmen oluşturuyor; uygun saati bulmak için öğretmenle öğrenci yazışıyor. Bu özellikle öğretmen haftalık boş saatlerini bir kez girer. Öğretmene bağlı öğrenci bu saatlerden birini seçip dersi kendisi ayarlar ve ders, onay beklemeden öğretmenin takvimine düşer.

Başarı ölçütleri:

1. Öğretmen müsaitliğini girip ayarlamayı açtığında, boşta hakkı olan bağlı öğrenci web ve mobilde boş bir saat seçip ders ayarlayabilir.
2. Ayarlanan ders öğretmenin takviminde "Öğrenci ayarladı" etiketiyle görünür ve öğretmene bildirim gider.
3. Hiçbir durumda iki ders çakışmaz, boştaki hak aşılmaz, veli ders ayarlayamaz.
4. Öğrenci, kendi ayarladığı dersi iptal süresi dolmadan iptal edebilir.
5. Öğretmenin mevcut ders akışları değişmez. Mevcut ve yeni testler geçer.

## Kapsam dışı

- Vitrindeki, henüz öğrenci olmayan kişinin saat seçmesi (deneme dersi). Vitrindeki istek akışı aynen kalır.
- Velinin ders ayarlaması ya da iptal etmesi.
- Tekrarlayan (haftalık seri) ayarlama. Öğrencinin dersi tek adımda başka saate taşıması da yok; bunu iptal edip yeni saat seçerek yapar.
- Haftalık şablonun dışında, belirli bir tarihe fazladan saat açma.
- Ayarlamanın öğrenci başına açılıp kapatılması, ayarlamada ödeme alınması.
- Öğrencinin başka öğretmenlerdeki dersleriyle çakışma kontrolü.
- Öğretmene e-posta. Bildirim yalnızca uygulama içinde gider.
- Öğretmenin, öğrencilerin göreceği saatleri önizlemesi.

## Terimler

- **Müsaitlik aralığı:** Haftanın bir gününde her hafta tekrar eden zaman aralığı, ör. Pazartesi 15:00–19:00.
- **Kapalı gün:** Öğretmenin ayarlamaya kapattığı tarih aralığı. İki ucu da dahildir.
- **Boş saat:** Öğrencinin seçebileceği ders başlangıcı.
- **Boştaki hak:** Paketin kalan hakkından, o pakete bağlı planlı (`SCHEDULED`) derslerin sayısı çıkarılınca kalan sayı. Geçmişte kalıp hâlâ planlı görünen dersler de çıkarılır, çünkü büyük olasılıkla tamamlanacaklar.
- **Öğrencinin ayarladığı ders:** `lessons.booked_by` alanı dolu olan ders.

## Ürün kuralları

### Öğretmen ayarları

| Ayar | Varsayılan | Geçerli değer | Arayüzdeki seçenekler |
| --- | --- | --- | --- |
| Ayarlama açık | Kapalı | Açık / kapalı | Anahtar |
| Ders süresi | 60 dk | 15–180, 5'in katı | 30, 40, 45, 50, 60, 75, 90, 120 dk |
| En az ne kadar önceden | 12 saat | 0–168 saat | Sınır yok, 1, 2, 6, 12, 24, 48 saat |
| İptal için son süre | 24 saat | 0–168 saat | Ders başlayana kadar, 2, 6, 12, 24, 48 saat |
| Ders yeri | Boş | En fazla 100 karakter | Serbest metin |
| Haftalık aralıklar | Yok | Toplam en fazla 50; sınırlar 30 dakikanın katı; aynı günde çakışmaz | Gün başına liste |
| Kapalı günler | Yok | Toplam en fazla 50; başlangıç ≤ bitiş | Tarih aralığı listesi |

- Ayarlar tek kayıt olarak, sürüm kontrolüyle kaydedilir. Web ve mobil birbirinin kaydını ezemez.
- Aralık sınırları "HH:MM" biçimindedir. Bitiş "24:00" olabilir.
- Bitişi bugünden önce olan kapalı günler okunurken gelmez, kaydedilirken atılır.
- Ayar değişikliği mevcut dersleri etkilemez, yalnızca yeni ayarlamalara uygulanır.

### Boş saatlerin üretimi

Saat dilimi, uygulamanın geri kalanında olduğu gibi Europe/Istanbul'dur. Süre `d` iken bir başlangıç `t`, aşağıdaki koşulların hepsini sağlıyorsa boş saattir:

1. Ayarlama açıktır.
2. `t`'nin günü bugün ile bugün + 27 gün arasındadır (28 gün).
3. O günün haftalık aralıklarından birinde `t = aralık başlangıcı + k × 30 dk` ve `t + d ≤ aralık bitişi`. Aynı günün uç uca aralıkları (15:00–19:00 ve 19:00–21:00) tek aralık sayılır; 60 dakikalık derste 18:30 da boş saattir (`0019_booking_joined_windows`).
4. Gün, kapalı gün aralıklarının hiçbirine düşmez.
5. `t ≥ şimdi + en az önceden ayarlama süresi`.
6. `[t, t + d)` aralığı, öğretmenin iptal edilmemiş (planlı ya da tamamlanmış) hiçbir dersiyle çakışmaz. Dersin hangi öğrenciye ait olduğu önemli değildir; öğrenciye yalnızca boş saatler gösterilir, dolu saatin kime ait olduğu gösterilmez.
7. Öğrencinin, o günü kapsayan (bitişi yok ya da gün ≤ bitiş) ve boştaki hakkı sıfırdan büyük en az bir paketi vardır.

### Ayarlama

- Yalnızca öğrencinin STUDENT portal bağlantısı ders ayarlayabilir. Bağlantının geri alınmamış olması, `lessons` iznini taşıması ve öğrencinin arşivde olmaması gerekir. Veli ve öğretmen bu yoldan ders ayarlayamaz.
- Ders alanları şöyle dolar:
  - konu: öğrenci kaydındaki branş,
  - yer: ayardaki ders yeri,
  - süre: ayardaki süre,
  - `booked_by`: dersi ayarlayan kullanıcı,
  - seri ve telafi alanları: boş.
- Paket seçimi: Dersin gününü kapsayan ve boştaki hakkı sıfırdan büyük paketler arasından bitişi en erken olan seçilir. Bitişi olmayan paketler en sona kalır; eşitlikte en eski paket seçilir.
- Öğretmene uygulama içi bildirim gider: tür `LESSON`, hedef ders, başlık `notice.lessonBooked`, gövde öğrencinin adı.
- Mevcut ders hatırlatması ve takvim aboneliği (.ics) ayarlanan derste de çalışır.
- Öğretmenin kendi ders oluşturma akışı (`lesson.create`) değişmez. Bu akış planlı dersleri hak sayımına katmamaya devam eder.

### İptal

- STUDENT bağlantısıyla gelen öğrenci yalnızca `booked_by` dolu ve planlı bir dersi iptal edebilir. Bunun için `şimdi ≤ başlangıç − iptal süresi` olmalıdır.
- Ders `CANCELLED` olur. Hak zaten düşmemişti; saat yeniden boşalır.
- Öğretmene bildirim gider: tür `LESSON`, başlık `notice.lessonCancelledByStudent`, gövde öğrencinin adı.
- Ayarlama kapatılmış olsa da iptal kuralı geçerlidir.

### Öğretmen tarafı ve veli

- Öğretmen, öğrencinin ayarladığı dersi diğer dersler gibi tamamlar, iptal eder, taşır ve tamamlamasını geri alır.
- Velinin gördüğü hiçbir şey değişmez. Veli dersleri görür; ders ayarlayamaz ve iptal edemez.

## Veri modeli

Yeni göç: `apps/api/drizzle/0017_lesson_booking.sql`. Drizzle meta kayıtları (`_journal.json`, `0017_snapshot.json`) ve `apps/api/src/db/schema.ts` de güncellenir.

```sql
CREATE TABLE derslik.booking_settings (
  workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),
  enabled boolean NOT NULL DEFAULT false,
  duration_minutes int NOT NULL DEFAULT 60
    CHECK (duration_minutes BETWEEN 15 AND 180 AND duration_minutes % 5 = 0),
  notice_hours int NOT NULL DEFAULT 12 CHECK (notice_hours BETWEEN 0 AND 168),
  cancel_hours int NOT NULL DEFAULT 24 CHECK (cancel_hours BETWEEN 0 AND 168),
  location text NOT NULL DEFAULT '' CHECK (char_length(location) <= 100),
  version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derslik.availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Pazartesi
  start_minute smallint NOT NULL
    CHECK (start_minute BETWEEN 0 AND 1410 AND start_minute % 30 = 0),
  end_minute smallint NOT NULL
    CHECK (end_minute BETWEEN 30 AND 1440 AND end_minute % 30 = 0),
  CHECK (end_minute > start_minute),
  EXCLUDE USING gist (workspace_id WITH =, weekday WITH =,
    int4range(start_minute, end_minute) WITH &&)
);
CREATE TABLE derslik.availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on)
);
ALTER TABLE derslik.lessons ADD COLUMN booked_by uuid REFERENCES derslik.users(id);
```

- **RLS:** Üç tablo için `ENABLE` ve `FORCE ROW LEVEL SECURITY` uygulanır. Yalnızca `owner_all` politikası tanımlanır (`workspace_id = derslik.workspace_id() AND derslik.is_owner(workspace_id)`). Öğrenci ve veli için politika yoktur; bu tablolara yalnızca aşağıdaki fonksiyonlarla erişirler.
- **Yetkiler:** Mevcut göçlerdeki gibi `REVOKE ALL … FROM PUBLIC` uygulanır. `derslik_app` rolüne `SELECT, INSERT, UPDATE` verilir; aralıklar ve kapalı günler toplu değiştirildiği için bu iki tabloya `DELETE` de verilir.
- **Dizin:** `availability_blocks (workspace_id, ends_on)`. Aralıklar için `EXCLUDE` kısıtının gist dizini yeterlidir.

## SQL fonksiyonları

Hepsi `SECURITY DEFINER SET search_path=pg_catalog,derslik` ile tanımlanır. `REVOKE ALL … FROM PUBLIC` ve `GRANT EXECUTE … TO derslik_app` uygulanır. Yetki hatası `ERRCODE 42501` ile, kural hataları `ERRCODE P0001` ve aşağıdaki `HINT` değerleriyle döner (istek kabulündeki `accept_lesson_request` yöntemi).

- **`derslik.booking_student(ws uuid, student uuid) RETURNS boolean`:** Çağıran kişinin o öğrencide geri alınmamış, `lessons` izinli STUDENT bağlantısı varsa ve öğrenci arşivde değilse `true` döner. Diğer fonksiyonlar bu kontrolü kullanır.
- **`derslik.booking_policy(ws uuid) RETURNS TABLE(enabled boolean, duration_minutes int, cancel_hours int, location text)`:** Çalışma alanına erişimi olan herkes (`has_workspace_access`) çağırabilir. Ayar satırı yoksa satır dönmez.
- **`derslik.open_slots(ws uuid, student uuid) RETURNS TABLE(starts_at timestamptz, ends_at timestamptz)`:** `booking_student` gerektirir. "Boş saatlerin üretimi" bölümündeki kuralları uygular ve sonucu `starts_at` sırasıyla döndürür.
- **`derslik.free_credits(ws uuid, student uuid) RETURNS int`:** `booking_student` gerektirir. Bugün geçerli olan (bitişi yok ya da bugün ≤ bitiş) paketlerin boştaki haklarını sıfırın altına düşürmeden toplar.
- **`derslik.book_lesson(ws uuid, student uuid, start timestamptz) RETURNS jsonb`:**
  1. `booking_student` kontrolü yapılır, yoksa `42501`.
  2. `pg_advisory_xact_lock(hashtextextended('calendar:' || ws, 0))` alınır. Bu, `LessonsService.calendarLock` ile aynı anahtardır.
  3. Öğrenci satırı `FOR UPDATE` ile kilitlenir. Arşivlenmiş öğrenci normalde 1. adımda (ve API'nin portal kontrolünde) 403 alır. Öğrenci 1. adımla kilit arasında arşivlenmişse (yarış durumu) `HINT 'archived'` döner.
  4. Ayar satırı `FOR SHARE` ile kilitlenir. Satır yoksa ya da ayarlama kapalıysa `HINT 'disabled'`.
  5. `start` değeri `open_slots` içinde yoksa: öğrencinin o günü kapsayan, boşta hakkı olan paketi yoksa `HINT 'credits'`, varsa `HINT 'slot'`.
  6. Paket kuralına göre paket seçilip `FOR UPDATE` ile kilitlenir.
  7. Ders yazılır, öğretmene bildirim eklenir ve ders satırı `jsonb` olarak döndürülür.
- **`derslik.cancel_booking(ws uuid, student uuid, lesson uuid, expected_version int) RETURNS jsonb`:**
  1. `booking_student` kontrolü yapılır, yoksa `42501`.
  2. Öğrenci satırı, ardından ders satırı `FOR UPDATE` ile kilitlenir. Kilit sırası `LessonsService` ile aynıdır.
  3. Kurallar şu sırayla denetlenir:
     - ders yoksa ya da başka öğrenciye aitse `HINT 'notFound'`,
     - `booked_by` boşsa `HINT 'notBooked'`,
     - ders planlı değilse `HINT 'state'`,
     - sürüm farklıysa `HINT 'changed'`,
     - iptal süresi geçtiyse `HINT 'deadline'`.
  4. Durum `CANCELLED`, `version = version + 1` yapılır. Öğretmene bildirim eklenir ve ders satırı `jsonb` olarak döndürülür.
- **Öğretmenin ayar kaydı** (API, aşağıda) ayar satırını önce `FOR UPDATE` ile kilitler, ardından aralıkları ve kapalı günleri değiştirir. Ayarlama bu satırı `FOR SHARE` ile tuttuğu için ikisi birbirini bekler. Kapatılmış bir ayara ders yazılamaz ve kilit sırasında döngü oluşmaz.

## API

Yeni modül: `apps/api/src/booking/` (`booking.service.ts`, `booking.controller.ts`). `app.module.ts` dosyasına eklenir.

| Yöntem | Yol | Kim | Ne yapar |
| --- | --- | --- | --- |
| GET | `/v1/workspaces/:ws/booking` | Öğretmen | Ayarları, aralıkları, bugünden sonraki kapalı günleri ve sürümü döndürür. Ayar satırı yoksa varsayılanları ve `version: 0` döndürür. |
| PUT | `/v1/workspaces/:ws/booking` | Öğretmen | Ayarların tamamını değiştirir. `version` eşleşmezse 409 `api.bookingSettingsChanged` döner. `booking.save` denetim kaydı yazılır. |
| GET | `/v1/portal/:ws/:student/booking/slots` | Öğrenci | `{durationMinutes, location, cancelHours, freeCredits, slots: [{startsAt, endsAt}]}` döndürür. Ayarlama kapalıysa 409 `api.bookingDisabled`. |
| POST | `/v1/portal/:ws/:student/booking` | Öğrenci | Gövde `{startsAt}`, `idempotency-key` zorunlu. Yanıt dersin kendisidir. |
| POST | `/v1/portal/:ws/:student/booking/:lesson/cancel` | Öğrenci | Gövde `{version}`, `idempotency-key` zorunlu. Yanıt dersin kendisidir. |

- **Öğretmen uçları:** `db.transaction(actor, ws, …)` içinde çalışır; öğretmen kontrolü vitrin uçlarındaki gibidir. Gövde `bookingSettingsSchema` ile doğrulanır.
- **Sürüm:** PUT, GET'ten gelen `version` değerini gönderir.
  - Ayar satırı yoksa beklenen sürüm 0 olmalıdır. Satır `version = 1` ile eklenir (`INSERT … ON CONFLICT DO NOTHING`). Aynı anda gelen ikinci ilk kayıt satır ekleyemez ve 409 alır.
  - Satır varsa `UPDATE … SET version = version + 1 WHERE version = beklenen` çalışır. Hiçbir satır güncellenmezse 409 döner.
- **Öğrenci GET:** `db.portalTransaction(actor, ws, student, "lessons", fn, true)` içinde çalışır. Yazma bayrağı açık olduğu için yalnızca STUDENT rolü geçer.
- **Öğrenci POST'ları:** `CommandService.run(…, { studentId, permission: "lessons", write: true })` ile `lesson.book` ve `lesson.cancelBooking` eylemleri olarak çalışır. Tekrarlanan anahtar aynı yanıtı alır ve denetim kaydı diğer portal komutlarındaki gibi yazılır.
- **İstek sınırı:** İki POST için kullanıcı başına dakikada 10 istekte süreç içi `RateLimiter` kullanılır. Sınır aşılırsa 429 `api.tooManyRequests` döner.
- **Veritabanı hatalarının eşlenmesi:**

| Kaynak | HTTP | Anahtar |
| --- | --- | --- |
| `42501` | 403 | `api.noStudentAccess` |
| `archived` | 409 | `api.studentArchived` |
| `disabled` | 409 | `api.bookingDisabled` |
| `slot` | 409 | `api.bookingSlotTaken` |
| `credits` | 409 | `api.bookingNoCredits` |
| `notFound` | 404 | `api.lessonNotFound` |
| `notBooked` | 409 | `api.bookingNotYours` |
| `state` | 409 | `api.lessonStateInvalid` |
| `changed` | 409 | `api.lessonChanged` |
| `deadline` | 409 | `api.bookingCancelClosed` |
| `23P01` (ayarlamada) | 409 | `api.bookingSlotTaken` |

- **Portal yanıtı** (`GET /v1/portal/:ws/:student`): `booking: {enabled, cancelHours} | null` alanı eklenir; ayar satırı yoksa `null` olur. Derslere `booked_by` eklenir. Öğretmenin öğrenci panelindeki ders sorgusu (`LearningService.read`) da `booked_by` alanını döndürür.
- **Öğretmen anlık görüntüsü:** `SELECT *` kullandığı için `booked_by` alanı kendiliğinden gelir.

## Ortak kod

- **`packages/contracts/src/booking.ts`** (yeni; `index.ts` üzerinden dışa açılır):
  - `bookingSettingsSchema` (zod): ayar tablosundaki bütün kurallar. Çakışan aralık, ters aralık ve ters tarih kontrolleri çeviri anahtarlarıyla yapılır (`api.availabilityOverlap`, `api.availabilityOrder`, `api.blockOrder`). Hem API hem formlar kullanır.
  - `bookLessonSchema` (`{startsAt}`, ofsetli tarih-saat) ve `cancelBookingSchema` (`{version}`).
  - Tipler: `BookingSettings`, `BookingWindow`, `BookingBlock`, `BookingSlots`, `BookingPolicy`.
  - Sabitler: `DURATION_PRESETS`, `NOTICE_PRESETS`, `CANCEL_PRESETS`, `BOOKING_HORIZON_DAYS = 28`, `SLOT_STEP_MINUTES = 30`.
  - Yardımcılar: `halfHourOptions()` (00:00 … 24:00), `groupSlotsByDay(slots)`, `cancelDeadline(startsAt, cancelHours)`, `canCancelBooking(lesson, cancelHours, now)`.
- **`packages/contracts/src/types.ts`:** `Lesson` tipine `booked_by?: string | null` eklenir.
- **`packages/api-client`:** `booking(ws)`, `saveBooking(ws, body)`, `bookingSlots(ws, student)`, `bookLesson(ws, student, startsAt)` ve `cancelBooking(ws, student, lessonId, version)` yöntemleri eklenir. `PortalData.booking` alanı tanımlanır.
- **Çeviriler:** Yeni anahtarların hepsi 7 dile eklenir (tr, en, de, es, fr, ja, zh).

## Arayüz

### Web: öğretmen

- **`CalendarView` araç çubuğu:** "Takvime bağla" ve "Ders ekle" düğmelerinin yanına açık/kapalı göstergeli "Müsaitlik" düğmesi eklenir. Düğme yeni `AvailabilityDialog` penceresini açar (`apps/web/components/derslik/availability-dialog.tsx`, kaydırılabilir pencere).
- **Pencerenin içeriği**, yukarıdan aşağıya:
  1. Ayarlama anahtarı.
  2. Haftalık saatler: 7 gün satırı. Her aralık, 30 dakikalık seçeneklerden iki açılır listeyle girilir ve × ile silinir; "+ Aralık ekle" düğmesi vardır. Aralığı olmayan gün "Kapalı" görünür.
  3. Kapalı günler: tarih aralığı listesi (× ile silinir) ve "+ Kapalı gün ekle".
  4. Ders süresi, en az ne kadar önceden ayarlanabileceği ve iptal süresi için açılır listeler.
  5. Ders yeri alanı.
  6. Kısa açıklama: "Öğrenci yalnızca boşta hakkı varsa saat seçebilir. Kendi oluşturduğun dersler o saatleri kapatır."
  7. Kaydet düğmesi.
- Doğrulama hataları ortak şemayla, göndermeden önce ilgili alanın altında gösterilir. 409 alınırsa "Ayarlar başka yerde değişti" uyarısı ve yeniden yükleme seçeneği çıkar.
- **`LessonRows`:** `booked_by` doluysa satırda "Öğrenci ayarladı" etiketi görünür.

### Web: öğrenci (portal, Dersler sekmesi)

- **"Ders ayarla" düğmesi:** Rol STUDENT ve `booking.enabled` açıksa `LessonSchedule` başlığının yanında, dersler boşken de boş durumun içinde görünür.
- **Ayarlama penceresi** (yeni `BookingDialog`: `apps/web/components/derslik/booking-dialog.tsx`):
  - Üstte özet satırı: süre, yer ve boştaki hak.
  - Yatay kaydırılabilen gün düğmeleri; yalnızca boş saati olan günler görünür.
  - Seçili günün saat düğmeleri.
  - Onay adımı: tarih, saat aralığı, yer ve iptal için son an; ardından [Ayarla] ya da [Geri].
- **Boş durumlar:**
  - Boşta hak yoksa uyarı çıkar; Mesajlar sekmesi açıksa "Mesaj yaz" bağlantısı da gösterilir.
  - Boş saat yoksa "Önümüzdeki 4 haftada boş saat yok" yazar.
- **Sonuçlar:**
  - Başarılı ayarlamada başarı bildirimi gösterilir ve portal verisi yenilenir.
  - `bookingSlotTaken` gelirse uyarı gösterilir, saatler yeniden çekilir ve pencere açık kalır.
  - `bookingDisabled` gelirse pencere kapanır ve portal yenilenir.
- **`LessonItem`:** Ayarlanmış derste "Sen ayarladın" etiketi görünür. Rol STUDENT ve iptal süresi dolmamışsa "İptal et" düğmesi mevcut onay penceresiyle açılır ("Hakkın düşmez"). Süre dolduysa düğme yerine "İptal için öğretmenine yaz" notu çıkar.

### Mobil: öğretmen

- **Takvim bölümü:** "Ders planla" düğmesinin yanına "Müsaitlik" düğmesi eklenir. Düğme tam sayfa pencere açar (`apps/mobile/src/teacher/availability.tsx`). İçerik web ile aynıdır, mobil bileşenlerle kurulur:
  - anahtar için `Toggle`,
  - saatler, süre, önceden ayarlama ve iptal süresi için `Picker`,
  - kapalı günler için mevcut "YYYY-AA-GG" tarih girişi,
  - ders yeri için `Input`.
- **Ders kartı:** "Öğrenci ayarladı" etiketi görünür.

### Mobil: öğrenci

- **Dersler sekmesi** (`apps/mobile/src/LearningScreen.tsx`): Rol STUDENT ve ayarlama açıksa "Ders ayarla" düğmesi görünür. Düğme tam sayfa pencere açar (`apps/mobile/src/booking.tsx`). Akış web ile aynıdır: gün düğmeleri yatay `ScrollView` içinde, saatler sarılan düğmeler hâlinde, onay adımı alt kısımda.
- **Ders kartı:** Etiket ile birlikte, `confirmAction` üzerinden "İptal et" düğmesi ya da süre dolduysa not görünür.

### Ortak

- Tarih ve saatler `dayLabel` ve `timeLabel` ile, Istanbul saatine göre gösterilir.
- Düğmelerin erişilebilir adları vardır. Gün düğmeleri `aria-pressed` kullanır.

## Hatalar ve yarış durumları

- **Arayüzün hata tepkileri:**

| Anahtar | Arayüzde ne olur |
| --- | --- |
| `api.bookingDisabled` | Pencere kapanır, düğme kaybolur |
| `api.bookingSlotTaken` | Saatler yenilenir, pencere açık kalır |
| `api.bookingNoCredits` | "Boşta hak yok" durumu gösterilir |
| `api.bookingCancelClosed`, `api.bookingNotYours` | İptal düğmesinin yerine not çıkar |
| `api.bookingSettingsChanged` | Öğretmene "yeniden yükle" uyarısı çıkar |

- **Ayar doğrulaması:** çakışan aralık, başlangıçtan önce biten aralık, 30 dakikanın katı olmayan saat, ters tarih aralığı ve 50'den fazla aralık ya da kapalı gün reddedilir.
- **Aynı saati iki öğrenci seçerse:** Takvim kilidi istekleri sıraya sokar; ikinci istek `bookingSlotTaken` alır.
- **Öğretmen aynı anda ders ekliyor ya da tamamlıyorsa:** Ayarlama aynı takvim ve öğrenci kilitlerini aldığı için işlemler sırayla yürür.
- **Öğretmen ayarları kaydederken öğrenci ders ayarlıyorsa:** Ayar satırı kilidi işlemleri sırayla yürütür.
- **Ağ koptu ve istek tekrarlandıysa:** `idempotency-key` ilk yanıtı geri döndürür; ikinci ders açılmaz.
- **Son güvence:** `teacher_calendar_no_overlap` kısıtı tetiklenirse ayarlamada `bookingSlotTaken` döner; genel `api.duplicate` dönmez.

## Testler

- **API entegrasyon testleri:** Yeni `apps/api/tests/booking-cases.mjs` dosyası `integration.test.mjs` içinde çağrılır. Testler PGlite'ta `pnpm test` ile koşar; mümkünse yerel Postgres'te de koşturulur.
  - *Ayarlar:* kaydetme ve okuma, varsayılanlar, sürüm çakışması, doğrulama hataları, geçmiş kapalı günlerin atılması. Öğrenci ve veli ayarları okuyamaz ve yazamaz.
  - *Saatler:*
    - 30 dakikalık adım ve dersin aralığa sığması (uç uca aralıklar tek aralık sayılır),
    - önceden ayarlama sınırı, kapalı günler, 28 günlük sınır, paketin bitiş tarihi,
    - başka öğrencinin dersi saati kapatır ama o derse ait bilgi yanıtta yer almaz,
    - iptal edilmiş ders saati kapatmaz,
    - boşta hak yoksa liste boş ve `freeCredits` sıfır olur,
    - veli ve öğretmen bu uca erişemez.
  - *Ayarlama:*
    - ders doğru alanlarla yazılır,
    - doğru paket seçilir,
    - boştaki hak doğru hesaplanır (kalan − planlı),
    - öğretmene `LESSON` bildirimi gider,
    - aynı saate eşzamanlı iki istekten yalnızca biri ders olur,
    - aynı anahtarla tekrarlanan istek aynı dersi döndürür,
    - listede olmayan saat, kapalı ayarlama, veli, geri alınmış bağlantı ve arşivlenmiş öğrenci reddedilir.
  - *İptal:*
    - süre içinde kabul edilir, süre dışında reddedilir,
    - öğretmenin oluşturduğu ders, eski sürüm ve veli reddedilir,
    - iptalden sonra saat ve hak geri gelir,
    - öğretmene bildirim gider.
  - *Mevcut akışlar bozulmaz:* Öğretmen, öğrencinin ayarladığı dersi tamamlar, taşır, iptal eder ve tamamlamasını geri alır. Ders hatırlatması bu dersleri de kapsar.
- **Ortak kod:** Ayar şeması ve yardımcılar için `node:test` birim testleri yazılır.
- **Derleme ve stil:** `pnpm typecheck`, `pnpm mobile:typecheck` ve `pnpm lint` çalıştırılır. Mimari testleri (`pnpm test:architecture`) de koşturulur.
- **Arayüz:** Web tarayıcı panelinde, mobil iOS simülatöründe denenir ve ekran görüntüsü alınır. Giriş Supabase üzerinden yapıldığı için öğretmen ve öğrenci oturumlarını kullanıcı açar; şifre ya da hesap bilgisi Claude tarafından girilmez.

## Bilinen sınırlar

- Öğretmenin açık sayfası yeni bir ayarlamayı kendiliğinden göstermez. Ayarlama bildirimle ya da sayfa yenilenince görünür; diğer öğrenci işlemlerinde de durum aynıdır.
- İstek sınırı süreç içi bir sayaçtır. Birden çok API kopyası çalışırsa sınır kopya sayısıyla çarpılır (mevcut `RateLimiter` notu).
- Öğretmenin kendi oluşturduğu dersler hak ayırmaz. Öğretmen paketteki haktan fazla ders planlarsa öğrencinin boştaki hakkı sıfır görünür ve öğrenci ders ayarlayamaz.

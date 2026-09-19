# Derslik API — NestJS ve PostgreSQL

Bu API, öğretmenin öğrenci → paket → ders → ders hakkı → manuel tahsilat akışını uygular. Web ve mobil istemci için `/v1` sözleşmesi sunar. Web ve mobil ortak API istemcisine bağlıdır. v0.5 web runtime’ında D1/R2 veya ikinci iş backend’i bulunmaz. Eski canlı v4 yayını için geçiş notları `docs/veri-gecisi.md` dosyasındadır.

## Bilgisayarda başlatma

Komutları ZIP'ten çıkan `derslik` ana klasöründe çalıştırın. Node.js 24 ve Docker Compose gerekir.

```sh
node scripts/setup.mjs
```

Komut iki bağımsız güçlü veritabanı parolası üretip `.env.api` dosyasına yazar; parolaları konsola basmaz ve mevcut dosyanın üzerine yazmaz. Dosyayı düzenleyin:

```dotenv
AUTH_ISSUER=https://PROJE_KIMLIGI.supabase.co/auth/v1
CORS_ORIGINS=http://localhost:3000
```

Supabase projesi ES256 veya RS256 imzalama anahtarı kullanmalıdır. Bu servis eski HS256 ortak sırrını kabul etmez. İmzayı sabit yapılandırılmış issuer'ın `/.well-known/jwks.json` ucuyla; issuer, audience, süre, kullanıcı UUID'si ve `authenticated` rolüyle birlikte doğrular. Anonim hesap ve service-role token'ları yönetim API'sine alınmaz. [Supabase JWT anahtarları](https://supabase.com/docs/guides/auth/signing-keys).

```sh
docker compose --env-file .env.api -f compose.api.yml up --build -d api
docker compose --env-file .env.api -f compose.api.yml logs api migrate
```

API `http://127.0.0.1:3001`, PostgreSQL `127.0.0.1:5433` üzerinde açılır. `GET /health/live` ve `GET /health/ready` token istemez. Öğrenci verilerine erişim token gerektirir. Docker bu ortamda çalıştırılamadı; aşağıdaki native test geçmeden bu API'yi canlıya almayın.

Normal durdurma veriyi korur:

```sh
docker compose --env-file .env.api -f compose.api.yml down
```

Kalıcı veri `postgres_data` volume'ündedir. Parolaları dosyada değiştirmek mevcut veritabanı rolünün parolasını değiştirmez; çalışan sistemde parola rotasyonu ayrı yönetilir. Örnek Compose yerel geliştirme içindir. Uzak yayında TLS, yedekler, hız sınırı ve izleme sağlayıcıda yapılandırılmalıdır.

## Node ile geliştirme

Pnpm 11.25.0 ve kilit dosyasını kullanın:

```sh
pnpm install --frozen-lockfile
pnpm api:setup
pnpm api:build
docker compose --env-file .env.api -f compose.api.yml up -d postgres
pnpm api:migrate
pnpm api:local
```

`api:local` ortamı `.env.api` üzerinden okur. Docker API hizmeti açıkken aynı 3001 portunda ikinci kez başlatmayın. Kurumsal PostgreSQL bağlantısında `DATABASE_SSL=true` sertifika doğrulamasını açık tutar. `DATABASE_URL` çalışma zamanı rolü, `DATABASE_ADMIN_URL` yalnızca göç içindir. API `DATABASE_ADMIN_URL` kullanmaz.

## İstek sözleşmesi

Kullanıcı API isteklerinde `Authorization: Bearer <Supabase kullanıcı access_token>` gönderilir. Sağlık uçları açıktır; provider webhook'ları ayrı HMAC imzasıyla doğrulanır. Kullanıcı kimliği istek gövdesinden veya `X-User-Id` gibi başlıklardan alınmaz.

Öğrenci, paket, ders, tahsilat, öğrenme ve rezervasyon komutları `Idempotency-Key: <UUID>` ister. Bir kullanıcı niyeti için bir anahtar üretin. Ağ hatası veya 503 sonrası **aynı gövde ve aynı anahtarla** yeniden deneyin. Anahtar aynı içerikle tekrar kullanılırsa önceki sonuç `replayed: true` ile döner. Farklı içerik için aynı anahtar 409 verir. 409 sürüm hatasında güncel kaydı alıp yeni niyet için yeni anahtar üretin. Çalışma alanı oluşturma ve aşağıda belirtilen finish/read/delete/sync/checkout uçları doğal tekrar güvenliği kullanır.

Güncelleme ve durum değişikliğinde mevcut `version` gönderilir. İlk öğrenci/ders/tahsilat sürümü 0; olmayan özel notun sürümü 0'dır. Başarılı değişiklik sürümü artırır. UUID ve çalışma alanı alanlarını istemcinin değiştirmesi başka öğretmene erişim sağlamaz.

Para, kuruş cinsinden ondalıksız string'dir: `"125050"` = 1.250,50 TL. Para birimi bu sürümde TRY. Zamanlar UTC ISO; günlük tarihler `YYYY-MM-DD`. Çalışma alanı saat dilimi Europe/Istanbul'dur. Haftalık tekrar 1–8 hafta; genel RRULE değildir.

| Yöntem ve yol                                      | Gövde / davranış                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /v1/workspaces`                               | Sahip olunan çalışma alanı                                                     |
| `POST /v1/workspaces`                              | `{ "name": "Öğretmen alanım" }`; hesap başına tek alan, doğal tekrar güvenliği |
| `GET /v1/workspaces/:ws/students`                  | Öğrenci listesi                                                                |
| `POST /v1/workspaces/:ws/students`                 | `name, grade, subject, phone, email`                                           |
| `GET /v1/workspaces/:ws/students/:id`              | Öğrenci, paket borçları ve açık tutar; özel not içermez                        |
| `PATCH /v1/workspaces/:ws/students/:id`            | `version` ve öğrenci alanları                                                  |
| `POST /v1/workspaces/:ws/students/:id/archive`     | `{ "version": 0 }`; planlı ders varsa reddedilir                               |
| `GET /v1/workspaces/:ws/students/:id/private-note` | Öğretmene özel not                                                             |
| `PUT /v1/workspaces/:ws/students/:id/private-note` | `body, version`                                                                |
| `POST /v1/workspaces/:ws/packages`                 | `studentId, name, granted, priceMinor, expiresOn`                              |
| `POST /v1/workspaces/:ws/sessions`                 | `studentId, packageId, topic, startsAt, duration, location, weeks`             |
| `POST /v1/workspaces/:ws/sessions/:id/complete`    | `{ "version": 0 }`; bir hak düşer                                              |
| `POST /v1/workspaces/:ws/sessions/:id/reverse`     | Mevcut `version`; ters hareketle hak iadesi                                    |
| `POST /v1/workspaces/:ws/sessions/:id/cancel`      | Mevcut `version`; planlı ders iptali, hak tüketmez                             |
| `POST /v1/workspaces/:ws/sessions/:id/reschedule`  | `version, startsAt, duration`; yalnızca seçili ders                            |
| `POST /v1/workspaces/:ws/payments`                 | `studentId, amountMinor, receivedOn, method, reference`                        |
| `POST /v1/workspaces/:ws/payments/:id/void`        | Mevcut `version`; kayıt iptali, banka iadesi değildir                          |
| `GET /v1/workspaces/:ws/packages`                  | Paket listesi                                                                  |
| `GET /v1/workspaces/:ws/sessions`                  | Ders listesi; `from, to` ISO aralık filtresi                                   |
| `GET /v1/workspaces/:ws/payments`                  | Tahsilat listesi; iptaller korunur                                             |
| `GET /v1/workspaces/:ws/credit-entries`            | Eklemeli ders hakkı hareketleri                                                |
| `GET /v1/workspaces/:ws/audit`                     | İşlem denetim izi; özel not metnini içermez                                    |

Liste uçları `limit` (1–100, varsayılan 50), `offset` (0–100000) kabul eder. Audit dışında `studentId` filtresi vardır. Sonuç: `{ data: [...], pagination: { limit, offset, hasMore } }`. Tek kayıt ve mutasyon sonucu `{ data: {...} }`; mutasyon ayrıca `replayed` içerir. Hata gövdesi `{ error: { status, message, requestId, details? } }`.

## Küçük istemci örneği

Giriş tamamlanınca Supabase oturumundaki kullanıcı token'ını kullanın. Gerçek token'ı kaynak dosyaya yazmayın.

```ts
const api = "http://127.0.0.1:3001";
const headers = {
  Authorization: `Bearer ${session.access_token}`,
  "Content-Type": "application/json",
};
const workspaceResponse = await fetch(`${api}/v1/workspaces`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "Derslerim" }),
});
if (!workspaceResponse.ok) throw new Error("Çalışma alanı açılamadı");
const { data: workspace } = await workspaceResponse.json();
const requestKey = crypto.randomUUID(); // Retry yapılırsa bu değeri koruyun.
const studentResponse = await fetch(
  `${api}/v1/workspaces/${workspace.id}/students`,
  {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": requestKey },
    body: JSON.stringify({
      name: "Örnek öğrenci",
      grade: "10",
      subject: "Matematik",
      phone: "",
      email: "",
    }),
  },
);
if (!studentResponse.ok) throw new Error("Öğrenci oluşturulamadı");
```

## İşlemler ve güvenlik sınırı

Tüm mutasyonlar aynı `pg` istemcisi üzerinde tek işlem kullanır; otomatik commit olan bağımsız sorgu dizileri değildir. [node-postgres işlem modeli](https://node-postgres.com/features/transactions).

Öğrenci satırı kilidi arşivleme, paket ve tahsilat işlemlerini sıralar. Ders tamamlama önce öğrenciyi, sonra ders ve paketi kilitler. Hareket ekleme, hak değişimi, ders durumu, idempotency sonucu ve audit tek işlemde kalır. İade eski hareketi silmez; `reverses_id` benzersizliği aynı hakkın tekrar iadesini önler. Haftalık seride bir saat çakışırsa tüm seri geri alınır. Borcu aşan tahsilat reddedilir; kayıt iptalinde dağıtımlar geçmiş olarak korunur.

Tenant tablolarında `ENABLE/FORCE ROW LEVEL SECURITY` vardır. Runtime rolünün superuser veya BYPASSRLS olması başlatmayı durdurur. Güvenilir API sunucusu doğrulanmış kullanıcı ve çalışma alanını `SET LOCAL` bağlamıyla iletir; bağlantı havuzunda bağlam işlem sonunda silinir. Runtime veritabanı kimlik bilgileri istemciye verilmez. Doğrudan bu bilgileri ele geçiren bir taraf güvenilir sunucu sınırını aşmış olur. [PostgreSQL RLS sınırları](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Göçler `apps/api/drizzle/` içindedir; web uygulamasının kökteki `drizzle/` D1 göçleriyle karıştırmayın. Uygulanmış göç değiştirilmez; sonraki şema değişimi için `pnpm api:db:generate` ile yeni göç eklenir. Özel RLS/exclusion/izin SQL'i custom migration içindedir ve Drizzle'ın otomatik diff kapsamı dışında ayrıca korunmalıdır.

## Test ve mevcut doğrulama sınırı

v0.5 doğrulama sonuçları: [doğrulama kaydı](../../docs/validation-v5.md).

```sh
pnpm api:test:pglite
pnpm api:test
```

İlk komut burada kullanılabilen PGlite kipidir. Üretim göçlerini uygular; NestJS'ye gerçek HTTP istekleri ve yerel JWKS üzerinden doğrulanan ES256 imzalı test token'ları gönderir. Kimlik doğrulama atlanmaz. PGlite tüm bağlantıları tek PostgreSQL oturumuna çoklar; test yalnızca test ortamında `SET ROLE derslik_app` kullanarak uygulama sorgularının gerçek RLS kısıtlarıyla çalışmasını sağlar. [PGlite bağlantı sınırı](https://pglite.dev/docs/pglite-socket).

İkinci komut geçici gerçek PostgreSQL 18 sunucusu başlatır; kurulu PostgreSQL veya dış veri tabanı kullanmaz. Veriler test sonunda silinir. Linux'ta root olmayan kullanıcı gerekir. Bu ortam root hesabını normal kullanıcıya geçirmeyi engellediği için **native test çalıştırılamadı**. PGlite sonuçları native satır kilitlerini, SCRAM/TLS bağlantısını veya Docker imajını doğrulamaz.

Docker'da normal kullanıcı altında native test:

```sh
docker compose --env-file .env.api -f compose.api.yml --profile test run --build --rm api-test
```

Test kapsamı: JWT imza/issuer/audience/süre/rol; çalışma alanı ve öğrenci oluşturma; ders tamamlama/idempotency/geri alma; son hak yarışması; seri geri alma ve saat sınırları; borçlara ödeme dağıtımı, fazla tahsilat ve iptal; öğretmenler arası erişim, özel not gizliliği, RLS ve eklemeli kayıt izinleri; havuz bağlamı; arşivleme ve sayfalama. Native kip, eşzamanlı istekleri ayrı gerçek PostgreSQL bağlantıları üzerinden çalıştırır.

## v0.3 ek uçları

| Yol                                                  | İşlev                                            |
| ---------------------------------------------------- | ------------------------------------------------ |
| `GET /v1/access`                                     | Öğretmen/öğrenci/veli erişim bağlamları          |
| `GET /v1/workspaces/:ws/snapshot`                    | Web ve mobilin ortak öğretmen görünümü           |
| `POST /v1/workspaces/:ws/commands`                   | Ortak doğrulanmış komut sözleşmesi               |
| `GET/POST /v1/workspaces/:ws/students/:id/learning`  | Ödev, geri bildirim, paylaşım, özet, soru yanıtı |
| `GET /v1/portal/:ws/:student`                        | İzinleri uygulanmış öğrenci/veli yanıtı          |
| `POST /v1/portal/:ws/:student/actions`               | Öğrenci teslim/soru, izleme ilerlemesi           |
| `POST /v1/workspaces/:ws/students/:id/invitations`   | E-postaya bağlı davet oluşturma                  |
| `GET /v1/workspaces/:ws/students/:id/access`         | Davet ve erişim listesi                          |
| `POST /v1/workspaces/:ws/students/:id/access/revoke` | Link/davet iptali                                |
| `POST /v1/invitations/accept`                        | Doğrulanmış e-postayla davet kabulü              |
| `GET /v1/inbox`, `POST /v1/inbox/:id/read`           | Bildirimler                                      |
| `GET /v1/workspaces/:ws/settings/limits`             | Plan, kullanım ve provider yetenekleri           |
| `POST /v1/media/:ws/:student/files`                  | Dosya rezervasyonu ve signed upload              |
| `POST /v1/media/:ws/:student/files/:id/finish`       | Dosyayı doğrula ve hazır yap                     |
| `GET /v1/media/:ws/:student/files/:id/download`      | Süreli dosya bağlantısı                          |
| `POST /v1/media/:ws/:student/videos`                 | Süre kotası ayır ve TUS URL üret                 |
| `GET /v1/media/:ws/:student/videos/:id/playback`     | Süreli izleme token'ı                            |
| `POST /v1/media/:ws/:student/videos/:id/refresh`     | Provider durumunu uzlaştır                       |
| `POST /v1/media/:ws/:student/videos/:id/delete`      | İzlemeyi kapat, provider'dan sil                 |
| `GET /v1/workspaces/:ws/subscription`                | Derslik aboneliği                                |
| `POST /v1/workspaces/:ws/subscription/checkout`      | Tek çalışma alanı için checkout                  |
| `POST /v1/workspaces/:ws/subscription/portal`        | Aboneliği yönetme bağlantısı                     |
| `POST /v1/workspaces/:ws/subscription/sync`          | Abonelik durumunu uzlaştır                       |
| `POST /v1/webhooks/stream`                           | HMAC ile korunan video olayı                     |
| `POST /v1/webhooks/subscriptions`                    | HMAC ile korunan abonelik olayı                  |

Learning/reserve/davet mutasyonları UUID `Idempotency-Key` ister. Finish/read/delete/sync/checkout uçları doğal tekrar güvenliği kullanır. Öğretmen snapshot ve learning DTO'ları paylaşılan sözleşmeye uygun snake_case; tekil komut makbuzları camelCase döner. Yetki hiçbir zaman istemcinin `role` alanından alınmaz.

Yeni kurulum, dış hizmet ayarları ve mobil başlangıç için [kurulum kılavuzu](../../docs/kurulum.md) esas alınmalıdır.

## v0.5 ortak öğretim uçları

`assignment.update`: `assignmentId, title, instructions, dueOn, status, version`. Durumlar OPEN / COMPLETED / CANCELLED; teslim tarihi null olabilir. Kapanmış ödeve öğrenci teslimi veya teslim dosyası eklenemez.

`POST /v1/media/:ws/:student/files`: ASSIGNMENT / SUBMISSION için assignmentId gereklidir. Öğretmen RESOURCE amacıyla assignmentId=null göndererek genel materyal yükleyebilir.

`POST /v1/media/:ws/:student/files/:id/delete`: özel dosyayı siler, provider kesintisinde tekrar denenebilir. `POST .../videos` için lessonId=null genel ders videosunu ifade eder. Web ve mobil bu uçları birlikte kullanır.

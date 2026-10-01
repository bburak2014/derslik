import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LessonRemindersService } from "../../../.api-build/apps/api/src/lessons/reminders.service.js";

// Öğrencinin boş saatten ders ayarlaması: öğretmen ayarları, boş saatler,
// ayarlama ve iptal. Saatler bugüne göre hesaplanır; İstanbul UTC+3'tür.
const DAY = 86_400_000,
  HOUR = 3_600_000;
/** Bugünden `offset` gün sonraki İstanbul takvim günü (YYYY-MM-DD). */
const istanbulDay = (offset = 0) =>
  new Date(Date.now() + 3 * HOUR + offset * DAY).toISOString().slice(0, 10);
/** Günün ISO hafta günü (1 = Pazartesi). */
const isoWeekday = (day) =>
  ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
/** İstanbul saatindeki an, API'nin döndürdüğü biçimde. */
const at = (day, time) => new Date(`${day}T${time}:00+03:00`).toISOString();
/** Bir anın İstanbul takvim günü. */
const dayOf = (iso) =>
  new Date(Date.parse(iso) + 3 * HOUR).toISOString().slice(0, 10);
/** Günlerdeki 10:00–13:00 aralığının 60 dakikalık boş saatleri. */
const morning = (days) =>
  days.flatMap((day) =>
    ["10:00", "10:30", "11:00", "11:30", "12:00"].map((time) => {
      const startsAt = at(day, time);
      return {
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + HOUR).toISOString(),
      };
    }),
  );

export async function bookingCases({ t, app, admin, request, ok, token }) {
  const teacher = randomUUID(),
    pupil = randomUUID(),
    parent = randomUUID(),
    rival = randomUUID(),
    third = randomUUID(),
    quiet = randomUUID(),
    loud = randomUUID(),
    learner = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil),
    tokenParent = await token(parent),
    tokenRival = await token(rival),
    tokenThird = await token(third),
    tokenQuiet = await token(quiet),
    tokenLoud = await token(loud),
    tokenLearner = await token(learner);
  const D3 = istanbulDay(3),
    D10 = istanbulDay(10),
    D17 = istanbulDay(17),
    D24 = istanbulDay(24);
  // 3., 10., 17. ve 24. günün hafta günü: 10:00–13:00.
  const main = { weekday: isoWeekday(D3), start: "10:00", end: "13:00" };
  let ws,
    base,
    version = 0,
    ayse,
    mehmet,
    zeynep,
    kerem,
    selin,
    ayseLesson,
    mehmetLesson,
    winner,
    selinLessons;
  const save = (body) =>
    request(`${base}/booking`, { method: "PUT", body, auth: tokenTeacher });
  const settings = (overrides = {}) => ({
    enabled: true,
    durationMinutes: 60,
    noticeHours: 0,
    cancelHours: 24,
    location: "Çevrim içi",
    windows: [main],
    blocks: [{ from: D17, to: D17 }],
    version,
    ...overrides,
  });
  /** Ayarları kaydeder ve yeni sürümü saklar. */
  const configure = async (overrides = {}) => {
    const r = await save(settings(overrides));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    version = r.body.data.version;
    return r.body.data;
  };
  const portal = (s) => `/v1/portal/${ws}/${s.id}`;
  const slotsOf = async (s, auth) =>
    (await ok(`${portal(s)}/booking/slots`, undefined, { auth })).data;
  const book = (s, startsAt, auth, key) =>
    request(`${portal(s)}/booking`, {
      method: "POST",
      body: { startsAt },
      auth,
      key,
    });
  const cancel = (s, lesson, lessonVersion, auth) =>
    request(`${portal(s)}/booking/${lesson.id}/cancel`, {
      method: "POST",
      body: { version: lessonVersion },
      auth,
    });
  const student = async (name, subject) =>
    (
      await ok(
        `${base}/students`,
        { name, grade: "", subject, phone: "", email: "" },
        { auth: tokenTeacher },
      )
    ).data;
  const packageFor = async (s, granted, expiresOn) =>
    (
      await ok(
        `${base}/packages`,
        {
          studentId: s.id,
          name: `${granted} ders`,
          granted,
          priceMinor: "100000",
          expiresOn,
        },
        { auth: tokenTeacher },
      )
    ).data;

  await t.test("öğretmen müsaitliğini sürüm kontrolüyle kaydeder", async () => {
    ws = (
      await ok("/v1/workspaces", { name: "Ayarlama Hoca" }, { auth: tokenTeacher })
    ).data.id;
    base = `/v1/workspaces/${ws}`;
    // Hiç kaydedilmemiş ayar varsayılanlarla gelir.
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      {
        enabled: false,
        durationMinutes: 60,
        noticeHours: 12,
        cancelHours: 24,
        location: "",
        windows: [],
        blocks: [],
        version: 0,
      },
    );
    const saved = await configure({
      windows: [
        { weekday: 3, start: "19:00", end: "21:00" },
        { weekday: 1, start: "10:00", end: "12:00" },
      ],
      blocks: [
        { from: istanbulDay(-10), to: istanbulDay(-3) },
        { from: istanbulDay(-1), to: istanbulDay(2) },
      ],
    });
    assert.equal(saved.version, 1);
    // Aralıklar gün ve saate göre sıralanır; bitmiş kapalı günler atılır.
    assert.deepEqual(saved.windows, [
      { weekday: 1, start: "10:00", end: "12:00" },
      { weekday: 3, start: "19:00", end: "21:00" },
    ]);
    assert.deepEqual(saved.blocks, [
      { from: istanbulDay(-1), to: istanbulDay(2) },
    ]);
    assert.deepEqual(
      (await ok(`${base}/booking`, undefined, { auth: tokenTeacher })).data,
      saved,
    );
    // Eski sürümle ya da ikinci kez "ilk kayıt" olarak kayıt reddedilir.
    for (const stale of [0, 5]) {
      const r = await save(settings({ version: stale }));
      assert.equal(r.status, 409);
      assert.match(r.body.error.message, /başka bir yerde değişti/);
    }
    const overlap = await save(
      settings({
        windows: [
          { weekday: 2, start: "10:00", end: "12:00" },
          { weekday: 2, start: "11:00", end: "13:00" },
        ],
      }),
    );
    assert.equal(overlap.status, 400);
    assert.match(JSON.stringify(overlap.body.error.details), /çakışıyor/);
    assert.equal(
      (
        await save(
          settings({ windows: [{ weekday: 2, start: "10:15", end: "12:00" }] }),
        )
      ).status,
      400,
    );
    // Başka hesap bu ayarları okuyamaz ve değiştiremez.
    assert.equal(
      (await request(`${base}/booking`, { auth: tokenPupil })).status,
      403,
    );
    assert.equal(
      (
        await request(`${base}/booking`, {
          method: "PUT",
          body: settings(),
          auth: tokenPupil,
        })
      ).status,
      403,
    );
  });

  await t.test(
    "boş saatler aralık, kapalı gün, ders, önceden ayarlama ve paket bitişine göre üretilir",
    async () => {
      ayse = await student("Ayşe Ayarlar", "Fizik");
      mehmet = await student("Mehmet Rakip", "Kimya");
      zeynep = await student("Zeynep Yarış", "Biyoloji");
      kerem = await student("Kerem Arşiv", "Tarih");
      ayse.pack = await packageFor(ayse, 2, D10);
      mehmet.pack = await packageFor(mehmet, 4, null);
      zeynep.pack = await packageFor(zeynep, 2, null);
      for (const id of [pupil, parent, rival, third, quiet])
        await admin.query(
          "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT DO NOTHING",
          [id],
        );
      await admin.query(
        `INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES
          ($1,$2,$6,'STUDENT',ARRAY['lessons']),($1,$2,$7,'GUARDIAN',ARRAY['lessons']),
          ($1,$3,$8,'STUDENT',ARRAY['lessons']),($1,$4,$9,'STUDENT',ARRAY['lessons']),
          ($1,$5,$10,'STUDENT',ARRAY['lessons'])`,
        [ws, ayse.id, mehmet.id, zeynep.id, kerem.id, pupil, parent, rival, third, quiet],
      );
      await configure();
      // Ayşe'nin paketi 10. gün bitiyor: 17. gün kapalı, 24. gün paket dışı.
      assert.deepEqual(await slotsOf(ayse, tokenPupil), {
        durationMinutes: 60,
        location: "Çevrim içi",
        cancelHours: 24,
        freeCredits: 2,
        slots: morning([D3, D10]),
      });
      assert.deepEqual(
        (await slotsOf(mehmet, tokenRival)).slots,
        morning([D3, D10, D24]),
      );
      // Öğretmenin başka öğrenciyle dersi çakışan saatleri kapatır; kimin
      // dersi olduğu yanıtta görünmez. İptal edilen ders saati yeniden açar.
      const busy = (
        await ok(
          `${base}/sessions`,
          {
            studentId: mehmet.id,
            packageId: mehmet.pack.id,
            startsAt: at(D3, "10:30"),
            duration: 60,
            topic: "Öğretmenin dersi",
            location: "",
            weeks: 1,
          },
          { auth: tokenTeacher },
        )
      ).data.lessons[0];
      const around = await slotsOf(ayse, tokenPupil);
      const blocked = [at(D3, "10:00"), at(D3, "10:30"), at(D3, "11:00")];
      assert.deepEqual(
        around.slots.map((s) => s.startsAt),
        morning([D3, D10])
          .map((s) => s.startsAt)
          .filter((s) => !blocked.includes(s)),
      );
      assert.doesNotMatch(JSON.stringify(around), /Öğretmenin dersi|Mehmet/);
      await ok(
        `${base}/sessions/${busy.id}/cancel`,
        { version: busy.version },
        { auth: tokenTeacher },
      );
      assert.equal((await slotsOf(ayse, tokenPupil)).slots.length, 10);
      // En az 7 gün önceden: 3. günün saatleri düşer.
      await configure({ noticeHours: 168 });
      assert.deepEqual((await slotsOf(ayse, tokenPupil)).slots, morning([D10]));
      await configure();
    },
  );

  await t.test(
    "gece yarısı ve süreye sığmayan aralık İstanbul gününe göre değerlendirilir",
    async () => {
      const D4 = istanbulDay(4),
        D5 = istanbulDay(5),
        D12 = istanbulDay(12);
      await configure({
        durationMinutes: 90,
        windows: [
          main,
          { weekday: isoWeekday(D4), start: "23:00", end: "24:00" },
          { weekday: isoWeekday(D5), start: "00:00", end: "02:00" },
        ],
        blocks: [
          { from: D17, to: D17 },
          { from: D5, to: D5 },
        ],
      });
      const slots = (await slotsOf(mehmet, tokenRival)).slots.map(
        (s) => s.startsAt,
      );
      // 90 dakikalık ders 23:00–24:00 aralığına sığmaz: o günlerde saat yok.
      assert.ok(!slots.some((s) => isoWeekday(dayOf(s)) === isoWeekday(D4)));
      // Kapalı gün İstanbul gününe göre: 5. günün 00:00'ı UTC'de önceki gün.
      assert.ok(!slots.some((s) => dayOf(s) === D5));
      assert.deepEqual(
        slots.filter((s) => dayOf(s) === D12),
        [at(D12, "00:00"), at(D12, "00:30")],
      );
      assert.deepEqual(
        slots.filter((s) => dayOf(s) === D3),
        [at(D3, "10:00"), at(D3, "10:30"), at(D3, "11:00"), at(D3, "11:30")],
      );
      await configure();
    },
  );

  await t.test(
    "uç uca aralıklar tek aralık sayılır; sınırdan geçen ders de önerilir",
    async () => {
      // 10:00–11:00 ve 11:00–13:00: 60 dakikalık 10:30 dersi iki aralığa yayılır.
      await configure({
        windows: [
          { ...main, end: "11:00" },
          { ...main, start: "11:00" },
        ],
      });
      assert.deepEqual(
        (await slotsOf(mehmet, tokenRival)).slots.filter(
          (s) => dayOf(s.startsAt) === D3,
        ),
        morning([D3]),
      );
      await configure();
    },
  );

  await t.test(
    "öğrenci boş saate ders ayarlar; ders öğretmenin takvimine ve bildirimine düşer",
    async () => {
      const key = randomUUID();
      const first = await book(ayse, at(D3, "11:30"), tokenPupil, key);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.replayed, false);
      ayseLesson = first.body.data;
      assert.equal(ayseLesson.topic, "Fizik");
      assert.equal(ayseLesson.location, "Çevrim içi");
      assert.equal(ayseLesson.bookedBy, pupil);
      assert.equal(ayseLesson.packageId, ayse.pack.id);
      assert.equal(ayseLesson.status, "SCHEDULED");
      assert.equal(Date.parse(ayseLesson.startsAt), Date.parse(at(D3, "11:30")));
      assert.equal(
        Date.parse(ayseLesson.endsAt) - Date.parse(ayseLesson.startsAt),
        HOUR,
      );
      // Aynı anahtarla yeniden gönderim aynı dersi döndürür.
      const again = await book(ayse, at(D3, "11:30"), tokenPupil, key);
      assert.equal(again.status, 201);
      assert.equal(again.body.replayed, true);
      assert.equal(again.body.data.id, ayseLesson.id);
      const snapshot = await ok(`${base}/snapshot`, undefined, {
        auth: tokenTeacher,
      });
      assert.equal(
        snapshot.lessons.filter((l) => l.booked_by === pupil).length,
        1,
      );
      assert.deepEqual(
        (
          await admin.query(
            "SELECT user_id,title,body,kind FROM derslik.notifications WHERE target_id=$1",
            [ayseLesson.id],
          )
        ).rows,
        [
          {
            user_id: teacher,
            title: "notice.lessonBooked",
            body: "Ayşe Ayarlar",
            kind: "LESSON",
          },
        ],
      );
      const view = await ok(portal(ayse), undefined, { auth: tokenPupil });
      assert.deepEqual(view.booking, { enabled: true, cancelHours: 24 });
      assert.equal(
        view.lessons.find((l) => l.id === ayseLesson.id).booked_by,
        pupil,
      );
      // Veli de özeti görür (düğmeyi istemci gizler).
      assert.deepEqual(
        (await ok(portal(ayse), undefined, { auth: tokenParent })).booking,
        { enabled: true, cancelHours: 24 },
      );
      // Takvim aboneliği (.ics) ayarlanan dersi de içerir.
      const feed = (await ok("/v1/calendar", {}, { auth: tokenPupil })).data
        .url;
      const feedToken = /\/api\/calendar\/([a-f0-9]{64})\.ics$/.exec(feed)[1];
      const ics = Buffer.from(
        (
          await request(`/v1/calendar/${feedToken}`, { auth: null, raw: true })
        ).body,
      ).toString("utf8");
      assert.match(ics, new RegExp(`\\r\\nUID:${ayseLesson.id}@derslik\\r\\n`));
      const after = await slotsOf(ayse, tokenPupil);
      assert.equal(after.freeCredits, 1);
      for (const time of ["11:00", "11:30", "12:00"])
        assert.ok(
          !after.slots.some((s) => s.startsAt === at(D3, time)),
          time,
        );
    },
  );

  await t.test(
    "son boştaki hak için aynı anda iki ayarlama: yalnızca biri ders olur",
    async () => {
      const results = await Promise.all(
        [at(D10, "10:00"), at(D10, "12:00")].map((startsAt) =>
          book(ayse, startsAt, tokenPupil),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.match(
        results.find((r) => r.status === 409).body.error.message,
        /Boşta ders hakkınız yok/,
      );
      const empty = await slotsOf(ayse, tokenPupil);
      assert.equal(empty.freeCredits, 0);
      assert.deepEqual(empty.slots, []);
      assert.equal((await book(ayse, at(D10, "11:00"), tokenPupil)).status, 409);
    },
  );

  await t.test(
    "iki öğrenci aynı saati aynı anda seçerse yalnızca biri alır",
    async () => {
      const slot = at(D24, "10:00");
      const results = await Promise.all(
        [
          [mehmet, tokenRival],
          [zeynep, tokenThird],
        ].map(([s, auth]) => book(s, slot, auth)),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.match(
        results.find((r) => r.status === 409).body.error.message,
        /artık boş değil/,
      );
      winner = results.find((r) => r.status === 201).body.data;
      // Aynı an başka biçimde (İstanbul saatiyle, +03:00) yazılsa da aynı saattir.
      const written = await book(mehmet, `${D24}T11:00:00+03:00`, tokenRival);
      assert.equal(written.status, 201, JSON.stringify(written.body));
      mehmetLesson = written.body.data;
      assert.equal(
        Date.parse(mehmetLesson.startsAt),
        Date.parse(at(D24, "11:00")),
      );
    },
  );

  await t.test(
    "veli, öğretmen, kapalı ayarlama, geri alınan ve arşivlenen hesap ders ayarlayamaz",
    async () => {
      const slot = at(D24, "12:00");
      assert.equal(
        (await request(`${portal(ayse)}/booking/slots`, { auth: tokenParent }))
          .status,
        403,
      );
      assert.equal((await book(ayse, slot, tokenParent)).status, 403);
      assert.equal(
        (await request(`${portal(mehmet)}/booking/slots`, { auth: tokenTeacher }))
          .status,
        403,
      );
      assert.equal((await book(mehmet, slot, tokenTeacher)).status, 403);
      // Bağlı veli ve öğrenci öğretmenin ayarlarını okuyamaz, değiştiremez.
      for (const auth of [tokenParent, tokenPupil]) {
        assert.equal((await request(`${base}/booking`, { auth })).status, 403);
        assert.equal(
          (
            await request(`${base}/booking`, {
              method: "PUT",
              body: settings(),
              auth,
            })
          ).status,
          403,
        );
      }
      // Ayarlama kapalıyken liste ve ayarlama 409; portal özeti kapalı.
      await configure({ enabled: false });
      assert.equal(
        (await request(`${portal(mehmet)}/booking/slots`, { auth: tokenRival }))
          .status,
        409,
      );
      const closed = await book(mehmet, slot, tokenRival);
      assert.equal(closed.status, 409);
      assert.match(closed.body.error.message, /ders ayarlamaya kapalı/);
      assert.deepEqual(
        (await ok(portal(mehmet), undefined, { auth: tokenRival })).booking,
        { enabled: false, cancelHours: 24 },
      );
      await configure();
      // Bağlantısı geri alınan öğrenci.
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [ws, third],
      );
      assert.equal(
        (await request(`${portal(zeynep)}/booking/slots`, { auth: tokenThird }))
          .status,
        403,
      );
      assert.equal((await book(zeynep, slot, tokenThird)).status, 403);
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=NULL WHERE workspace_id=$1 AND user_id=$2",
        [ws, third],
      );
      // Arşivlenen öğrenci.
      await ok(
        `${base}/students/${kerem.id}/archive`,
        { version: kerem.version },
        { auth: tokenTeacher },
      );
      assert.equal(
        (await request(`${portal(kerem)}/booking/slots`, { auth: tokenQuiet }))
          .status,
        403,
      );
      assert.equal((await book(kerem, slot, tokenQuiet)).status, 403);
      // Dakikada 10'dan fazla ayarlama ya da iptal isteği reddedilir.
      const statuses = [];
      for (let i = 0; i < 11; i++)
        statuses.push((await book(kerem, slot, tokenLoud)).status);
      assert.deepEqual(statuses, [...Array(10).fill(403), 429]);
    },
  );

  await t.test("öğrenci kendi ayarladığı dersi süresi içinde iptal eder", async () => {
    assert.equal((await cancel(mehmet, mehmetLesson, 3, tokenRival)).status, 409);
    const done = await cancel(mehmet, mehmetLesson, 0, tokenRival);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.data.status, "CANCELLED");
    assert.deepEqual(
      (
        await admin.query(
          "SELECT user_id,body FROM derslik.notifications WHERE target_id=$1 AND title='notice.lessonCancelledByStudent'",
          [mehmetLesson.id],
        )
      ).rows,
      [{ user_id: teacher, body: "Mehmet Rakip" }],
    );
    // Saat yeniden boşalır; iptal edilmiş ders yeniden iptal edilemez.
    assert.ok(
      (await slotsOf(mehmet, tokenRival)).slots.some(
        (s) => s.startsAt === at(D24, "11:00"),
      ),
    );
    assert.equal((await cancel(mehmet, mehmetLesson, 1, tokenRival)).status, 409);
  });

  await t.test(
    "süresi geçen, öğretmenin planladığı, başkasının dersi ve veli iptal edemez",
    async () => {
      await configure({ cancelHours: 168 });
      const late = await cancel(ayse, ayseLesson, 0, tokenPupil);
      assert.equal(late.status, 409);
      assert.match(late.body.error.message, /iptal süresi geçti/);
      await configure();
      const planned = (
        await ok(
          `${base}/sessions`,
          {
            studentId: ayse.id,
            packageId: ayse.pack.id,
            startsAt: at(istanbulDay(5), "15:00"),
            duration: 60,
            topic: "Öğretmen planladı",
            location: "",
            weeks: 1,
          },
          { auth: tokenTeacher },
        )
      ).data.lessons[0];
      const notMine = await cancel(ayse, planned, 0, tokenPupil);
      assert.equal(notMine.status, 409);
      assert.match(notMine.body.error.message, /öğretmeniniz planladı/);
      assert.equal((await cancel(mehmet, ayseLesson, 0, tokenRival)).status, 404);
      assert.equal((await cancel(ayse, ayseLesson, 0, tokenParent)).status, 403);
      // Öğretmen bütün aralıkları kaldırsa da ayarlanmış ders yerinde kalır,
      // liste boş döner ve ders süresi içinde iptal edilebilir.
      await configure({ windows: [] });
      assert.deepEqual((await slotsOf(ayse, tokenPupil)).slots, []);
      assert.equal((await cancel(ayse, ayseLesson, 0, tokenPupil)).status, 201);
      await configure();
    },
  );

  await t.test(
    "öğretmen ayarlanan dersi taşır, tamamlar, geri alır; hatırlatma gider",
    async () => {
      const lessonPath = (action) => `${base}/sessions/${winner.id}/${action}`;
      const moved = (
        await ok(
          lessonPath("reschedule"),
          { version: 0, startsAt: at(D24, "15:00"), duration: 60 },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(moved.bookedBy, winner.bookedBy);
      const completed = (
        await ok(
          lessonPath("complete"),
          { version: moved.version },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(completed.status, "COMPLETED");
      const reversed = (
        await ok(
          lessonPath("reverse"),
          { version: completed.version },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(reversed.status, "SCHEDULED");
      // Yakında başlayan ayarlanmış ders diğer dersler gibi hatırlatılır.
      const soon = new Date(
        Math.ceil((Date.now() + 30 * 60_000) / 60_000) * 60_000,
      );
      await admin.query(
        "UPDATE derslik.lessons SET starts_at=$2,ends_at=$3,reminded_at=NULL WHERE id=$1",
        [winner.id, soon, new Date(soon.getTime() + HOUR)],
      );
      assert.ok((await app.get(LessonRemindersService).run()) >= 1);
      const reminded = (
        await admin.query(
          "SELECT user_id FROM derslik.notifications WHERE target_id=$1 AND title='notice.lessonReminder'",
          [winner.id],
        )
      ).rows.map((r) => r.user_id);
      assert.ok(reminded.includes(teacher) && reminded.includes(winner.bookedBy));
    },
  );

  await t.test(
    "birden çok pakette önce süresi en erken biten paketin hakkı kullanılır",
    async () => {
      selin = await student("Selin Paket", "Matematik");
      // Süresiz paket önce açılır: seçim açılış sırasına değil bitişe bakar.
      selin.open = await packageFor(selin, 3, null);
      selin.soon = await packageFor(selin, 1, istanbulDay(30));
      await admin.query(
        "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT DO NOTHING",
        [learner],
      );
      await admin.query(
        "INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES($1,$2,$3,'STUDENT',ARRAY['lessons'])",
        [ws, selin.id, learner],
      );
      assert.equal((await slotsOf(selin, tokenLearner)).freeCredits, 4);
      const first = await book(selin, at(D3, "10:00"), tokenLearner);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.data.packageId, selin.soon.id);
      // Süreli paketin tek hakkı planlı derste; sıradaki ders süresiz paketten.
      const second = await book(selin, at(D3, "11:00"), tokenLearner);
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.equal(second.body.data.packageId, selin.open.id);
      assert.equal((await slotsOf(selin, tokenLearner)).freeCredits, 2);
      selinLessons = [first.body.data, second.body.data];
    },
  );

  await t.test(
    "öğrencinin iptali hakkı geri verir; ayarlama kapalıyken de iptal edilir",
    async () => {
      const [first] = selinLessons;
      await configure({ enabled: false });
      const done = await cancel(selin, first, first.version, tokenLearner);
      assert.equal(done.status, 201, JSON.stringify(done.body));
      assert.equal(done.body.data.status, "CANCELLED");
      await configure();
      assert.equal((await slotsOf(selin, tokenLearner)).freeCredits, 3);
      // Geri gelen hak yine önce süreli paketten kullanılır.
      const again = await book(selin, at(D3, "12:00"), tokenLearner);
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.data.packageId, selin.soon.id);
      assert.equal((await slotsOf(selin, tokenLearner)).freeCredits, 2);
    },
  );

  await t.test(
    "öğretmen öğrencinin ayarladığı dersi iptal eder; etiket kalır, hak geri gelir",
    async () => {
      const [, second] = selinLessons;
      const cancelled = (
        await ok(
          `${base}/sessions/${second.id}/cancel`,
          { version: second.version },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(cancelled.bookedBy, learner);
      assert.equal((await slotsOf(selin, tokenLearner)).freeCredits, 3);
    },
  );
}

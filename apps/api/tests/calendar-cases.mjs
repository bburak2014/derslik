import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Takvim aboneliği: herkes yalnızca uygulamada gördüğü dersleri takviminde
// görür; bağlantı yenilenince eskisi çalışmaz; akış RFC 5545'e uyar.
export async function calendarCases({
  t,
  config,
  admin,
  request,
  ok,
  token,
  tokenB,
  sessionBody,
}) {
  const teacher = randomUUID(),
    pupil = randomUUID(),
    parent = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil),
    tokenParent = await token(parent);
  const hour = 3_600_000;
  const at = (hours) =>
    new Date(Math.ceil(Date.now() / hour) * hour + hours * hour).toISOString();
  const feedOf = async (auth, headers = {}) =>
    (await ok("/v1/calendar", {}, { auth, headers })).data.url;
  const tokenOf = (url) => /\/api\/calendar\/([a-f0-9]{64})\.ics$/.exec(url)[1];
  const read = async (url) => {
    const r = await request(`/v1/calendar/${tokenOf(url)}`, {
      auth: null,
      raw: true,
    });
    return { ...r, text: Buffer.from(r.body).toString("utf8") };
  };
  const uids = (text) =>
    [...text.matchAll(/^UID:(.+)@derslik\r$/gm)].map((m) => m[1]).sort();
  let ws, ayse, mehmet, first, second, other;

  await t.test(
    "calendar feed shows each account only the lessons it can see",
    async () => {
      ws = (
        await ok(
          "/v1/workspaces",
          { name: "Takvim Hoca" },
          { auth: tokenTeacher },
        )
      ).data.id;
      const base = `/v1/workspaces/${ws}`;
      const student = async (name) =>
        (
          await ok(
            `${base}/students`,
            { name, grade: "", subject: "Matematik", phone: "", email: "" },
            { auth: tokenTeacher },
          )
        ).data;
      const lesson = async (s, startsAt, topic, location) => {
        const pack = (
          await ok(
            `${base}/packages`,
            {
              studentId: s.id,
              name: "4 ders",
              granted: 4,
              priceMinor: "100000",
              expiresOn: null,
            },
            { auth: tokenTeacher },
          )
        ).data;
        return (
          await ok(
            `${base}/sessions`,
            { ...sessionBody(s.id, pack.id, startsAt), topic, location },
            { auth: tokenTeacher },
          )
        ).data.lessons[0];
      };
      ayse = await student("Ayşe Yılmaz");
      mehmet = await student("Mehmet Kaya");
      first = await lesson(
        ayse,
        at(24),
        "Kesirler, oranlar; tekrar",
        "Kütüphane",
      );
      second = await lesson(ayse, at(48), "İptal edilecek", "");
      other = await lesson(mehmet, at(72), "Geometri", "Çevrim içi");
      await ok(
        `${base}/sessions/${second.id}/cancel`,
        { version: second.version },
        { auth: tokenTeacher },
      );
      // Ayşe'nin öğrenci hesabı ve velisi; velinin Mehmet'te derslere erişimi yok.
      for (const id of [pupil, parent])
        await admin.query(
          "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT DO NOTHING",
          [id],
        );
      await admin.query(
        `INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES
          ($1,$2,$4,'STUDENT',ARRAY['lessons']),
          ($1,$2,$5,'GUARDIAN',ARRAY['lessons']),
          ($1,$3,$5,'GUARDIAN',ARRAY['assignments'])`,
        [ws, ayse.id, mehmet.id, pupil, parent],
      );

      const url = await feedOf(tokenTeacher);
      assert.ok(
        url.startsWith(new URL("/api/calendar/", config.WEB_ORIGIN).href),
      );
      // Aynı kişi her seferinde aynı bağlantıyı alır.
      assert.equal(await feedOf(tokenTeacher), url);
      const feed = await read(url);
      assert.equal(feed.status, 200);
      assert.match(feed.headers.get("content-type"), /^text\/calendar/);
      assert.equal(feed.headers.get("cache-control"), "private, no-cache");
      assert.equal(feed.headers.get("referrer-policy"), "no-referrer");
      // İptal edilen ders akışta yok; abone takvim onu siler.
      assert.deepEqual(uids(feed.text), [first.id, other.id].sort());
      assert.ok(feed.text.startsWith("BEGIN:VCALENDAR\r\n"));
      assert.ok(feed.text.endsWith("END:VCALENDAR\r\n"));
      assert.match(
        feed.text,
        /\r\nBEGIN:VTIMEZONE\r\nTZID:Europe\/Istanbul\r\n/,
      );
      assert.match(feed.text, /\r\nX-WR-CALNAME:Derslik dersleri\r\n/);
      assert.match(
        feed.text,
        /\r\nSUMMARY:Kesirler\\, oranlar\\; tekrar · Ayşe Yılmaz\r\n/,
      );
      assert.match(feed.text, /\r\nLOCATION:Kütüphane\r\n/);
      const start = new Date(first.startsAt ?? first.starts_at)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
      assert.match(feed.text, new RegExp(`\\r\\nDTSTART:${start}\\r\\n`));
      for (const line of feed.text.slice(0, -2).split("\r\n")) {
        assert.ok(!line.includes("\n") && !line.includes("\r"), line);
        assert.ok(Buffer.byteLength(line) <= 75, line);
      }

      // Öğrenci yalnızca kendi dersini, kendi dilinde ve öğretmen adıyla görür.
      const pupilFeed = await read(
        await feedOf(tokenPupil, { "Accept-Language": "en-US,en;q=0.9" }),
      );
      assert.deepEqual(uids(pupilFeed.text), [first.id]);
      assert.match(pupilFeed.text, /\r\nX-WR-CALNAME:Derslik lessons\r\n/);
      assert.match(
        pupilFeed.text,
        /\r\nSUMMARY:Kesirler\\, oranlar\\; tekrar · Takvim Hoca\r\n/,
      );
      // Veli derslere erişimi olan çocuğun derslerini, adıyla görür.
      const parentFeed = await read(await feedOf(tokenParent));
      assert.deepEqual(uids(parentFeed.text), [first.id]);
      assert.match(
        parentFeed.text,
        /\r\nSUMMARY:Ayşe Yılmaz: Kesirler\\, oranlar\\; tekrar · Takvim Hoca\r\n/,
      );
      // Başka öğretmen bu dersleri görmez.
      const foreign = await read(await feedOf(tokenB));
      assert.equal(foreign.status, 200);
      for (const id of [first.id, other.id])
        assert.ok(!foreign.text.includes(id));
    },
  );

  await t.test(
    "calendar feed follows access changes and old links stop after renewal",
    async () => {
      const pupilUrl = await feedOf(tokenPupil);
      // Ertelenen ders yeni saatiyle ve artan sırayla gelir.
      const moved = (
        await ok(
          `/v1/workspaces/${ws}/sessions/${first.id}/reschedule`,
          { version: first.version, startsAt: at(30), duration: 90 },
          { auth: tokenTeacher },
        )
      ).data;
      const after = (await read(pupilUrl)).text;
      assert.match(after, new RegExp(`\\r\\nSEQUENCE:${moved.version}\\r\\n`));
      // Bağlantısı kaldırılan öğrencinin takviminden dersler düşer.
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [ws, pupil],
      );
      const revoked = await read(pupilUrl);
      assert.equal(revoked.status, 200);
      assert.deepEqual(uids(revoked.text), []);
      // Ders yokken de takvimde bir bileşen olur (RFC 5545); katı istemciler
      // boş takvimi reddeder.
      assert.match(revoked.text, /\r\nBEGIN:VTIMEZONE\r\n/);
      // Arşivlenen öğrencinin dersleri velide görünmez.
      await admin.query(
        "UPDATE derslik.students SET active=false WHERE workspace_id=$1 AND id=$2",
        [ws, ayse.id],
      );
      assert.deepEqual(uids((await read(await feedOf(tokenParent))).text), []);
      await admin.query(
        "UPDATE derslik.students SET active=true WHERE workspace_id=$1 AND id=$2",
        [ws, ayse.id],
      );

      const old = await feedOf(tokenTeacher);
      const renewed = (
        await ok("/v1/calendar/rotate", {}, { auth: tokenTeacher })
      ).data.url;
      assert.notEqual(renewed, old);
      assert.equal(await feedOf(tokenTeacher), renewed);
      assert.equal((await read(old)).status, 404);
      assert.equal((await read(renewed)).status, 200);
      // 2000'den fazla ders varsa yaklaşan dersler kalır, en eski geçmiş
      // dersler düşer.
      await admin.query(
        `INSERT INTO derslik.lessons(workspace_id,student_id,package_id,topic,starts_at,ends_at,status)
         SELECT workspace_id,student_id,package_id,'Eski ders',
          now()-interval '2 hours'-g*interval '45 minutes',
          now()-interval '2 hours'-g*interval '45 minutes'+interval '30 minutes',
          'COMPLETED'
         FROM derslik.lessons l, generate_series(1,2000) g WHERE l.id=$1`,
        [other.id],
      );
      try {
        const busy = uids((await read(renewed)).text);
        assert.equal(busy.length, 2000);
        assert.ok(busy.includes(first.id) && busy.includes(other.id));
      } finally {
        await admin.query(
          "DELETE FROM derslik.lessons WHERE workspace_id=$1 AND topic='Eski ders'",
          [ws],
        );
      }
      // Biçimi bozuk ya da bilinmeyen belirteç aynı 404'ü alır.
      for (const bad of ["abc", "A".repeat(64), "0".repeat(64)]) {
        const r = await request(`/v1/calendar/${bad}`, { auth: null });
        assert.equal(r.status, 404);
      }
      // Bağlantı almak oturum ister.
      assert.equal(
        (
          await request("/v1/calendar", {
            method: "POST",
            body: {},
            auth: null,
          })
        ).status,
        401,
      );
      // Belirteç komut kaydına yazılmaz.
      const stored = (
        await admin.query(
          "SELECT count(*) AS n FROM derslik.api_commands WHERE response::text LIKE $1",
          [`%${tokenOf(renewed)}%`],
        )
      ).rows[0].n;
      assert.equal(stored, "0");
    },
  );
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Öğrencinin boş saatten ders ayarlaması: öğretmen ayarları, boş saatler,
// ayarlama ve iptal. Saatler bugüne göre hesaplanır; İstanbul UTC+3'tür.
const DAY = 86_400_000,
  HOUR = 3_600_000;
/** Bugünden `offset` gün sonraki İstanbul takvim günü (YYYY-MM-DD). */
const istanbulDay = (offset = 0) =>
  new Date(Date.now() + 3 * HOUR + offset * DAY).toISOString().slice(0, 10);

export async function bookingCases({ t, request, ok, token }) {
  const teacher = randomUUID(),
    pupil = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil);
  let ws,
    base,
    version = 0;
  const save = (body) =>
    request(`${base}/booking`, { method: "PUT", body, auth: tokenTeacher });
  const settings = (overrides = {}) => ({
    enabled: true,
    durationMinutes: 60,
    noticeHours: 0,
    cancelHours: 24,
    location: "Çevrim içi",
    windows: [],
    blocks: [],
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
}

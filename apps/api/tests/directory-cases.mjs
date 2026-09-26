import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Öğretmen vitrini: yayın, filtre, fotoğraf, ders isteği, kabul/red, yorum.
export async function directoryCases({ t, admin, request, ok, token }) {
  const teacher = randomUUID(),
    other = randomUUID(),
    student = randomUUID(),
    declined = randomUUID(),
    canceller = randomUUID();
  const tokenTeacher = await token(teacher, { email: "teacher@example.test" }),
    tokenOther = await token(other),
    tokenStudent = await token(student, { email: "ayse@example.test" }),
    tokenDeclined = await token(declined),
    tokenCanceller = await token(canceller);
  let ws, requestId;
  const profile = {
    displayName: "Deniz Hoca",
    headline: "YKS matematik",
    bio: "On yıllık deneyim.",
    subjects: ["math", "physics"],
    levels: ["high", "exam"],
    lessonModes: ["ONLINE"],
    city: "",
    hourlyPrice: 750,
    currency: "TRY",
    languages: ["tr", "en"],
    experienceYears: 10,
    published: false,
  };
  const requestBody = {
    studentName: "Ayşe Kaya",
    subject: "math",
    level: "exam",
    phone: "",
    message: "Hafta içi akşamları uygunum.",
  };

  await t.test(
    "teacher showcase stays hidden until published and validates fields",
    async () => {
      ws = (
        await ok("/v1/workspaces", { name: "Deniz" }, { auth: tokenTeacher })
      ).data.id;
      const saved = await request(`/v1/workspaces/${ws}/showcase`, {
        method: "PUT",
        body: profile,
        auth: tokenTeacher,
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.data.published, false);
      assert.equal(
        (await request(`/v1/teachers/${ws}`, { auth: null })).status,
        404,
      );
      const hidden = await request("/v1/teachers", { auth: null });
      assert.equal(hidden.status, 200);
      assert.ok(!hidden.body.data.some((x) => x.id === ws));
      const noCity = await request(`/v1/workspaces/${ws}/showcase`, {
        method: "PUT",
        body: { ...profile, lessonModes: ["IN_PERSON"] },
        auth: tokenTeacher,
      });
      assert.equal(noCity.status, 400);
      const noSubject = await request(`/v1/workspaces/${ws}/showcase`, {
        method: "PUT",
        body: { ...profile, subjects: [] },
        auth: tokenTeacher,
      });
      assert.equal(noSubject.status, 400);
      // Başka öğretmen bu vitrini göremez ve değiştiremez.
      assert.equal(
        (
          await request(`/v1/workspaces/${ws}/showcase`, {
            method: "PUT",
            body: profile,
            auth: tokenOther,
          })
        ).status,
        403,
      );
      // İstek yayında olmayan öğretmene gidemez.
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/requests`, {
            method: "POST",
            body: requestBody,
            auth: tokenStudent,
          })
        ).status,
        404,
      );
    },
  );

  await t.test(
    "published teachers are listed publicly with filters and a photo",
    async () => {
      const published = await request(`/v1/workspaces/${ws}/showcase`, {
        method: "PUT",
        body: {
          ...profile,
          lessonModes: ["ONLINE", "IN_PERSON"],
          city: "İzmir",
          published: true,
        },
        auth: tokenTeacher,
      });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.ok(published.body.data.publishedAt);
      const all = await request("/v1/teachers", { auth: null });
      const card = all.body.data.find((x) => x.id === ws);
      assert.equal(card.displayName, "Deniz Hoca");
      assert.equal(card.hourlyPrice, 750);
      assert.equal(card.ratingCount, 0);
      assert.equal(card.ratingAverage, null);
      assert.ok(all.body.cities.includes("İzmir"));
      // Vitrin kartında iletişim ve öğrenci bilgisi yok.
      assert.equal(card.phone, undefined);
      assert.equal(card.photo, undefined);
      const find = async (query) =>
        (await request("/v1/teachers?" + query, { auth: null })).body.data.some(
          (x) => x.id === ws,
        );
      assert.equal(await find("subject=math"), true);
      assert.equal(await find("subject=music"), false);
      assert.equal(await find("level=exam&mode=IN_PERSON&city=izmir"), true);
      assert.equal(await find("maxPrice=500"), false);
      assert.equal(await find("maxPrice=800&sort=price"), true);
      assert.equal(await find("q=deniz"), true);
      assert.equal(await find("q=%25"), false);
      // Arama branş, seviye ve şehir adlarında da eşleşir (her dilde).
      assert.equal(await find("q=matematik"), true);
      assert.equal(await find("q=Fizik"), true);
      assert.equal(await find("q=physics"), true);
      assert.equal(await find("q=İZMİR"), true);
      assert.equal(await find("q=izmir%20matematik"), true);
      assert.equal(await find("q=lise"), true);
      // Konuştuğu dil (en) branş sayılmaz.
      assert.equal(await find("q=ingilizce"), false);
      assert.equal(await find("q=kimya"), false);
      assert.equal(await find("q=izmir%20kimya"), false);
      assert.equal(
        (await request("/v1/teachers?subject=nope", { auth: null })).status,
        400,
      );

      const jpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1,
      ]);
      const bad = await request(`/v1/workspaces/${ws}/showcase/photo`, {
        method: "PUT",
        body: { mimeType: "image/png", data: jpeg.toString("base64") },
        auth: tokenTeacher,
      });
      assert.equal(bad.status, 400);
      const big = await request(`/v1/workspaces/${ws}/showcase/photo`, {
        method: "PUT",
        body: {
          mimeType: "image/jpeg",
          data: Buffer.concat([jpeg, Buffer.alloc(320 * 1024)]).toString(
            "base64",
          ),
        },
        auth: tokenTeacher,
      });
      assert.equal(big.status, 400);
      const photo = await request(`/v1/workspaces/${ws}/showcase/photo`, {
        method: "PUT",
        body: { mimeType: "image/jpeg", data: jpeg.toString("base64") },
        auth: tokenTeacher,
      });
      assert.equal(photo.status, 200, JSON.stringify(photo.body));
      const version = photo.body.data.photoVersion;
      assert.ok(version >= 1);
      const detail = await request(`/v1/teachers/${ws}`, { auth: null });
      assert.equal(detail.body.data.photoVersion, version);
      const image = await fetchPhoto(request, ws, null);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/jpeg");
      assert.match(image.headers.get("cache-control"), /public/);
    },
  );

  await t.test(
    "students send one pending request; teacher sees it and gets a notice",
    async () => {
      const relation = await ok(`/v1/teacher-relations/${ws}`, undefined, {
        auth: tokenStudent,
      });
      assert.equal(relation.data.request, null);
      assert.equal(relation.data.canReview, false);
      assert.equal(relation.data.isOwn, false);
      const sent = await request(`/v1/teacher-relations/${ws}/requests`, {
        method: "POST",
        body: requestBody,
        auth: tokenStudent,
      });
      assert.equal(sent.status, 201, JSON.stringify(sent.body));
      assert.equal(sent.body.data.status, "PENDING");
      assert.equal(sent.body.data.email, "ayse@example.test");
      requestId = sent.body.data.id;
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/requests`, {
            method: "POST",
            body: requestBody,
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/requests`, {
            method: "POST",
            body: requestBody,
            auth: tokenTeacher,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/requests`, {
            method: "POST",
            body: { ...requestBody, extra: true },
            auth: tokenOther,
          })
        ).status,
        400,
      );
      const mine = await ok("/v1/requests", undefined, { auth: tokenStudent });
      assert.equal(mine.data.length, 1);
      assert.equal(mine.data[0].teacherName, "Deniz Hoca");
      // Başkasının isteğini ne öğrenci ne başka öğretmen görür.
      assert.equal(
        (await ok("/v1/requests", undefined, { auth: tokenOther })).data.length,
        0,
      );
      assert.equal(
        (await request(`/v1/workspaces/${ws}/showcase`, { auth: tokenOther }))
          .status,
        403,
      );
      const showcase = await ok(`/v1/workspaces/${ws}/showcase`, undefined, {
        auth: tokenTeacher,
      });
      assert.equal(showcase.data.requests.length, 1);
      assert.equal(showcase.data.requests[0].studentName, "Ayşe Kaya");
      const inbox = await ok("/v1/inbox", undefined, { auth: tokenTeacher });
      const notice = inbox.data.find((n) => n.kind === "REQUEST");
      assert.equal(notice.title, "notice.requestNew");
      assert.equal(notice.targetId, requestId);
      // Yorum için önce öğrenci olmak gerekir.
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/review`, {
            method: "PUT",
            body: { rating: 5, comment: "" },
            auth: tokenStudent,
          })
        ).status,
        403,
      );
      // Öğrenci hesabı öğretmenin fotoğrafını görebilir.
      assert.equal((await fetchPhoto(request, ws, tokenStudent)).status, 200);
    },
  );

  await t.test(
    "accepting links the student like an invitation; reviews are simple",
    async () => {
      assert.equal(
        (
          await request(`/v1/workspaces/${ws}/requests/${requestId}/accept`, {
            method: "POST",
            body: {},
            auth: tokenOther,
          })
        ).status,
        403,
      );
      const accepted = await request(
        `/v1/workspaces/${ws}/requests/${requestId}/accept`,
        { method: "POST", body: {}, auth: tokenTeacher },
      );
      assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
      assert.equal(accepted.body.data.status, "ACCEPTED");
      const studentId = accepted.body.data.studentId;
      assert.ok(studentId);
      assert.equal(
        (
          await request(`/v1/workspaces/${ws}/requests/${requestId}/accept`, {
            method: "POST",
            body: {},
            auth: tokenTeacher,
          })
        ).status,
        409,
      );
      const record = await ok(
        `/v1/workspaces/${ws}/students/${studentId}`,
        undefined,
        { auth: tokenTeacher },
      );
      assert.equal(record.data.name, "Ayşe Kaya");
      assert.equal(record.data.subject, "Matematik");
      assert.equal(record.data.email, "ayse@example.test");
      const access = await ok("/v1/access", undefined, { auth: tokenStudent });
      const portal = access.data.find((a) => a.id === ws);
      assert.equal(portal.role, "STUDENT");
      assert.equal(portal.studentId, studentId);
      assert.equal(
        (await request(`/v1/portal/${ws}/${studentId}`, { auth: tokenStudent }))
          .status,
        200,
      );
      const decided = await ok("/v1/inbox", undefined, { auth: tokenStudent });
      assert.equal(
        decided.data.find((n) => n.kind === "REQUEST_DECISION").title,
        "notice.requestAccepted",
      );
      const relation = await ok(`/v1/teacher-relations/${ws}`, undefined, {
        auth: tokenStudent,
      });
      assert.equal(relation.data.isStudent, true);
      assert.equal(relation.data.canReview, true);
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/requests`, {
            method: "POST",
            body: requestBody,
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/review`, {
            method: "PUT",
            body: { rating: 6, comment: "" },
            auth: tokenStudent,
          })
        ).status,
        400,
      );
      await ok(
        `/v1/teacher-relations/${ws}/review`,
        { rating: 4, comment: "Çok sabırlı." },
        { auth: tokenStudent, method: "PUT" },
      );
      const review = await request(`/v1/teacher-relations/${ws}/review`, {
        method: "PUT",
        body: { rating: 5, comment: "Harika anlatıyor." },
        auth: tokenStudent,
      });
      assert.equal(review.status, 200);
      assert.equal(review.body.data.authorName, "Ayşe K.");
      const detail = await ok(`/v1/teachers/${ws}`, undefined, { auth: null });
      assert.equal(detail.data.ratingAverage, 5);
      assert.equal(detail.data.ratingCount, 1);
      assert.equal(detail.reviews.length, 1);
      assert.equal(detail.reviews[0].comment, "Harika anlatıyor.");
      assert.equal(detail.reviews[0].userId, undefined);
      // Öğretmen yorumu değiştiremez veya silemez.
      assert.equal(
        (
          await request(`/v1/teacher-relations/${ws}/review`, {
            method: "PUT",
            body: { rating: 1, comment: "" },
            auth: tokenTeacher,
          })
        ).status,
        403,
      );
      await ok(
        `/v1/teacher-relations/${ws}/review/delete`,
        {},
        {
          auth: tokenTeacher,
        },
      );
      assert.equal(
        (await ok(`/v1/teachers/${ws}`, undefined, { auth: null })).data
          .ratingCount,
        1,
      );
    },
  );

  await t.test(
    "declines cool down, students cancel their own, student limit holds",
    async () => {
      const sent = await ok(
        `/v1/teacher-relations/${ws}/requests`,
        requestBody,
        {
          auth: tokenDeclined,
        },
      );
      const declinedRequest = await ok(
        `/v1/workspaces/${ws}/requests/${sent.data.id}/decline`,
        {},
        { auth: tokenTeacher },
      );
      assert.equal(declinedRequest.data.status, "DECLINED");
      const again = await request(`/v1/teacher-relations/${ws}/requests`, {
        method: "POST",
        body: requestBody,
        auth: tokenDeclined,
      });
      assert.equal(again.status, 409);
      const relation = await ok(`/v1/teacher-relations/${ws}`, undefined, {
        auth: tokenDeclined,
      });
      assert.ok(relation.data.retryAfter);

      const pending = await ok(
        `/v1/teacher-relations/${ws}/requests`,
        { ...requestBody, studentName: "Can Er" },
        { auth: tokenCanceller },
      );
      assert.equal(
        (
          await request(`/v1/requests/${pending.data.id}/cancel`, {
            method: "POST",
            body: {},
            auth: tokenOther,
          })
        ).status,
        409,
      );
      const second = await ok(
        `/v1/teacher-relations/${ws}/requests`,
        { ...requestBody, studentName: "Can Er" },
        { auth: tokenCanceller },
      ).catch((e) => e);
      assert.ok(second instanceof Error);
      await admin.query(
        "UPDATE derslik.workspace_limits SET student_limit=1 WHERE workspace_id=$1",
        [ws],
      );
      const full = await request(
        `/v1/workspaces/${ws}/requests/${pending.data.id}/accept`,
        { method: "POST", body: {}, auth: tokenTeacher },
      );
      assert.equal(full.status, 409);
      assert.equal(
        (
          await ok(`/v1/workspaces/${ws}/showcase`, undefined, {
            auth: tokenTeacher,
          })
        ).data.requests.find((r) => r.id === pending.data.id).status,
        "PENDING",
      );
      const cancelled = await ok(
        `/v1/requests/${pending.data.id}/cancel`,
        {},
        { auth: tokenCanceller },
      );
      assert.equal(cancelled.data.status, "CANCELLED");
      assert.equal(
        (
          await request(
            `/v1/workspaces/${ws}/requests/${pending.data.id}/decline`,
            { method: "POST", body: {}, auth: tokenTeacher },
          )
        ).status,
        409,
      );
      // Yayından kalkınca vitrinde ve profil sayfasında görünmez.
      await ok(`/v1/workspaces/${ws}/showcase`, profile, {
        auth: tokenTeacher,
        method: "PUT",
      });
      assert.equal(
        (await request(`/v1/teachers/${ws}`, { auth: null })).status,
        404,
      );
      assert.equal((await fetchPhoto(request, ws, null)).status, 404);
      assert.equal((await fetchPhoto(request, ws, tokenTeacher)).status, 200);
    },
  );
}

async function fetchPhoto(request, ws, auth) {
  return request(`/v1/teachers/${ws}/photo`, { auth, raw: true });
}

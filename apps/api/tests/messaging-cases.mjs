import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../../.api-build/apps/api/src/main.js";
import { translate } from "../../../.api-build/packages/contracts/src/i18n/index.js";
import {
  threadTitle,
  unreadBadge,
} from "../../../.api-build/packages/contracts/src/messages.js";

// Uygulama içi mesajlaşma: öğretmen bağlı her hesapla (öğrenci hesabı ve her
// veli hesabı) ayrı yazışır. Paylaşımlara erişimi olan veli çocuğunun
// yazışmasını yalnızca okur; başka hiç kimse bir yazışmayı göremez. Alıcıya
// yazışma başına tek okunmamış bildirim gider.
export async function messagingCases({
  t,
  config,
  admin,
  request,
  ok,
  token,
  tokenB,
  verifiedUsers,
}) {
  const teacher = randomUUID(),
    pupil = randomUUID(),
    parent = randomUUID(),
    quiet = randomUUID(),
    kid = randomUUID(),
    both = randomUUID(),
    stranger = randomUUID();
  const tokenTeacher = await token(teacher),
    tokenPupil = await token(pupil),
    tokenParent = await token(parent),
    tokenQuiet = await token(quiet),
    tokenKid = await token(kid),
    tokenBoth = await token(both),
    tokenStranger = await token(stranger);
  const confirm = (auth, id, email) =>
    verifiedUsers.set(`Bearer ${auth}`, {
      id,
      email,
      email_confirmed_at: new Date().toISOString(),
    });
  confirm(tokenPupil, pupil, "ayse.mesaj@example.test");
  // Auth adresi büyük harfli olabilir; eşleşme harf duyarsızdır.
  confirm(tokenParent, parent, "Veli.Mesaj@example.test");

  const text = (key) => translate("tr", key);
  let ws, ayse, mehmet, can;
  const links = {};
  const owner = (suffix = "") => `/v1/workspaces/${ws}/messages${suffix}`;
  const portal = (student, suffix = "") =>
    `/v1/portal/${ws}/${student}/messages${suffix}`;
  const send = (path, body, auth, options = {}) =>
    ok(path, { body }, { auth, ...options });
  const listOwner = async (query = "") =>
    (await ok(owner(query), undefined, { auth: tokenTeacher })).data;
  const listPortal = async (student, auth) =>
    (await ok(portal(student), undefined, { auth })).data;
  const open = async (path, auth) => (await ok(path, undefined, { auth })).data;
  const row = (rows, linkId) => rows.find((r) => r.linkId === linkId);
  // Beklenen ret: durum kodu ve isteğin dilinde (Türkçe) anahtarın metni.
  const refused = async (path, status, key, options = {}) => {
    const r = await request(path, options);
    assert.equal(
      r.status,
      status,
      `${options.method ?? "GET"} ${path}: ${r.status} ${JSON.stringify(r.body)}`,
    );
    if (key) assert.equal(r.body.error.message, text(key));
    return r;
  };
  const post = (auth, body = { body: "Deneme" }) => ({
    method: "POST",
    body,
    auth,
  });
  const unreadNotices = async (user, link) =>
    (
      await admin.query(
        "SELECT title,body,student_id,workspace_id FROM derslik.notifications WHERE user_id=$1 AND kind='MESSAGE' AND target_id=$2 AND read_at IS NULL",
        [user, link],
      )
    ).rows;
  const noticeCount = async (user, link) =>
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM derslik.notifications WHERE user_id=$1 AND target_id=$2",
        [user, link],
      )
    ).rows[0].n;
  const messageCount = async (link) =>
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM derslik.messages WHERE link_id=$1",
        [link],
      )
    ).rows[0].n;

  await t.test(
    "messaging: the teacher talks one to one with each linked account",
    async () => {
      ws = (
        await ok(
          "/v1/workspaces",
          { name: "Mesaj Hoca" },
          { auth: tokenTeacher },
        )
      ).data.id;
      const student = async (name) =>
        (
          await ok(
            `/v1/workspaces/${ws}/students`,
            { name, grade: "", subject: "Matematik", phone: "", email: "" },
            { auth: tokenTeacher },
          )
        ).data;
      ayse = await student("Ayşe Yılmaz");
      mehmet = await student("Mehmet Kaya");
      can = await student("Can Demir");
      const invite = async (s, email, role, permissions) =>
        (
          await ok(
            `/v1/workspaces/${ws}/students/${s.id}/invitations`,
            { email, role, permissions },
            { auth: tokenTeacher },
          )
        ).data;
      const accept = async (invitation, auth) =>
        (
          await ok(
            "/v1/invitations/accept",
            { token: invitation.url.split("/").at(-1) },
            { auth },
          )
        ).data.id;
      // Ayşe'nin öğrenci hesabı ve paylaşımlara erişimi olan velisi davetle
      // katılır; kabul edilmemiş bir davet de durur.
      links.pupil = await accept(
        await invite(ayse, "ayse.mesaj@example.test", "STUDENT", [
          "lessons",
          "assignments",
          "videos",
          "notes",
        ]),
        tokenPupil,
      );
      links.parent = await accept(
        await invite(ayse, "veli.mesaj@example.test", "GUARDIAN", [
          "lessons",
          "notes",
        ]),
        tokenParent,
      );
      await invite(ayse, "bekleyen@example.test", "GUARDIAN", ["lessons"]);
      // Paylaşımlara erişimi olmayan veli (hesabının e-postası kayıtlı ama
      // daveti yok), Mehmet'in öğrenci hesabı, Can'a hem öğrenci hem veli
      // olarak bağlı tek hesap ve öğretmenin kendi çalışma alanındaki velilik
      // bağlantısı.
      for (const user of [quiet, kid, both])
        await admin.query(
          "INSERT INTO derslik.users(id,email) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [user, `hesap-${user}@example.test`],
        );
      const inserted = (
        await admin.query(
          `INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES
            ($1,$2,$5,'GUARDIAN',ARRAY['lessons']),
            ($1,$3,$6,'STUDENT',ARRAY['lessons','notes']),
            ($1,$4,$7,'STUDENT',ARRAY['lessons','notes']),
            ($1,$4,$7,'GUARDIAN',ARRAY['lessons','notes']),
            ($1,$2,$8,'GUARDIAN',ARRAY['lessons','notes'])
           RETURNING id,user_id,role`,
          [ws, ayse.id, mehmet.id, can.id, quiet, kid, both, teacher],
        )
      ).rows;
      const linkOf = (user, role) =>
        inserted.find((r) => r.user_id === user && r.role === role).id;
      links.quiet = linkOf(quiet, "GUARDIAN");
      links.kid = linkOf(kid, "STUDENT");
      links.bothStudent = linkOf(both, "STUDENT");
      links.bothGuardian = linkOf(both, "GUARDIAN");
      links.self = linkOf(teacher, "GUARDIAN");

      // Öğretmen: kendi bağlantısı dışında her bağlantı bir yazışma. Mesaj
      // yokken sıra öğrenci adı, önce öğrenci hesabı, sonra bağlantı sırası.
      const first = await listOwner();
      assert.deepEqual(
        first.map((r) => r.linkId),
        [
          links.pupil,
          links.parent,
          links.quiet,
          links.bothStudent,
          links.bothGuardian,
          links.kid,
        ],
      );
      for (const r of first) {
        assert.equal(r.viewer, "OWNER");
        assert.equal(r.canSend, true);
        assert.equal(r.active, true);
        assert.equal(r.teacherName, "Mesaj Hoca");
        assert.equal(r.lastBody, null);
        assert.equal(r.lastAt, null);
        assert.equal(r.lastMine, false);
        assert.equal(r.unread, 0);
      }
      assert.deepEqual(
        {
          role: row(first, links.pupil).role,
          studentId: row(first, links.pupil).studentId,
          studentName: row(first, links.pupil).studentName,
          guardianEmail: row(first, links.pupil).guardianEmail,
        },
        {
          role: "STUDENT",
          studentId: ayse.id,
          studentName: "Ayşe Yılmaz",
          guardianEmail: null,
        },
      );
      // Öğrenci yazışmasını yalnızca paylaşımlara erişimi olan veli okur;
      // öğretmenin kendi bağlantısı ve hesabın kendi veli bağlantısı sayılmaz.
      assert.equal(row(first, links.pupil).guardianReaders, 1);
      assert.equal(row(first, links.bothStudent).guardianReaders, 0);
      assert.equal(row(first, links.kid).guardianReaders, 0);
      assert.equal(row(first, links.parent).guardianReaders, 0);
      // Veli e-postası yalnızca kabul edilen davetten gelir.
      assert.equal(
        row(first, links.parent).guardianEmail,
        "veli.mesaj@example.test",
      );
      assert.equal(row(first, links.quiet).guardianEmail, null);
      assert.equal(row(first, links.kid).guardianEmail, null);
      assert.equal(threadTitle(row(first, links.pupil)), "Ayşe Yılmaz");
      assert.equal(
        threadTitle(row(first, links.parent)),
        "Ayşe Yılmaz velisi",
      );
      assert.deepEqual(
        (await listOwner(`?student=${ayse.id}`)).map((r) => r.linkId),
        [links.pupil, links.parent, links.quiet],
      );
      await refused(owner("?student=bozuk"), 400, "api.invalidFields", {
        auth: tokenTeacher,
      });
      // Öğretmenin kendi velilik bağlantısı hiçbir tarafta yazışma değildir.
      await refused(owner(`/${links.self}`), 404, "api.messageNotFound", {
        auth: tokenTeacher,
      });
      await refused(
        owner(`/${links.self}`),
        404,
        "api.messageNotFound",
        post(tokenTeacher),
      );
      assert.deepEqual(await listPortal(ayse.id, tokenTeacher), []);
      await refused(
        portal(ayse.id, `/${links.self}`),
        404,
        "api.messageNotFound",
        post(tokenTeacher),
      );

      // Öğretmen → öğrenci.
      const hello = await send(
        owner(`/${links.pupil}`),
        "Merhaba Ayşe, yarınki derse hazır mısın?",
        tokenTeacher,
      );
      assert.equal(hello.replayed, false);
      assert.deepEqual(Object.keys(hello.data).sort(), ["createdAt", "id"]);
      const mine = await listPortal(ayse.id, tokenPupil);
      assert.equal(mine.length, 1);
      assert.deepEqual(mine[0], {
        linkId: links.pupil,
        role: "STUDENT",
        studentId: ayse.id,
        studentName: "Ayşe Yılmaz",
        teacherName: "Mesaj Hoca",
        guardianEmail: null,
        viewer: "SELF",
        canSend: true,
        active: true,
        guardianReaders: 1,
        lastBody: "Merhaba Ayşe, yarınki derse hazır mısın?",
        lastAt: hello.data.createdAt,
        lastMine: false,
        unread: 1,
      });
      assert.equal(threadTitle(mine[0]), "Mesaj Hoca");
      const opened = await open(portal(ayse.id, `/${links.pupil}`), tokenPupil);
      assert.equal(opened.thread.linkId, links.pupil);
      assert.equal(opened.thread.viewer, "SELF");
      assert.equal(opened.more, false);
      assert.deepEqual(opened.messages, [
        {
          id: hello.data.id,
          senderRole: "OWNER",
          mine: false,
          body: "Merhaba Ayşe, yarınki derse hazır mısın?",
          createdAt: hello.data.createdAt,
        },
      ]);
      assert.deepEqual(
        await ok(
          portal(ayse.id, `/${links.pupil}/read`),
          {},
          { auth: tokenPupil },
        ),
        { data: { read: true } },
      );
      assert.equal((await listPortal(ayse.id, tokenPupil))[0].unread, 0);

      // Öğrenci → öğretmen; yazışma listede en üste çıkar.
      const reply = await send(
        portal(ayse.id, `/${links.pupil}`),
        "Hazırım hocam.",
        tokenPupil,
      );
      const afterReply = await listOwner();
      assert.equal(afterReply[0].linkId, links.pupil);
      assert.equal(afterReply[0].lastBody, "Hazırım hocam.");
      assert.equal(afterReply[0].lastAt, reply.data.createdAt);
      assert.equal(afterReply[0].lastMine, false);
      assert.equal(afterReply[0].unread, 1);
      assert.deepEqual(
        (await open(owner(`/${links.pupil}`), tokenTeacher)).messages.map(
          (m) => [m.senderRole, m.mine, m.body],
        ),
        [
          ["OWNER", true, "Merhaba Ayşe, yarınki derse hazır mısın?"],
          ["STUDENT", false, "Hazırım hocam."],
        ],
      );

      // Paylaşımlara erişimi olan veli: kendi yazışması ve çocuğunun
      // yazışması (yalnızca okur, önceki mesajlar dahil).
      const parentList = await listPortal(ayse.id, tokenParent);
      assert.deepEqual(
        parentList.map((r) => [r.linkId, r.viewer, r.canSend, r.role]),
        [
          [links.pupil, "GUARDIAN_READ", false, "STUDENT"],
          [links.parent, "SELF", true, "GUARDIAN"],
        ],
      );
      assert.equal(row(parentList, links.pupil).unread, 2);
      assert.equal(row(parentList, links.pupil).guardianReaders, 0);
      assert.equal(row(parentList, links.pupil).guardianEmail, null);
      assert.equal(row(parentList, links.parent).guardianEmail, null);
      assert.equal(
        threadTitle(row(parentList, links.pupil)),
        "Ayşe Yılmaz ile öğretmen",
      );
      const child = await open(
        portal(ayse.id, `/${links.pupil}`),
        tokenParent,
      );
      assert.equal(child.thread.viewer, "GUARDIAN_READ");
      assert.deepEqual(
        child.messages.map((m) => [m.senderRole, m.mine]),
        [
          ["OWNER", false],
          ["STUDENT", false],
        ],
      );
      await refused(
        portal(ayse.id, `/${links.pupil}`),
        403,
        "api.messageClosed",
        post(tokenParent),
      );
      await ok(
        portal(ayse.id, `/${links.pupil}/read`),
        {},
        { auth: tokenParent },
      );
      assert.equal(
        row(await listPortal(ayse.id, tokenParent), links.pupil).unread,
        0,
      );
      const fromParent = await send(
        portal(ayse.id, `/${links.parent}`),
        "Merhaba, Ayşe'nin velisiyim.",
        tokenParent,
      );
      assert.equal(fromParent.replayed, false);
      await send(owner(`/${links.parent}`), "Hoş geldiniz.", tokenTeacher);
      assert.deepEqual(
        (await open(portal(ayse.id, `/${links.parent}`), tokenParent)).messages.map(
          (m) => [m.senderRole, m.mine],
        ),
        [
          ["GUARDIAN", true],
          ["OWNER", false],
        ],
      );

      // Paylaşımlara erişimi olmayan veli yalnızca kendi yazışmasını görür.
      assert.deepEqual(
        (await listPortal(ayse.id, tokenQuiet)).map((r) => [
          r.linkId,
          r.viewer,
        ]),
        [[links.quiet, "SELF"]],
      );
      for (const link of [links.pupil, links.parent]) {
        await refused(
          portal(ayse.id, `/${link}`),
          404,
          "api.messageNotFound",
          { auth: tokenQuiet },
        );
        await refused(
          portal(ayse.id, `/${link}`),
          404,
          "api.messageNotFound",
          post(tokenQuiet),
        );
        await refused(
          portal(ayse.id, `/${link}/read`),
          404,
          "api.messageNotFound",
          post(tokenQuiet, {}),
        );
      }
      // Veli öbür velinin ve başka çocuğun yazışmasını, öğrenci veli
      // yazışmalarını göremez.
      for (const [auth, link] of [
        [tokenParent, links.quiet],
        [tokenParent, links.kid],
        [tokenPupil, links.parent],
        [tokenPupil, links.quiet],
      ]) {
        await refused(
          portal(ayse.id, `/${link}`),
          404,
          "api.messageNotFound",
          { auth },
        );
        await refused(
          portal(ayse.id, `/${link}`),
          404,
          "api.messageNotFound",
          post(auth),
        );
        await refused(
          portal(ayse.id, `/${link}/read`),
          404,
          "api.messageNotFound",
          post(auth, {}),
        );
      }
      // Bağlı olmadığı öğrencinin yolu öğrenci düzeyinde reddedilir.
      await refused(portal(mehmet.id), 403, "api.noStudentAccess", {
        auth: tokenParent,
      });
      await refused(
        portal(mehmet.id, `/${links.kid}`),
        403,
        "api.noStudentAccess",
        { auth: tokenParent },
      );
      // Yol başka öğrenciyi, bağlantı bu öğrenciyi gösterirse yazışma yok.
      await refused(
        portal(mehmet.id, `/${links.pupil}`),
        404,
        "api.messageNotFound",
        { auth: tokenKid },
      );
      assert.deepEqual(
        (await listPortal(mehmet.id, tokenKid)).map((r) => [
          r.linkId,
          r.viewer,
          r.guardianReaders,
        ]),
        [[links.kid, "SELF", 0]],
      );

      // Aynı öğrenciye hem öğrenci hem veli olarak bağlı hesap: öğrenci
      // yazışmasını bir kez, kendi tarafı olarak görür ve yazabilir.
      const bothList = await listPortal(can.id, tokenBoth);
      assert.deepEqual(
        bothList.map((r) => [r.linkId, r.viewer, r.canSend]),
        [
          [links.bothStudent, "SELF", true],
          [links.bothGuardian, "SELF", true],
        ],
      );
      await send(
        portal(can.id, `/${links.bothStudent}`),
        "Öğrenci olarak yazıyorum.",
        tokenBoth,
      );
      await send(
        portal(can.id, `/${links.bothGuardian}`),
        "Veli olarak yazıyorum.",
        tokenBoth,
      );
      assert.equal(
        (await unreadNotices(teacher, links.bothStudent))[0].title,
        "notice.messageFromStudent",
      );
      assert.equal(
        (await unreadNotices(teacher, links.bothGuardian))[0].title,
        "notice.messageFromGuardian",
      );
    },
  );

  await t.test(
    "messaging: one unread notice per conversation, cleared on open, never to the sender or a reading guardian",
    async () => {
      await ok(
        portal(ayse.id, `/${links.pupil}/read`),
        {},
        { auth: tokenPupil },
      );
      assert.equal((await unreadNotices(pupil, links.pupil)).length, 0);
      const before = await noticeCount(pupil, links.pupil);
      await send(owner(`/${links.pupil}`), "İlk not", tokenTeacher);
      await send(
        owner(`/${links.pupil}`),
        "İkinci not:\n\n  sayfa   12",
        tokenTeacher,
      );
      // Yeni mesaj aynı okunmamış bildirimi günceller.
      assert.deepEqual(await unreadNotices(pupil, links.pupil), [
        {
          title: "notice.messageFromTeacher",
          body: "Mesaj Hoca: İkinci not: sayfa 12",
          student_id: ayse.id,
          workspace_id: ws,
        },
      ]);
      assert.equal(await noticeCount(pupil, links.pupil), before + 1);
      const inbox = (await ok("/v1/inbox", undefined, { auth: tokenPupil }))
        .data;
      const notice = inbox.find(
        (n) => n.kind === "MESSAGE" && n.targetId === links.pupil && !n.readAt,
      );
      assert.equal(notice.studentId, ayse.id);
      assert.equal(notice.workspaceId, ws);
      assert.equal(notice.title, "notice.messageFromTeacher");
      // Yazışmayı açmak bildirimi okur; sonraki mesaj yeni bir bildirimdir.
      await ok(
        portal(ayse.id, `/${links.pupil}/read`),
        {},
        { auth: tokenPupil },
      );
      assert.equal((await unreadNotices(pupil, links.pupil)).length, 0);
      await send(owner(`/${links.pupil}`), "Üçüncü not", tokenTeacher);
      assert.equal((await unreadNotices(pupil, links.pupil)).length, 1);
      assert.equal(await noticeCount(pupil, links.pupil), before + 2);
      // Aynı anda gelen mesajlar da tek okunmamış bildirim bırakır.
      const count = await messageCount(links.pupil);
      await Promise.all(
        [1, 2, 3, 4, 5].map((i) =>
          send(owner(`/${links.pupil}`), `Eşzamanlı ${i}`, tokenTeacher),
        ),
      );
      assert.equal(await messageCount(links.pupil), count + 5);
      assert.equal((await unreadNotices(pupil, links.pupil)).length, 1);
      assert.equal(await noticeCount(pupil, links.pupil), before + 2);
      // Öğrenciden öğretmene: gövde öğrenci adıyla, önizleme 140 karakter.
      const long = `Soru:  ${"çok uzun bir soru ".repeat(20)}\n\nson`;
      await send(portal(ayse.id, `/${links.pupil}`), long, tokenPupil);
      const collapsed = long.replace(/\s+/g, " ").trim();
      assert.deepEqual(
        (await unreadNotices(teacher, links.pupil)).map((n) => [
          n.title,
          n.body,
        ]),
        [
          [
            "notice.messageFromStudent",
            `Ayşe Yılmaz: ${collapsed.slice(0, 140)}…`,
          ],
        ],
      );
      // Veli yazınca başlık veliyi, gövde öğrencinin adını söyler.
      await send(
        portal(ayse.id, `/${links.parent}`),
        "Kısa bir soru",
        tokenParent,
      );
      assert.deepEqual(
        (await unreadNotices(teacher, links.parent)).map((n) => [
          n.title,
          n.body,
        ]),
        [["notice.messageFromGuardian", "Ayşe Yılmaz: Kısa bir soru"]],
      );
      // Yazan kişi yazışmayı okumuş sayılır; kendi okunmamış bildirimi de düşer.
      await send(owner(`/${links.parent}`), "Yanıt", tokenTeacher);
      assert.equal((await unreadNotices(teacher, links.parent)).length, 0);
      assert.equal(row(await listOwner(), links.parent).unread, 0);
      // Veli çocuğunun yazışması için bildirim almaz; kimse kendi mesajı için
      // bildirim almaz; öğretmen yalnızca öğrenci/veli mesajı için, bağlantının
      // hesabı yalnızca öğretmen mesajı için bildirim alır.
      assert.equal(await noticeCount(parent, links.pupil), 0);
      const misrouted = (
        await admin.query(
          `SELECT count(*)::int AS n FROM derslik.notifications n
           JOIN derslik.portal_links l ON l.id=n.target_id
           WHERE n.kind='MESSAGE' AND n.workspace_id=$1 AND NOT (
            (n.user_id=$2 AND l.role='STUDENT' AND n.title='notice.messageFromStudent') OR
            (n.user_id=$2 AND l.role='GUARDIAN' AND n.title='notice.messageFromGuardian') OR
            (n.user_id=l.user_id AND n.title='notice.messageFromTeacher'))`,
          [ws, teacher],
        )
      ).rows[0].n;
      assert.equal(misrouted, 0);
      // Öğretmenin vitrindeki adı kullanılır; boş ad çalışma alanı adına düşer.
      await admin.query(
        "INSERT INTO derslik.teacher_profiles(workspace_id,display_name) VALUES($1,'Zeynep Öğretmen')",
        [ws],
      );
      await send(owner(`/${links.pupil}`), "Adım değişti", tokenTeacher);
      assert.equal(
        (await unreadNotices(pupil, links.pupil))[0].body,
        "Zeynep Öğretmen: Adım değişti",
      );
      assert.equal(
        (await listPortal(ayse.id, tokenPupil))[0].teacherName,
        "Zeynep Öğretmen",
      );
      await admin.query(
        "UPDATE derslik.teacher_profiles SET display_name='  ' WHERE workspace_id=$1",
        [ws],
      );
      assert.equal(
        (await listPortal(ayse.id, tokenPupil))[0].teacherName,
        "Mesaj Hoca",
      );
      // Mesaj metni başka bir hesabın bildirimlerine düşmez.
      const secret = `Yalnızca Ayşe okur ${randomUUID()}`;
      await send(owner(`/${links.pupil}`), secret, tokenTeacher);
      assert.ok(
        JSON.stringify(
          await ok("/v1/inbox", undefined, { auth: tokenPupil }),
        ).includes(secret),
      );
      for (const auth of [
        tokenParent,
        tokenQuiet,
        tokenKid,
        tokenBoth,
        tokenStranger,
        tokenB,
        tokenTeacher,
      ])
        assert.ok(
          !JSON.stringify(await ok("/v1/inbox", undefined, { auth })).includes(
            secret,
          ),
        );
    },
  );

  await t.test(
    "messaging: unread counts, the unread badge and paging",
    async () => {
      const kidThread = () => listPortal(mehmet.id, tokenKid);
      const teacherRow = async () => row(await listOwner(), links.kid);
      for (const n of [1, 2, 3])
        await send(owner(`/${links.kid}`), `Öğretmen ${n}`, tokenTeacher);
      assert.equal((await kidThread())[0].unread, 3);
      assert.equal((await teacherRow()).unread, 0);
      assert.equal((await teacherRow()).lastMine, true);
      // Yazan, o ana kadarki mesajları okumuş sayılır.
      await send(portal(mehmet.id, `/${links.kid}`), "Öğrenci 1", tokenKid);
      assert.equal((await kidThread())[0].unread, 0);
      assert.equal((await kidThread())[0].lastMine, true);
      assert.equal((await teacherRow()).unread, 1);
      await send(owner(`/${links.kid}`), "Öğretmen 4", tokenTeacher);
      assert.equal((await kidThread())[0].unread, 1);
      assert.equal((await teacherRow()).unread, 0);
      assert.equal(unreadBadge(await kidThread()), 1);
      await ok(
        portal(mehmet.id, `/${links.kid}/read`),
        {},
        { auth: tokenKid },
      );
      assert.equal(unreadBadge(await kidThread()), 0);

      // Velinin yalnızca okuduğu çocuk yazışması sayaca girmez.
      await ok(
        portal(ayse.id, `/${links.parent}/read`),
        {},
        { auth: tokenParent },
      );
      await ok(
        portal(ayse.id, `/${links.pupil}/read`),
        {},
        { auth: tokenParent },
      );
      await send(owner(`/${links.parent}`), "Veliye", tokenTeacher);
      await send(owner(`/${links.pupil}`), "Öğrenciye 1", tokenTeacher);
      await send(owner(`/${links.pupil}`), "Öğrenciye 2", tokenTeacher);
      const parentList = await listPortal(ayse.id, tokenParent);
      assert.equal(row(parentList, links.parent).unread, 1);
      assert.equal(row(parentList, links.pupil).unread, 2);
      assert.equal(unreadBadge(parentList), 1);
      const all = await listOwner();
      assert.equal(
        unreadBadge(all),
        all.reduce((sum, r) => sum + r.unread, 0),
      );
      assert.ok(unreadBadge(all) > 0);

      // Sayfalar: en yeniden geriye, her sayfa eskiden yeniye; aynı anda
      // gönderilen mesajlar da kaybolmaz ve tekrarlanmaz.
      await Promise.all(
        ["A", "B", "C"].map((x) =>
          send(owner(`/${links.kid}`), `Toplu ${x}`, tokenTeacher),
        ),
      );
      const thread = (path) => open(owner(`/${links.kid}${path}`), tokenTeacher);
      const full = await thread("?limit=100");
      assert.equal(full.messages.length, 8);
      assert.equal(full.more, false);
      assert.equal(full.thread.linkId, links.kid);
      for (let i = 1; i < full.messages.length; i++)
        assert.ok(
          Date.parse(full.messages[i - 1].createdAt) <
            Date.parse(full.messages[i].createdAt),
        );
      assert.equal(full.messages[0].body, "Öğretmen 1");
      assert.equal(full.messages[3].senderRole, "STUDENT");
      assert.deepEqual((await thread("")).messages, full.messages);
      const pages = [];
      let cursor = "";
      for (;;) {
        const page = await thread(`?limit=3${cursor}`);
        pages.unshift(page.messages);
        assert.ok(page.messages.length <= 3);
        if (!page.more) break;
        assert.equal(page.messages.length, 3);
        cursor = `&before=${encodeURIComponent(page.messages[0].createdAt)}`;
      }
      assert.deepEqual(
        pages.map((p) => p.length),
        [2, 3, 3],
      );
      assert.deepEqual(pages.flat(), full.messages);
      // Tek tek sayfalamak da aynı sırayı verir.
      const single = [];
      cursor = "";
      for (;;) {
        const page = await thread(`?limit=1${cursor}`);
        single.unshift(...page.messages);
        if (!page.more) break;
        cursor = `&before=${encodeURIComponent(page.messages[0].createdAt)}`;
      }
      assert.deepEqual(single, full.messages);
      assert.equal((await thread("?limit=8")).more, false);
      assert.equal((await thread("?limit=7")).more, true);
      assert.deepEqual(
        await thread("?before=2000-01-01T00:00:00.000Z"),
        { thread: full.thread, messages: [], more: false },
      );
      // Öğrenci de aynı sayfaları görür.
      assert.deepEqual(
        (
          await open(portal(mehmet.id, `/${links.kid}?limit=2`), tokenKid)
        ).messages.map((m) => m.id),
        full.messages.slice(-2).map((m) => m.id),
      );
      for (const bad of [
        "?limit=0",
        "?limit=101",
        "?limit=iki",
        "?before=dün",
        "?before=2026-13-45",
      ])
        await refused(owner(`/${links.kid}${bad}`), 400, "api.invalidFields", {
          auth: tokenTeacher,
        });
      await refused(owner("/bozuk"), 400, "api.invalidFields", {
        auth: tokenTeacher,
      });
      await refused(
        portal(mehmet.id, "/bozuk"),
        400,
        "api.invalidFields",
        post(tokenKid),
      );
    },
  );

  await t.test(
    "messaging: bodies are cleaned and validated; retries are idempotent and the text stays out of logs",
    async () => {
      const path = owner(`/${links.kid}`);
      for (const body of [
        { body: "" },
        { body: "   \n\t  \r\n" },
        { body: "\u0000\u0007" },
        { body: "a".repeat(2001) },
        { body: 5 },
        {},
      ])
        await refused(
          path,
          400,
          "api.messageInvalid",
          post(tokenTeacher, body),
        );
      await refused(
        portal(mehmet.id, `/${links.kid}`),
        400,
        "api.messageInvalid",
        post(tokenKid, { body: " " }),
      );
      await send(path, "a".repeat(2000), tokenTeacher);
      // Denetim karakterleri sayılmadan atılır; satır sonu ve sekme kalır.
      await send(path, `\u0001${"b".repeat(2000)}\u0002`, tokenTeacher);
      const cleaned = await send(
        path,
        "  Satır 1\r\nSatır\u0000 2\rSatır\t3\u0007\u007f\u0085\n\n  ",
        tokenTeacher,
      );
      const stored = (
        await admin.query("SELECT body FROM derslik.messages WHERE id=$1", [
          cleaned.data.id,
        ])
      ).rows[0].body;
      assert.equal(stored, "Satır 1\nSatır 2\nSatır\t3");
      assert.equal(
        (await open(`${path}?limit=1`, tokenTeacher)).messages[0].body,
        "Satır 1\nSatır 2\nSatır\t3",
      );

      // Aynı anahtarla tekrar: tek mesaj, ikinci yanıt tekrar.
      const secret = `Tekrar denenen mesaj ${randomUUID()}`;
      const key = randomUUID();
      const once = await send(path, secret, tokenTeacher, { key });
      const twice = await send(path, secret, tokenTeacher, { key });
      assert.equal(once.replayed, false);
      assert.equal(twice.replayed, true);
      assert.deepEqual(twice.data, once.data);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM derslik.messages WHERE body=$1",
            [secret],
          )
        ).rows[0].n,
        1,
      );
      await refused(
        path,
        409,
        "api.idempotencyKeyReused",
        { ...post(tokenTeacher, { body: `${secret} değişti` }), key },
      );
      // Portal tarafında da aynı kural.
      const portalKey = randomUUID();
      const p1 = await send(
        portal(mehmet.id, `/${links.kid}`),
        secret,
        tokenKid,
        { key: portalKey },
      );
      const p2 = await send(
        portal(mehmet.id, `/${links.kid}`),
        secret,
        tokenKid,
        { key: portalKey },
      );
      assert.equal(p2.replayed, true);
      assert.equal(p2.data.id, p1.data.id);
      // Komut kaydı ve denetim kaydı metni tutmaz.
      const logged = (
        await admin.query(
          `SELECT
            (SELECT count(*)::int FROM derslik.api_commands WHERE workspace_id=$1 AND action='message.send') AS commands,
            (SELECT count(*)::int FROM derslik.api_commands WHERE workspace_id=$1 AND response::text LIKE $2) AS responses,
            (SELECT count(*)::int FROM derslik.audit_events WHERE workspace_id=$1 AND metadata::text LIKE $2) AS audits,
            (SELECT metadata->>'linkId' FROM derslik.audit_events WHERE workspace_id=$1 AND action='message.send' AND resource_id=$3) AS link`,
          [ws, `%${secret.slice(-36)}%`, once.data.id],
        )
      ).rows[0];
      assert.ok(logged.commands > 10);
      assert.equal(logged.responses, 0);
      assert.equal(logged.audits, 0);
      assert.equal(logged.link, links.kid);
    },
  );

  await t.test(
    "messaging: revoked access, archived students and foreign teachers",
    async () => {
      const pupilPath = owner(`/${links.pupil}`);
      // Yabancı öğretmen A'nın çalışma alanında: çalışma alanı düzeyinde ret.
      await refused(owner(), 403, "api.noWorkspaceAccess", { auth: tokenB });
      await refused(pupilPath, 403, "api.noWorkspaceAccess", { auth: tokenB });
      await refused(pupilPath, 403, "api.noWorkspaceAccess", post(tokenB));
      await refused(
        owner(`/${links.pupil}/read`),
        403,
        "api.noWorkspaceAccess",
        post(tokenB, {}),
      );
      await refused(owner(), 403, "api.noWorkspaceAccess", {
        auth: tokenPupil,
      });
      await refused(portal(ayse.id), 403, "api.noStudentAccess", {
        auth: tokenB,
      });
      // Kendi çalışma alanında A'nın yazışma kimliğiyle: yazışma yok.
      const wsS = (
        await ok(
          "/v1/workspaces",
          { name: "Yabancı Hoca" },
          { auth: tokenStranger },
        )
      ).data.id;
      const foreign = (suffix) => `/v1/workspaces/${wsS}/messages${suffix}`;
      assert.deepEqual(
        (await ok(foreign(""), undefined, { auth: tokenStranger })).data,
        [],
      );
      await refused(
        foreign(`/${links.pupil}`),
        404,
        "api.messageNotFound",
        { auth: tokenStranger },
      );
      await refused(
        foreign(`/${links.pupil}`),
        404,
        "api.messageNotFound",
        post(tokenStranger),
      );
      await refused(
        foreign(`/${links.pupil}/read`),
        404,
        "api.messageNotFound",
        post(tokenStranger, {}),
      );
      const foreignPortal = `/v1/portal/${wsS}/${ayse.id}/messages`;
      assert.deepEqual(
        (await ok(foreignPortal, undefined, { auth: tokenStranger })).data,
        [],
      );
      await refused(
        `${foreignPortal}/${links.pupil}`,
        404,
        "api.messageNotFound",
        post(tokenStranger),
      );
      assert.equal(await messageCount(links.pupil), await messageCount(links.pupil));

      // Erişimi kaldırılan öğrenci: portal öğrenci düzeyinde reddeder;
      // öğretmen geçmişi okur, yazamaz; veli çocuğun yazışmasını artık görmez.
      const history = await messageCount(links.pupil);
      await ok(
        `/v1/workspaces/${ws}/students/${ayse.id}/access/revoke`,
        { id: links.pupil, kind: "link" },
        { auth: tokenTeacher },
      );
      await refused(portal(ayse.id), 403, "api.noStudentAccess", {
        auth: tokenPupil,
      });
      await refused(
        portal(ayse.id, `/${links.pupil}`),
        403,
        "api.noStudentAccess",
        { auth: tokenPupil },
      );
      await refused(
        portal(ayse.id, `/${links.pupil}`),
        403,
        "api.noStudentAccess",
        post(tokenPupil),
      );
      await refused(
        portal(ayse.id, `/${links.pupil}/read`),
        403,
        "api.noStudentAccess",
        post(tokenPupil, {}),
      );
      const closed = row(await listOwner(), links.pupil);
      assert.equal(closed.active, false);
      assert.equal(closed.canSend, false);
      assert.equal(closed.guardianReaders, 0);
      assert.equal(
        (await open(`${pupilPath}?limit=100`, tokenTeacher)).messages.length,
        history,
      );
      await refused(pupilPath, 403, "api.messageClosed", post(tokenTeacher));
      await ok(`${pupilPath}/read`, {}, { auth: tokenTeacher });
      assert.equal(await messageCount(links.pupil), history);
      assert.deepEqual(
        (await listPortal(ayse.id, tokenParent)).map((r) => r.linkId),
        [links.parent],
      );
      await refused(
        portal(ayse.id, `/${links.pupil}`),
        404,
        "api.messageNotFound",
        { auth: tokenParent },
      );
      // Veritabanı fonksiyonu da aynı kararı verir (API denetimi ile kilit
      // arasında erişim kalkarsa).
      const direct = async (sql) => {
        try {
          await admin.query(sql);
        } catch (error) {
          return { code: error.code, hint: error.hint };
        }
        return null;
      };
      assert.deepEqual(
        await direct(`DO $$ BEGIN
          PERFORM set_config('app.actor_id','${teacher}',true);
          PERFORM * FROM derslik.send_message('${ws}',NULL,'${links.pupil}','OWNER','x');
        END $$`),
        { code: "42501", hint: "closed" },
      );
      assert.deepEqual(
        await direct(`DO $$ BEGIN
          PERFORM set_config('app.actor_id','${teacher}',true);
          PERFORM * FROM derslik.send_message('${ws}',NULL,'${links.self}','OWNER','x');
        END $$`),
        { code: "42501", hint: "not_found" },
      );
      assert.equal(
        await direct(`DO $$ BEGIN
          PERFORM set_config('app.actor_id','${teacher}',true);
          IF (SELECT count(*) FROM derslik.message_access('${ws}',NULL,'${links.parent}','OWNER'))<>1
           OR (SELECT count(*) FROM derslik.message_access('${ws}',NULL,'${links.parent}','BOGUS'))<>0
           OR (SELECT count(*) FROM derslik.message_access('${ws}','${ayse.id}','${links.parent}','OWNER'))<>0
           OR derslik.read_messages('${ws}','${ayse.id}','${links.parent}','PORTAL')
          THEN RAISE EXCEPTION 'message_access'; END IF;
        END $$`),
        null,
      );

      // Mesajı olmayan kapalı yazışma listeden düşer ama açılabilir.
      await ok(
        `/v1/workspaces/${ws}/students/${ayse.id}/access/revoke`,
        { id: links.quiet, kind: "link" },
        { auth: tokenTeacher },
      );
      assert.equal(row(await listOwner(), links.quiet), undefined);
      const quietThread = await open(owner(`/${links.quiet}`), tokenTeacher);
      assert.equal(quietThread.thread.active, false);
      assert.equal(quietThread.thread.canSend, false);
      assert.deepEqual(quietThread.messages, []);
      await refused(
        owner(`/${links.quiet}`),
        403,
        "api.messageClosed",
        post(tokenTeacher),
      );

      // Davet yeniden kabul edilince aynı bağlantı, aynı geçmiş döner.
      const again = (
        await ok(
          `/v1/workspaces/${ws}/students/${ayse.id}/invitations`,
          {
            email: "ayse.mesaj@example.test",
            role: "STUDENT",
            permissions: ["lessons", "notes"],
          },
          { auth: tokenTeacher },
        )
      ).data;
      assert.equal(
        (
          await ok(
            "/v1/invitations/accept",
            { token: again.url.split("/").at(-1) },
            { auth: tokenPupil },
          )
        ).data.id,
        links.pupil,
      );
      const revived = await listPortal(ayse.id, tokenPupil);
      assert.deepEqual(
        revived.map((r) => [r.linkId, r.canSend]),
        [[links.pupil, true]],
      );
      assert.equal(
        (
          await open(
            portal(ayse.id, `/${links.pupil}?limit=100`),
            tokenPupil,
          )
        ).messages.length,
        history,
      );
      await send(portal(ayse.id, `/${links.pupil}`), "Geri döndüm", tokenPupil);
      assert.equal(row(await listOwner(), links.pupil).guardianReaders, 1);

      // Arşivlenen öğrenci: portal reddeder, öğretmen okur ama yazamaz.
      await admin.query(
        "UPDATE derslik.students SET active=false WHERE workspace_id=$1 AND id=$2",
        [ws, ayse.id],
      );
      try {
        await refused(portal(ayse.id), 403, "api.noStudentAccess", {
          auth: tokenParent,
        });
        await refused(
          portal(ayse.id, `/${links.parent}`),
          403,
          "api.noStudentAccess",
          post(tokenParent),
        );
        const archived = row(await listOwner(), links.parent);
        assert.equal(archived.active, false);
        assert.equal(archived.canSend, false);
        assert.ok(
          (await open(owner(`/${links.parent}`), tokenTeacher)).messages.length >
            0,
        );
        await refused(
          owner(`/${links.parent}`),
          403,
          "api.messageClosed",
          post(tokenTeacher),
        );
      } finally {
        await admin.query(
          "UPDATE derslik.students SET active=true WHERE workspace_id=$1 AND id=$2",
          [ws, ayse.id],
        );
      }
      await send(owner(`/${links.parent}`), "Tekrar açık", tokenTeacher);
    },
  );

  await t.test(
    "messaging: sending has its own per-account rate limit",
    async () => {
      const limited = await createApplication({
        ...config,
        RATE_LIMIT_MESSAGES_PER_MINUTE: 2,
      });
      await limited.listen(0, "127.0.0.1");
      const url = await limited.getUrl();
      const call = async (path, auth, body) => {
        const r = await fetch(url + path, {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${auth}`,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, body: await r.json() };
      };
      try {
        const path = owner(`/${links.kid}`);
        // Geçersiz gövde sayılmaz.
        assert.equal(
          (await call(path, tokenTeacher, { body: "" })).status,
          400,
        );
        const results = [];
        for (let i = 0; i < 3; i++)
          results.push(await call(path, tokenTeacher, { body: `Hızlı ${i}` }));
        assert.deepEqual(
          results.map((r) => r.status),
          [201, 201, 429],
        );
        assert.equal(
          results[2].body.error.message,
          text("api.messageRateLimit"),
        );
        // Sınır hesap başınadır; okuma sınırlanmaz.
        assert.equal(
          (
            await call(portal(mehmet.id, `/${links.kid}`), tokenKid, {
              body: "Ben de yazıyorum",
            })
          ).status,
          201,
        );
        assert.equal((await call(path, tokenTeacher)).status, 200);
      } finally {
        await limited.close();
      }
    },
  );
}

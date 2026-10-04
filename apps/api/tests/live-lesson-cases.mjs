import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MailService } from "../../../.api-build/apps/api/src/access/mail.js";

export async function liveLessonCases({ t, app, admin, request, ok, token }) {
  const teacher = randomUUID(),
    pupil = randomUUID(),
    guardian = randomUUID(),
    stranger = randomUUID();
  const teacherToken = await token(teacher),
    pupilToken = await token(pupil),
    guardianToken = await token(guardian),
    strangerToken = await token(stranger);
  let ws, student, lesson, secondStudent;
  const meeting = "https://meet.google.com/abc-defg-hij";
  const teacherPath = () =>
    `/v1/workspaces/${ws}/students/${student.id}/lessons/${lesson.id}/board`;
  const portalPath = () =>
    `/v1/portal/${ws}/${student.id}/lessons/${lesson.id}/board`;
  const commandPath = () => `/v1/workspaces/${ws}/commands`;
  const draw = (epoch = 0, id = randomUUID()) => ({
    action: "stroke.add",
    epoch,
    stroke: {
      id,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.8, y: 0.9 },
      ],
      color: "#2563eb",
      width: 4,
    },
  });
  const change = (path, body, auth = teacherToken, key) =>
    request(path, { method: "POST", body, auth, ...(key ? { key } : {}) });

  await t.test(
    "live lesson creates safe provider links and shares them in portal, calendar and reminders",
    async () => {
      ws = (
        await ok(
          "/v1/workspaces",
          { name: "Canlı ders öğretmeni" },
          { auth: teacherToken },
        )
      ).data.id;
      const createStudent = (name) =>
        ok(
          `/v1/workspaces/${ws}/students`,
          { name, grade: "", subject: "Matematik", phone: "", email: "" },
          { auth: teacherToken },
        );
      student = (await createStudent("Tahta öğrencisi")).data;
      secondStudent = (await createStudent("Başka öğrenci")).data;
      const pack = (
        await ok(
          `/v1/workspaces/${ws}/packages`,
          {
            studentId: student.id,
            name: "8 ders",
            granted: 8,
            priceMinor: "100000",
            expiresOn: null,
          },
          { auth: teacherToken },
        )
      ).data;
      const body = {
        studentId: student.id,
        packageId: pack.id,
        topic: "Ortak tahta",
        startsAt: new Date(Date.now() + 30 * 60000).toISOString(),
        duration: 60,
        location: "Çevrim içi",
        weeks: 1,
        meetingUrl: "https://MEET.google.com:443/abc-defg-hij",
      };
      for (const bad of [
        "javascript:alert(1)",
        "http://meet.google.com/abc-defg-hij",
        "https://meet.google.com.evil.test/abc",
        "https://meet.google.com@evil.test/abc",
        "https://localhost/abc",
        "https://zoom.us/",
        "https://meet.google.com/abc\nBAD",
      ]) {
        assert.equal(
          (
            await change(`/v1/workspaces/${ws}/sessions`, {
              ...body,
              meetingUrl: bad,
            })
          ).status,
          400,
          bad,
        );
      }
      lesson = (
        await ok(`/v1/workspaces/${ws}/sessions`, body, { auth: teacherToken })
      ).data.lessons[0];
      assert.equal(lesson.meetingUrl, meeting);
      for (const id of [pupil, guardian, stranger])
        await admin.query("INSERT INTO derslik.users(id) VALUES($1)", [id]);
      await admin.query(
        "INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES($1,$2,$3,'STUDENT',ARRAY['lessons']),($1,$2,$4,'GUARDIAN',ARRAY['lessons'])",
        [ws, student.id, pupil, guardian],
      );
      const snapshot = await ok(`/v1/workspaces/${ws}/snapshot`, undefined, {
        auth: teacherToken,
      });
      assert.equal(
        snapshot.lessons.find((item) => item.id === lesson.id).meeting_url,
        meeting,
      );
      const portal = await ok(`/v1/portal/${ws}/${student.id}`, undefined, {
        auth: pupilToken,
      });
      assert.equal(
        portal.lessons.find((item) => item.id === lesson.id).meeting_url,
        meeting,
      );
      const feed = (await ok("/v1/calendar", {}, { auth: pupilToken })).data
        .url;
      const feedToken = /\/([a-f0-9]{64})\.ics$/.exec(feed)[1];
      const ics = await request(`/v1/calendar/${feedToken}`, {
        auth: null,
        raw: true,
      });
      assert.equal(ics.status, 200);
      assert.ok(
        Buffer.from(ics.body).toString("utf8").includes(`URL:${meeting}\r\n`),
      );
      const claimed = await admin.query(
        "SELECT * FROM derslik.claim_lesson_reminders(60,100)",
      );
      assert.equal(
        claimed.rows.find((item) => item.lesson_id === lesson.id).meeting_url,
        meeting,
      );
      const mail = app.get(MailService),
        sent = [];
      const oldSend = mail.send;
      mail.send = async (message) => {
        sent.push(message);
        return true;
      };
      const oldConfigured = Object.getOwnPropertyDescriptor(mail, "configured");
      Object.defineProperty(mail, "configured", {
        configurable: true,
        value: true,
      });
      try {
        await mail.sendLessonReminder({
          to: "pupil@example.test",
          locale: "tr",
          role: "STUDENT",
          studentName: student.name,
          teacherName: "Öğretmen",
          startsAt: new Date(body.startsAt),
          topic: body.topic,
          location: body.location,
          url: "https://derslik.example",
          meetingUrl: meeting,
        });
        assert.ok(sent[0].text.includes(meeting));
        assert.ok(sent[0].html.includes(`href="${meeting}"`));
      } finally {
        mail.send = oldSend;
        if (oldConfigured)
          Object.defineProperty(mail, "configured", oldConfigured);
        else delete mail.configured;
      }
    },
  );

  await t.test(
    "meeting updates enforce optimistic version, idempotency and teacher access",
    async () => {
      const key = randomUUID(),
        body = {
          action: "lesson.meeting.update",
          id: lesson.id,
          version: lesson.version,
          meetingUrl: "https://meet.jit.si/DerslikTest",
        };
      const updated = await change(commandPath(), body, teacherToken, key);
      assert.equal(updated.status, 201);
      assert.equal(updated.body.data.meetingUrl, body.meetingUrl);
      assert.equal(updated.body.data.version, lesson.version + 1);
      assert.equal(
        (await change(commandPath(), body, teacherToken, key)).body.replayed,
        true,
      );
      assert.equal((await change(commandPath(), body)).status, 409);
      assert.equal(
        (
          await change(
            commandPath(),
            { ...body, meetingUrl: null },
            teacherToken,
            key,
          )
        ).status,
        409,
      );
      assert.equal((await change(commandPath(), body, pupilToken)).status, 403);
      lesson = updated.body.data;
      const audit = await admin.query(
        "SELECT metadata FROM derslik.audit_events WHERE workspace_id=$1 AND resource_id=$2 AND action='lesson.meeting.update'",
        [ws, lesson.id],
      );
      assert.deepEqual(audit.rows[0].metadata, { hasMeetingUrl: true });
      const cleared = await change(commandPath(), {
        action: "lesson.meeting.update",
        id: lesson.id,
        version: lesson.version,
        meetingUrl: null,
      });
      assert.equal(cleared.status, 201);
      assert.equal(cleared.body.data.meetingUrl, null);
      lesson = cleared.body.data;
      const learning = await ok(
        `/v1/workspaces/${ws}/students/${student.id}/learning`,
        undefined,
        { auth: teacherToken },
      );
      assert.equal(
        learning.lessons.find((item) => item.id === lesson.id).meeting_url,
        null,
      );
    },
  );

  await t.test(
    "board authenticates every reader and grants teacher and linked student editing only",
    async () => {
      assert.equal((await request(teacherPath(), { auth: null })).status, 401);
      assert.equal(
        (await request(teacherPath(), { auth: strangerToken })).status,
        403,
      );
      assert.equal(
        (await request(portalPath(), { auth: strangerToken })).status,
        403,
      );
      const teacherBoard = (
        await ok(teacherPath(), undefined, { auth: teacherToken })
      ).data;
      assert.equal(teacherBoard.viewerId, teacher);
      assert.equal(teacherBoard.canClear, true);
      assert.deepEqual(teacherBoard.strokes, []);
      const studentBoard = (
        await ok(portalPath(), undefined, { auth: pupilToken })
      ).data;
      assert.equal(studentBoard.canEdit, true);
      assert.equal(studentBoard.canClear, false);
      const guardianBoard = (
        await ok(portalPath(), undefined, { auth: guardianToken })
      ).data;
      assert.equal(guardianBoard.canEdit, false);
      assert.equal(
        (await change(portalPath(), draw(), guardianToken)).status,
        403,
      );
      assert.equal(
        (await change(teacherPath(), { action: "delete.everything", epoch: 0 }))
          .status,
        400,
      );
      assert.equal(
        (
          await request(
            `/v1/portal/${ws}/${secondStudent.id}/lessons/${lesson.id}/board`,
            { auth: pupilToken },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/v1/workspaces/${ws}/students/${secondStudent.id}/lessons/${lesson.id}/board`,
            { auth: teacherToken },
          )
        ).status,
        404,
      );
      const unchanged = await ok(`${portalPath()}?revision=0`, undefined, {
        auth: guardianToken,
      });
      assert.equal(unchanged.data, null);
      assert.deepEqual(unchanged.access, { canEdit: false, canClear: false });
      assert.equal(
        (await request(`${portalPath()}?revision=-1`, { auth: pupilToken }))
          .status,
        400,
      );
    },
  );

  await t.test(
    "board appends preserve each author, reject invalid data and keep command history small",
    async () => {
      const first = draw(),
        key = randomUUID();
      const added = await change(teacherPath(), first, teacherToken, key);
      assert.equal(added.status, 201);
      assert.equal(added.body.data.revision, 1);
      assert.equal(added.body.data.strokes[0].authorId, teacher);
      const replay = await change(teacherPath(), first, teacherToken, key);
      assert.equal(replay.body.replayed, true);
      assert.equal(replay.body.data.revision, 1);
      assert.equal((await change(teacherPath(), first)).body.data.revision, 1);
      assert.equal(
        (
          await change(teacherPath(), {
            ...first,
            stroke: { ...first.stroke, color: "#dc2626" },
          })
        ).status,
        409,
      );
      assert.equal((await change(portalPath(), first, pupilToken)).status, 409);
      const second = draw();
      const studentAdded = await change(portalPath(), second, pupilToken);
      assert.equal(studentAdded.status, 201);
      assert.equal(studentAdded.body.data.strokes.length, 2);
      assert.ok(
        studentAdded.body.data.strokes.some(
          (stroke) => stroke.authorId === pupil,
        ),
      );
      const latest = await ok(`${portalPath()}?revision=1`, undefined, {
        auth: pupilToken,
      });
      assert.equal(latest.data.revision, 2);
      assert.equal(
        (
          await ok(`${portalPath()}?revision=2`, undefined, {
            auth: pupilToken,
          })
        ).data,
        null,
      );
      for (const stroke of [
        { ...draw().stroke, points: [{ x: -1, y: 0 }] },
        {
          ...draw().stroke,
          points: Array.from({ length: 129 }, () => ({ x: 0, y: 0 })),
        },
        { ...draw().stroke, color: "url(javascript:evil)" },
        { ...draw().stroke, width: 100 },
        { ...draw().stroke, authorId: stranger },
      ]) {
        assert.equal(
          (
            await change(teacherPath(), {
              action: "stroke.add",
              epoch: 0,
              stroke,
            })
          ).status,
          400,
        );
      }
      const receipt = await admin.query(
        "SELECT response FROM derslik.api_commands WHERE workspace_id=$1 AND actor_id=$2 AND key=$3",
        [ws, teacher, key],
      );
      assert.deepEqual(receipt.rows[0].response.data, {
        id: lesson.id,
        epoch: 0,
        revision: 1,
      });
    },
  );

  await t.test(
    "undo protects the other author and clear rejects stale client strokes",
    async () => {
      const before = (await ok(portalPath(), undefined, { auth: pupilToken }))
        .data;
      const teacherStroke = before.strokes.find(
          (stroke) => stroke.authorId === teacher,
        ),
        ownStroke = before.strokes.find((stroke) => stroke.authorId === pupil);
      assert.equal(
        (
          await change(
            portalPath(),
            { action: "stroke.remove", epoch: 0, id: teacherStroke.id },
            pupilToken,
          )
        ).status,
        403,
      );
      const removed = await change(
        portalPath(),
        { action: "stroke.remove", epoch: 0, id: ownStroke.id },
        pupilToken,
      );
      assert.equal(removed.body.data.strokes.length, 1);
      assert.equal(
        (
          await change(
            portalPath(),
            { action: "stroke.remove", epoch: 0, id: ownStroke.id },
            pupilToken,
          )
        ).body.data.revision,
        removed.body.data.revision,
      );
      assert.equal(
        (await change(portalPath(), draw(0, ownStroke.id), pupilToken)).body
          .data.strokes.length,
        1,
      );
      assert.equal(
        (
          await change(
            portalPath(),
            { action: "board.clear", epoch: 0 },
            pupilToken,
          )
        ).status,
        403,
      );
      const cleared = await change(teacherPath(), {
        action: "board.clear",
        epoch: 0,
      });
      assert.equal(cleared.status, 201);
      assert.equal(cleared.body.data.epoch, 1);
      assert.deepEqual(cleared.body.data.strokes, []);
      assert.equal(
        (await change(portalPath(), draw(0), pupilToken)).status,
        409,
      );
      assert.equal(
        (await change(portalPath(), draw(1), pupilToken)).body.data.strokes
          .length,
        1,
      );
    },
  );

  await t.test(
    "board storage is bounded and completed or cancelled lessons reject writing",
    async () => {
      await admin.query(
        "INSERT INTO derslik.lesson_board_strokes(workspace_id,student_id,lesson_id,epoch,id,author_id,points,color,width) SELECT $1,$2,$3,1,gen_random_uuid(),$4,'[{\"x\":0,\"y\":0}]'::jsonb,'#172554',2 FROM generate_series(1,499)",
        [ws, student.id, lesson.id, teacher],
      );
      assert.equal((await change(teacherPath(), draw(1))).status, 409);
      await change(teacherPath(), { action: "board.clear", epoch: 1 });
      assert.equal((await change(teacherPath(), draw(2))).status, 201);
      const completed = await change(commandPath(), {
        action: "lesson.complete",
        id: lesson.id,
        version: lesson.version,
      });
      assert.equal(completed.status, 201);
      lesson = completed.body.data;
      const completedState = (
        await ok(portalPath(), undefined, { auth: pupilToken })
      ).data;
      assert.equal(completedState.canEdit, false);
      const noChange = await ok(
        `${portalPath()}?revision=${completedState.revision}`,
        undefined,
        { auth: pupilToken },
      );
      assert.equal(noChange.data, null);
      assert.equal(noChange.access.canEdit, false);
      assert.equal((await change(teacherPath(), draw(2))).status, 403);
      const reversed = await change(commandPath(), {
        action: "lesson.reverse",
        id: lesson.id,
        version: lesson.version,
      });
      lesson = reversed.body.data;
      assert.equal(
        (
          await change(commandPath(), {
            action: "lesson.cancel",
            id: lesson.id,
            version: lesson.version,
          })
        ).status,
        201,
      );
      assert.equal(
        (await request(portalPath(), { auth: pupilToken })).status,
        404,
      );
      assert.equal((await change(teacherPath(), draw(2))).status, 404);
    },
  );

  await t.test(
    "database board RLS hides every stroke from another actor and prevents guardian writes",
    async () => {
      await admin.query(
        "UPDATE derslik.lessons SET status='SCHEDULED' WHERE id=$1",
        [lesson.id],
      );
      const db = app.get(
        (
          await import("../../../.api-build/apps/api/src/db/database.service.js")
        ).DatabaseService,
      );
      await db.transaction({ id: teacher }, ws, async (tx) => {
        assert.equal(
          (await tx.query("SELECT * FROM derslik.lesson_board_strokes"))
            .rowCount,
          1,
        );
      });
      await db.transaction({ id: stranger }, null, async (tx) => {
        await tx.query("SELECT set_config('app.workspace_id',$1,true)", [ws]);
        assert.equal(
          (await tx.query("SELECT * FROM derslik.lesson_board_strokes"))
            .rowCount,
          0,
        );
        assert.equal(
          (await tx.query("SELECT * FROM derslik.lesson_boards")).rowCount,
          0,
        );
      });
      await assert.rejects(
        db.portalTransaction(
          { id: guardian },
          ws,
          student.id,
          "lessons",
          (tx) =>
            tx.query(
              "UPDATE derslik.lesson_boards SET revision=revision+1 WHERE workspace_id=$1 AND lesson_id=$2 RETURNING *",
              [ws, lesson.id],
            ),
          true,
        ),
        /Forbidden|access/i,
      );
      await db.portalTransaction(
        { id: guardian },
        ws,
        student.id,
        "lessons",
        async (tx) => {
          assert.equal(
            (
              await tx.query(
                "UPDATE derslik.lesson_boards SET revision=revision+1 WHERE workspace_id=$1 AND lesson_id=$2 RETURNING *",
                [ws, lesson.id],
              )
            ).rowCount,
            0,
          );
        },
      );
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [ws, pupil],
      );
      assert.equal(
        (await request(portalPath(), { auth: pupilToken })).status,
        403,
      );
    },
  );
}

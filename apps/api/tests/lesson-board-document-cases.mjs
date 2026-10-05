import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MediaProviders } from "../../../.api-build/apps/api/src/media/providers.js";
import { DatabaseService } from "../../../.api-build/apps/api/src/db/database.service.js";
import { attachBoardDocument } from "../../../.api-build/apps/api/src/lessons/lesson-board-documents.js";

export async function lessonBoardDocumentCases({
  t,
  app,
  admin,
  request,
  ok,
  token,
  ws,
  student,
  secondStudent,
  lesson,
  teacher,
  teacherToken,
  pupilToken,
  guardianToken,
  strangerToken,
}) {
  let pdf, room;
  const teacherPath = () =>
    `/v1/workspaces/${ws}/students/${student.id}/lessons/${room.id}/board`;
  const portalPath = () =>
    `/v1/portal/${ws}/${student.id}/lessons/${room.id}/board`;
  const mediaPath = `/v1/media/${ws}/${student.id}/files`;
  const change = (body, auth = teacherToken, key) =>
    request(auth === teacherToken ? teacherPath() : portalPath(), {
      method: "POST",
      body,
      auth,
      ...(key ? { key } : {}),
    });
  const draw = (documentId, page, extra = {}) => ({
    action: "stroke.add",
    epoch: 0,
    stroke: {
      id: randomUUID(),
      color: "#2563eb",
      width: 4,
      documentId,
      page,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.8, y: 0.9 },
      ],
      ...extra,
    },
  });
  const seed = async (overrides = {}) => {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO derslik.materials(id,workspace_id,student_id,user_id,purpose,name,mime_type,size_bytes,object_key,status) VALUES($1,$2,$3,$4,'RESOURCE',$5,$6,12,$7,$8)",
      [
        id,
        ws,
        overrides.student ?? student.id,
        teacher,
        `${id}.pdf`,
        overrides.mime ?? "application/pdf",
        `${ws}/${overrides.student ?? student.id}/${id}`,
        overrides.status ?? "READY",
      ],
    );
    return id;
  };

  await t.test(
    "PDF pruning captures one candidate set when another source is deleted between statements",
    async () => {
      const deleted = randomUUID(),
        concurrent = randomUUID(),
        incoming = randomUUID();
      const candidates = new Set([deleted]),
        references = new Set([deleted, concurrent]),
        strokes = new Set([deleted, concurrent]);
      const tx = {
        query(sql, values) {
          if (sql.startsWith("SELECT id FROM derslik.materials"))
            return { rows: [{ id: incoming }] };
          if (sql.startsWith("SELECT d.material_id"))
            return {
              rows: [...candidates].map((material_id) => ({ material_id })),
            };
          if (sql.startsWith("DELETE FROM derslik.lesson_board_strokes")) {
            for (const id of values[3] ?? candidates) strokes.delete(id);
            candidates.add(concurrent);
            return { rowCount: 1 };
          }
          if (sql.startsWith("DELETE FROM derslik.lesson_board_documents")) {
            for (const id of values[3] ?? candidates) {
              if (strokes.has(id)) throw new Error("lesson_stroke_document_fk");
              references.delete(id);
            }
            return { rowCount: 1 };
          }
          if (sql.startsWith("SELECT page_count")) return { rows: [] };
          if (sql.startsWith("SELECT count(*)"))
            return { rows: [{ n: references.size }] };
          if (sql.startsWith("INSERT INTO derslik.lesson_board_documents")) {
            references.add(values[3]);
            return { rowCount: 1 };
          }
          throw new Error("Unexpected query");
        },
      };
      const row = { epoch: 0, revision: 0, document_id: null, page: 0 };
      assert.equal(
        await attachBoardDocument(
          tx,
          { ws, student: student.id, lesson: lesson.id },
          row,
          incoming,
          1,
        ),
        true,
      );
      assert.deepEqual([...references], [concurrent, incoming]);
      assert.deepEqual([...strokes], [concurrent]);
    },
  );

  await t.test(
    "lesson PDFs use verified private uploads, teacher attachment and lessons-only reader access",
    async () => {
      room = (
        await ok(
          `/v1/workspaces/${ws}/sessions`,
          {
            studentId: student.id,
            packageId: lesson.packageId,
            topic: "PDF üzerinde çalışma",
            startsAt: new Date(Date.now() + 180 * 60000).toISOString(),
            duration: 60,
            location: "Çevrim içi",
            weeks: 1,
          },
          { auth: teacherToken },
        )
      ).data.lessons[0];
      const providers = app.get(MediaProviders);
      const originalInfo = providers.fileInfo,
        originalSignature = providers.fileSignature,
        originalDownload = providers.downloadFileUrl;
      providers.fileInfo = async () => ({
        size: 12,
        content_type: "application/pdf",
      });
      providers.fileSignature = async () => Buffer.from("not a PDF");
      try {
        const reservation = await request(mediaPath, {
          method: "POST",
          auth: teacherToken,
          body: {
            purpose: "RESOURCE",
            name: "Kesirler.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12,
          },
        });
        assert.equal(reservation.status, 201);
        pdf = reservation.body.data.id;
        assert.equal(
          (
            await change({
              action: "document.add",
              epoch: 0,
              id: pdf,
              pageCount: 3,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`${mediaPath}/${pdf}/finish`, {
              method: "POST",
              auth: teacherToken,
            })
          ).status,
          400,
        );
        providers.fileSignature = async () => Buffer.from("%PDF-1.7\n");
        assert.equal(
          (
            await request(`${mediaPath}/${pdf}/finish`, {
              method: "POST",
              auth: teacherToken,
            })
          ).status,
          201,
        );
        const body = {
            action: "document.add",
            epoch: 0,
            id: pdf,
            pageCount: 3,
          },
          key = randomUUID();
        const attached = await change(body, teacherToken, key);
        assert.equal(attached.status, 201);
        assert.equal(attached.body.data.documentId, pdf);
        assert.equal(attached.body.data.page, 1);
        assert.deepEqual(attached.body.data.documents, [
          { id: pdf, name: "Kesirler.pdf", pageCount: 3 },
        ]);
        assert.equal(
          (await change(body, teacherToken, key)).body.replayed,
          true,
        );
        assert.equal(
          (await change({ ...body, pageCount: 2 }, teacherToken, key)).status,
          409,
        );
        assert.equal((await change(body, pupilToken)).status, 403);
        assert.equal((await change(body, guardianToken)).status, 403);
        const board = (await ok(portalPath(), undefined, { auth: pupilToken }))
          .data;
        assert.equal(board.documents[0].name, "Kesirler.pdf");
        assert.equal(
          (await request(`${mediaPath}/${pdf}/download`, { auth: pupilToken }))
            .status,
          403,
        );
        providers.downloadFileUrl = async (objectKey, inline) => {
          assert.equal(inline, true);
          assert.equal(objectKey, `${ws}/${student.id}/${pdf}`);
          return "https://storage.example.test/signed.pdf?token=short-lived";
        };
        const documentPath = `${portalPath()}/documents/${pdf}`;
        const signed = await ok(documentPath, undefined, { auth: pupilToken });
        assert.equal(signed.data.expiresIn, 120);
        assert.equal(signed.data.name, "Kesirler.pdf");
        assert.equal("objectKey" in signed.data, false);
        assert.equal((await request(documentPath, { auth: null })).status, 401);
        assert.equal(
          (await request(documentPath, { auth: strangerToken })).status,
          403,
        );
      } finally {
        providers.fileInfo = originalInfo;
        providers.fileSignature = originalSignature;
        providers.downloadFileUrl = originalDownload;
      }
    },
  );

  await t.test(
    "PDF strokes, erasing, restoring and page clearing preserve separate page and whiteboard work",
    async () => {
      const first = draw(pdf, 1, { tool: "line" });
      assert.equal((await change(first)).status, 201);
      const own = draw(pdf, 1, {
        tool: "note",
        points: [{ x: 0.3, y: 0.4 }],
        text: "Payda eşitle",
      });
      assert.equal((await change(own, pupilToken)).status, 201);
      assert.equal(
        (
          await change(
            {
              action: "stroke.remove",
              epoch: 0,
              id: first.stroke.id,
              documentId: pdf,
              page: 1,
            },
            pupilToken,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await change(
            {
              action: "stroke.remove",
              epoch: 0,
              id: own.stroke.id,
              documentId: pdf,
              page: 1,
            },
            pupilToken,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await change(
            {
              action: "stroke.restore",
              epoch: 0,
              id: own.stroke.id,
              documentId: pdf,
              page: 1,
            },
            pupilToken,
          )
        ).body.data.strokes.length,
        2,
      );
      assert.equal(
        (
          await change(
            { action: "document.select", epoch: 0, documentId: pdf, page: 2 },
            pupilToken,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await change({
            action: "document.select",
            epoch: 0,
            documentId: pdf,
            page: 4,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await change({
            action: "document.select",
            epoch: 0,
            documentId: pdf,
            page: 2,
          })
        ).status,
        201,
      );
      assert.equal((await change(draw(pdf, 1), pupilToken)).status, 409);
      assert.equal(
        (
          await change(
            {
              action: "stroke.restore",
              epoch: 0,
              id: own.stroke.id,
              documentId: pdf,
              page: 1,
            },
            pupilToken,
          )
        ).status,
        409,
      );
      const second = draw(pdf, 2, { tool: "highlighter" });
      assert.equal((await change(second)).status, 201);
      assert.equal(
        (
          await change({
            action: "document.select",
            epoch: 0,
            documentId: null,
            page: 0,
          })
        ).status,
        201,
      );
      const whiteboard = draw(null, 0);
      assert.equal((await change(whiteboard, pupilToken)).status, 201);
      await change({
        action: "document.select",
        epoch: 0,
        documentId: pdf,
        page: 2,
      });
      const cleared = await change({
        action: "page.clear",
        epoch: 0,
        documentId: pdf,
        page: 2,
      });
      assert.equal(cleared.body.data.epoch, 1);
      assert.equal(cleared.body.data.documents.length, 1);
      assert.equal(cleared.body.data.strokes.length, 3);
      assert.ok(
        cleared.body.data.strokes.some((stroke) => stroke.documentId === null),
      );
      assert.ok(
        cleared.body.data.strokes.some(
          (stroke) => stroke.text === "Payda eşitle",
        ),
      );
      assert.equal(
        (
          await change({
            action: "stroke.restore",
            epoch: 0,
            id: second.stroke.id,
            documentId: pdf,
            page: 2,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await change({
            action: "stroke.restore",
            epoch: 1,
            id: second.stroke.id,
            documentId: pdf,
            page: 2,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await change(
            {
              action: "stroke.restore",
              epoch: 1,
              id: own.stroke.id,
              documentId: pdf,
              page: 2,
            },
            pupilToken,
          )
        ).status,
        409,
      );
      const allCleared = await change({ action: "board.clear", epoch: 1 });
      assert.equal(allCleared.body.data.strokes.length, 0);
      assert.equal(allCleared.body.data.documents.length, 1);
    },
  );

  await t.test(
    "PDF document scope, bounds, deletion and revoked reader access hold in API and RLS",
    async () => {
      for (const id of [
        await seed({ student: secondStudent.id }),
        await seed({ mime: "image/png" }),
        await seed({ status: "PENDING" }),
      ])
        assert.equal(
          (await change({ action: "document.add", epoch: 2, id, pageCount: 1 }))
            .status,
          409,
        );
      for (const pageCount of [0, 101])
        assert.equal(
          (
            await change({
              action: "document.add",
              epoch: 2,
              id: pdf,
              pageCount,
            })
          ).status,
          400,
        );
      const survivors = [];
      for (let count = 0; count < 4; count++) {
        const id = await seed();
        survivors.push(id);
        assert.equal(
          (
            await change({
              action: "document.add",
              epoch: 2,
              id,
              pageCount: 1,
            })
          ).status,
          201,
        );
      }
      const replacement = await seed();
      assert.equal(
        (
          await change({
            action: "document.add",
            epoch: 2,
            id: replacement,
            pageCount: 1,
          })
        ).status,
        409,
      );
      const keep = draw(survivors.at(-1), 1, {
        tool: "note",
        points: [{ x: 0.2, y: 0.3 }],
        text: "Korunan belge notu",
      });
      keep.epoch = 2;
      assert.equal((await change(keep)).status, 201);
      await change({
        action: "document.select",
        epoch: 2,
        documentId: null,
        page: 0,
      });
      const whiteboard = draw(null, 0);
      whiteboard.epoch = 2;
      assert.equal((await change(whiteboard, pupilToken)).status, 201);
      await change({
        action: "document.select",
        epoch: 2,
        documentId: pdf,
        page: 3,
      });
      const deletedNote = draw(pdf, 3, {
        tool: "note",
        points: [{ x: 0.4, y: 0.5 }],
        text: "Silinen belge notu",
      });
      deletedNote.epoch = 2;
      assert.equal((await change(deletedNote)).status, 201);
      const before = (
        await ok(teacherPath(), undefined, { auth: teacherToken })
      ).data;
      await admin.query(
        "UPDATE derslik.materials SET delete_requested=true WHERE id=$1",
        [pdf],
      );
      const after = await ok(
        `${portalPath()}?revision=${before.revision}`,
        undefined,
        { auth: pupilToken },
      );
      assert.equal(after.data.documentId, null);
      assert.equal(after.data.page, 0);
      assert.equal(after.data.revision, before.revision + 1);
      assert.equal(
        after.data.documents.some((document) => document.id === pdf),
        false,
      );
      assert.equal(
        (
          await request(`${portalPath()}/documents/${pdf}`, {
            auth: pupilToken,
          })
        ).status,
        404,
      );
      const replaced = await change({
        action: "document.add",
        epoch: 2,
        id: replacement,
        pageCount: 1,
      });
      assert.equal(replaced.status, 201);
      assert.equal(replaced.body.data.revision, after.data.revision + 1);
      assert.equal(replaced.body.data.documents.length, 5);
      assert.equal(replaced.body.data.strokes.length, 2);
      assert.ok(
        replaced.body.data.strokes.some(
          (stroke) =>
            stroke.id === keep.stroke.id &&
            stroke.text === "Korunan belge notu",
        ),
      );
      assert.ok(
        replaced.body.data.strokes.some(
          (stroke) => stroke.id === whiteboard.stroke.id,
        ),
      );
      assert.equal(
        replaced.body.data.strokes.some((stroke) => stroke.documentId === pdf),
        false,
      );
      const db = app.get(DatabaseService);
      await db.transaction({ id: teacher }, ws, async (tx) => {
        assert.equal(
          (
            await tx.query(
              "SELECT * FROM derslik.lesson_board_documents WHERE lesson_id=$1",
              [room.id],
            )
          ).rowCount,
          5,
        );
      });
      const reader = randomUUID(),
        readerToken = await token(reader);
      await admin.query("INSERT INTO derslik.users(id) VALUES($1)", [reader]);
      await admin.query(
        "INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES($1,$2,$3,'GUARDIAN',ARRAY['lessons'])",
        [ws, student.id, reader],
      );
      const valid = after.data.documents[0].id;
      assert.equal(
        (
          await request(`${portalPath()}/documents/${valid}`, {
            auth: readerToken,
          })
        ).status,
        200,
      );
      await admin.query(
        "UPDATE derslik.portal_links SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [ws, reader],
      );
      assert.equal(
        (
          await request(`${portalPath()}/documents/${valid}`, {
            auth: readerToken,
          })
        ).status,
        403,
      );
      await db.transaction({ id: reader }, null, async (tx) => {
        await tx.query("SELECT set_config('app.workspace_id',$1,true)", [ws]);
        assert.equal(
          (await tx.query("SELECT * FROM derslik.lesson_board_documents"))
            .rowCount,
          0,
        );
        assert.equal(
          (
            await tx.query("SELECT * FROM derslik.materials WHERE id=$1", [
              valid,
            ])
          ).rowCount,
          0,
        );
      });
      assert.equal(
        (
          await change(
            { action: "page.clear", epoch: 2, documentId: null, page: 0 },
            guardianToken,
          )
        ).status,
        403,
      );
    },
  );

  await t.test(
    "deleting the PDF that filled the drawing limit allows student whiteboard work and keeps other page notes",
    async () => {
      const initial = (
        await ok(teacherPath(), undefined, { auth: teacherToken })
      ).data;
      assert.equal(initial.strokes.length, 2);
      await admin.query(
        `INSERT INTO derslik.lesson_board_strokes(workspace_id,student_id,lesson_id,epoch,id,author_id,points,color,width,document_id,page)
       SELECT $1,$2,$3,$4,gen_random_uuid(),$5,'[{"x":0,"y":0}]'::jsonb,'#172554',2,$6,1 FROM generate_series(1,498)`,
        [ws, student.id, room.id, initial.epoch, teacher, initial.documentId],
      );
      const full = draw(initial.documentId, 1);
      full.epoch = initial.epoch;
      assert.equal((await change(full, pupilToken)).status, 409);
      await admin.query(
        "UPDATE derslik.materials SET delete_requested=true WHERE id=$1",
        [initial.documentId],
      );
      const after = (await ok(portalPath(), undefined, { auth: pupilToken }))
        .data;
      assert.equal(after.documentId, null);
      assert.equal(after.strokes.length, 2);
      assert.ok(
        after.strokes.some((stroke) => stroke.text === "Korunan belge notu"),
      );
      assert.ok(after.strokes.some((stroke) => stroke.documentId === null));
      const whiteboard = draw(null, 0);
      whiteboard.epoch = after.epoch;
      const drawn = await change(whiteboard, pupilToken);
      assert.equal(drawn.status, 201);
      assert.equal(drawn.body.data.strokes.length, 3);
      const replaced = await change({
        action: "document.add",
        epoch: after.epoch,
        id: await seed(),
        pageCount: 1,
      });
      assert.equal(replaced.status, 201);
      assert.equal(replaced.body.data.strokes.length, 3);
      assert.ok(
        replaced.body.data.strokes.some(
          (stroke) => stroke.text === "Korunan belge notu",
        ),
      );
      assert.ok(
        replaced.body.data.strokes.some(
          (stroke) => stroke.id === whiteboard.stroke.id,
        ),
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM derslik.lesson_board_strokes WHERE lesson_id=$1",
            [room.id],
          )
        ).rows[0].n,
        3,
      );
    },
  );
}

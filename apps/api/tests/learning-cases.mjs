import { BillingProvider } from "../../../.api-build/apps/api/src/subscriptions/subscription.service.js";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { MediaProviders } from "../../../.api-build/apps/api/src/media/providers.js";
export async function learningCases({
  t,
  app,
  config,
  admin,
  request,
  ok,
  ws,
  wsB,
  student,
  pack,
  lesson,
  actorA,
  actorB,
  actorStudent,
  tokenA,
  tokenB,
  tokenStudent,
  token,
  verifiedUsers,
  sessionBody,
}) {
  const guardian = randomUUID(),
    tokenGuardian = await token(guardian),
    base = `/v1/workspaces/${ws}/students/${student.id}`,
    portal = `/v1/portal/${ws}/${student.id}`,
    media = `/v1/media/${ws}/${student.id}`;
  verifiedUsers.set(`Bearer ${tokenStudent}`, {
    id: actorStudent,
    email: "student@example.test",
    email_confirmed_at: new Date().toISOString(),
  });
  verifiedUsers.set(`Bearer ${tokenGuardian}`, {
    id: guardian,
    email: "guardian@example.test",
    email_confirmed_at: new Date().toISOString(),
  });
  verifiedUsers.set(`Bearer ${tokenB}`, {
    id: actorB,
    email: "wrong@example.test",
    email_confirmed_at: new Date().toISOString(),
  });
  let assignment, submission, studentInvite, guardianInvite, video, providerUid;
  const providers = app.get(MediaProviders),
    remoteVideos = new Map(),
    fileObjects = new Map();
  let reservations = 0,
    deleted = 0;
  providers.stream = async (path, init = {}) => {
    if (path === "?direct_user=true") {
      assert.match(init.headers["Upload-Metadata"], /requiresignedurls/);
      assert.match(init.headers["Upload-Metadata"], /maxDurationSeconds/);
      const uid = randomUUID().replaceAll("-", "");
      reservations++;
      remoteVideos.set(uid, {
        uid,
        readyToStream: false,
        requireSignedURLs: true,
        status: { state: "inprogress" },
      });
      return new Response(null, {
        status: 201,
        headers: {
          location: `https://upload.videodelivery.net/tus/${uid}`,
          "stream-media-id": uid,
        },
      });
    }
    const uid = path.split("/")[1];
    if (init.method === "DELETE") {
      deleted++;
      remoteVideos.delete(uid);
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/token")) {
      assert.ok(JSON.parse(init.body).exp - Date.now() / 1000 < 301);
      return Response.json({ result: { token: "test.signed.token" } });
    }
    return Response.json({ result: remoteVideos.get(uid) });
  };
  providers.uploadFileUrl = async (key) =>
    `https://storage.example.test/${key}?token=test`;
  providers.downloadFileUrl = async (key) =>
    `https://storage.example.test/${key}?token=download`;
  providers.fileInfo = async (key) => fileObjects.get(key)?.info || { size: 0 };
  providers.fileSignature = async (key) =>
    fileObjects.get(key)?.bytes || Buffer.alloc(0);
  providers.deleteFile = async (key) => {
    fileObjects.delete(key);
  };
  await t.test(
    "workspace snapshot connects the shared web/mobile contract",
    async () => {
      const data = await ok(`/v1/workspaces/${ws}/snapshot`);
      assert.equal(data.students.find((s) => s.id === student.id).active, 1);
      assert.equal(typeof data.packages[0].price_minor, "string");
      assert.ok(data.notes.some((n) => n.body.includes("Yalnızca")));
      assert.equal(
        (await request(`/v1/workspaces/${ws}/snapshot`, { auth: tokenStudent }))
          .status,
        403,
      );
      const command = {
          action: "student.create",
          name: "Shared client",
          grade: "8",
          subject: "Fen",
          phone: "",
          email: "",
        },
        key = randomUUID();
      const first = await ok(`/v1/workspaces/${ws}/commands`, command, { key });
      const replay = await ok(`/v1/workspaces/${ws}/commands`, command, {
        key,
      });
      assert.equal(first.data.id, replay.data.id);
    },
  );
  await t.test(
    "invitation requires bound verified email; portal access is explicit and single use",
    async () => {
      const permissions = ["lessons", "assignments", "videos", "notes"];
      studentInvite = (
        await ok(base + "/invitations", {
          email: "student@example.test",
          role: "STUDENT",
          permissions,
        })
      ).data;
      guardianInvite = (
        await ok(base + "/invitations", {
          email: "guardian@example.test",
          role: "GUARDIAN",
          permissions,
        })
      ).data;
      const acceptBody = { token: studentInvite.url.split("/").at(-1) };
      assert.equal((await request(portal, { auth: tokenStudent })).status, 403);
      assert.equal(
        (
          await request("/v1/invitations/accept", {
            method: "POST",
            body: acceptBody,
            auth: tokenB,
          })
        ).status,
        409,
      );
      await ok("/v1/invitations/accept", acceptBody, { auth: tokenStudent });
      assert.equal(
        (
          await request("/v1/invitations/accept", {
            method: "POST",
            body: acceptBody,
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      await ok(
        "/v1/invitations/accept",
        { token: guardianInvite.url.split("/").at(-1) },
        { auth: tokenGuardian },
      );
      const accesses = (
        await ok("/v1/access", undefined, { auth: tokenStudent })
      ).data;
      assert.ok(
        accesses.some(
          (a) => a.studentId === student.id && a.role === "STUDENT",
        ),
      );
      const data = await ok(portal, undefined, { auth: tokenGuardian });
      assert.equal(data.student.id, student.id);
      assert.deepEqual(data.packages, []);
      assert.deepEqual(data.payments, []);
      assert.ok(!JSON.stringify(data).includes("Yalnızca öğretmenin"));
      assert.equal(
        (await request(base + "/learning", { auth: tokenGuardian })).status,
        403,
      );
      assert.equal(
        (
          await request(`/v1/portal/${wsB}/${student.id}`, {
            auth: tokenStudent,
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "assignment submission is student-only, versioned, reviewed and notified",
    async () => {
      assignment = (
        await ok(base + "/learning", {
          action: "assignment.create",
          title: "Denklem ödevi",
          instructions: "İlk beş soruyu çözün.",
          dueOn: "2026-09-20",
        })
      ).data;
      assert.ok(
        (await ok(portal, undefined, { auth: tokenStudent })).assignments.some(
          (a) => a.id === assignment.id,
        ),
      );
      const command = {
          action: "assignment.submit",
          assignmentId: assignment.id,
          body: "Çözümlerim hazır.",
          version: 0,
        },
        key = randomUUID();
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            body: command,
            auth: tokenGuardian,
          })
        ).status,
        403,
      );
      submission = (
        await ok(portal + "/actions", command, { auth: tokenStudent, key })
      ).data;
      assert.equal(
        (await ok(portal + "/actions", command, { auth: tokenStudent, key }))
          .replayed,
        true,
      );
      await ok(base + "/learning", {
        action: "assignment.review",
        submissionId: submission.id,
        feedback: "Üçüncü soruyu birlikte inceleyelim.",
        version: 0,
      });
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            body: command,
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      assert.ok(
        (
          await ok(portal, undefined, { auth: tokenStudent })
        ).submissions[0].feedback.includes("Üçüncü"),
      );
      const inbox = (await ok("/v1/inbox", undefined, { auth: tokenStudent }))
        .data;
      assert.ok(inbox.some((n) => n.title === "Ödev değerlendirildi"));
      await ok(`/v1/inbox/${inbox[0].id}/read`, {}, { auth: tokenStudent });
      assert.equal(
        (await ok(`/v1/inbox/${inbox[0].id}/read`, {}, { auth: tokenB })).data,
        null,
      );
    },
  );
  await t.test(
    "private and audience notes stay separate; summaries require teacher publication",
    async () => {
      await ok(base + "/learning", {
        action: "note.publish",
        body: "Sadece öğrenciye açık",
        audience: "STUDENT",
      });
      await ok(base + "/learning", {
        action: "note.publish",
        body: "Aileyle paylaşılan not",
        audience: "BOTH",
      });
      const draft = (
        await ok(base + "/learning", {
          action: "summary.draft",
          weekOn: "2026-09-14",
        })
      ).data;
      assert.equal(
        (await ok(portal, undefined, { auth: tokenStudent })).summaries.length,
        0,
      );
      assert.equal(
        (await ok(portal, undefined, { auth: tokenGuardian })).notes.length,
        1,
      );
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            body: {
              action: "summary.publish",
              summaryId: draft.id,
              body: "Yetkisiz",
              version: 0,
            },
            auth: tokenStudent,
          })
        ).status,
        403,
      );
      await ok(base + "/learning", {
        action: "summary.publish",
        summaryId: draft.id,
        body: "Bu haftaki gelişim değerlendirildi.",
        version: 0,
      });
      assert.equal(
        (await ok(portal, undefined, { auth: tokenGuardian })).summaries.length,
        1,
      );
    },
  );
  await t.test(
    "private attachments validate purpose, actual size, signature and scoped downloads",
    async () => {
      const body = {
          assignmentId: assignment.id,
          purpose: "ASSIGNMENT",
          name: "odev.pdf",
          mimeType: "application/pdf",
          sizeBytes: 128,
        },
        key = randomUUID();
      const f = (await ok(media + "/files", body, { key })).data;
      assert.equal((await ok(media + "/files", body, { key })).data.id, f.id);
      assert.equal(
        (
          await request(media + "/files", {
            method: "POST",
            body,
            auth: tokenStudent,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(media + "/files", {
            method: "POST",
            body: { ...body, purpose: "SUBMISSION" },
            auth: tokenGuardian,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(media + `/files/${f.id}/download`, {
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      const row = (
        await admin.query(
          "SELECT object_key FROM derslik.materials WHERE id=$1",
          [f.id],
        )
      ).rows[0];
      fileObjects.set(row.object_key, {
        info: { size: 129, content_type: "application/pdf" },
        bytes: Buffer.from("%PDF-1.7"),
      });
      assert.equal(
        (
          await request(media + `/files/${f.id}/finish`, {
            method: "POST",
            body: {},
          })
        ).status,
        400,
      );
      fileObjects.get(row.object_key).info.size = 128;
      await ok(media + `/files/${f.id}/finish`, {});
      assert.ok(
        (
          await ok(media + `/files/${f.id}/download`, undefined, {
            auth: tokenStudent,
          })
        ).data.url,
      );
      assert.equal(
        (await request(media + `/files/${f.id}/download`, { auth: tokenB }))
          .status,
        403,
      );
      const submissionFile = (
        await ok(
          media + "/files",
          { ...body, purpose: "SUBMISSION" },
          { auth: tokenStudent },
        )
      ).data;
      assert.ok(submissionFile.id);
      await admin.query(
        "UPDATE derslik.workspace_limits SET material_bytes=256 WHERE workspace_id=$1",
        [ws],
      );
      assert.equal(
        (
          await request(media + "/files", {
            method: "POST",
            body: { ...body, purpose: "SUBMISSION" },
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      await admin.query(
        "UPDATE derslik.workspace_limits SET material_bytes=209715200 WHERE workspace_id=$1",
        [ws],
      );
    },
  );
  await t.test(
    "web and mobile clients share assignments, resources and video records",
    async () => {
      const { DerslikClient } =
        await import("../../../.api-build/packages/api-client/src/index.js");
      const address = await app.getUrl();
      const web = new DerslikClient({
        baseUrl: address,
        getToken: async () => tokenA,
      });
      const mobile = new DerslikClient({
        baseUrl: address,
        getToken: async () => tokenA,
      });
      const post = (client, path, body, key = randomUUID()) =>
        client.request(path, { method: "POST", body, key });
      const created = (
        await post(web, base + "/learning", {
          action: "assignment.create",
          title: "Ortak ödev",
          instructions: "PDF çözümü",
          dueOn: "2026-12-01",
        })
      ).data;
      const seen = (await mobile.learning(ws, student.id)).assignments.find(
        (a) => a.id === created.id,
      );
      assert.equal(seen.status, "OPEN");
      const change = {
        action: "assignment.update",
        assignmentId: seen.id,
        title: seen.title,
        instructions: seen.instructions,
        dueOn: seen.due_on,
        status: "COMPLETED",
        version: seen.version,
      };
      const key = randomUUID();
      await post(mobile, base + "/learning", change, key);
      assert.equal(
        (await post(mobile, base + "/learning", change, key)).replayed,
        true,
      );
      assert.equal(
        (await web.learning(ws, student.id)).assignments.find(
          (a) => a.id === seen.id,
        ).status,
        "COMPLETED",
      );
      await assert.rejects(
        post(web, base + "/learning", change),
        (e) => e.status === 409,
      );
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            auth: tokenStudent,
            body: {
              action: "assignment.submit",
              assignmentId: seen.id,
              body: "Kapalı ödev",
              version: 0,
            },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            auth: tokenStudent,
            body: change,
          })
        ).status,
        403,
      );

      const fileBody = {
        assignmentId: null,
        purpose: "RESOURCE",
        name: "ortak.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
      };
      const f = (await post(web, media + "/files", fileBody)).data;
      const row = (
        await admin.query(
          "SELECT object_key FROM derslik.materials WHERE id=$1",
          [f.id],
        )
      ).rows[0];
      fileObjects.set(row.object_key, {
        info: { size: 128, content_type: "application/pdf" },
        bytes: Buffer.from("%PDF-1.7"),
      });
      await post(web, media + `/files/${f.id}/finish`, {});
      assert.equal(
        (await mobile.learning(ws, student.id)).materials.find(
          (m) => m.id === f.id,
        ).status,
        "READY",
      );
      assert.ok(
        (
          await ok(media + `/files/${f.id}/download`, undefined, {
            auth: tokenStudent,
          })
        ).data.url,
      );
      assert.equal(
        (
          await request(media + "/files", {
            method: "POST",
            auth: tokenStudent,
            body: fileBody,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(media + `/files/${f.id}/delete`, {
            method: "POST",
            auth: tokenStudent,
            body: {},
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/v1/media/${wsB}/${student.id}/files/${f.id}/download`,
            { auth: tokenB },
          )
        ).status,
        404,
      );
      const deletion = providers.deleteFile;
      providers.deleteFile = async () => {
        throw new Error("Provider temporarily unavailable");
      };
      try {
        await assert.rejects(
          post(mobile, media + `/files/${f.id}/delete`, {}),
          (e) => e.status >= 500,
        );
        assert.equal(
          (await request(media + `/files/${f.id}/download`)).status,
          404,
        );
        assert.equal(
          (await web.learning(ws, student.id)).materials.find(
            (m) => m.id === f.id,
          ).delete_requested,
          true,
        );
      } finally {
        providers.deleteFile = deletion;
      }
      await post(mobile, media + `/files/${f.id}/delete`, {});
      await post(mobile, media + `/files/${f.id}/delete`, {});
      assert.ok(
        !(await web.learning(ws, student.id)).materials.some(
          (m) => m.id === f.id,
        ),
      );
      assert.ok(!fileObjects.has(row.object_key));

      const v = (
        await post(mobile, media + "/videos", {
          title: "Genel ders videosu",
          lessonId: null,
          sizeBytes: 1000,
          maxDurationSeconds: 60,
        })
      ).data;
      assert.equal(
        (await web.learning(ws, student.id)).videos.find((x) => x.id === v.id)
          .lesson_id,
        null,
      );
      await post(web, media + `/videos/${v.id}/delete`, {});
      // Existing provider tests count only their own reservations/deletions.
      reservations = 0;
      deleted = 0;
    },
  );
  await t.test(
    "video reservations, signed webhooks, private playback and timestamps are consistent",
    async () => {
      const body = {
          title: "Denklem tekrarı",
          lessonId: lesson.id,
          sizeBytes: 10000,
          maxDurationSeconds: 600,
        },
        key = randomUUID();
      video = (await ok(media + "/videos", body, { key })).data;
      await ok(media + "/videos", body, { key });
      assert.equal(reservations, 1);
      assert.equal(
        (
          await request(media + "/videos", {
            method: "POST",
            body,
            auth: tokenStudent,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(media + `/videos/${video.id}/playback`, {
            auth: tokenStudent,
          })
        ).status,
        404,
      );
      providerUid = (
        await admin.query(
          "SELECT provider_uid FROM derslik.videos WHERE id=$1",
          [video.id],
        )
      ).rows[0].provider_uid;
      const ready = {
        uid: providerUid,
        status: { state: "ready" },
        readyToStream: true,
        requireSignedURLs: true,
        duration: 120.2,
      };
      async function webhook(
        body,
        time = Math.floor(Date.now() / 1000),
        secret = config.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
      ) {
        const sig = createHmac("sha256", secret)
          .update(time + "." + JSON.stringify(body))
          .digest("hex");
        return request("/v1/webhooks/stream", {
          method: "POST",
          body,
          auth: null,
          headers: { "Webhook-Signature": `time=${time},sig1=${sig}` },
        });
      }
      assert.equal(
        (await webhook(ready, Math.floor(Date.now() / 1000), "wrong")).status,
        401,
      );
      assert.equal(
        (await webhook(ready, Math.floor(Date.now() / 1000) - 900)).status,
        401,
      );
      assert.equal((await webhook(ready)).status, 200);
      assert.equal((await webhook(ready)).status, 200);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*) AS n FROM derslik.webhook_events WHERE provider_uid=$1",
            [providerUid],
          )
        ).rows[0].n,
        "1",
      );
      await webhook({
        ...ready,
        status: { state: "error" },
        readyToStream: false,
      });
      assert.equal(
        (await ok(portal, undefined, { auth: tokenStudent })).videos[0].status,
        "READY",
      );
      assert.ok(
        (
          await ok(media + `/videos/${video.id}/playback`, undefined, {
            auth: tokenGuardian,
          })
        ).data.url.includes("test.signed.token"),
      );
      const question = {
        action: "question.create",
        videoId: video.id,
        atSeconds: 30,
        body: "Bu adımı neden yaptık?",
      };
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            body: { ...question, atSeconds: 500 },
            auth: tokenStudent,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(portal + "/actions", {
            method: "POST",
            body: question,
            auth: tokenGuardian,
          })
        ).status,
        403,
      );
      const q = (
        await ok(portal + "/actions", question, { auth: tokenStudent })
      ).data;
      await ok(base + "/learning", {
        action: "question.answer",
        questionId: q.id,
        answer: "Her iki taraftan aynı sayıyı çıkardık.",
        resolved: true,
        version: 0,
      });
      await ok(
        portal + "/actions",
        { action: "video.progress", videoId: video.id, seconds: 60 },
        { auth: tokenGuardian },
      );
      assert.equal(
        (await ok(portal, undefined, { auth: tokenGuardian })).progress[0]
          .seconds,
        60,
      );
      assert.equal(
        (await ok(portal, undefined, { auth: tokenStudent })).progress.length,
        0,
      );
      await admin.query(
        "UPDATE derslik.workspace_limits SET video_seconds=121 WHERE workspace_id=$1",
        [ws],
      );
      assert.equal(
        (await request(media + "/videos", { method: "POST", body })).status,
        409,
      );
      await ok(media + `/videos/${video.id}/delete`, {});
      assert.equal(deleted, 1);
      assert.equal(
        (
          await request(media + `/videos/${video.id}/playback`, {
            auth: tokenStudent,
          })
        ).status,
        404,
      );
      await admin.query(
        "UPDATE derslik.workspace_limits SET video_seconds=36000 WHERE workspace_id=$1",
        [ws],
      );
    },
  );
  await t.test(
    "make-up sessions preserve original cancellation and reject duplicate active replacements",
    async () => {
      const original = (
        await ok(
          `/v1/workspaces/${ws}/sessions`,
          sessionBody(student.id, pack.id, "2025-12-01T12:00:00Z"),
        )
      ).data.lessons[0];
      await ok(`/v1/workspaces/${ws}/sessions/${original.id}/cancel`, {
        version: 0,
      });
      const body = {
        ...sessionBody(student.id, pack.id, "2025-12-02T12:00:00Z"),
        makeupForId: original.id,
      };
      const makeup = (await ok(`/v1/workspaces/${ws}/sessions`, body)).data
        .lessons[0];
      assert.equal(makeup.makeupForId, original.id);
      assert.equal(
        (
          await request(`/v1/workspaces/${ws}/sessions`, {
            method: "POST",
            body: { ...body, startsAt: "2025-12-03T12:00:00Z" },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "SaaS subscriptions are signed, idempotent, scoped and separate from student payments",
    async () => {
      const billing = app.get(BillingProvider);
      let checkoutCalls = 0,
        billingKey,
        remoteStatus = "active",
        updated = "2026-09-14T00:00:00Z";
      const remote = () => ({
        data: {
          type: "subscriptions",
          id: "12345",
          attributes: {
            store_id: 123,
            variant_id: 456,
            status: remoteStatus,
            test_mode: true,
            updated_at: updated,
            ends_at:
              remoteStatus === "cancelled" ? "2020-01-01T00:00:00Z" : null,
            renews_at: "2026-10-14T00:00:00Z",
            urls: {
              customer_portal:
                "https://test.lemonsqueezy.com/billing?signature=test",
            },
          },
        },
      });
      billing.call = async (path, body) => {
        if (path === "/checkouts") {
          checkoutCalls++;
          billingKey = body.data.attributes.checkout_data.custom.billing_key;
          assert.deepEqual(
            body.data.attributes.product_options.enabled_variants,
            [456],
          );
          return {
            data: {
              attributes: {
                url: "https://test.lemonsqueezy.com/checkout/buy/test",
              },
            },
          };
        }
        return remote();
      };
      const path = `/v1/workspaces/${ws}/subscription`;
      // The generic GET workspaces/:ws/:resource route must not swallow this
      // one; the notifications panel reads the plan state from here.
      const current = (await ok(path)).data;
      assert.equal(current.status, "none");
      assert.equal(current.available, true);
      assert.equal(
        (
          await request(path + "/checkout", {
            method: "POST",
            body: {},
            auth: tokenStudent,
          })
        ).status,
        403,
      );
      await ok(path + "/checkout", {});
      await ok(path + "/checkout", {});
      assert.equal(checkoutCalls, 1);
      const payments = (await ok(`/v1/workspaces/${ws}/snapshot`)).payments
        .length;
      const event = {
        meta: {
          event_name: "subscription_created",
          custom_data: { billing_key: billingKey },
        },
        ...remote(),
      };
      const sign = (body) =>
        createHmac("sha256", config.LEMONSQUEEZY_WEBHOOK_SECRET)
          .update(JSON.stringify(body))
          .digest("hex");
      assert.equal(
        (
          await request("/v1/webhooks/subscriptions", {
            method: "POST",
            body: event,
            auth: null,
            headers: { "X-Signature": "0".repeat(64) },
          })
        ).status,
        401,
      );
      await ok("/v1/webhooks/subscriptions", event, {
        auth: null,
        headers: { "X-Signature": sign(event) },
      });
      await ok("/v1/webhooks/subscriptions", event, {
        auth: null,
        headers: { "X-Signature": sign(event) },
      });
      assert.equal(
        (await ok(`/v1/workspaces/${ws}/settings/limits`)).data.limits.plan,
        "PRO",
      );
      assert.equal(
        (await ok(`/v1/workspaces/${ws}/snapshot`)).payments.length,
        payments,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*) AS n FROM derslik.subscription_events WHERE workspace_id=$1",
            [ws],
          )
        ).rows[0].n,
        "1",
      );
      assert.ok((await ok(path + "/portal", {})).data.url.includes("/billing"));
      remoteStatus = "cancelled";
      updated = "2026-09-15T00:00:00Z";
      // Replaying a formerly active event re-fetches the current cancelled state.
      await ok("/v1/webhooks/subscriptions", event, {
        auth: null,
        headers: { "X-Signature": sign(event) },
      });
      assert.equal(
        (await ok(`/v1/workspaces/${ws}/settings/limits`)).data.limits.plan,
        "PILOT",
      );
    },
  );
  await t.test(
    "revoked and archived portal links fail on fresh requests",
    async () => {
      const links = (await ok(base + "/access")).data,
        studentLink = links.find((l) => l.role === "STUDENT");
      await ok(base + "/access/revoke", { id: studentLink.id, kind: "link" });
      assert.equal((await request(portal, { auth: tokenStudent })).status, 403);
      assert.ok(
        !(await ok("/v1/access", undefined, { auth: tokenStudent })).data
          .length,
      );
      await admin.query(
        "UPDATE derslik.students SET active=false WHERE id=$1",
        [student.id],
      );
      assert.equal(
        (await request(portal, { auth: tokenGuardian })).status,
        403,
      );
      await admin.query("UPDATE derslik.students SET active=true WHERE id=$1", [
        student.id,
      ]);
    },
  );
}

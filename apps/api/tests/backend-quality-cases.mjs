import assert from "node:assert/strict";
import { MediaProviders } from "../../../.api-build/apps/api/src/media/providers.js";

export async function backendQualityCases({
  t,
  config,
  request,
  ws,
  student,
  pack,
  lesson,
  sessionBody,
}) {
  await t.test(
    "invalid calendar years and ISO offsets return 400 across backend inputs",
    async () => {
      const base = `/v1/workspaces/${ws}`;
      for (const startsAt of [
        "0000-01-01T12:00:00Z",
        "0000-12-31T23:00:00-01:00",
        "2026-10-02T12:00:00+16:00",
        "2026-10-02T12:00:00+99:00",
      ]) {
        for (const input of [
          [`${base}/sessions?from=${encodeURIComponent(startsAt)}`, {}],
          [`${base}/sessions?to=${encodeURIComponent(startsAt)}`, {}],
          [
            `${base}/sessions`,
            {
              method: "POST",
              body: sessionBody(student.id, pack.id, startsAt),
            },
          ],
          [
            `${base}/sessions/${lesson.id}/reschedule`,
            { method: "POST", body: { version: 0, startsAt, duration: 60 } },
          ],
          [
            `/v1/portal/${ws}/${student.id}/booking`,
            { method: "POST", body: { startsAt } },
          ],
        ]) {
          const response = await request(...input);
          assert.equal(
            response.status,
            400,
            `${input[0]}: ${JSON.stringify(response.body)}`,
          );
        }
      }
      for (const [url, body] of [
        [
          `${base}/packages`,
          {
            studentId: student.id,
            name: "Invalid expiry",
            granted: 1,
            priceMinor: "100",
            expiresOn: "0000-01-01",
          },
        ],
        [
          `${base}/payments`,
          {
            studentId: student.id,
            amountMinor: "100",
            receivedOn: "0000-01-01",
            method: "CASH",
            reference: "",
          },
        ],
        [
          `${base}/students/${student.id}/learning`,
          {
            action: "assignment.create",
            title: "Invalid due date",
            instructions: "",
            dueOn: "0000-01-01",
          },
        ],
        [
          `${base}/students/${student.id}/learning`,
          { action: "summary.draft", weekOn: "0000-01-01" },
        ],
      ]) {
        const response = await request(url, { method: "POST", body });
        assert.equal(
          response.status,
          400,
          `${url}: ${JSON.stringify(response.body)}`,
        );
      }
      const settings = await request(`${base}/booking`, {
        method: "PUT",
        body: {
          enabled: false,
          durationMinutes: 60,
          noticeHours: 0,
          cancelHours: 0,
          location: "",
          windows: [],
          blocks: [{ from: "0000-01-01", to: "2099-01-01" }],
          version: 0,
        },
      });
      assert.equal(settings.status, 400);
    },
  );

  await t.test(
    "file signatures survive fragmented network chunks and stop after 16 bytes",
    async () => {
      const providers = new MediaProviders(config);
      const signature = Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      let cancelled = false;
      providers.storage = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of signature)
                controller.enqueue(Uint8Array.of(byte));
              controller.enqueue(new Uint8Array(100));
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      assert.deepEqual(await providers.fileSignature("test.png"), signature);
      assert.equal(cancelled, true);

      providers.storage = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.of(1));
              controller.enqueue(Uint8Array.of(2));
              controller.close();
            },
          }),
        );
      assert.deepEqual(
        await providers.fileSignature("short-file"),
        Buffer.from([1, 2]),
      );
    },
  );
}

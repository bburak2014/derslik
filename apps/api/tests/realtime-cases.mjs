import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// Anlık mesajlaşma soketi: istemci REST ile tek kullanımlık bilet alır ve
// /v1/socket'e onunla bağlanır. Yeni mesajda yazışmayı okuyabilen herkese
// (öğretmen, bağlantının hesabı, paylaşımlara erişimi olan veli) yalnızca
// yazışmanın kimliği gider; mesajın içeriği sokete çıkmaz.
export async function realtimeCases({
  t,
  admin,
  request,
  ok,
  token,
  base,
  wasmMode,
}) {
  const socketBase = base.replace(/^http/, "ws");
  const teacher = randomUUID(),
    pupil = randomUUID(),
    parent = randomUUID(),
    quiet = randomUUID(),
    stranger = randomUUID(),
    crowd = randomUUID();
  const auth = {
    teacher: await token(teacher),
    pupil: await token(pupil),
    parent: await token(parent),
    quiet: await token(quiet),
    stranger: await token(stranger),
    crowd: await token(crowd),
  };
  let ws, student;
  const links = {};
  const opened = [];

  const ticket = async (who) =>
    (await ok("/v1/socket/ticket", {}, { auth: auth[who] })).data.ticket;
  /** Soketi açar: açılırsa { sock, events }, reddedilirse { status }. */
  const open = (value, { origin, protocols, path = "/v1/socket" } = {}) =>
    new Promise((resolve, reject) => {
      const sock = new WebSocket(
        socketBase + path,
        protocols ?? ["derslik.v1", "ticket." + value],
        origin ? { origin } : {},
      );
      const events = [];
      sock.on("message", (data) => events.push(JSON.parse(String(data))));
      sock.once("open", () => {
        opened.push(sock);
        resolve({ sock, events });
      });
      sock.once("unexpected-response", (_req, res) => {
        res.resume();
        resolve({ status: res.statusCode });
      });
      sock.once("error", reject);
    });
  const connect = async (who, options) => open(await ticket(who), options);
  const until = async (events, match, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(match);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail("beklenen soket olayı gelmedi: " + JSON.stringify(events));
  };
  const quietFor = (ms) => new Promise((r) => setTimeout(r, ms));
  const changes = (events, type = "message") =>
    events.filter((e) => e.type === type);
  const portalSend = (who, link, body = "Merhaba") =>
    ok(
      `/v1/portal/${ws}/${student}/messages/${link}`,
      { body },
      { auth: auth[who] },
    );
  const ownerSend = (link, body = "Merhaba") =>
    ok(
      `/v1/workspaces/${ws}/messages/${link}`,
      { body },
      { auth: auth.teacher },
    );

  await t.test("realtime: setup", async () => {
    ws = (
      await ok("/v1/workspaces", { name: "Soket Hoca" }, { auth: auth.teacher })
    ).data.id;
    student = (
      await ok(
        `/v1/workspaces/${ws}/students`,
        {
          name: "Soket Öğrenci",
          grade: "",
          subject: "Fizik",
          phone: "",
          email: "",
        },
        { auth: auth.teacher },
      )
    ).data.id;
    for (const user of [pupil, parent, quiet])
      await admin.query(
        "INSERT INTO derslik.users(id,email) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [user, `soket-${user}@example.test`],
      );
    // Öğrenci hesabı; paylaşımlara erişimi olan veli (çocuğun yazışmasını
    // okur); yalnızca Dersler izni olan veli (okuyamaz).
    const rows = (
      await admin.query(
        `INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES
          ($1,$2,$3,'STUDENT',ARRAY['lessons','notes']),
          ($1,$2,$4,'GUARDIAN',ARRAY['lessons','notes']),
          ($1,$2,$5,'GUARDIAN',ARRAY['lessons'])
         RETURNING id,user_id`,
        [ws, student, pupil, parent, quiet],
      )
    ).rows;
    links.pupil = rows.find((r) => r.user_id === pupil).id;
    links.parent = rows.find((r) => r.user_id === parent).id;
    links.quiet = rows.find((r) => r.user_id === quiet).id;
  });

  await t.test(
    "realtime: tickets need a session, are single use, short lived and well formed",
    async () => {
      assert.equal(
        (
          await request("/v1/socket/ticket", {
            method: "POST",
            body: {},
            auth: null,
          })
        ).status,
        401,
      );
      const issued = (await ok("/v1/socket/ticket", {}, { auth: auth.teacher }))
        .data;
      assert.match(issued.ticket, /^[a-f0-9]{64}$/);
      assert.equal(issued.expiresIn, 30);
      // Veritabanında biletin kendisi değil özeti durur.
      const stored = (
        await admin.query(
          "SELECT token_hash,user_id,expires_at-now() < interval '31 seconds' AS short FROM derslik.socket_tickets WHERE user_id=$1",
          [teacher],
        )
      ).rows;
      assert.equal(stored.length, 1);
      assert.notEqual(stored[0].token_hash, issued.ticket);
      assert.equal(stored[0].short, true);

      const first = await open(issued.ticket);
      assert.equal(first.sock.protocol, "derslik.v1");
      await until(first.events, (e) => e.type === "ready");
      // Bilet bir kez kullanılır.
      assert.equal((await open(issued.ticket)).status, 401);
      // Süresi dolan bilet.
      const old = await ticket("teacher");
      await admin.query(
        "UPDATE derslik.socket_tickets SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [teacher],
      );
      assert.equal((await open(old)).status, 401);
      // Biçimsiz bilet, eksik alt protokol, bilinmeyen yol, rastgele bilet.
      assert.equal((await open("zz")).status, 401);
      assert.equal(
        (
          await open(null, {
            protocols: ["ticket." + (await ticket("teacher"))],
          })
        ).status,
        401,
      );
      assert.equal(
        (await open(await ticket("teacher"), { path: "/v1/sockets" })).status,
        404,
      );
      assert.equal((await open("a".repeat(64))).status, 401);
      // Tarayıcıdan yalnızca izinli adresler; Origin göndermeyen istemci geçer.
      assert.equal(
        (await connect("teacher", { origin: "https://evil.example" })).status,
        403,
      );
      assert.ok(
        (await connect("teacher", { origin: "http://localhost:3000" })).sock,
      );
    },
  );

  const sockets = {};
  await t.test(
    "realtime: a new message reaches every reader at once, once, without its body",
    async () => {
      for (const who of ["teacher", "pupil", "parent", "quiet", "stranger"])
        sockets[who] = await connect(who);
      for (const s of Object.values(sockets))
        await until(s.events, (e) => e.type === "ready");

      await portalSend("pupil", links.pupil, "Gizli içerik 123");
      const expected = {
        type: "message",
        workspace: ws,
        student,
        thread: links.pupil,
      };
      for (const who of ["teacher", "pupil", "parent"])
        assert.deepEqual(
          await until(sockets[who].events, (e) => e.type === "message"),
          expected,
        );
      await quietFor(400);
      // Aynı olay bir kez gelir (süreç kendi NOTIFY'ını atlar).
      for (const who of ["teacher", "pupil", "parent"])
        assert.equal(changes(sockets[who].events).length, 1, who);
      // Okuyamayan veli ve başka kullanıcı hiçbir şey almaz.
      assert.equal(changes(sockets.quiet.events).length, 0);
      assert.equal(changes(sockets.stranger.events).length, 0);
      for (const s of Object.values(sockets))
        assert.ok(!JSON.stringify(s.events).includes("Gizli"));

      // Öğretmen veliye yazar: yalnızca o veli ve öğretmen haber alır.
      await ownerSend(links.quiet);
      await until(
        sockets.quiet.events,
        (e) => e.type === "message" && e.thread === links.quiet,
      );
      await quietFor(300);
      for (const who of ["pupil", "parent"])
        assert.ok(
          !sockets[who].events.some((e) => e.thread === links.quiet),
          who,
        );
    },
  );

  await t.test("realtime: read receipts go only to the reader", async () => {
    const before = changes(sockets.pupil.events, "read").length;
    await ok(
      `/v1/workspaces/${ws}/messages/${links.pupil}/read`,
      {},
      { auth: auth.teacher },
    );
    assert.equal(
      (
        await until(
          sockets.teacher.events,
          (e) => e.type === "read" && e.thread === links.pupil,
        )
      ).workspace,
      ws,
    );
    await quietFor(300);
    assert.equal(changes(sockets.pupil.events, "read").length, before);
    assert.equal(changes(sockets.parent.events, "read").length, 0);
  });

  await t.test("realtime: revoked access stops events at once", async () => {
    await ok(
      `/v1/workspaces/${ws}/students/${student}/access/revoke`,
      { id: links.parent, kind: "link" },
      { auth: auth.teacher },
    );
    const parentBefore = changes(sockets.parent.events).length,
      teacherBefore = changes(sockets.teacher.events).length;
    await portalSend("pupil", links.pupil, "Veli artık görmemeli");
    await until(
      sockets.teacher.events,
      () => changes(sockets.teacher.events).length > teacherBefore,
    );
    await quietFor(300);
    assert.equal(changes(sockets.parent.events).length, parentBefore);
  });

  await t.test("realtime: one account holds at most ten sockets", async () => {
    const held = [];
    for (let i = 0; i < 10; i++) held.push(await connect("crowd"));
    assert.ok(held.every((s) => s.sock));
    assert.equal((await connect("crowd")).status, 429);
    held[0].sock.close();
    await quietFor(200);
    assert.ok((await connect("crowd")).sock);
  });

  await t.test(
    "realtime: messages written elsewhere reach sockets through LISTEN",
    { skip: wasmMode && "PGlite NOTIFY'ı soket istemcilerine iletmez" },
    async () => {
      const before = changes(sockets.teacher.events).length;
      // Başka bir yazar (yönetici bağlantısı, başka application_name).
      await admin.query(
        "INSERT INTO derslik.messages(workspace_id,link_id,sender_id,body) VALUES($1,$2,$3,'dışarıdan')",
        [ws, links.pupil, pupil],
      );
      await until(
        sockets.teacher.events,
        () => changes(sockets.teacher.events).length > before,
      );
    },
  );

  for (const sock of opened) sock.terminate();
}

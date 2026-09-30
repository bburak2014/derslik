import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Kayıtlı her rotayı yabancı bir öğretmen ve bağlı bir öğrenci adına, A
// öğretmeninin gerçek kimlikleriyle dener. Başarılı yanıt A'nın verisini
// içermemeli ve A'nın hiçbir satırı değişmemeli. Yeni bir rota eklendiğinde
// `classify` içinde sınıflandırılmadan bu test geçmez; böylece yetki
// denetimi olmayan bir uç nokta sessizce eklenemez.

// Herkese açık ya da çağıranın kendi kaydına bakan rotalar. Bunlar başka
// kullanıcının kimliğini yoldan almaz veya dizindeki gibi herkese açıktır.
const open = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /v1/workspaces",
  "POST /v1/workspaces",
  "GET /v1/access",
  "GET /v1/inbox",
  "POST /v1/invitations/accept",
  "GET /v1/teachers",
  "GET /v1/teachers/:id",
  "GET /v1/teachers/:id/photo",
  "GET /v1/teacher-relations",
  "GET /v1/teacher-relations/:id",
  "POST /v1/teacher-relations/:id/requests",
  "PUT /v1/teacher-relations/:id/review",
  "POST /v1/teacher-relations/:id/review/delete",
  "GET /v1/requests",
  "GET /v1/media/capabilities",
  // Takvim uygulaması oturumsuz okur; bağlantıdaki belirteç çağıranın kendi
  // akışıdır. Oluşturma ve yenileme yalnızca çağıranın kendi bağlantısına dokunur.
  "GET /v1/calendar/:token",
  // İmzalı gövdeyle doğrulanır; kimlik yolu kullanmaz.
  "POST /v1/webhooks/subscriptions",
  "POST /v1/webhooks/stream",
]);

function routesOf(app) {
  const stack = app.getHttpAdapter().getInstance().router.stack;
  const routes = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods))
      if (method !== "_all")
        routes.push({ method: method.toUpperCase(), path: layer.route.path });
  }
  return routes;
}

async function firstId(admin, sql, values) {
  return (await admin.query(sql, values)).rows[0]?.id ?? randomUUID();
}

// A çalışma alanına ait tüm satırların özeti. Reddedilen bir istek hiçbir
// satırı değiştirmemeli.
async function digest(admin, ws) {
  const tables = (
    await admin.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema='derslik' AND column_name='workspace_id'
        ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name);
  const parts = {};
  for (const table of tables) {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n,
              coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h
         FROM derslik.${table} t WHERE workspace_id=$1`,
      [ws],
    );
    parts[table] = `${rows[0].n}:${rows[0].h}`;
  }
  return parts;
}

export async function accessCases({
  t,
  app,
  admin,
  request,
  ws,
  wsB,
  student,
  tokenB,
  tokenStudent,
  actorA,
}) {
  await t.test(
    "every route rejects a foreign teacher and a student outside their grant",
    async () => {
      const q = (table) =>
        firstId(
          admin,
          `SELECT id FROM derslik.${table} WHERE workspace_id=$1 ORDER BY id LIMIT 1`,
          [ws],
        );
      const otherStudent = await firstId(
        admin,
        "SELECT id FROM derslik.students WHERE workspace_id=$1 AND id<>$2 ORDER BY id LIMIT 1",
        [ws, student.id],
      );
      const ids = {
        student: student.id,
        lesson: await q("lessons"),
        payment: await q("payments"),
        material: await q("materials"),
        video: await q("videos"),
        request: await q("lesson_requests"),
        notification: await firstId(
          admin,
          "SELECT id FROM derslik.notifications WHERE user_id=$1 ORDER BY id LIMIT 1",
          [actorA],
        ),
      };

      // Rotadaki `:id`'nin hangi kayda denk geldiği yolun geri kalanından
      // anlaşılır.
      function idFor(path) {
        if (path.includes("/sessions/")) return ids.lesson;
        if (path.includes("/payments/")) return ids.payment;
        if (path.includes("/files/")) return ids.material;
        if (path.includes("/videos/")) return ids.video;
        if (path.includes("/inbox/")) return ids.notification;
        if (path.includes("/requests/")) return ids.request;
        return ids.student;
      }
      function fill(path, workspace, studentId) {
        return path
          .replace(":ws", workspace)
          .replace(":student", studentId)
          .replace(":resource", "students")
          .replace(":action", "cancel")
          .replace(":decision", "accept")
          .replace(":id", idFor(path));
      }

      const routes = routesOf(app);
      const guarded = routes.filter((r) => !open.has(`${r.method} ${r.path}`));
      const known = new Set(routes.map((r) => `${r.method} ${r.path}`));
      for (const key of open)
        assert.ok(known.has(key), `listed as open but not registered: ${key}`);
      assert.ok(guarded.length >= 40, `only ${guarded.length} guarded routes`);

      // A'ya ait her satır kimliği. Başarılı bir yanıt bunlardan birini
      // (yolda gönderilen dışında) içeriyorsa veri sızmıştır.
      const secrets = new Set();
      for (const { table_name } of (
        await admin.query(
          `SELECT c.table_name FROM information_schema.columns c
             JOIN information_schema.columns i
               ON i.table_schema=c.table_schema AND i.table_name=c.table_name
              AND i.column_name='id'
            WHERE c.table_schema='derslik' AND c.column_name='workspace_id'`,
        )
      ).rows)
        for (const row of (
          await admin.query(
            `SELECT id::text FROM derslik.${table_name} WHERE workspace_id=$1`,
            [ws],
          )
        ).rows)
          secrets.add(row.id);
      secrets.add(student.name);

      const before = await digest(admin, ws);
      const leaks = [];
      async function attempt(label, method, url, auth) {
        const body = method === "GET" ? undefined : { version: 0 };
        const r = await request(url, { method, body, auth });
        if (r.status >= 300) return;
        const text = JSON.stringify(r.body);
        const seen = [...secrets].filter(
          (s) => !url.includes(s) && text.includes(s),
        );
        if (seen.length)
          leaks.push(`${label}: ${method} ${url} → ${r.status} ${text}`);
      }
      for (const { method, path } of guarded) {
        // 1. Yabancı öğretmen, A'nın çalışma alanı ve kimlikleriyle.
        await attempt(
          "foreign teacher",
          method,
          fill(path, ws, student.id),
          tokenB,
        );
        // 2. Yabancı öğretmen, kendi çalışma alanında A'nın kimlikleriyle.
        if (path.includes(":ws") && /:(student|id)\b/.test(path))
          await attempt(
            "foreign teacher, own workspace",
            method,
            fill(path, wsB, student.id),
            tokenB,
          );
        // 3. Öğrenci, bağlı olmadığı öğrencinin portalı ve medyasıyla; ve
        // öğretmene ait her rotada.
        const portalOrMedia = /^\/v1\/(portal|media)\//.test(path);
        if (portalOrMedia)
          await attempt(
            "student, other student",
            method,
            fill(path, ws, otherStudent),
            tokenStudent,
          );
        else if (path.includes(":ws"))
          await attempt(
            "student, teacher route",
            method,
            fill(path, ws, student.id),
            tokenStudent,
          );
      }
      assert.deepEqual(leaks, []);
      assert.deepEqual(await digest(admin, ws), before);
    },
  );
}

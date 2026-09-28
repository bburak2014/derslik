import { randomUUID } from "node:crypto";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { MediaProviders } from "../../../.api-build/apps/api/src/media/providers.js";
import { BillingProvider } from "../../../.api-build/apps/api/src/subscriptions/subscription.service.js";

// Opt-in, disposable test data for local web/ZAP integration. Never reads .env.
export async function holdSecurityFixture({
  app,
  admin,
  token,
  ok,
  base,
  issuer,
  publicJwk,
  verifiedUsers,
  file,
}) {
  const media = app.get(MediaProviders);
  const remoteVideos = new Map();
  media.stream = async (path, init = {}) => {
    if (path === "?direct_user=true") {
      const uid = randomUUID().replaceAll("-", "");
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
      remoteVideos.delete(uid);
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/token"))
      return Response.json({ result: { token: "fixture.signed.token" } });
    return Response.json({ result: remoteVideos.get(uid) });
  };
  media.uploadFileUrl = async (key) =>
    `https://storage.example.test/${key}?token=fixture`;
  media.downloadFileUrl = async (key) =>
    `https://storage.example.test/${key}?token=fixture-download`;
  media.fileInfo = async () => ({ size: 100, content_type: "application/pdf" });
  media.fileSignature = async () => Buffer.from("%PDF-1.7 fixture");
  media.deleteFile = async () => {};
  media.capabilities = async () => ({
    files: true,
    videos: true,
    fileMessage: null,
    videoMessage: null,
  });
  app.get(BillingProvider).call = async () => {
    throw new Error("Billing provider disabled in security fixture");
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 1500;
  const actors = {};
  for (const role of ["owner", "otherOwner", "student", "guardian"]) {
    const id = randomUUID();
    const email = `${role.toLowerCase()}@security.example.test`;
    const jwt = await token(id, { email, exp: expiresAt });
    actors[role] = { id, email, token: jwt };
    verifiedUsers.set(`Bearer ${jwt}`, {
      id,
      email,
      email_confirmed_at: new Date().toISOString(),
    });
  }
  const ws = (
    await ok(
      "/v1/workspaces",
      { name: "Security fixture teacher" },
      { auth: actors.owner.token },
    )
  ).data.id;
  const otherWs = (
    await ok(
      "/v1/workspaces",
      { name: "Security fixture other teacher" },
      { auth: actors.otherOwner.token },
    )
  ).data.id;
  const student = (
    await ok(
      `/v1/workspaces/${ws}/students`,
      {
        name: "Security fixture student",
        grade: "10",
        subject: "Matematik",
        phone: "",
        email: actors.student.email,
      },
      { auth: actors.owner.token },
    )
  ).data;
  for (const role of ["student", "guardian"]) {
    await admin.query(
      "INSERT INTO derslik.users(id) VALUES($1) ON CONFLICT DO NOTHING",
      [actors[role].id],
    );
    await admin.query(
      "INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES($1,$2,$3)",
      [ws, actors[role].id, role.toUpperCase()],
    );
    await admin.query(
      "INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES($1,$2,$3,$4,$5)",
      [
        ws,
        student.id,
        actors[role].id,
        role.toUpperCase(),
        ["lessons", "assignments", "videos", "notes", "payments"],
      ],
    );
  }
  const originalFetch = globalThis.fetch;
  // Provider methods are mocked by learning-cases. This final guard also blocks
  // every accidentally unmocked HTTP call outside this machine while scanning.
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Security fixture blocked external provider request");
    }
    return originalFetch(input, init);
  };
  const routes = [];
  for (const layer of app.getHttpAdapter().getInstance().router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (method !== "_all")
        routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        base,
        dockerBase: "http://host.docker.internal:3101",
        issuer,
        publicJwk,
        expiresAt,
        actors,
        workspaceId: ws,
        otherWorkspaceId: otherWs,
        studentId: student.id,
        routes,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Isolated security fixture ready on port 3101; credentials stored in the requested private file.",
  );
  try {
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        process.off("SIGINT", finish);
        process.off("SIGTERM", finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        Math.min(
          Number(process.env.DERSLIK_SECURITY_HOLD_MS) || 1_200_000,
          1_200_000,
        ),
      );
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(file, { force: true });
  }
}

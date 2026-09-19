import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { root, syncEnv } from "./sync-env.mjs";

const require = createRequire(import.meta.url);
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
function child(command, args, options = {}) {
  const p = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
  children.add(p);
  p.once("exit", () => children.delete(p));
  p.once("error", () => children.delete(p));
  return p;
}
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const p = child(command, args, options);
    p.once("error", reject);
    p.once("exit", (code) =>
      code === 0 && !stopping
        ? resolve()
        : reject(new Error(`${command} tamamlanamadı (${code}).`)),
    );
  });
}
function service(args, options = {}) {
  const p = child(process.execPath, args, options);
  p.once("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  p.once("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
try {
  const api = await syncEnv();
  if (
    !api.AUTH_ISSUER ||
    /YOUR_PROJECT/.test(api.AUTH_ISSUER) ||
    !api.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error(
      ".env.api içindeki AUTH_ISSUER, SUPABASE_URL ve SUPABASE_PUBLISHABLE_KEY alanlarını doldurun. Ayrıntı: docs/kurulum.md.",
    );
  const production = process.argv.includes("--production");
  const remote = Boolean(api.API_PUBLIC_URL);
  const environment = {
    ...process.env,
    ...api,
    API_PORT: api.API_HTTP_PORT || "3001",
    API_HOST: api.API_BIND_ADDRESS || "127.0.0.1",
  };
  if (!production && !remote) {
    await run("docker", [
      "compose",
      "--env-file",
      ".env.api",
      "-f",
      "compose.api.yml",
      "up",
      "-d",
      "--wait",
      "postgres",
    ]);
    await run(process.execPath, [
      require.resolve("typescript/bin/tsc"),
      "-p",
      "apps/api/tsconfig.json",
    ]);
    await run(process.execPath, [".api-build/apps/api/src/db/migrate.js"], {
      env: environment,
    });
    service([
      require.resolve("typescript/bin/tsc"),
      "-p",
      "apps/api/tsconfig.json",
      "--watch",
      "--preserveWatchOutput",
    ]);
  }
  const runtimeEnv = {
    ...environment,
    NODE_ENV: production ? "production" : "development",
  };
  for (const key of [
    "DATABASE_ADMIN_URL",
    "POSTGRES_PASSWORD",
    "API_DATABASE_PASSWORD",
  ])
    delete runtimeEnv[key];
  if (!remote)
    service(
      [
        ...(production
          ? []
          : [
              ...(process.platform === "darwin" || process.platform === "win32"
                ? ["--watch-path=.api-build"]
                : ["--watch"]),
            ]),
        ".api-build/apps/api/src/main.js",
      ],
      { env: runtimeEnv },
    );
  // Only the allowlisted web settings are loaded by Next from apps/web/.env.local.
  service(
    [
      require.resolve("next/dist/bin/next"),
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      api.WEB_HTTP_PORT || "3000",
    ],
    { cwd: resolve(root, "apps/web") },
  );
  console.log(
    `Web: ${api.APP_ORIGIN || "http://localhost:3000"}. Web ve telefon aynı API'yi kullanır.`,
  );
  console.log("Mobil: başka terminalde pnpm mobile:start. Çıkış: Ctrl+C.");
} catch (e) {
  console.error(e.message);
  stop(1);
}

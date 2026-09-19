import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const root = resolve(import.meta.dirname, "..");
export async function readApiEnv() {
  try {
    return parseEnv(await readFile(resolve(root, ".env.api"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT")
      throw new Error(
        "Önce pnpm setup çalıştırın ve .env.api dosyasını doldurun.",
      );
    throw e;
  }
}
export function clientEnvironment(api, lanHost) {
  const supabase =
    api.SUPABASE_URL || api.AUTH_ISSUER?.replace(/\/auth\/v1\/?$/, "") || "";
  const port = api.API_HTTP_PORT || "3001";
  const apiUrl = api.API_PUBLIC_URL || `http://${lanHost}:${port}`;
  const target = new URL(apiUrl);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error(
      "API adresi http/https olmalı; parola, sorgu veya # içermemeli.",
    );
  if (
    api.AUTH_ISSUER &&
    supabase &&
    new URL(api.AUTH_ISSUER).origin !== new URL(supabase).origin
  )
    throw new Error(
      "AUTH_ISSUER ve SUPABASE_URL aynı Auth projesine ait olmalı.",
    );
  return {
    web: {
      API_BASE_URL: api.API_PUBLIC_URL || `http://127.0.0.1:${port}`,
      SUPABASE_URL: supabase,
      SUPABASE_PUBLISHABLE_KEY: api.SUPABASE_PUBLISHABLE_KEY || "",
      APP_ORIGIN: api.APP_ORIGIN || "http://localhost:3000",
    },
    mobile: {
      EXPO_PUBLIC_API_URL: apiUrl,
      EXPO_PUBLIC_SUPABASE_URL: supabase,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: api.SUPABASE_PUBLISHABLE_KEY || "",
    },
  };
}
function localAddress() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(docker|veth|br-)/.test(name)) continue;
    for (const a of addresses || []) {
      if (
        a.family === "IPv4" &&
        !a.internal &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      )
        return a.address;
    }
  }
  return "127.0.0.1";
}
export async function merge(file, values) {
  let previous = await readFile(resolve(root, file), "utf8").catch((e) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  const lines = previous
    .split(/\r?\n/)
    .filter(
      (line) =>
        !Object.keys(values).some((key) =>
          new RegExp(`^(?:export\\s+)?${key}\\s*=`).test(line),
        ),
    );
  const contents =
    lines.filter(Boolean).join("\n") +
    "\n" +
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") +
    "\n";
  // Expo watches its environment file. Rewriting identical settings causes
  // needless bundle reloads while the API/web development processes run.
  if (contents !== previous)
    await writeFile(resolve(root, file), contents, { mode: 0o600 });
}
export async function syncEnv() {
  const api = await readApiEnv();
  const settings = clientEnvironment(
    api,
    api.MOBILE_API_HOST || localAddress(),
  );
  await merge("apps/web/.env.local", settings.web);
  await merge("apps/mobile/.env", settings.mobile);
  console.log("Web ve mobil bağlantıları .env.api dosyasından güncellendi.");
  return api;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await syncEnv();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

// Vendored from @openai/sites-vite-plugin 0.2.0 (openai/sites#9).
// See sites-vite-plugin.LICENSE for the upstream MIT license.
import { access, cp, mkdir, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const localUserId = "local_seedy";
const localEmail = "seedy@sites.test";
const localFullName = "Seedy";
const localCookieName = "__sites_local_auth";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]); // NOSONAR: yerel geliştirme sunucusunun loopback izin listesi
const authPaths = new Set([
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function sites({ mockAuth = true } = {}): Plugin {
  let root = process.cwd();
  let command: "build" | "serve" = "build";

  return {
    name: "sites",
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    configureServer(server) {
      if (!mockAuth) return;
      const secure = Boolean(server.config.server.https);

      server.config.logger.info(`Sites local sign-in: ${localEmail}`);
      server.middlewares.use((request, response, next) => {
        handleLocalAuth(request, response, next, secure);
      });
    },
    async closeBundle() {
      if (command !== "build") return;

      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      // Portable checkouts can build without the local hosting metadata.
      // Remove a previous build's metadata even when that file is absent.
      if (!(await exists(hostingConfig))) return;
      await mkdir(outputDirectory, { recursive: true });

      await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}

function handleLocalAuth(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
  secure: boolean,
): void {
  removeSpoofedIdentityHeaders(request);

  const parsed = parseRequestUrl(request, secure);
  if (!parsed) {
    refuseAuthPath((request.url ?? "/").split("?")[0], response, next);
    return;
  }
  const { authority, url } = parsed;
  if (!isLocalRequest(request, authority, url)) {
    refuseAuthPath(url.pathname, response, next);
    return;
  }

  const signInCookies = takeSignInCookies(request);

  if (url.pathname === "/callback") {
    respond(response, 501);
    return;
  }

  const signIn = url.pathname === "/signin-with-chatgpt";
  const signOut = url.pathname === "/signout-with-chatgpt";
  if (!signIn && !signOut) {
    attachLocalIdentity(request, signInCookies);
    next();
    return;
  }

  if (isCrossSiteRequest(request, url)) {
    respond(response, 403);
    return;
  }

  if (isPrefetchRequest(request)) {
    respond(response, 204);
    return;
  }

  if (!isAllowedMethod(request.method, signOut)) {
    response.setHeader("Allow", signIn ? "GET" : "GET, POST");
    respond(response, 405);
    return;
  }

  redirectAfterAuth(request, response, url, signIn, secure);
}

function removeSpoofedIdentityHeaders(request: IncomingMessage): void {
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("oai-authenticated-user-")) {
      removeHeader(request, name);
    }
  }
}

function parseRequestUrl(
  request: IncomingMessage,
  secure: boolean,
): { authority: URL; url: URL } | undefined {
  try {
    const authority = new URL(
      `${secure ? "https" : "http"}://${request.headers.host}`,
    );
    return { authority, url: new URL(request.url ?? "/", authority) };
  } catch {
    return undefined;
  }
}

function refuseAuthPath(
  pathname: string,
  response: ServerResponse,
  next: () => void,
): void {
  if (authPaths.has(pathname)) respond(response, 403);
  else next();
}

function isLocalRequest(
  request: IncomingMessage,
  authority: URL,
  url: URL,
): boolean {
  const hostname = authority.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    localHosts.has(hostname) &&
    localAddresses.has(request.socket.remoteAddress ?? "") &&
    url.origin === authority.origin
  );
}

// Removes the sign-in cookie from what the application sees and returns its
// values.
function takeSignInCookies(request: IncomingMessage): string[] {
  const cookies = (request.headers.cookie ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean);
  const signInCookies = cookies
    .filter((cookie) => cookie.startsWith(`${localCookieName}=`))
    .map((cookie) => cookie.slice(localCookieName.length + 1));
  const applicationCookies = cookies.filter(
    (cookie) => !cookie.startsWith(`${localCookieName}=`),
  );
  if (applicationCookies.length !== cookies.length) {
    removeHeader(request, "cookie");
    if (applicationCookies.length) {
      setHeader(request, "cookie", applicationCookies.join("; "));
    }
  }
  return signInCookies;
}

// Exactly one sign-in cookie holding "1" means the local account is signed in.
function attachLocalIdentity(
  request: IncomingMessage,
  signInCookies: string[],
): void {
  if (signInCookies.length !== 1 || signInCookies[0] !== "1") return;
  setHeader(request, "oai-authenticated-user-id", localUserId);
  setHeader(request, "oai-authenticated-user-email", localEmail);
  setHeader(request, "oai-authenticated-user-full-name", localFullName);
  setHeader(
    request,
    "oai-authenticated-user-full-name-encoding",
    "percent-encoded-utf-8",
  );
}

function isCrossSiteRequest(request: IncomingMessage, url: URL): boolean {
  const { origin } = request.headers;
  if (origin && origin !== url.origin) return true;
  return request.headers["sec-fetch-site"] === "cross-site";
}

function declaresPrefetch(value: string | string[] | undefined): boolean {
  return (
    typeof value === "string" &&
    value.split(/[;,]/).some((part) => part.trim().toLowerCase() === "prefetch")
  );
}

function isPrefetchRequest(request: IncomingMessage): boolean {
  const { headers } = request;
  return (
    headers["next-router-prefetch"] !== undefined ||
    headers["x-middleware-prefetch"] === "1" ||
    [headers.purpose, headers["sec-purpose"]].some(declaresPrefetch)
  );
}

// Signing in needs GET; signing out also accepts POST.
function isAllowedMethod(
  method: string | undefined,
  signOut: boolean,
): boolean {
  return method === "GET" || (signOut && method === "POST");
}

// Only reached for sign-in or sign-out, so `signIn === false` means sign-out.
function redirectAfterAuth(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  signIn: boolean,
  secure: boolean,
): void {
  response.statusCode = request.method === "POST" ? 303 : 302;
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Location", safeReturn(url.searchParams.get("return_to")));
  response.setHeader(
    "Set-Cookie",
    `${localCookieName}=${signIn ? "1" : ""}; Path=/; ${
      signIn ? "" : "Max-Age=0; "
    }HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );
  response.end();
}

function removeHeader(request: IncomingMessage, name: string): void {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders.splice(index, 2);
    }
  }
}

function setHeader(
  request: IncomingMessage,
  name: string,
  value: string,
): void {
  removeHeader(request, name);
  request.headers[name] = value;
  request.rawHeaders.push(name, value);
}

function respond(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "private, no-store");
  response.end();
}

function safeReturn(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost" || authPaths.has(url.pathname)) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

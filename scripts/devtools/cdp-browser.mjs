import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browserRuntime = {
  platform: process.platform,
  env: process.env,
  existsSync,
  spawnSync,
  spawn,
  createServer,
  mkdtemp,
  rm,
  tmpdir,
  fetch: (...args) => fetch(...args),
  delay,
  WebSocketClass: WebSocket,
};

function executableCandidates({ env, platform }) {
  const explicit = env.CHROME_PATH;
  const candidates = explicit ? [explicit] : [];
  if (platform === "darwin")
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  if (platform === "win32") {
    const programFiles = env.PROGRAMFILES ?? String.raw`C:\Program Files`;
    const programFilesX86 = env["PROGRAMFILES(X86)"] ?? String.raw`C:\Program Files (x86)`;
    candidates.push(
      String.raw`${programFiles}\Google\Chrome\Application\chrome.exe`,
      String.raw`${programFilesX86}\Google\Chrome\Application\chrome.exe`,
    );
  }
  candidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
  return candidates;
}

function commandAvailable(command, runtime) {
  if (command.includes("/") || command.includes("\\")) return runtime.existsSync(command);
  const checker = runtime.platform === "win32" ? "where" : "which";
  return runtime.spawnSync(checker, [command], { stdio: "ignore" }).status === 0;
}

function chromeExecutable(runtime) {
  const command = executableCandidates(runtime).find((candidate) => commandAvailable(candidate, runtime));
  if (!command)
    throw new Error(
      "Chrome/Chromium bulunamadı. CHROME_PATH ile tarayıcı çalıştırılabilir dosyasını belirtin.",
    );
  return command;
}

async function freePort(runtime) {
  const server = runtime.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" ? address?.port ?? 0 : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function json(url, runtime) {
  const response = await runtime.fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function waitForDebugger(port, child, runtime) {
  const endpoint = `http://127.0.0.1:${port}`;
  const poll = async (attemptsRemaining) => {
    if (child.exitCode !== null)
      throw new Error(`Chrome beklenmedik biçimde kapandı: ${child.exitCode}`);
    try {
      await json(endpoint + "/json/version", runtime);
      return endpoint;
    } catch {
      await runtime.delay(100);
      if (attemptsRemaining > 1) return poll(attemptsRemaining - 1);
      throw new Error("Chrome DevTools Protocol 10 saniye içinde hazır olmadı.");
    }
  };
  return poll(100);
}

export class CdpSession {
  constructor(url, { WebSocketClass = WebSocket } = {}) {
    this.url = url;
    this.WebSocketClass = WebSocketClass;
    this.socket = null;
    this.counter = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new this.WebSocketClass(this.url);
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => this.handle(raw));
    this.socket.on("close", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("CDP bağlantısı kapandı."));
      this.pending.clear();
    });
  }

  handle(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const listener of this.listeners.get(message.method) ?? [])
      listener(message.params ?? {});
  }

  send(method, params = {}) {
    if (this.socket?.readyState !== this.WebSocketClass.OPEN)
      return Promise.reject(new Error("CDP bağlantısı açık değil."));
    const id = (this.counter += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  once(method, timeoutMs = 15_000, { signal } = {}) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        off();
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("CDP olayı bekleyişi iptal edildi."));
      };
      const off = this.on(method, (event) => {
        cleanup();
        resolve(event);
      });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${method} ${timeoutMs} ms içinde gelmedi.`));
      }, timeoutMs);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  close() {
    this.socket?.close();
  }
}

export class DevtoolsPage {
  constructor(session, { sleep = delay, now = Date.now } = {}) {
    this.session = session;
    this.sleep = sleep;
    this.now = now;
  }

  async enable() {
    await Promise.all([
      this.session.send("Page.enable"),
      this.session.send("Runtime.enable"),
      this.session.send("Network.enable"),
      this.session.send("Log.enable"),
    ]);
  }

  async navigate(url) {
    const controller = new AbortController();
    const loaded = this.session.once("Page.loadEventFired", 15_000, { signal: controller.signal });
    const navigated = this.session.send("Page.navigate", { url }).then((result) => {
      if (result.errorText) throw new Error(result.errorText);
    });
    try {
      await Promise.all([navigated, loaded]);
    } finally {
      controller.abort();
    }
  }

  async evaluate(expression) {
    const result = await this.session.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text ?? "Tarayıcı ifadesi hata verdi.");
    return result.result?.value;
  }

  async waitFor(expression, timeoutMs = 10_000) {
    const started = this.now();
    const poll = async () => {
      if (this.now() - started >= timeoutMs)
        throw new Error(`Koşul ${timeoutMs} ms içinde oluşmadı: ${expression}`);
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await this.sleep(100);
      return poll();
    };
    return poll();
  }

  settle(ms = 1200) {
    return this.sleep(ms);
  }

  async setCookieHeader(cookieHeader, origin) {
    const cookies = cookieHeader
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf("=");
        return index < 1
          ? null
          : { name: pair.slice(0, index), value: pair.slice(index + 1), url: origin };
      })
      .filter(Boolean);
    if (cookies.length) await this.session.send("Network.setCookies", { cookies });
  }
}

export async function launchDevtoolsBrowser(dependencies = {}) {
  const runtime = { ...browserRuntime, ...dependencies };
  const executable = chromeExecutable(runtime);
  const port = await freePort(runtime);
  const profile = await runtime.mkdtemp(join(runtime.tmpdir(), "derslik-devtools-"));
  let child;
  let session;
  try {
    child = runtime.spawn(
      executable,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--headless=new",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,1000",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const endpoint = await waitForDebugger(port, child, runtime);
    const targets = await json(endpoint + "/json/list", runtime);
    const target = targets.find((item) => item.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome sayfa hedefi bulunamadı.");
    session = new CdpSession(target.webSocketDebuggerUrl, runtime);
    await session.connect();
    const page = new DevtoolsPage(session);
    await page.enable();
    const close = async () => {
      session.close();
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, runtime.delay(1500)]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await runtime.rm(profile, { recursive: true, force: true });
    };
    return { session, page, close };
  } catch (error) {
    session?.close();
    child?.kill("SIGKILL");
    await runtime.rm(profile, { recursive: true, force: true });
    throw error;
  }
}

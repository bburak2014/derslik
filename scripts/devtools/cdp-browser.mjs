import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function executableCandidates() {
  const explicit = process.env.CHROME_PATH;
  const platform = process.platform;
  const candidates = explicit ? [explicit] : [];
  if (platform === "darwin")
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  if (platform === "win32")
    candidates.push(
      `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  candidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
  return candidates;
}

function commandAvailable(command) {
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const checker = process.platform === "win32" ? "where" : "which";
  return spawnSync(checker, [command], { stdio: "ignore" }).status === 0;
}

function chromeExecutable() {
  const command = executableCandidates().find(commandAvailable);
  if (!command)
    throw new Error(
      "Chrome/Chromium bulunamadı. CHROME_PATH ile tarayıcı çalıştırılabilir dosyasını belirtin.",
    );
  return command;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function waitForDebugger(port, child) {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Chrome beklenmedik biçimde kapandı: ${child.exitCode}`);
    try {
      await json(endpoint + "/json/version");
      return endpoint;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Chrome DevTools Protocol 10 saniye içinde hazır olmadı.");
}

export class CdpSession {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.counter = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
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

  once(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      let timer;
      const off = this.on(method, (event) => {
        clearTimeout(timer);
        off();
        resolve(event);
      });
      timer = setTimeout(() => {
        off();
        reject(new Error(`${method} ${timeoutMs} ms içinde gelmedi.`));
      }, timeoutMs);
    });
  }

  close() {
    this.socket?.close();
  }
}

export class DevtoolsPage {
  constructor(session) {
    this.session = session;
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
    const loaded = this.session.once("Page.loadEventFired");
    const result = await this.session.send("Page.navigate", { url });
    if (result.errorText) throw new Error(result.errorText);
    await loaded;
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
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await delay(100);
    }
    throw new Error(`Koşul ${timeoutMs} ms içinde oluşmadı: ${expression}`);
  }

  settle(ms = 1200) {
    return delay(ms);
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

export async function launchDevtoolsBrowser() {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "derslik-devtools-"));
  const executable = chromeExecutable();
  const child = spawn(
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
  let session;
  try {
    const endpoint = await waitForDebugger(port, child);
    const targets = await json(endpoint + "/json/list");
    const target = targets.find((item) => item.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome sayfa hedefi bulunamadı.");
    session = new CdpSession(target.webSocketDebuggerUrl);
    await session.connect();
    const page = new DevtoolsPage(session);
    await page.enable();
    const close = async () => {
      session.close();
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        delay(1500),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true });
    };
    return { session, page, close };
  } catch (error) {
    session?.close();
    child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

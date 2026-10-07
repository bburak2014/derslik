import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeMessageSend, analyzeWindow, DevtoolsRecorder } from "./network-audit.mjs";
import { launchDevtoolsBrowser } from "./cdp-browser.mjs";

const DEFAULT_ROUTES = {
  public: ["/"],
  teacher: [
    "/?view=overview",
    "/?view=calendar",
    "/?view=students",
    "/?view=messages",
    "/?view=payments",
    "/?view=assignments",
    "/?view=files",
    "/?view=videos",
    "/?view=showcase",
  ],
  portal: [
    "/?view=lessons",
    "/?view=messages",
    "/?view=assignments",
    "/?view=files",
    "/?view=videos",
    "/?view=notes",
    "/?view=payments",
    "/?view=teachers",
    "/?view=requests",
  ],
};

export function auditConfiguration(env = process.env) {
  const profile = env.DEVTOOLS_PROFILE ?? "public";
  const explicit = env.DEVTOOLS_ROUTES;
  const routes = explicit
    ? explicit.split(",").map((route) => route.trim()).filter(Boolean)
    : DEFAULT_ROUTES[profile];
  if (!routes)
    throw new Error(
      `Bilinmeyen DEVTOOLS_PROFILE=${profile}. public, teacher veya portal kullanın.`,
    );
  return {
    baseUrl: env.DEVTOOLS_BASE_URL ?? "http://127.0.0.1:3000",
    profile,
    routes,
    reportPath: env.DEVTOOLS_REPORT ?? "reports/devtools-audit.json",
    settleMs: Number(env.DEVTOOLS_SETTLE_MS ?? 1200),
    duplicateWindowMs: Number(env.DEVTOOLS_DUPLICATE_WINDOW_MS ?? 800),
  };
}

function absolute(route, config) {
  return new URL(route, config.baseUrl).toString();
}

function printResult(name, result) {
  if (result.ok) {
    console.log(`PASS ${name}`);
    return;
  }
  console.error(`FAIL ${name}`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
}

async function fillAndSend(page, text) {
  const encoded = JSON.stringify(text);
  const result = await page.evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement))
      return { ok: false, reason: 'Mesaj textarea bulunamadı.' };
    const form = textarea.closest('form');
    if (!(form instanceof HTMLFormElement))
      return { ok: false, reason: 'Mesaj formu bulunamadı.' };
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(textarea, ${encoded});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  if (!result?.ok) throw new Error(result?.reason ?? "Mesaj alanı hazırlanamadı.");
  await page.waitFor(
    `(() => {
      const textarea = document.querySelector('textarea');
      const button = textarea?.closest('form')?.querySelector('button[type="submit"]');
      return textarea && textarea.value === ${encoded} && button && !button.disabled;
    })()`,
  );
  await page.evaluate(`(() => {
    const textarea = document.querySelector('textarea');
    const form = textarea?.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Mesaj formu bulunamadı.');
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
}

async function auditRoute(page, recorder, route, config) {
  const mark = recorder.checkpoint();
  await page.navigate(absolute(route, config));
  await page.settle(config.settleMs);
  const window = recorder.window(mark);
  return {
    route,
    result: analyzeWindow(window, { duplicateWindowMs: config.duplicateWindowMs }),
    counts: {
      requests: window.requests.length,
      responses: window.responses.length,
      websocketCreated: window.websockets.created.length,
      websocketReceived: window.websockets.received.length,
    },
  };
}

async function auditMessageSend(page, recorder, config, env) {
  const route = env.DEVTOOLS_MESSAGE_URL;
  if (!route) return null;
  await page.navigate(absolute(route, config));
  await page.waitFor(`document.querySelector('textarea')`);
  await page.settle(config.settleMs);
  const socketCreatedBeforeSend = recorder.websockets.created.length;
  const mark = recorder.checkpoint();
  const text =
    env.DEVTOOLS_MESSAGE_TEXT ?? `devtools-${Date.now().toString(36)}`;
  await fillAndSend(page, text);
  await page.settle(config.settleMs);
  const window = recorder.window(mark);
  const send = analyzeMessageSend(window);
  const general = analyzeWindow(window, { duplicateWindowMs: config.duplicateWindowMs });
  const problems = [...send.problems, ...general.problems];
  const requireSocket = env.DEVTOOLS_ALLOW_NO_SOCKET !== "1";
  const socketSeen =
    socketCreatedBeforeSend > 0 || window.websockets.created.length > 0;
  if (requireSocket && !socketSeen)
    problems.push("Mesajlaşma sayfasında WebSocket bağlantısı görülmedi.");
  return {
    route,
    text,
    ok: problems.length === 0,
    problems,
    send,
    socketSeen,
    counts: {
      requests: window.requests.length,
      websocketCreated: recorder.websockets.created.length,
      websocketSent: window.websockets.sent.length,
      websocketReceived: window.websockets.received.length,
    },
  };
}

export async function runAudit({ env = process.env, launchBrowser = launchDevtoolsBrowser } = {}) {
  const config = auditConfiguration(env);
  const { baseUrl, profile, reportPath, settleMs, duplicateWindowMs } = config;
  const browser = await launchBrowser();
  const recorder = new DevtoolsRecorder(browser.session);
  const rows = [];
  let message = null;
  try {
    if (env.DEVTOOLS_COOKIE)
      await browser.page.setCookieHeader(env.DEVTOOLS_COOKIE, baseUrl);
    // All routes share one page and recorder; finish each capture before navigating again.
    await config.routes.reduce((previous, route) => previous.then(async () => {
      try {
        const row = await auditRoute(browser.page, recorder, route, config);
        rows.push(row);
        printResult(`${profile} ${route}`, row.result);
      } catch (error) {
        const result = { ok: false, problems: [String(error.message ?? error)] };
        rows.push({ route, result, counts: {} });
        printResult(`${profile} ${route}`, result);
      }
    }), Promise.resolve());
    try {
      message = await auditMessageSend(browser.page, recorder, config, env);
      if (message)
        printResult("mesaj gönderimi / network + WebSocket", message);
    } catch (error) {
      message = {
        route: env.DEVTOOLS_MESSAGE_URL,
        ok: false,
        problems: [String(error.message ?? error)],
      };
      printResult("mesaj gönderimi / network + WebSocket", message);
    }
  } finally {
    await browser.close();
  }
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    profile,
    duplicateWindowMs,
    settleMs,
    routes: rows,
    message,
    passed: rows.filter((row) => row.result.ok).length + (message?.ok ? 1 : 0),
    failed: rows.filter((row) => !row.result.ok).length + (message && !message.ok ? 1 : 0),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`DevTools raporu: ${reportPath}`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = await runAudit();
  process.exitCode = report.failed ? 1 : 0;
}

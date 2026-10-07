import { URL } from "node:url";

const API_PREFIX = "/api/";
const MESSAGE_SEGMENT = "/messages/";

function parsed(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isApiUrl(url) {
  return parsed(url)?.pathname.startsWith(API_PREFIX) ?? false;
}

export function requestLabel(request) {
  const url = parsed(request.url);
  if (!url) return `${request.method} ${request.url}`;
  return `${request.method} ${url.pathname}${url.search}`;
}

export function duplicateApiGets(requests, windowMs = 800) {
  const last = new Map();
  const duplicates = [];
  for (const request of requests) {
    if (request.method !== "GET" || !isApiUrl(request.url)) continue;
    const key = requestLabel(request);
    const previous = last.get(key);
    if (previous && request.at - previous.at <= windowMs)
      duplicates.push({ previous, request });
    last.set(key, request);
  }
  return duplicates;
}

function responseFailures(window) {
  return window.responses.filter(
    (response) => isApiUrl(response.url) && response.status >= 400,
  );
}

function loadingFailures(window) {
  return window.failures.filter((failure) => isApiUrl(failure.url));
}

function consoleFailures(window) {
  return window.console.filter((entry) => entry.level === "error");
}

export function analyzeWindow(window, { duplicateWindowMs = 800 } = {}) {
  const duplicates = duplicateApiGets(window.requests, duplicateWindowMs);
  const responses = responseFailures(window);
  const failures = loadingFailures(window);
  const console = consoleFailures(window);
  const problems = [];
  for (const item of responses)
    problems.push(`HTTP ${item.status}: ${item.url}`);
  for (const item of failures)
    problems.push(`Ağ hatası ${item.errorText}: ${item.url}`);
  for (const item of duplicates)
    problems.push(`Tekrarlı GET: ${requestLabel(item.request)}`);
  for (const item of console)
    problems.push(`Console error: ${item.text}`);
  return { ok: problems.length === 0, problems, duplicates, responses, failures, console };
}

function pathOf(url) {
  return parsed(url)?.pathname ?? "";
}

function isMessagePost(request) {
  const path = pathOf(request.url);
  return request.method === "POST" && path.includes(MESSAGE_SEGMENT);
}

function senderRefetches(requests, post) {
  const postPath = pathOf(post.url);
  const parent = postPath.slice(0, postPath.lastIndexOf("/"));
  const watched = new Set([postPath, parent, "/api/backend/inbox"]);
  return requests.filter(
    (request) =>
      request.at >= post.at &&
      request.method === "GET" &&
      watched.has(pathOf(request.url)),
  );
}

export function analyzeMessageSend(window) {
  const posts = window.requests.filter(isMessagePost);
  const problems = [];
  if (posts.length !== 1)
    problems.push(`Mesaj gönderiminde 1 POST bekleniyordu, ${posts.length} bulundu.`);
  const post = posts[0] ?? null;
  const refetches = post ? senderRefetches(window.requests, post) : [];
  for (const request of refetches)
    problems.push(`Gönderen gereksiz GET attı: ${requestLabel(request)}`);
  return {
    ok: problems.length === 0,
    problems,
    post,
    refetches,
    websocketFramesReceived: window.websockets.received.length,
    websocketFramesSent: window.websockets.sent.length,
  };
}

function textFromArgs(args = []) {
  return args
    .map((arg) => {
      if (typeof arg.value === "string") return arg.value;
      if (arg.value !== undefined) return String(arg.value);
      return arg.description ?? "";
    })
    .filter(Boolean)
    .join(" ");
}

export class DevtoolsRecorder {
  constructor(session) {
    this.requests = [];
    this.responses = [];
    this.failures = [];
    this.console = [];
    this.websockets = { created: [], sent: [], received: [], closed: [] };
    this.byId = new Map();
    this.bind(session);
  }

  bind(session) {
    session.on("Network.requestWillBeSent", (event) => {
      const row = {
        requestId: event.requestId,
        method: event.request.method,
        url: event.request.url,
        type: event.type ?? "",
        at: Date.now(),
      };
      this.requests.push(row);
      this.byId.set(event.requestId, row);
    });
    session.on("Network.responseReceived", (event) => {
      this.responses.push({
        requestId: event.requestId,
        url: event.response.url,
        status: event.response.status,
        at: Date.now(),
      });
    });
    session.on("Network.loadingFailed", (event) => {
      const request = this.byId.get(event.requestId);
      this.failures.push({
        requestId: event.requestId,
        url: request?.url ?? "",
        errorText: event.errorText,
        at: Date.now(),
      });
    });
    session.on("Network.webSocketCreated", (event) => {
      this.websockets.created.push({ url: event.url, at: Date.now() });
    });
    session.on("Network.webSocketFrameSent", (event) => {
      this.websockets.sent.push({ payload: event.response.payloadData, at: Date.now() });
    });
    session.on("Network.webSocketFrameReceived", (event) => {
      this.websockets.received.push({ payload: event.response.payloadData, at: Date.now() });
    });
    session.on("Network.webSocketClosed", (event) => {
      this.websockets.closed.push({ requestId: event.requestId, at: Date.now() });
    });
    session.on("Runtime.consoleAPICalled", (event) => {
      if (event.type !== "error") return;
      this.console.push({
        level: "error",
        text: textFromArgs(event.args),
        at: Date.now(),
      });
    });
    session.on("Runtime.exceptionThrown", (event) => {
      this.console.push({
        level: "error",
        text: event.exceptionDetails?.text ?? "Unhandled page exception",
        at: Date.now(),
      });
    });
    session.on("Log.entryAdded", (event) => {
      if (event.entry.level !== "error") return;
      this.console.push({ level: "error", text: event.entry.text, at: Date.now() });
    });
  }

  checkpoint() {
    return {
      requests: this.requests.length,
      responses: this.responses.length,
      failures: this.failures.length,
      console: this.console.length,
      websocketCreated: this.websockets.created.length,
      websocketSent: this.websockets.sent.length,
      websocketReceived: this.websockets.received.length,
      websocketClosed: this.websockets.closed.length,
    };
  }

  window(mark) {
    return {
      requests: this.requests.slice(mark.requests),
      responses: this.responses.slice(mark.responses),
      failures: this.failures.slice(mark.failures),
      console: this.console.slice(mark.console),
      websockets: {
        created: this.websockets.created.slice(mark.websocketCreated),
        sent: this.websockets.sent.slice(mark.websocketSent),
        received: this.websockets.received.slice(mark.websocketReceived),
        closed: this.websockets.closed.slice(mark.websocketClosed),
      },
    };
  }
}

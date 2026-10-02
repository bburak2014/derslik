import { readFile, writeFile, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Only the disposable local security fixture is supported. Credentials stay
// in process memory; generated plans contain no tokens or session cookies.
const mode = process.argv[2];
if (!["api", "web"].includes(mode)) throw new Error("Usage: node scripts/security-zap-fixture.mjs api|web");
const reportDir = resolve("reports/security");
const fixture = JSON.parse(await readFile(resolve(reportDir, "backend-fixture.json"), "utf8"));
const expires = typeof fixture.expiresAt === "number" ? fixture.expiresAt * 1000 : Date.parse(fixture.expiresAt);
if (!Number.isFinite(expires) || expires < Date.now() + 15 * 60_000) throw new Error("Security fixture needs at least 15 minutes remaining; restart it first.");
const seeds = JSON.parse(await readFile(resolve(reportDir, "backend-zap-seeds.json"), "utf8")).seeds;
const target = mode === "api" ? "http://host.docker.internal:3101" : "http://host.docker.internal:3100";
let header = "Authorization", credential = `Bearer ${fixture.actors.owner.token}`;
if (mode === "web") {
  const sessions = JSON.parse(await readFile(resolve(reportDir, "web-fixture-session.json"), "utf8"));
  header = "Cookie";
  credential = sessions.accounts.find((a) => a.name === "owner").cookie;
}
const requests = seeds.filter((s) => s.actor === "owner" && (mode === "api" || s.path.startsWith("/v1/"))).map((seed) => ({
  url: target + (mode === "web" ? "/api/backend" + seed.path.slice(3) : seed.path),
  method: seed.method,
  headers: ["Content-Type: application/json", `Idempotency-Key: ${randomUUID()}`,
    ...(mode === "web" ? ["Origin: http://127.0.0.1:3100", "X-Derslik-Client: web"] : [])],
  ...(seed.body ? { data: JSON.stringify(seed.body) } : {}),
}));
if (mode === "web") requests.unshift(...["/", "/teachers", "/reset-password", "/api/session", "/api/auth/providers"].map((path) => ({ url: target + path, method: "GET" })));
const plan = {
  env: { contexts: [{ name: "local-fixture", urls: [target], includePaths: [target.replaceAll(".", String.raw`\.`) + "/.*"], excludePaths: mode === "web" ? [target + "/api/auth/signout.*"] : [] }], parameters: { failOnError: true, failOnWarning: false, progressToStdout: true } },
  jobs: [
    ...(mode === "web" ? [{ type: "replacer", rules: [
      { description: "Local fixture origin", url: String.raw`http://host\.docker\.internal:3100/.*`, matchType: "req_header", matchString: "Origin", replacementString: "http://127.0.0.1:3100" },
      { description: "Local fixture client", url: String.raw`http://host\.docker\.internal:3100/.*`, matchType: "req_header", matchString: "X-Derslik-Client", replacementString: "web" },
    ] }] : []),
    { type: "passiveScan-config", parameters: { scanOnlyInScope: true, maxAlertsPerRule: 20 } },
    { type: "requestor", requests },
    ...(mode === "web" ? [{ type: "spider", parameters: { context: "local-fixture", url: target, maxDuration: 1, maxDepth: 5, acceptCookies: false } }] : []),
    { type: "passiveScan-wait", parameters: { maxDuration: 2 } },
    { type: "activeScan", parameters: { context: "local-fixture", maxScanDurationInMins: 12, maxRuleDurationInMins: 2, threadPerHost: 2, delayInMs: 20, addQueryParam: true, maxAlertsPerRule: 20 }, policyDefinition: { defaultStrength: "Medium", defaultThreshold: "Medium" } },
    { type: "passiveScan-wait", parameters: { maxDuration: 2 } },
    ...["json", "html"].map((format) => ({ type: "report", alwaysRun: true, parameters: { template: `traditional-${format}`, reportDir: "/zap/wrk", reportFile: `zap-${mode}-active.${format}`, reportTitle: `Derslik isolated ${mode} authenticated security scan` } })),
  ],
};
await writeFile(resolve(reportDir, `zap-${mode}-active.yaml`), JSON.stringify(plan, null, 2));
const log = await open(resolve(reportDir, `zap-${mode}-active.log`), "w", 0o600);
const child = spawn("docker", ["run", "--rm", "--name", `derslik-zap-${mode}-active`, "-e", "ZAP_AUTH_HEADER_VALUE", "-e", "ZAP_AUTH_HEADER", "-e", "ZAP_AUTH_HEADER_SITE", "-v", `${reportDir}:/zap/wrk:rw`, "ghcr.io/zaproxy/zaproxy:stable", "zap.sh", "-cmd", "-autorun", `/zap/wrk/zap-${mode}-active.yaml`], {
  env: { ...process.env, ZAP_AUTH_HEADER: header, ZAP_AUTH_HEADER_VALUE: credential, ZAP_AUTH_HEADER_SITE: `host.docker.internal:${mode === "api" ? 3101 : 3100}` },
  stdio: ["ignore", log.fd, log.fd],
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code) => { await log.close(); console.log(`ZAP ${mode} exited ${code}; reports: reports/security/zap-${mode}-active.*`); process.exitCode = code ?? 1; });

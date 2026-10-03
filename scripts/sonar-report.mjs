import { readFileSync } from "node:fs";
import { SCANNER_IMAGE } from "./sonar-local.mjs";

export function scannerInvocation({
  root,
  host,
  container,
  network,
  token,
  nodeMaxspace,
  javaOpts,
  scannerPath,
  userHome,
  nodePath = process.execPath,
}) {
  const commonEnvironment = {
    ...process.env,
    SONAR_TOKEN: token,
    NODE_OPTIONS: `--max-old-space-size=${nodeMaxspace}`,
    SONAR_SCANNER_JAVA_OPTS: javaOpts,
  };
  const memoryArgument = `-Dsonar.javascript.node.maxspace=${nodeMaxspace}`;
  if (scannerPath) {
    return {
      command: scannerPath,
      args: [memoryArgument, `-Dsonar.nodejs.executable=${nodePath}`],
      options: {
        cwd: root,
        stdio: "inherit",
        env: {
          ...commonEnvironment,
          SONAR_HOST_URL: host,
          SONAR_USER_HOME: userHome,
        },
      },
    };
  }
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      network,
      "-e",
      "SONAR_HOST_URL",
      "-e",
      "SONAR_TOKEN",
      "-e",
      "NODE_OPTIONS",
      "-e",
      "SONAR_SCANNER_JAVA_OPTS",
      "-v",
      `${root}:/usr/src`,
      // İmajın arm64 sürümü yok; Apple Silicon'da öykünmeyle çalışır.
      "--platform",
      "linux/amd64",
      SCANNER_IMAGE,
      memoryArgument,
    ],
    options: {
      stdio: "inherit",
      env: { ...commonEnvironment, SONAR_HOST_URL: `http://${container}:9000` },
    },
  };
}

export function scannerTaskId(file) {
  const properties = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  if (!properties.ceTaskId?.trim()) {
    throw new Error(
      "Scanner raporunda ceTaskId yok; bu analizin sonucu doğrulanamadı.",
    );
  }
  return properties.ceTaskId.trim();
}

async function jsonResponse(request, pathname) {
  const response = await request("GET", pathname);
  if (!response.ok) {
    throw new Error(
      `SonarQube API ${response.status}: ${pathname.split("?")[0]}`,
    );
  }
  return response.json();
}

export async function waitForAnalysis(request, taskId, options = {}) {
  const {
    timeoutMs = 600_000,
    pollMs = 2000,
    now = Date.now,
    sleep = (duration) =>
      new Promise((resolve) => setTimeout(resolve, duration)),
  } = options;
  const started = now();
  while (now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop -- yoklama: görev durumu her turda öncekinden sonra sorulur ve sonuç döngünün sürüp sürmeyeceğini belirler.
    const { task } = await jsonResponse(
      request,
      `/api/ce/task?id=${encodeURIComponent(taskId)}`,
    );
    if (task?.id !== taskId) {
      throw new Error("SonarQube beklenen analiz görevini döndürmedi.");
    }
    if (task.status === "SUCCESS") {
      if (!task.analysisId)
        throw new Error("SonarQube analiz kimliğini döndürmedi.");
      return task.analysisId;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(
        `SonarQube analizi ${task.status}: ${task.errorMessage ?? taskId}`,
      );
    }
    if (task.status !== "PENDING" && task.status !== "IN_PROGRESS") {
      throw new Error(`Bilinmeyen SonarQube görev durumu: ${task.status}`);
    }
    // eslint-disable-next-line no-await-in-loop -- yoklama aralığı: görev durumu tekrar sorulmadan önce beklenir, paralel olursa aralık anlamsız kalır.
    await sleep(pollMs); // NOSONAR: yoklama aralığı: görev durumu tekrar sorulmadan önce beklenir, paralel olursa aralık anlamsız kalır
  }
  throw new Error(`SonarQube analiz görevi zaman aşımına uğradı: ${taskId}`);
}

export async function collectAnalysisReport(
  request,
  project,
  taskId,
  analysisId,
) {
  const keys = [
    "ncloc",
    "bugs",
    "vulnerabilities",
    "code_smells",
    "security_hotspots",
    "duplicated_lines_density",
    "cognitive_complexity",
    "sqale_index",
    "coverage",
    "lines_to_cover",
    "uncovered_lines",
  ];
  const [measures, gate] = await Promise.all([
    jsonResponse(
      request,
      `/api/measures/component?component=${encodeURIComponent(project)}&metricKeys=${keys.join(",")}`,
    ),
    jsonResponse(
      request,
      `/api/qualitygates/project_status?analysisId=${encodeURIComponent(analysisId)}`,
    ),
  ]);
  if (
    measures.component?.key !== project ||
    !Array.isArray(measures.component.measures)
  ) {
    throw new Error("SonarQube proje ölçülerini döndürmedi.");
  }
  if (!gate.projectStatus?.status) {
    throw new Error("SonarQube kalite kapısı sonucunu döndürmedi.");
  }
  return {
    generatedAt: new Date().toISOString(),
    project,
    taskId,
    analysisId,
    metrics: Object.fromEntries(
      measures.component.measures.map(({ metric, value }) => [metric, value]),
    ),
    qualityGate: gate.projectStatus,
    coverageMeasured: measures.component.measures.some(
      ({ metric }) => metric === "coverage",
    ),
    // This command has no instrumentation/LCOV import configured. A Sonar
    // metric alone (including its automatic zero-coverage fallback) is not
    // evidence that tests generated and uploaded a coverage report.
    coverageReportImported: false,
  };
}

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "pg";
import { AppModule } from "./app.module.js";
import { loadConfig, type ApiConfig } from "./config.js";
import { DatabaseService } from "./db/database.service.js";
import { ApiErrorFilter } from "./common/api-error.filter.js";
import { localeMiddleware } from "./common/i18n.js";

// DATE is a calendar day, not a process-local midnight instant.
types.setTypeParser(1082, (value) => value);

/** Tek bir uç için daha büyük JSON gövdesi. Gövde burada okunursa genel
 *  ayrıştırıcı (`_body` işaretini görür) onu yeniden okumaz. */
function largeJson(limit: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (
      req.method !== "PUT" ||
      !req.headers["content-type"]?.startsWith("application/json")
    )
      return next();
    const chunks: Buffer[] = [];
    let size = 0,
      failed = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit && !failed) {
        failed = true;
        next(
          Object.assign(new Error("too large"), { type: "entity.too.large" }),
        );
      }
      if (!failed) chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      try {
        req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        (req as Request & { _body?: boolean })._body = true;
        next();
      } catch {
        next(
          Object.assign(new Error("invalid json"), {
            type: "entity.parse.failed",
          }),
        );
      }
    });
    req.on("error", next);
  };
}

export async function createApplication(config: ApiConfig) {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config),
    {
      logger: config.NODE_ENV === "test" ? false : ["error", "warn", "log"],
      abortOnError: false,
      rawBody: true,
    },
  );
  app.disable("x-powered-by");
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Request-Id", randomUUID());
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(localeMiddleware);
  // Vitrin fotoğrafı JSON içinde base64 gelir; yalnızca o uç daha büyük gövde alır.
  app.use("/v1/workspaces/:ws/showcase/photo", largeJson(512 * 1024));
  app.useBodyParser("json", { limit: "16kb" });
  app.enableCors({
    origin: (origin, callback) =>
      callback(null, !!origin && config.origins.includes(origin)),
    methods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "Accept-Language",
    ],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
  });
  app.useGlobalFilters(new ApiErrorFilter());
  try {
    await app.get(DatabaseService).assertRuntimeRole();
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = loadConfig();
  const app = await createApplication(config);
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, config.API_HOST);
}

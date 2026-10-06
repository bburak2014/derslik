import "reflect-metadata";
import { HttpException, HttpStatus } from "@nestjs/common";
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
import { ipBucket, RateLimiter, RecentKeys } from "./common/rate-limit.js";
import { RealtimeService } from "./messages/realtime.service.js";

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
  app.set("trust proxy", config.TRUST_PROXY);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Request-Id", randomUUID());
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(localeMiddleware);
  // Herkese açık vitrin oturum istemez; IP başına sınırlanır. Web sunucusu
  // ziyaretçinin IP'sini X-Forwarded-For ile iletir.
  const publicLimiter = new RateLimiter(config.RATE_LIMIT_PUBLIC_PER_MINUTE);
  app.use("/v1/teachers", (req: Request, res: Response, next: NextFunction) => {
    const wait = publicLimiter.take(ipBucket(req.ip || "unknown"));
    if (!wait) return next();
    res.setHeader("Retry-After", String(wait));
    next(
      new HttpException("api.tooManyRequests", HttpStatus.TOO_MANY_REQUESTS),
    );
  });
  // Takvim akışını takvim uygulamaları oturumsuz okur. Sınır bağlantı
  // başınadır, IP başına değil: Google ve Apple bütün abonelikleri birkaç ortak
  // sunucudan okur ve web vekili ziyaretçi IP'sini her kurulumda bilmez.
  // Belirteç 256 bittir; tahmin edilemez, bilinmeyen belirteç tek bir indeksli
  // okumaya mal olur. Express HEAD'i de GET işleyicisine verir.
  // Bağlantı başına sınır, her istekte değişen belirteçle yapılan taramayı
  // durdurmaz: bulunamayan bağlantılar ortak bir bütçeden sayılır. Bütçe
  // dolunca yalnızca son 24 saatte çalışmış bağlantılar veritabanına ulaşır;
  // mevcut abonelikler tarama sırasında da okunur.
  const calendarLimiter = new RateLimiter(
    config.RATE_LIMIT_CALENDAR_PER_MINUTE,
  );
  const calendarMisses = new RateLimiter(
    config.RATE_LIMIT_CALENDAR_MISSES_PER_MINUTE,
  );
  const workingFeeds = new RecentKeys(50_000, 24 * 3_600_000);
  app.use("/v1/calendar", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Aynı bağlantının kodlanmış ya da sonu eğik çizgili biçimi de aynı
    // sayaca düşer. Belirteç biçiminde olmayan yol veritabanına hiç ulaşmaz
    // (işleyicide 404); sayılmaz, sayaç da uzun yollarla şişirilemez.
    let path = req.path;
    try {
      path = decodeURIComponent(path);
    } catch {
      return next();
    }
    const token = /^\/([a-f0-9]{64})\/?$/i.exec(path)?.[1]?.toLowerCase();
    if (!token) return next();
    const wait =
      (!workingFeeds.has(token) && calendarMisses.peek("miss")) ||
      calendarLimiter.take(token);
    if (!wait) {
      res.on("finish", () => {
        if (res.statusCode === 404) {
          workingFeeds.delete(token);
          calendarMisses.take("miss");
        } else if (res.statusCode < 300) workingFeeds.add(token);
      });
      return next();
    }
    res.setHeader("Retry-After", String(wait));
    next(
      new HttpException("api.tooManyRequests", HttpStatus.TOO_MANY_REQUESTS),
    );
  });
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
    // Anlık mesajlaşma soketi aynı HTTP sunucusunda, /v1/socket'te.
    app.get(RealtimeService).attach(app.getHttpServer());
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

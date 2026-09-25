import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { translate } from "../../../../packages/contracts/src/i18n/index.js";
import { localizeMessage, requestLocale } from "./i18n.js";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const locale = requestLocale(host.switchToHttp().getRequest<Request>());
    const requestId = response.getHeader("X-Request-Id") || randomUUID();
    let status = 500;
    let message = translate(locale, "api.failed");
    let details: unknown;
    if (error instanceof ZodError) {
      status = 400;
      message = translate(locale, "api.invalidFields");
      details = error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: localizeMessage(locale, issue.message),
      }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      // Servisler iletiyi çeviri anahtarı olarak fırlatır ("api.lessonNotFound").
      message = localizeMessage(locale, error.message);
    } else {
      const code = (error as { code?: string })?.code;
      if (code === "23505" || code === "23P01") {
        status = 409;
        message = translate(locale, "api.duplicate");
      } else if (code === "23503" || code === "23514") {
        status = 409;
        message = translate(locale, "api.relationInvalid");
      } else if (
        code === "40001" ||
        code === "40P01" ||
        code === "57014" ||
        code === "55P03"
      ) {
        status = 503;
        message = translate(locale, "api.retryLater");
      } else if ((error as { type?: string })?.type === "entity.too.large") {
        status = 413;
        message = translate(locale, "api.bodyTooLarge");
      } else if ((error as { type?: string })?.type === "entity.parse.failed") {
        status = 400;
        message = translate(locale, "api.invalidJson");
      }
      // Do not log SQL parameter values, authentication headers or private note bodies.
      console.error("Derslik API request failed", {
        requestId,
        code: code || "INTERNAL_ERROR",
      });
    }
    response.status(status).json({
      error: { status, message, requestId, ...(details ? { details } : {}) },
    });
  }
}

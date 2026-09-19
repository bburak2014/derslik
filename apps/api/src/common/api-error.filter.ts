import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = response.getHeader("X-Request-Id") || randomUUID();
    let status = 500;
    let message = "İşlem tamamlanamadı. Yeniden deneyin.";
    let details: unknown;
    if (error instanceof ZodError) {
      status = 400;
      message = "Eksik veya geçersiz alanları kontrol edin.";
      details = error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else {
      const code = (error as { code?: string })?.code;
      if (code === "23505" || code === "23P01") {
        status = 409;
        message = "Aynı kayıt veya çakışan bir ders zaten var.";
      } else if (code === "23503" || code === "23514") {
        status = 409;
        message = "İlişkili kayıt veya işlem koşulları geçersiz.";
      } else if (
        code === "40001" ||
        code === "40P01" ||
        code === "57014" ||
        code === "55P03"
      ) {
        status = 503;
        message =
          "İşlem geçici olarak tamamlanamadı. Aynı işlem anahtarıyla yeniden deneyin.";
      } else if ((error as { type?: string })?.type === "entity.too.large") {
        status = 413;
        message = "İstek gövdesi 16 KB sınırını aşıyor.";
      } else if ((error as { type?: string })?.type === "entity.parse.failed") {
        status = 400;
        message = "Geçerli JSON gönderin.";
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

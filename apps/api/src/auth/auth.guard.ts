import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request } from "express";
import { z } from "zod";
import { CONFIG, type ApiConfig } from "../config.js";

export type Actor = { id: string; email?: string };
export type ActorRequest = Request & { actor: Actor };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks;

  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {
    this.jwks = createRemoteJWKSet(
      new URL(config.AUTH_ISSUER + "/.well-known/jwks.json"),
      {
        cacheMaxAge: 600_000,
        cooldownDuration: 30_000,
        timeoutDuration: 5_000,
      },
    );
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const authorization = request.headers.authorization;
    if (
      !authorization?.startsWith("Bearer ") ||
      authorization.length > 16_384
    ) {
      throw new UnauthorizedException("Geçerli bir erişim belirteci gerekli.");
    }
    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, {
        issuer: this.config.AUTH_ISSUER,
        audience: this.config.AUTH_AUDIENCE,
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["sub", "exp", "iat", "role"],
        clockTolerance: 5,
      });
      if (payload.role !== "authenticated" || payload.is_anonymous === true) {
        throw new Error("Authenticated account required");
      }
      request.actor = {
        id: z.string().uuid().parse(payload.sub),
        ...(typeof payload.email === "string"
          ? { email: payload.email.toLowerCase() }
          : {}),
      };
      return true;
    } catch {
      throw new UnauthorizedException("Oturum geçersiz veya süresi dolmuş.");
    }
  }
}

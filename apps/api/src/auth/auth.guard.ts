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
import { RateLimiter } from "../common/rate-limit.js";

export type Actor = { id: string; email?: string };
export type ActorRequest = Request & { actor: Actor };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks;
  private readonly limiter;

  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {
    this.limiter = new RateLimiter(config.RATE_LIMIT_USER_PER_MINUTE);
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
    request.actor = await this.verify(request.headers.authorization);
    // Sayaç imza doğrulandıktan sonra: sahte belirteçle kova çoğaltılamaz.
    this.limiter.check(request.actor.id);
    return true;
  }

  /** Oturum isteğe bağlı uçlar (öğretmen vitrini) için: başlık yoksa null. */
  async optional(authorization: string | undefined) {
    return authorization ? this.verify(authorization) : null;
  }

  async verify(authorization: string | undefined): Promise<Actor> {
    if (
      !authorization?.startsWith("Bearer ") ||
      authorization.length > 16_384
    ) {
      throw new UnauthorizedException("api.tokenRequired");
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
      return {
        id: z.string().uuid().parse(payload.sub),
        ...(typeof payload.email === "string"
          ? { email: payload.email.toLowerCase() }
          : {}),
      };
    } catch {
      throw new UnauthorizedException("api.sessionInvalid");
    }
  }
}

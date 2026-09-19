import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { SubscriptionService } from "./subscription.service.js";
@Controller("v1/workspaces/:ws/subscription")
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}
  @Get() get(@Req() r: ActorRequest, @Param("ws") ws: string) {
    return this.subscriptions.get(r.actor, uuid.parse(ws));
  }
  @Post("checkout") checkout(@Req() r: ActorRequest, @Param("ws") ws: string) {
    return this.subscriptions.checkout(r.actor, uuid.parse(ws));
  }
  @Post("portal") portal(@Req() r: ActorRequest, @Param("ws") ws: string) {
    return this.subscriptions.portal(r.actor, uuid.parse(ws));
  }
  @Post("sync") sync(@Req() r: ActorRequest, @Param("ws") ws: string) {
    return this.subscriptions.sync(r.actor, uuid.parse(ws));
  }
}
@Controller("v1/webhooks/subscriptions")
export class SubscriptionWebhookController {
  constructor(private readonly subscriptions: SubscriptionService) {}
  @Post() @HttpCode(200) webhook(
    @Headers("x-signature") signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.subscriptions.webhook(signature, req.rawBody);
  }
}

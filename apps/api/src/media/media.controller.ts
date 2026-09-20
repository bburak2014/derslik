import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { MediaService } from "./media.service.js";
import { MediaProviders } from "./providers.js";

@Controller("v1/media/capabilities")
@UseGuards(AuthGuard)
export class MediaCapabilitiesController {
  constructor(private readonly providers: MediaProviders) {}
  @Get() status() {
    return this.providers.capabilities();
  }
}

@Controller("v1/media/:ws/:student")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Post("files") reserveFile(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.media.reserveFile(
      req.actor,
      uuid.parse(w),
      uuid.parse(s),
      key,
      body,
    );
  }
  @Post("files/:id/finish") finishFile(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
  ) {
    return this.media.finishFile(req.actor, uuid.parse(w), uuid.parse(s), id);
  }
  @Get("files/:id/download") downloadFile(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
    @Query("inline") inline?: string,
  ) {
    return this.media.downloadFile(
      req.actor,
      uuid.parse(w),
      uuid.parse(s),
      id,
      inline === "1",
    );
  }
  @Post("files/:id/delete") deleteFile(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
  ) {
    return this.media.deleteFile(req.actor, uuid.parse(w), uuid.parse(s), id);
  }
  @Post("videos") reserveVideo(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.media.reserveVideo(
      req.actor,
      uuid.parse(w),
      uuid.parse(s),
      key,
      body,
    );
  }
  @Get("videos/:id/playback") playback(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
  ) {
    return this.media.playback(req.actor, uuid.parse(w), uuid.parse(s), id);
  }
  @Post("videos/:id/delete") deleteVideo(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
  ) {
    return this.media.deleteVideo(req.actor, uuid.parse(w), uuid.parse(s), id);
  }
  @Post("videos/:id/refresh") refreshVideo(
    @Req() req: ActorRequest,
    @Param("ws") w: string,
    @Param("student") s: string,
    @Param("id") id: string,
  ) {
    return this.media.refreshVideo(req.actor, uuid.parse(w), uuid.parse(s), id);
  }
}
@Controller("v1/webhooks/stream")
export class StreamWebhookController {
  constructor(private readonly media: MediaService) {}
  @Post() @HttpCode(200) webhook(
    @Headers("webhook-signature") signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.media.webhook(signature, req.rawBody);
  }
}

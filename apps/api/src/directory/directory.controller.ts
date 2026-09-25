import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { z } from "zod";
import { uuid } from "../contracts.js";
import { DirectoryService } from "./directory.service.js";

/** Öğretmen vitrini: giriş yapmadan gezilebilir. */
@Controller("v1/teachers")
export class PublicDirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly auth: AuthGuard,
  ) {}
  @Get() list(@Query() query: unknown) {
    return this.directory.list(query);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.directory.get(id);
  }
  // Oturum varsa öğretmen kendi (yayında olmayan) fotoğrafını, isteği olan
  // öğrenci de öğretmeninkini görür; yoksa yalnızca vitrindekiler.
  @Get(":id/photo") async photo(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const actor = await this.auth.optional(req.headers.authorization);
    const photo = await this.directory.photo(actor, id);
    res.setHeader("Content-Type", photo.type);
    res.setHeader(
      "Cache-Control",
      actor ? "private, max-age=86400" : "public, max-age=86400",
    );
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.end(photo.bytes);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}
  @Get("teacher-relations/:id") relation(
    @Req() req: ActorRequest,
    @Param("id") id: string,
  ) {
    return this.directory.relation(req.actor, id);
  }
  @Post("teacher-relations/:id/requests") request(
    @Req() req: ActorRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.directory.sendRequest(req.actor, id, body);
  }
  @Put("teacher-relations/:id/review") review(
    @Req() req: ActorRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.directory.saveReview(req.actor, id, body);
  }
  @Post("teacher-relations/:id/review/delete") deleteReview(
    @Req() req: ActorRequest,
    @Param("id") id: string,
  ) {
    return this.directory.deleteReview(req.actor, id);
  }
  @Get("requests") mine(@Req() req: ActorRequest) {
    return this.directory.myRequests(req.actor);
  }
  @Post("requests/:id/cancel") cancel(
    @Req() req: ActorRequest,
    @Param("id") id: string,
  ) {
    return this.directory.cancelRequest(req.actor, id);
  }
  @Get("workspaces/:ws/showcase") showcase(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ) {
    return this.directory.showcase(req.actor, uuid.parse(ws));
  }
  @Put("workspaces/:ws/showcase") save(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Body() body: unknown,
  ) {
    return this.directory.saveProfile(req.actor, uuid.parse(ws), body);
  }
  @Put("workspaces/:ws/showcase/photo") photo(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Body() body: unknown,
  ) {
    return this.directory.savePhoto(req.actor, uuid.parse(ws), body);
  }
  @Post("workspaces/:ws/showcase/photo/delete") deletePhoto(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ) {
    return this.directory.deletePhoto(req.actor, uuid.parse(ws));
  }
  @Post("workspaces/:ws/requests/:id/:decision") decide(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Param("decision") decision: string,
  ) {
    return this.directory.decide(
      req.actor,
      uuid.parse(ws),
      id,
      z.enum(["accept", "decline"]).parse(decision),
    );
  }
}

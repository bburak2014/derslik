import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { MessagesService } from "./messages.service.js";

/** Uygulama içi mesajlaşma. `:id` yazışmanın (portal bağlantısının) kimliğidir.
 *  Öğretmen rotaları çalışma alanının yazışmalarını, portal rotaları öğrenci
 *  ve velinin o öğrencideki yazışmalarını açar. ApiController'dan önce kayıtlı
 *  olmalı: onun `GET workspaces/:ws/:resource` rotası listeyi 400 ile yanıtlar. */
@Controller("v1")
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get("workspaces/:ws/messages") list(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Query() query: unknown,
  ) {
    return this.messages.threads(req.actor, uuid.parse(ws), null, query);
  }
  @Get("workspaces/:ws/messages/:id") thread(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return this.messages.thread(
      req.actor,
      uuid.parse(ws),
      null,
      uuid.parse(id),
      query,
    );
  }
  @Post("workspaces/:ws/messages/:id") send(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.messages.send(
      req.actor,
      uuid.parse(ws),
      null,
      uuid.parse(id),
      key,
      body,
    );
  }
  @Post("workspaces/:ws/messages/:id/read") read(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.messages.read(
      req.actor,
      uuid.parse(ws),
      null,
      uuid.parse(id),
      body,
    );
  }
  @Get("portal/:ws/:student/messages") portalList(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.messages.threads(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      {},
    );
  }
  @Get("portal/:ws/:student/messages/:id") portalThread(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return this.messages.thread(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(id),
      query,
    );
  }
  @Post("portal/:ws/:student/messages/:id") portalSend(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.messages.send(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(id),
      key,
      body,
    );
  }
  @Post("portal/:ws/:student/messages/:id/read") portalRead(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.messages.read(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(id),
      body,
    );
  }
}

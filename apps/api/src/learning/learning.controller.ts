import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { LearningService } from "./learning.service.js";
import { AccessService } from "../access/access.service.js";
@Controller("v1")
@UseGuards(AuthGuard)
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly access: AccessService,
  ) {}
  @Get("access") list(@Req() req: ActorRequest) {
    return this.access.list(req.actor);
  }
  @Get("inbox") inbox(@Req() req: ActorRequest) {
    return this.access.inbox(req.actor);
  }
  @Post("inbox/:id/read") read(
    @Req() req: ActorRequest,
    @Param("id") id: string,
  ) {
    return this.access.readNotification(req.actor, id);
  }
  @Post("invitations/accept") accept(
    @Req() req: ActorRequest,
    @Body() body: unknown,
  ) {
    return this.access.accept(req.actor, req.headers.authorization!, body);
  }
  @Get("workspaces/:ws/settings/limits") limits(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ) {
    return this.access.limits(req.actor, uuid.parse(ws));
  }
  @Get("workspaces/:ws/students/:student/learning") learningGet(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.learning.get(req.actor, uuid.parse(ws), uuid.parse(student));
  }
  @Post("workspaces/:ws/students/:student/learning") learningPost(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.learning.mutate(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
    );
  }
  @Get("workspaces/:ws/students/:student/access") accessGet(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.access.links(req.actor, uuid.parse(ws), uuid.parse(student));
  }
  @Post("workspaces/:ws/students/:student/invitations") invite(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.access.invite(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
    );
  }
  @Post("workspaces/:ws/students/:student/access/revoke") revoke(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.access.revoke(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
    );
  }
  @Get("portal/:ws/:student") portal(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.learning.portal(req.actor, uuid.parse(ws), uuid.parse(student));
  }
  @Post("portal/:ws/:student/actions") portalPost(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.learning.mutate(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
      true,
    );
  }
}

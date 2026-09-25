import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ActorRequest } from "./auth/auth.guard.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { CommandService } from "./common/command.service.js";
import { command, uuid } from "./contracts.js";
import { WorkspacesService } from "./workspaces/workspaces.service.js";
import { QueriesService, type Resource } from "./workspaces/queries.service.js";
import { StudentsService } from "./students/students.service.js";
import { LessonsService } from "./lessons/lessons.service.js";
import { BillingService } from "./billing/billing.service.js";
import { z } from "zod";

import { SnapshotService } from "./workspaces/snapshot.service.js";
import { commandSchema } from "../../../packages/contracts/src/validation.js";

@Controller("v1")
@UseGuards(AuthGuard)
export class ApiController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly queries: QueriesService,
    private readonly commands: CommandService,
    private readonly students: StudentsService,
    private readonly lessons: LessonsService,
    private readonly billing: BillingService,
    private readonly snapshots: SnapshotService,
  ) {}

  @Get("workspaces")
  listWorkspaces(@Req() req: ActorRequest) {
    return this.workspaces.list(req.actor);
  }

  @Post("workspaces")
  createWorkspace(@Req() req: ActorRequest, @Body() body: unknown) {
    return this.workspaces.create(req.actor, body);
  }

  @Get("workspaces/:ws/students/:id")
  student(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
  ) {
    return this.queries.student(req.actor, uuid.parse(ws), uuid.parse(id));
  }

  @Get("workspaces/:ws/students/:id/private-note")
  note(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
  ) {
    return this.queries.student(
      req.actor,
      uuid.parse(ws),
      uuid.parse(id),
      true,
    );
  }

  @Get("workspaces/:ws/snapshot")
  snapshot(@Req() req: ActorRequest, @Param("ws") ws: string) {
    return this.snapshots.get(req.actor, uuid.parse(ws));
  }

  @Post("workspaces/:ws/commands")
  sharedCommand(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    const c = commandSchema.parse(body);
    if (c.action === "seed")
      throw new BadRequestException("api.sampleUnsupported");
    return this.mutate(req, ws, key, c.action, c);
  }

  @Get("workspaces/:ws/:resource")
  list(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("resource") resource: string,
    @Query() query: unknown,
  ) {
    const name: Resource = z
      .enum([
        "students",
        "packages",
        "sessions",
        "payments",
        "credit-entries",
        "audit",
      ])
      .parse(resource);
    return this.queries.list(req.actor, uuid.parse(ws), name, query);
  }

  private mutate(
    req: ActorRequest,
    ws: string,
    key: string,
    action: string,
    body: unknown,
    path: Record<string, string> = {},
  ) {
    const payload = command(action, {
      ...z.record(z.unknown()).parse(body),
      ...path,
    });
    return this.commands.run(req.actor, uuid.parse(ws), key, payload, (tx) => {
      if (
        payload.action.startsWith("student.") ||
        payload.action === "note.save"
      )
        return this.students.mutate(tx, ws, payload);
      if (payload.action.startsWith("lesson."))
        return this.lessons.mutate(tx, ws, payload);
      return this.billing.mutate(tx, ws, payload);
    });
  }

  @Post("workspaces/:ws/students")
  createStudent(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "student.create", body);
  }

  @Patch("workspaces/:ws/students/:id")
  updateStudent(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "student.update", body, {
      id: uuid.parse(id),
    });
  }

  @Post("workspaces/:ws/students/:id/archive")
  archiveStudent(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "student.archive", body, {
      id: uuid.parse(id),
    });
  }

  @Put("workspaces/:ws/students/:id/private-note")
  saveNote(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "note.save", body, {
      studentId: uuid.parse(id),
    });
  }

  @Post("workspaces/:ws/packages")
  createPackage(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "package.create", body);
  }

  @Post("workspaces/:ws/sessions")
  createSession(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "lesson.create", body);
  }

  @Post("workspaces/:ws/sessions/:id/:action")
  changeSession(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Param("action") action: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    const next = z
      .enum(["complete", "reverse", "cancel", "reschedule"])
      .parse(action);
    return this.mutate(req, ws, key, `lesson.${next}`, body, {
      id: uuid.parse(id),
    });
  }

  @Post("workspaces/:ws/payments")
  createPayment(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "payment.create", body);
  }

  @Post("workspaces/:ws/payments/:id/void")
  voidPayment(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.mutate(req, ws, key, "payment.void", body, {
      id: uuid.parse(id),
    });
  }
}

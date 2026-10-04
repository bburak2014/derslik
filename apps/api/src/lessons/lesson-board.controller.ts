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
import { z } from "zod";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { LessonBoardService } from "./lesson-board.service.js";
import type {
  LessonBoardReadResult,
  LessonBoardMutationResult,
} from "../../../../packages/contracts/src/live-lesson.js";

@Controller("v1")
@UseGuards(AuthGuard)
export class LessonBoardController {
  constructor(private readonly boards: LessonBoardService) {}

  @Get("workspaces/:ws/students/:student/lessons/:lesson/board")
  teacherGet(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Query("revision") revision?: string,
  ): Promise<LessonBoardReadResult> {
    return this.read(req, ws, student, lesson, false, revision);
  }

  @Get("portal/:ws/:student/lessons/:lesson/board")
  portalGet(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Query("revision") revision?: string,
  ): Promise<LessonBoardReadResult> {
    return this.read(req, ws, student, lesson, true, revision);
  }

  @Post("workspaces/:ws/students/:student/lessons/:lesson/board")
  teacherPost(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ): Promise<LessonBoardMutationResult> {
    return this.write(req, ws, student, lesson, key, body, false);
  }

  @Post("portal/:ws/:student/lessons/:lesson/board")
  portalPost(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ): Promise<LessonBoardMutationResult> {
    return this.write(req, ws, student, lesson, key, body, true);
  }

  private read(
    req: ActorRequest,
    ws: string,
    student: string,
    lesson: string,
    portal: boolean,
    revision?: string,
  ) {
    const current = z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .parse(revision);
    return this.boards.get(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(lesson),
      portal,
      current,
    );
  }

  private write(
    req: ActorRequest,
    ws: string,
    student: string,
    lesson: string,
    key: string,
    body: unknown,
    portal: boolean,
  ) {
    return this.boards.mutate(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(lesson),
      key,
      body,
      portal,
    );
  }
}

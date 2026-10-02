import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import {
  CommandService,
  type MutationResult,
} from "../common/command.service.js";
import { rawDto } from "../workspaces/snapshot.service.js";
import { lockStudent } from "../students/students.service.js";
import { apiText } from "../common/i18n.js";
import type { MessageKey } from "../../../../packages/contracts/src/i18n/index.js";
import { calendarDaySchema } from "../../../../packages/contracts/src/dates.js";

// Due dates are calendar days in the workspace timezone (fixed to Istanbul).
export const ISTANBUL_TODAY = "(now() AT TIME ZONE 'Europe/Istanbul')::date";

const id = z.string().uuid(),
  short = z.string().trim().min(1).max(150),
  body = z.string().trim().min(1).max(5000);
const day = calendarDaySchema;
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assignment.create"),
    title: short,
    instructions: z.string().trim().max(5000),
    dueOn: z.preprocess(
      (v) => (v === "" ? null : v),
      day.nullable().default(null),
    ),
  }),
  z.object({
    action: z.literal("assignment.update"),
    assignmentId: id,
    title: short,
    instructions: z.string().trim().max(5000),
    dueOn: z.preprocess(
      (v) => (v === "" ? null : v),
      day.nullable().default(null),
    ),
    status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]),
    version: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("assignment.submit"),
    assignmentId: id,
    body,
    version: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("assignment.review"),
    submissionId: id,
    feedback: body,
    version: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("note.publish"),
    body,
    audience: z.enum(["STUDENT", "BOTH"]),
  }),
  z.object({
    action: z.literal("question.create"),
    videoId: id,
    atSeconds: z.number().int().min(0).max(7200),
    body,
  }),
  z.object({
    action: z.literal("question.answer"),
    questionId: id,
    answer: body,
    resolved: z.boolean(),
    version: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal("summary.draft"), weekOn: day }),
  z.object({
    action: z.literal("summary.publish"),
    summaryId: id,
    body,
    version: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("video.progress"),
    videoId: id,
    seconds: z.number().int().min(0).max(7200),
  }),
]);

/** Records a notification is about; clients map these to a screen. */
export type NoticeKind =
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "REVIEW"
  | "VIDEO"
  | "QUESTION"
  | "ANSWER"
  | "SUMMARY";

/** The portal permission a link needs to see the record a notice opens. */
const NOTICE_PERMISSION: Record<NoticeKind, string> = {
  ASSIGNMENT: "assignments",
  SUBMISSION: "assignments",
  REVIEW: "assignments",
  VIDEO: "videos",
  QUESTION: "videos",
  ANSWER: "videos",
  SUMMARY: "notes",
};

export async function notify(
  tx: PoolClient,
  ws: string,
  student: string,
  notice: {
    /** Çeviri anahtarı; okuyan kişi kendi dilinde görür. */
    title: MessageKey;
    /** Çeviri anahtarı ya da ödev/video adı gibi serbest metin. */
    body: string;
    kind: NoticeKind;
    /** The assignment, video or summary the notification opens. */
    targetId: string;
    ownerOnly?: boolean;
  },
) {
  await tx.query(
    `INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 SELECT $1,recipient,$2,$3,$4,$6,$7 FROM (
  SELECT owner_id AS recipient FROM derslik.workspaces WHERE id=$1
  UNION SELECT user_id FROM derslik.portal_links WHERE workspace_id=$1 AND student_id=$2 AND revoked_at IS NULL AND NOT $5 AND $8=ANY(permissions)
 ) recipients WHERE recipient<>derslik.actor_id()`,
    [
      ws,
      student,
      notice.title,
      notice.body,
      notice.ownerOnly ?? false,
      notice.kind,
      notice.targetId,
      NOTICE_PERMISSION[notice.kind],
    ],
  );
}

type LearningInput = z.infer<typeof schema>;
type LearningAction<A extends LearningInput["action"]> = Extract<
  LearningInput,
  { action: A }
>;

async function createAssignment(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"assignment.create">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "INSERT INTO derslik.assignments(workspace_id,student_id,title,instructions,due_on) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [ws, student, c.title, c.instructions, c.dueOn],
    )
  ).rows[0];
  await notify(tx, ws, student, {
    title: "notice.assignmentNew",
    body: c.title,
    kind: "ASSIGNMENT",
    targetId: data.id,
  });
  return { data };
}

async function updateAssignment(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"assignment.update">,
): Promise<MutationResult> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    ws + ":" + c.assignmentId,
  ]);
  const data = (
    await tx.query(
      "UPDATE derslik.assignments SET title=$4,instructions=$5,due_on=$6,status=$7,version=version+1 WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND version=$8 RETURNING *",
      [
        ws,
        student,
        c.assignmentId,
        c.title,
        c.instructions,
        c.dueOn,
        c.status,
        c.version,
      ],
    )
  ).rows[0];
  if (!data) throw new ConflictException("api.assignmentChanged");
  return { data };
}

async function submitAssignment(
  tx: PoolClient,
  actor: Actor,
  ws: string,
  student: string,
  c: LearningAction<"assignment.submit">,
): Promise<MutationResult> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    ws + ":" + c.assignmentId,
  ]);
  const assignment = (
    await tx.query(
      `SELECT id,status,due_on IS NOT NULL AND due_on<${ISTANBUL_TODAY} AS past_due
               FROM derslik.assignments WHERE workspace_id=$1 AND student_id=$2 AND id=$3`,
      [ws, student, c.assignmentId],
    )
  ).rows[0];
  if (!assignment) throw new NotFoundException("api.assignmentNotFound");
  if (assignment.status !== "OPEN")
    throw new ConflictException("api.assignmentClosed");
  const previous = (
    await tx.query(
      "SELECT * FROM derslik.submissions WHERE workspace_id=$1 AND assignment_id=$2 FOR UPDATE",
      [ws, c.assignmentId],
    )
  ).rows[0];
  // A late first hand-in is still accepted; changing it is not.
  if (previous && assignment.past_due)
    throw new ConflictException("api.dueDatePassedSubmission");
  if ((previous?.version ?? 0) !== c.version)
    throw new ConflictException("api.submissionChanged");
  // Editing a reviewed hand-in sends it back to the teacher's queue.
  const data = (
    await tx.query(
      `INSERT INTO derslik.submissions(workspace_id,student_id,assignment_id,user_id,body) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(workspace_id,assignment_id) DO UPDATE SET body=EXCLUDED.body,status='SUBMITTED',version=submissions.version+1 RETURNING *`,
      [ws, student, c.assignmentId, actor.id, c.body],
    )
  ).rows[0];
  await notify(tx, ws, student, {
    title: previous ? "notice.submissionUpdated" : "notice.submissionNew",
    body: previous
      ? "notice.submissionUpdatedBody"
      : "notice.submissionNewBody",
    kind: "SUBMISSION",
    targetId: data.assignment_id,
    ownerOnly: true,
  });
  return { data };
}

async function reviewAssignment(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"assignment.review">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "UPDATE derslik.submissions SET feedback=$4,status='REVIEWED',version=version+1 WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND version=$5 RETURNING *",
      [ws, student, c.submissionId, c.feedback, c.version],
    )
  ).rows[0];
  if (!data) throw new ConflictException("api.submissionNotFound");
  await notify(tx, ws, student, {
    title: "notice.reviewed",
    body: "notice.reviewedBody",
    kind: "REVIEW",
    targetId: data.assignment_id,
  });
  return { data };
}

async function publishNote(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"note.publish">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "INSERT INTO derslik.shared_notes(workspace_id,student_id,body,audience) VALUES($1,$2,$3,$4) RETURNING *",
      [ws, student, c.body, c.audience],
    )
  ).rows[0];
  return { data, audit: { audience: c.audience } };
}

async function askQuestion(
  tx: PoolClient,
  actor: Actor,
  ws: string,
  student: string,
  c: LearningAction<"question.create">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "INSERT INTO derslik.video_questions(workspace_id,student_id,video_id,user_id,at_seconds,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [ws, student, c.videoId, actor.id, c.atSeconds, c.body],
    )
  ).rows[0];
  await notify(tx, ws, student, {
    title: "notice.question",
    body: "notice.questionBody",
    kind: "QUESTION",
    targetId: c.videoId,
    ownerOnly: true,
  });
  return { data };
}

async function saveProgress(
  tx: PoolClient,
  actor: Actor,
  ws: string,
  student: string,
  c: LearningAction<"video.progress">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "INSERT INTO derslik.video_progress(workspace_id,student_id,video_id,user_id,seconds) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,video_id,user_id) DO UPDATE SET seconds=EXCLUDED.seconds,updated_at=now() RETURNING *",
      [ws, student, c.videoId, actor.id, c.seconds],
    )
  ).rows[0];
  return { data };
}

// Soru ve ilerleme oynatılabilir bir videoya ve videonun süresi içindeki bir
// ana bağlanır.
async function recordVideoEvent(
  tx: PoolClient,
  actor: Actor,
  ws: string,
  student: string,
  c: LearningAction<"question.create" | "video.progress">,
): Promise<MutationResult> {
  const video = (
    await tx.query(
      "SELECT id,duration_seconds FROM derslik.videos WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND status='READY' AND NOT delete_requested",
      [ws, student, c.videoId],
    )
  ).rows[0];
  if (!video) throw new NotFoundException("api.playableVideoNotFound");
  const at = c.action === "question.create" ? c.atSeconds : c.seconds;
  if (at > (video.duration_seconds ?? 0))
    throw new ConflictException("api.timeBeyondVideo");
  return c.action === "question.create"
    ? askQuestion(tx, actor, ws, student, c)
    : saveProgress(tx, actor, ws, student, c);
}

async function answerQuestion(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"question.answer">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "UPDATE derslik.video_questions SET answer=$4,resolved=$5,version=version+1 WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND version=$6 RETURNING *",
      [ws, student, c.questionId, c.answer, c.resolved, c.version],
    )
  ).rows[0];
  if (!data) throw new ConflictException("api.questionNotFound");
  await notify(tx, ws, student, {
    title: "notice.answered",
    body: "notice.answeredBody",
    kind: "ANSWER",
    targetId: data.video_id,
  });
  return { data };
}

async function draftSummary(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"summary.draft">,
): Promise<MutationResult> {
  const completed = (
    await tx.query(
      "SELECT count(*) AS n FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 AND status='COMPLETED' AND starts_at>=$3::date AT TIME ZONE 'Europe/Istanbul' AND starts_at<($3::date+7) AT TIME ZONE 'Europe/Istanbul'",
      [ws, student, c.weekOn],
    )
  ).rows[0].n;
  const pending = (
    await tx.query(
      "SELECT count(*) AS n FROM derslik.assignments a WHERE a.workspace_id=$1 AND a.student_id=$2 AND a.status='OPEN' AND due_on<=($3::date+6) AND NOT EXISTS(SELECT 1 FROM derslik.submissions s WHERE s.workspace_id=a.workspace_id AND s.assignment_id=a.id)",
      [ws, student, c.weekOn],
    )
  ).rows[0].n;
  // Taslak öğretmenin dilinde; öğretmen düzenleyip yayımlar.
  const text =
    [
      apiText("api.summaryDraftLessons", { count: Number(completed) }),
      apiText("api.summaryDraftPending", { count: Number(pending) }),
      apiText("api.summaryDraftTail"),
    ].join(" ") + " ";
  const data = (
    await tx.query(
      "INSERT INTO derslik.weekly_summaries(workspace_id,student_id,week_on,body) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,student_id,week_on) DO NOTHING RETURNING *",
      [ws, student, c.weekOn, text],
    )
  ).rows[0];
  if (!data) throw new ConflictException("api.summaryExists");
  return { data };
}

async function publishSummary(
  tx: PoolClient,
  ws: string,
  student: string,
  c: LearningAction<"summary.publish">,
): Promise<MutationResult> {
  const data = (
    await tx.query(
      "UPDATE derslik.weekly_summaries SET body=$4,status='PUBLISHED',version=version+1 WHERE workspace_id=$1 AND student_id=$2 AND id=$3 AND version=$5 RETURNING *",
      [ws, student, c.summaryId, c.body, c.version],
    )
  ).rows[0];
  if (!data) throw new ConflictException("api.summaryNotFound");
  await notify(tx, ws, student, {
    title: "notice.summaryReady",
    body: "notice.summaryReadyBody",
    kind: "SUMMARY",
    targetId: data.id,
  });
  return { data };
}

async function applyLearning(
  tx: PoolClient,
  actor: Actor,
  ws: string,
  student: string,
  c: LearningInput,
): Promise<MutationResult> {
  switch (c.action) {
    case "assignment.create":
      return createAssignment(tx, ws, student, c);
    case "assignment.update":
      return updateAssignment(tx, ws, student, c);
    case "assignment.submit":
      return submitAssignment(tx, actor, ws, student, c);
    case "assignment.review":
      return reviewAssignment(tx, ws, student, c);
    case "note.publish":
      return publishNote(tx, ws, student, c);
    case "question.create":
    case "video.progress":
      return recordVideoEvent(tx, actor, ws, student, c);
    case "question.answer":
      return answerQuestion(tx, ws, student, c);
    case "summary.draft":
      return draftSummary(tx, ws, student, c);
    default:
      return publishSummary(tx, ws, student, c);
  }
}

@Injectable()
export class LearningService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
  ) {}
  async read(tx: PoolClient, ws: string, student: string) {
    const result: Record<string, unknown> = {};
    const queries = {
      lessons:
        "SELECT id,student_id,topic,starts_at,ends_at,location,status,version,makeup_for_id,booked_by FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 ORDER BY starts_at DESC",
      assignments:
        "SELECT * FROM derslik.assignments WHERE workspace_id=$1 AND student_id=$2 ORDER BY due_on DESC,id",
      submissions:
        "SELECT * FROM derslik.submissions WHERE workspace_id=$1 AND student_id=$2 ORDER BY created_at DESC,id",
      notes:
        "SELECT id,body,audience,created_at FROM derslik.shared_notes WHERE workspace_id=$1 AND student_id=$2 ORDER BY created_at DESC,id",
      videos:
        "SELECT id,lesson_id,title,status,duration_seconds,delete_requested,created_at FROM derslik.videos WHERE workspace_id=$1 AND student_id=$2 AND status<>'DELETED' ORDER BY created_at DESC,id",
      questions:
        "SELECT id,video_id,at_seconds,body,answer,resolved,version,created_at FROM derslik.video_questions WHERE workspace_id=$1 AND student_id=$2 ORDER BY created_at DESC,id",
      materials:
        "SELECT id,assignment_id,purpose,name,status,size_bytes,mime_type,delete_requested FROM derslik.materials WHERE workspace_id=$1 AND student_id=$2 AND status<>'DELETED' ORDER BY created_at DESC,id",
      summaries:
        "SELECT id,body,status,week_on,version FROM derslik.weekly_summaries WHERE workspace_id=$1 AND student_id=$2 ORDER BY week_on DESC,id",
      progress:
        "SELECT video_id,seconds FROM derslik.video_progress WHERE workspace_id=$1 AND student_id=$2 AND user_id=derslik.actor_id()",
    };
    for (const [key, sql] of Object.entries(queries))
      result[key] = (await tx.query(sql, [ws, student])).rows;
    return rawDto(result) as Record<string, unknown>;
  }
  get(actor: Actor, ws: string, student: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      await lockStudent(tx, ws, student);
      return this.read(tx, ws, student);
    });
  }
  portal(actor: Actor, ws: string, student: string) {
    return this.db.portalTransaction(
      actor,
      ws,
      student,
      "lessons",
      async (tx) => {
        const person = (
          await tx.query(
            "SELECT id,name,subject FROM derslik.students WHERE workspace_id=$1 AND id=$2",
            [ws, student],
          )
        ).rows[0];
        if (!person) throw new NotFoundException("api.studentNotFound");
        const link = (
          await tx.query(
            "SELECT role,permissions FROM derslik.portal_links WHERE workspace_id=$1 AND student_id=$2 AND user_id=$3 AND revoked_at IS NULL ORDER BY role DESC LIMIT 1",
            [ws, student, actor.id],
          )
        ).rows[0];
        if (!link) throw new ForbiddenException("api.portalAccessNotFound");
        // Ders ayarlama özeti: "Ders ayarla" düğmesi ve iptal süresi için.
        const policy = (
          await tx.query(
            "SELECT enabled,cancel_hours FROM derslik.booking_policy($1)",
            [ws],
          )
        ).rows[0];
        const data = await this.read(tx, ws, student);
        return rawDto({
          ...data,
          student: person,
          ...link,
          booking: policy
            ? { enabled: policy.enabled, cancelHours: policy.cancel_hours }
            : null,
          lessons: (
            await tx.query(
              "SELECT id,student_id,topic,starts_at,ends_at,location,status,version,makeup_for_id,booked_by FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 ORDER BY starts_at DESC",
              [ws, student],
            )
          ).rows,
          packages: (
            await tx.query(
              "SELECT id,student_id,name,remaining,granted,price_minor,expires_on FROM derslik.packages WHERE workspace_id=$1 AND student_id=$2",
              [ws, student],
            )
          ).rows,
          payments: (
            await tx.query(
              "SELECT id,student_id,amount_minor,received_on,method,voided_at FROM derslik.payments WHERE workspace_id=$1 AND student_id=$2 ORDER BY received_on DESC",
              [ws, student],
            )
          ).rows,
        });
      },
    );
  }
  mutate(
    actor: Actor,
    ws: string,
    student: string,
    key: string,
    input: unknown,
    portal = false,
  ) {
    const c = schema.parse(input);
    const studentActions = [
      "assignment.submit",
      "question.create",
      "video.progress",
    ];
    if (portal && !studentActions.includes(c.action))
      throw new ForbiddenException("api.teacherOnly");
    const permission = c.action.startsWith("assignment.")
      ? "assignments"
      : "videos";
    return this.commands.run(
      actor,
      ws,
      key,
      { ...c, studentId: student },
      async (tx) => {
        if (!portal) await lockStudent(tx, ws, student, true);
        return applyLearning(tx, actor, ws, student, c);
      },
      portal
        ? {
            studentId: student,
            permission,
            write: c.action !== "video.progress",
          }
        : undefined,
    );
  }
}

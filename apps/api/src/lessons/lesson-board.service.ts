import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { CommandService } from "../common/command.service.js";
import {
  lessonBoardCommandSchema,
  maxBoardStrokes,
  type BoardStroke,
  type LessonBoard,
  type LessonBoardReadResult,
  type LessonBoardMutationResult,
} from "../../../../packages/contracts/src/live-lesson.js";
import { MediaProviders } from "../media/providers.js";
import {
  attachBoardDocument,
  boardDocumentFile,
  boardDocuments,
  selectBoardDocument,
  type BoardRow,
  type BoardScope,
} from "./lesson-board-documents.js";

type Scope = BoardScope;
type BoardCommand = ReturnType<typeof lessonBoardCommandSchema.parse>;
type StrokeInput = Omit<BoardStroke, "authorId">;
type StrokeRow = {
  id: string;
  author_id: string;
  points: BoardStroke["points"];
  color: BoardStroke["color"];
  width: BoardStroke["width"];
  document_id: string | null;
  page: number;
  tool: BoardStroke["tool"];
  text: string | null;
  removed: boolean;
};

async function permissions(tx: PoolClient, scope: Scope) {
  const row = (
    await tx.query(
      `SELECT l.status, derslik.is_owner($1) AS owner,
       (s.active AND derslik.can_student($1,$2,'lessons',true)) AS can_write
       FROM derslik.lessons l JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
       WHERE l.workspace_id=$1 AND l.student_id=$2 AND l.id=$3 AND l.status<>'CANCELLED'`,
      [scope.ws, scope.student, scope.lesson],
    )
  ).rows[0];
  if (!row) throw new NotFoundException("api.lessonNotFound");
  return {
    canEdit: row.status === "SCHEDULED" && row.can_write,
    canClear: row.status === "SCHEDULED" && row.owner && row.can_write,
  };
}

async function state(
  tx: PoolClient,
  actor: Actor,
  scope: Scope,
  row: BoardRow,
  access: { canEdit: boolean; canClear: boolean },
): Promise<LessonBoard> {
  const documents = await boardDocuments(tx, scope);
  const strokes = (
    await tx.query<StrokeRow>(
      `SELECT id,author_id,points,color,width,document_id,page,tool,text FROM derslik.lesson_board_strokes
       WHERE workspace_id=$1 AND student_id=$2 AND lesson_id=$3 AND epoch=$4 AND NOT removed
       AND (document_id IS NULL OR document_id=ANY($5::uuid[])) ORDER BY created_at,id`,
      [
        scope.ws,
        scope.student,
        scope.lesson,
        row.epoch,
        documents.map((document) => document.id),
      ],
    )
  ).rows.map(
    ({
      id,
      author_id,
      points,
      color,
      width,
      document_id,
      page,
      tool,
      text,
    }): BoardStroke => ({
      id,
      authorId: author_id,
      points,
      color,
      width,
      documentId: document_id,
      page,
      tool,
      ...(text === null ? {} : { text }),
    }),
  );
  const documentId = documents.some(
    (document) => document.id === row.document_id,
  )
    ? row.document_id
    : null;
  return {
    id: scope.lesson,
    epoch: row.epoch,
    revision: row.revision,
    documentId,
    page: documentId ? row.page : 0,
    documents,
    viewerId: actor.id,
    ...access,
    strokes,
  };
}

async function boardRow(
  tx: PoolClient,
  scope: Scope,
  write: boolean,
): Promise<BoardRow> {
  // Readers share a lock; writers hold it exclusively, including the first insert.
  await tx.query(
    write
      ? "SELECT pg_advisory_xact_lock(hashtextextended($1,0))"
      : "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
    [`lesson-board:${scope.ws}:${scope.lesson}`],
  );
  if (write)
    await tx.query(
      "INSERT INTO derslik.lesson_boards(workspace_id,student_id,lesson_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [scope.ws, scope.student, scope.lesson],
    );
  return (
    (
      await tx.query<BoardRow>(
        "SELECT epoch,revision,document_id,page FROM derslik.lesson_boards WHERE workspace_id=$1 AND student_id=$2 AND lesson_id=$3",
        [scope.ws, scope.student, scope.lesson],
      )
    ).rows[0] ?? { epoch: 0, revision: 0, document_id: null, page: 0 }
  );
}

async function addStroke(
  tx: PoolClient,
  actor: Actor,
  scope: Scope,
  epoch: number,
  stroke: StrokeInput,
) {
  const previous = (
    await tx.query<StrokeRow>(
      "SELECT * FROM derslik.lesson_board_strokes WHERE workspace_id=$1 AND lesson_id=$2 AND epoch=$3 AND id=$4",
      [scope.ws, scope.lesson, epoch, stroke.id],
    )
  ).rows[0];
  if (previous) {
    if (
      previous.author_id !== actor.id ||
      previous.color !== stroke.color ||
      previous.width !== stroke.width ||
      previous.document_id !== stroke.documentId ||
      previous.page !== stroke.page ||
      previous.tool !== stroke.tool ||
      previous.text !== (stroke.text ?? null) ||
      JSON.stringify(previous.points) !== JSON.stringify(stroke.points)
    )
      throw new ConflictException("api.boardStrokeChanged");
    return false;
  }
  const count = (
    await tx.query(
      `SELECT count(*)::int AS n FROM derslik.lesson_board_strokes s WHERE s.workspace_id=$1 AND s.lesson_id=$2
       AND (s.document_id IS NULL OR EXISTS(SELECT 1 FROM derslik.lesson_board_documents d
        JOIN derslik.materials m ON m.workspace_id=d.workspace_id AND m.student_id=d.student_id AND m.id=d.material_id
        WHERE d.workspace_id=s.workspace_id AND d.lesson_id=s.lesson_id AND d.material_id=s.document_id AND m.status='READY' AND NOT m.delete_requested))`,
      [scope.ws, scope.lesson],
    )
  ).rows[0].n;
  // Tombstones on available pages count; deleted PDFs must not lock a blank board.
  if (count >= maxBoardStrokes) throw new ConflictException("api.boardFull");
  await tx.query(
    "INSERT INTO derslik.lesson_board_strokes(workspace_id,student_id,lesson_id,epoch,id,author_id,points,color,width,document_id,page,tool,text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      scope.ws,
      scope.student,
      scope.lesson,
      epoch,
      stroke.id,
      actor.id,
      JSON.stringify(stroke.points),
      stroke.color,
      stroke.width,
      stroke.documentId,
      stroke.page,
      stroke.tool,
      stroke.text ?? null,
    ],
  );
  return true;
}

async function setStrokeRemoved(
  tx: PoolClient,
  actor: Actor,
  scope: Scope,
  command: Extract<
    BoardCommand,
    { action: "stroke.remove" | "stroke.restore" }
  >,
  teacher: boolean,
) {
  const { epoch, id, documentId, page } = command;
  const removed = command.action === "stroke.remove";
  const stroke = (
    await tx.query<StrokeRow>(
      "SELECT * FROM derslik.lesson_board_strokes WHERE workspace_id=$1 AND lesson_id=$2 AND epoch=$3 AND id=$4",
      [scope.ws, scope.lesson, epoch, id],
    )
  ).rows[0];
  if (!stroke) throw new NotFoundException("api.lessonNotFound");
  if (stroke.document_id !== documentId || stroke.page !== page)
    throw new ConflictException("api.boardChanged");
  if (!teacher && stroke.author_id !== actor.id)
    throw new ForbiddenException("api.boardOwnStrokeOnly");
  if (stroke.removed === removed) return false;
  await tx.query(
    "UPDATE derslik.lesson_board_strokes SET removed=$5 WHERE workspace_id=$1 AND lesson_id=$2 AND epoch=$3 AND id=$4",
    [scope.ws, scope.lesson, epoch, id, removed],
  );
  return true;
}

async function applyChange(
  tx: PoolClient,
  actor: Actor,
  scope: Scope,
  command: BoardCommand,
  row: BoardRow,
  teacher: boolean,
) {
  if (command.epoch !== row.epoch)
    throw new ConflictException("api.boardChanged");
  if (command.action === "stroke.add") {
    currentPage(row, command.stroke);
    return addStroke(tx, actor, scope, row.epoch, command.stroke);
  }
  if (
    command.action === "stroke.remove" ||
    command.action === "stroke.restore"
  ) {
    currentPage(row, command);
    return setStrokeRemoved(tx, actor, scope, command, teacher);
  }
  if (!teacher) throw new ForbiddenException("api.boardTeacherOnly");
  if (command.action === "document.add")
    return attachBoardDocument(tx, scope, row, command.id, command.pageCount);
  if (command.action === "document.select")
    return selectBoardDocument(
      tx,
      scope,
      row,
      command.documentId,
      command.page,
    );
  if (command.action === "page.clear") {
    currentPage(row, command);
    await tx.query(
      "DELETE FROM derslik.lesson_board_strokes WHERE workspace_id=$1 AND lesson_id=$2 AND document_id IS NOT DISTINCT FROM $3 AND page=$4",
      [scope.ws, scope.lesson, row.document_id, row.page],
    );
    row.epoch++;
    await tx.query(
      "UPDATE derslik.lesson_board_strokes SET epoch=$3 WHERE workspace_id=$1 AND lesson_id=$2",
      [scope.ws, scope.lesson, row.epoch],
    );
    return true;
  }
  await tx.query(
    "DELETE FROM derslik.lesson_board_strokes WHERE workspace_id=$1 AND lesson_id=$2",
    [scope.ws, scope.lesson],
  );
  row.epoch++;
  return true;
}

function currentPage(
  row: BoardRow,
  scope: { documentId: string | null; page: number },
) {
  if (row.document_id !== scope.documentId || row.page !== scope.page)
    throw new ConflictException("api.boardChanged");
}

@Injectable()
export class LessonBoardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commands: CommandService,
    private readonly providers: MediaProviders,
  ) {}

  get(
    actor: Actor,
    ws: string,
    student: string,
    lesson: string,
    portal: boolean,
    revision?: number,
  ): Promise<LessonBoardReadResult> {
    const scope = { ws, student, lesson };
    const read = async (tx: PoolClient) => {
      const access = await permissions(tx, scope);
      const row = await boardRow(tx, scope, false);
      if (revision === row.revision) return { data: null, access };
      return { data: await state(tx, actor, scope, row, access) };
    };
    return portal
      ? this.db.portalTransaction(actor, ws, student, "lessons", read)
      : this.db.transaction(actor, ws, read);
  }

  async document(
    actor: Actor,
    ws: string,
    student: string,
    lesson: string,
    id: string,
    portal: boolean,
  ) {
    const scope = { ws, student, lesson };
    const read = async (tx: PoolClient) => {
      await permissions(tx, scope);
      return boardDocumentFile(tx, scope, id);
    };
    const file = await (portal
      ? this.db.portalTransaction(actor, ws, student, "lessons", read)
      : this.db.transaction(actor, ws, read));
    return {
      data: {
        url: await this.providers.downloadFileUrl(file.object_key, true),
        name: file.name,
        expiresIn: 120,
      },
    };
  }

  async mutate(
    actor: Actor,
    ws: string,
    student: string,
    lesson: string,
    key: string,
    body: unknown,
    portal: boolean,
  ): Promise<LessonBoardMutationResult> {
    const command = lessonBoardCommandSchema.parse(body),
      scope = { ws, student, lesson };
    const payload = {
      ...command,
      action: `lesson.board.${command.action}`,
      studentId: student,
      lessonId: lesson,
    };
    const result = await this.commands.run(
      actor,
      ws,
      key,
      payload,
      async (tx) => {
        const access = await permissions(tx, scope);
        if (!access.canEdit) throw new ForbiddenException("api.boardReadOnly");
        const row = await boardRow(tx, scope, true);
        const changed = await applyChange(
          tx,
          actor,
          scope,
          command,
          row,
          access.canClear,
        );
        if (changed) {
          const selection =
            command.action === "document.add" ||
            command.action === "document.select";
          const updated = await tx.query<BoardRow>(
            `UPDATE derslik.lesson_boards SET epoch=$3,revision=revision+1${selection ? ",document_id=$4,page=$5" : ""}
             WHERE workspace_id=$1 AND lesson_id=$2 RETURNING epoch,revision,document_id,page`,
            selection
              ? [ws, lesson, row.epoch, row.document_id, row.page]
              : [ws, lesson, row.epoch],
          );
          Object.assign(row, updated.rows[0]);
        }
        // Command history stores only the operation receipt, avoiding one full
        // snapshot per stroke (quadratic storage as the lesson board grows).
        return {
          data: { id: lesson, epoch: row.epoch, revision: row.revision },
          audit: { epoch: row.epoch, revision: row.revision },
        };
      },
      portal
        ? { studentId: student, permission: "lessons", write: true }
        : undefined,
    );
    const { data } = await this.get(actor, ws, student, lesson, portal);
    if (!data) throw new NotFoundException("api.lessonNotFound");
    return { data, replayed: result.replayed };
  }
}

import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  maxBoardDocuments,
  type BoardDocument,
} from "../../../../packages/contracts/src/live-lesson.js";

export type BoardScope = { ws: string; student: string; lesson: string };
export type BoardRow = {
  epoch: number;
  revision: number;
  document_id: string | null;
  page: number;
};

export async function boardDocuments(
  tx: PoolClient,
  scope: BoardScope,
): Promise<BoardDocument[]> {
  return (
    await tx.query<{ id: string; name: string; page_count: number }>(
      `SELECT d.material_id AS id,m.name,d.page_count FROM derslik.lesson_board_documents d
     JOIN derslik.materials m ON m.workspace_id=d.workspace_id AND m.student_id=d.student_id AND m.id=d.material_id
     WHERE d.workspace_id=$1 AND d.student_id=$2 AND d.lesson_id=$3 AND m.status='READY' AND NOT m.delete_requested ORDER BY d.created_at,d.material_id`,
      [scope.ws, scope.student, scope.lesson],
    )
  ).rows.map(({ id, name, page_count }) => ({
    id,
    name,
    pageCount: page_count,
  }));
}

export async function boardDocumentFile(
  tx: PoolClient,
  scope: BoardScope,
  id: string,
  lock = false,
) {
  const file = (
    await tx.query<{ object_key: string; name: string; page_count: number }>(
      `SELECT m.object_key,m.name,d.page_count FROM derslik.lesson_board_documents d
     JOIN derslik.materials m ON m.workspace_id=d.workspace_id AND m.student_id=d.student_id AND m.id=d.material_id
     WHERE d.workspace_id=$1 AND d.student_id=$2 AND d.lesson_id=$3 AND d.material_id=$4
     AND m.purpose='RESOURCE' AND m.mime_type='application/pdf' AND m.status='READY' AND NOT m.delete_requested${lock ? " FOR SHARE OF m" : ""}`,
      [scope.ws, scope.student, scope.lesson, id],
    )
  ).rows[0];
  if (!file) throw new NotFoundException("api.boardDocumentInvalid");
  return file;
}

export async function attachBoardDocument(
  tx: PoolClient,
  scope: BoardScope,
  row: BoardRow,
  id: string,
  pageCount: number,
) {
  const file = (
    await tx.query(
      `SELECT id FROM derslik.materials WHERE workspace_id=$1 AND student_id=$2 AND id=$3
     AND purpose='RESOURCE' AND mime_type='application/pdf' AND status='READY' AND NOT delete_requested FOR SHARE`,
      [scope.ws, scope.student, id],
    )
  ).rows[0];
  if (!file) throw new ConflictException("api.boardDocumentInvalid");
  const pruned = await pruneDeletedDocuments(tx, scope);
  const previous = (
    await tx.query<{ page_count: number }>(
      "SELECT page_count FROM derslik.lesson_board_documents WHERE workspace_id=$1 AND lesson_id=$2 AND material_id=$3",
      [scope.ws, scope.lesson, id],
    )
  ).rows[0];
  if (previous && previous.page_count !== pageCount)
    throw new ConflictException("api.boardDocumentInvalid");
  if (!previous) {
    const count = (
      await tx.query(
        "SELECT count(*)::int AS n FROM derslik.lesson_board_documents WHERE workspace_id=$1 AND lesson_id=$2",
        [scope.ws, scope.lesson],
      )
    ).rows[0].n;
    if (count >= maxBoardDocuments)
      throw new ConflictException("api.boardDocumentLimit");
    await tx.query(
      "INSERT INTO derslik.lesson_board_documents(workspace_id,student_id,lesson_id,material_id,page_count) VALUES($1,$2,$3,$4,$5)",
      [scope.ws, scope.student, scope.lesson, id, pageCount],
    );
  }
  const changed =
    pruned || !previous || row.document_id !== id || row.page !== 1;
  row.document_id = id;
  row.page = 1;
  return changed;
}

async function pruneDeletedDocuments(tx: PoolClient, scope: BoardScope) {
  // The board's advisory lock serializes this with erasing/restoring strokes.
  // Pruning from the material trigger would reverse their row-lock order.
  const deleted = (
    await tx.query<{ material_id: string }>(
      `SELECT d.material_id FROM derslik.lesson_board_documents d
    JOIN derslik.materials m ON m.workspace_id=d.workspace_id AND m.student_id=d.student_id AND m.id=d.material_id
    WHERE d.workspace_id=$1 AND d.student_id=$2 AND d.lesson_id=$3 AND (m.status='DELETED' OR m.delete_requested)`,
      [scope.ws, scope.student, scope.lesson],
    )
  ).rows.map((row) => row.material_id);
  if (!deleted.length) return false;
  // Capture once: a source can be deleted between these two statements.
  await tx.query(
    "DELETE FROM derslik.lesson_board_strokes WHERE workspace_id=$1 AND student_id=$2 AND lesson_id=$3 AND document_id=ANY($4::uuid[])",
    [scope.ws, scope.student, scope.lesson, deleted],
  );
  const result = await tx.query(
    "DELETE FROM derslik.lesson_board_documents WHERE workspace_id=$1 AND student_id=$2 AND lesson_id=$3 AND material_id=ANY($4::uuid[])",
    [scope.ws, scope.student, scope.lesson, deleted],
  );
  return Boolean(result.rowCount);
}

export async function selectBoardDocument(
  tx: PoolClient,
  scope: BoardScope,
  row: BoardRow,
  documentId: string | null,
  page: number,
) {
  if (documentId === null) {
    if (page !== 0) throw new ConflictException("api.boardPageInvalid");
  } else {
    const file = await boardDocumentFile(tx, scope, documentId, true);
    if (page < 1 || page > file.page_count)
      throw new ConflictException("api.boardPageInvalid");
  }
  const changed = row.document_id !== documentId || row.page !== page;
  row.document_id = documentId;
  row.page = page;
  return changed;
}

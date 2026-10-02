import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import type { Command } from "../../../../packages/contracts/src/validation.js";
import type { MutationResult } from "../common/command.service.js";

export async function lockStudent(
  tx: PoolClient,
  ws: string,
  id: string,
  active = false,
) {
  const student = (
    await tx.query(
      "SELECT * FROM derslik.students WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
      [ws, id],
    )
  ).rows[0];
  if (!student) throw new NotFoundException("api.studentNotFound");
  if (active && !student.active)
    throw new ConflictException("api.studentArchived");
  return student;
}

// Bir öğretmende bir e-posta tek öğrenci kaydında durur (arşivdekiler dahil);
// büyük/küçük harf fark etmez. Veritabanındaki benzersiz dizin eşzamanlı
// kayıtları da yakalar.
async function assertEmailFree(
  tx: PoolClient,
  ws: string,
  email: string,
  id: string | null,
) {
  if (!email.trim()) return;
  const { rowCount } = await tx.query(
    "SELECT 1 FROM derslik.students WHERE workspace_id=$1 AND btrim(email)<>'' AND lower(btrim(email))=lower(btrim($2)) AND id IS DISTINCT FROM $3::uuid LIMIT 1",
    [ws, email, id],
  );
  if (rowCount) throw new ConflictException("api.studentEmailTaken");
}

type StudentCreate = Extract<Command, { action: "student.create" }>;
type StudentChange = Extract<
  Command,
  { action: "student.update" | "student.archive" | "student.restore" }
>;
type NoteSave = Extract<Command, { action: "note.save" }>;

// Plan sınırı: sınır satırı kilitlenir, sonra etkin öğrenciler sayılır.
async function assertWithinStudentLimit(tx: PoolClient, ws: string) {
  const limit = (
    await tx.query(
      "SELECT student_limit FROM derslik.workspace_limits WHERE workspace_id=$1 FOR UPDATE",
      [ws],
    )
  ).rows[0].student_limit;
  const count = Number(
    (
      await tx.query(
        "SELECT count(*) AS n FROM derslik.students WHERE workspace_id=$1 AND active",
        [ws],
      )
    ).rows[0].n,
  );
  if (count >= limit) throw new ConflictException("api.studentLimitReached");
}

async function createStudent(
  tx: PoolClient,
  ws: string,
  c: StudentCreate,
): Promise<MutationResult> {
  await tx.query(
    "INSERT INTO derslik.workspace_limits(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
    [ws],
  );
  await assertWithinStudentLimit(tx, ws);
  await assertEmailFree(tx, ws, c.email, null);
  const student = (
    await tx.query(
      "INSERT INTO derslik.students (workspace_id,name,grade,subject,phone,email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [ws, c.name, c.grade, c.subject, c.phone, c.email],
    )
  ).rows[0];
  return { data: student };
}

async function archiveStudent(
  tx: PoolClient,
  ws: string,
  id: string,
): Promise<MutationResult> {
  const { rowCount } = await tx.query(
    "SELECT id FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 AND status='SCHEDULED' LIMIT 1",
    [ws, id],
  );
  if (rowCount) throw new ConflictException("api.studentHasScheduledLessons");
  return {
    data: (
      await tx.query(
        "UPDATE derslik.students SET active=false,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
        [ws, id],
      )
    ).rows[0],
  };
}

async function restoreStudent(
  tx: PoolClient,
  ws: string,
  id: string,
  student: QueryResultRow,
): Promise<MutationResult> {
  if (student.active) throw new ConflictException("api.studentAlreadyActive");
  // Arşivden dönen öğrenci yeniden sınıra dahil olur; yoksa arşivleyip
  // geri alarak plan sınırı aşılabilirdi.
  await assertWithinStudentLimit(tx, ws);
  return {
    data: (
      await tx.query(
        "UPDATE derslik.students SET active=true,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
        [ws, id],
      )
    ).rows[0],
  };
}

async function updateStudent(
  tx: PoolClient,
  ws: string,
  c: Extract<StudentChange, { action: "student.update" }>,
): Promise<MutationResult> {
  await assertEmailFree(tx, ws, c.email, c.id);
  return {
    data: (
      await tx.query(
        "UPDATE derslik.students SET name=$3,grade=$4,subject=$5,phone=$6,email=$7,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
        [ws, c.id, c.name, c.grade, c.subject, c.phone, c.email],
      )
    ).rows[0],
  };
}

async function changeStudent(
  tx: PoolClient,
  ws: string,
  c: StudentChange,
): Promise<MutationResult> {
  const student = await lockStudent(tx, ws, c.id);
  if (student.version !== c.version)
    throw new ConflictException("api.studentChanged");
  if (c.action === "student.archive") return archiveStudent(tx, ws, c.id);
  if (c.action === "student.restore")
    return restoreStudent(tx, ws, c.id, student);
  return updateStudent(tx, ws, c);
}

async function saveNote(
  tx: PoolClient,
  ws: string,
  c: NoteSave,
): Promise<MutationResult> {
  await lockStudent(tx, ws, c.studentId);
  const note = (
    await tx.query(
      "SELECT * FROM derslik.private_notes WHERE workspace_id=$1 AND student_id=$2 FOR UPDATE",
      [ws, c.studentId],
    )
  ).rows[0];
  if ((note?.version || 0) !== c.version)
    throw new ConflictException("api.noteChanged");
  const saved = (
    await tx.query(
      `INSERT INTO derslik.private_notes (workspace_id,student_id,body) VALUES ($1,$2,$3)
         ON CONFLICT (workspace_id,student_id) DO UPDATE SET body=EXCLUDED.body,version=private_notes.version+1,updated_at=now() RETURNING *`,
      [ws, c.studentId, c.body],
    )
  ).rows[0];
  return {
    data: saved,
    audit: { studentId: c.studentId, version: saved.version },
  };
}

@Injectable()
export class StudentsService {
  async mutate(
    tx: PoolClient,
    ws: string,
    c: Command,
  ): Promise<MutationResult> {
    if (c.action === "student.create") return createStudent(tx, ws, c);
    if (
      c.action === "student.update" ||
      c.action === "student.archive" ||
      c.action === "student.restore"
    )
      return changeStudent(tx, ws, c);
    if (c.action === "note.save") return saveNote(tx, ws, c);
    throw new Error("Unsupported student action");
  }
}

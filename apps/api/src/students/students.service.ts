import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
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
  if (!student) throw new NotFoundException("Öğrenci bulunamadı.");
  if (active && !student.active)
    throw new ConflictException("Öğrenci arşivlenmiş.");
  return student;
}

@Injectable()
export class StudentsService {
  async mutate(
    tx: PoolClient,
    ws: string,
    c: Command,
  ): Promise<MutationResult> {
    if (c.action === "student.create") {
      await tx.query(
        "INSERT INTO derslik.workspace_limits(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
        [ws],
      );
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
      if (count >= limit)
        throw new ConflictException("Aktif öğrenci sınırına ulaşıldı.");
      const student = (
        await tx.query(
          "INSERT INTO derslik.students (workspace_id,name,grade,subject,phone,email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [ws, c.name, c.grade, c.subject, c.phone, c.email],
        )
      ).rows[0];
      return { data: student };
    }
    if (c.action === "student.update" || c.action === "student.archive") {
      const student = await lockStudent(tx, ws, c.id);
      if (student.version !== c.version)
        throw new ConflictException(
          "Öğrenci kaydı değişmiş. Güncel sürümü yükleyin.",
        );
      if (c.action === "student.archive") {
        const { rowCount } = await tx.query(
          "SELECT id FROM derslik.lessons WHERE workspace_id=$1 AND student_id=$2 AND status='SCHEDULED' LIMIT 1",
          [ws, c.id],
        );
        if (rowCount)
          throw new ConflictException(
            "Önce planlanan dersleri tamamlayın veya iptal edin.",
          );
        return {
          data: (
            await tx.query(
              "UPDATE derslik.students SET active=false,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
              [ws, c.id],
            )
          ).rows[0],
        };
      }
      return {
        data: (
          await tx.query(
            "UPDATE derslik.students SET name=$3,grade=$4,subject=$5,phone=$6,email=$7,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
            [ws, c.id, c.name, c.grade, c.subject, c.phone, c.email],
          )
        ).rows[0],
      };
    }
    if (c.action === "note.save") {
      await lockStudent(tx, ws, c.studentId);
      const note = (
        await tx.query(
          "SELECT * FROM derslik.private_notes WHERE workspace_id=$1 AND student_id=$2 FOR UPDATE",
          [ws, c.studentId],
        )
      ).rows[0];
      if ((note?.version || 0) !== c.version)
        throw new ConflictException(
          "Not başka bir işlemde değişti. Güncel sürümü yükleyin.",
        );
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
    throw new Error("Unsupported student action");
  }
}

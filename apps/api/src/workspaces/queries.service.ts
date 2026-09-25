import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../db/database.service.js";
import type { Actor } from "../auth/auth.guard.js";
import { toDto } from "../common/command.service.js";
import { paging, uuid } from "../contracts.js";
import { openCharges } from "../billing/billing.service.js";

const tables = {
  students: { table: "students", order: "created_at DESC,id" },
  packages: { table: "packages", order: "created_at DESC,id" },
  sessions: { table: "lessons", order: "starts_at,id" },
  payments: { table: "payments", order: "created_at DESC,id" },
  "credit-entries": { table: "credit_entries", order: "created_at DESC,id" },
  audit: { table: "audit_events", order: "created_at DESC,id" },
} as const;
export type Resource = keyof typeof tables;

@Injectable()
export class QueriesService {
  constructor(private readonly database: DatabaseService) {}

  async list(actor: Actor, ws: string, resource: Resource, input: unknown) {
    const { limit, offset, studentId, from, to } = paging
      .extend({
        studentId: uuid.optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      })
      .parse(input);
    return this.database.transaction(actor, ws, async (tx) => {
      const def = tables[resource];
      const values: unknown[] = [ws];
      const clauses = ["workspace_id=$1"];
      if (studentId && resource !== "audit") {
        values.push(studentId);
        clauses.push(
          `${resource === "students" ? "id" : "student_id"}=$${values.length}`,
        );
      }
      if (resource === "sessions") {
        if (from) {
          values.push(from);
          clauses.push(`ends_at>$${values.length}::timestamptz`);
        }
        if (to) {
          values.push(to);
          clauses.push(`starts_at<$${values.length}::timestamptz`);
        }
      }
      values.push(limit + 1, offset);
      // Table/ordering fragments come exclusively from the internal allowlist above.
      const rows = (
        await tx.query(
          `SELECT * FROM derslik.${def.table} WHERE ${clauses.join(" AND ")} ORDER BY ${def.order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values,
        )
      ).rows;
      return {
        data: toDto(rows.slice(0, limit)),
        pagination: { limit, offset, hasMore: rows.length > limit },
      };
    });
  }

  async student(actor: Actor, ws: string, id: string, noteOnly = false) {
    return this.database.transaction(actor, ws, async (tx) => {
      const student = (
        await tx.query(
          "SELECT * FROM derslik.students WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        )
      ).rows[0];
      if (!student) throw new NotFoundException("api.studentNotFound");
      if (noteOnly) {
        const note = (
          await tx.query(
            "SELECT * FROM derslik.private_notes WHERE workspace_id=$1 AND student_id=$2",
            [ws, id],
          )
        ).rows[0];
        return {
          data: toDto(note || { student_id: id, body: "", version: 0 }),
        };
      }
      const charges = await openCharges(tx, ws, id);
      return {
        data: toDto({
          ...student,
          charges,
          outstanding_minor: charges.reduce(
            (sum: bigint, c) => sum + BigInt(c.outstanding_minor),
            0n,
          ),
        }),
      };
    });
  }
}

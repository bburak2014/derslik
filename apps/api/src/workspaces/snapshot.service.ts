import { Injectable } from "@nestjs/common";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
export function rawDto(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(rawDto);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rawDto(v)]),
    );
  return value;
}
@Injectable()
export class SnapshotService {
  constructor(private readonly db: DatabaseService) {}
  get(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      const data: Record<string, unknown> = {};
      for (const [name, table] of Object.entries({
        students: "students",
        packages: "packages",
        lessons: "lessons",
        payments: "payments",
        credits: "credit_entries",
        notes: "private_notes",
      })) {
        data[name] = (
          await tx.query(
            `SELECT * FROM derslik.${table} WHERE workspace_id=$1 ORDER BY ${name === "notes" ? "updated_at" : "created_at"} DESC`,
            [ws],
          )
        ).rows;
      }
      data.students = (data.students as Record<string, unknown>[]).map((s) => ({
        ...s,
        active: s.active ? 1 : 0,
        is_sample: s.is_sample ? 1 : 0,
      }));
      return rawDto({ ...data, serverTime: new Date() });
    });
  }
}

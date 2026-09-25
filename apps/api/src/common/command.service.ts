import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { DatabaseService } from "../db/database.service.js";
import type { Actor } from "../auth/auth.guard.js";

export type MutationResult = {
  data: Record<string, unknown>;
  audit?: Record<string, unknown>;
};
export function toDto(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toDto);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase()),
        toDto(item),
      ]),
    );
  return value;
}

@Injectable()
export class CommandService {
  constructor(private readonly database: DatabaseService) {}

  async run(
    actor: Actor,
    ws: string,
    key: string,
    payload: { action: string; [key: string]: unknown },
    execute: (tx: PoolClient) => Promise<MutationResult>,
    portal?: { studentId: string; permission: string; write?: boolean },
  ) {
    z.string().uuid().parse(key);
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const perform = async (tx: PoolClient) => {
      const inserted = await tx.query(
        `INSERT INTO derslik.api_commands (workspace_id, actor_id, key, request_hash, action)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, actor_id, key) DO NOTHING RETURNING id`,
        [ws, actor.id, key, hash, payload.action],
      );
      if (!inserted.rowCount) {
        const previous = (
          await tx.query(
            "SELECT request_hash, response FROM derslik.api_commands WHERE workspace_id=$1 AND actor_id=$2 AND key=$3",
            [ws, actor.id, key],
          )
        ).rows[0];
        if (!previous || previous.request_hash !== hash)
          throw new ConflictException("api.idempotencyKeyReused");
        return { ...previous.response, replayed: true };
      }
      const result = await execute(tx);
      const response = { data: toDto(result.data), replayed: false };
      await tx.query(
        "INSERT INTO derslik.audit_events (workspace_id,actor_id,action,resource_id,metadata) VALUES ($1,$2,$3,$4,$5)",
        [
          ws,
          actor.id,
          payload.action,
          result.data.id,
          JSON.stringify(result.audit || {}),
        ],
      );
      await tx.query(
        "UPDATE derslik.api_commands SET response=$1 WHERE id=$2 AND workspace_id=$3",
        [JSON.stringify(response), inserted.rows[0].id, ws],
      );
      return response;
    };
    return portal
      ? this.database.portalTransaction(
          actor,
          ws,
          portal.studentId,
          portal.permission,
          perform,
          portal.write ?? true,
        )
      : this.database.transaction(actor, ws, perform);
  }
}

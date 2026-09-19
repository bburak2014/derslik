import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { DatabaseService } from "../db/database.service.js";
import { toDto } from "../common/command.service.js";

@Injectable()
export class WorkspacesService {
  constructor(private readonly db: DatabaseService) {}
  list(actor: Actor) {
    return this.db.transaction(actor, null, async (tx) => ({
      data: toDto(
        (
          await tx.query(
            "SELECT id,name,timezone,created_at FROM derslik.workspaces WHERE owner_id=$1 ORDER BY created_at",
            [actor.id],
          )
        ).rows,
      ),
    }));
  }
  create(actor: Actor, input: unknown) {
    const data = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .parse(input);
    return this.db.transaction(actor, null, async (tx) => {
      await tx.query(
        "INSERT INTO derslik.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
        [actor.id],
      );
      const workspace = (
        await tx.query(
          "INSERT INTO derslik.workspaces (owner_id,name) VALUES ($1,$2) ON CONFLICT (owner_id) DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id,name,timezone,created_at",
          [actor.id, data.name],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO derslik.memberships (workspace_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT (workspace_id,user_id,role) DO NOTHING",
        [workspace.id, actor.id],
      );
      return { data: toDto(workspace) };
    });
  }
}

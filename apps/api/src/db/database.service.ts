import {
  ForbiddenException,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { CONFIG, type ApiConfig } from "../config.js";
import type { Actor } from "../auth/auth.guard.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ...(config.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: true } }
        : {}),
    });
    this.pool.on("error", (error) =>
      console.error("PostgreSQL pool failure", {
        code: (error as Error & { code?: string }).code,
      }),
    );
  }

  async assertRuntimeRole() {
    const { rows } = await this.pool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls) {
      throw new Error(
        "API DATABASE_URL must use a non-superuser, non-BYPASSRLS runtime role.",
      );
    }
  }

  async transaction<T>(
    actor: Actor,
    workspaceId: string | null,
    fn: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SET LOCAL statement_timeout = '8s'");
      await tx.query("SET LOCAL lock_timeout = '5s'");
      await tx.query(
        "SELECT set_config('app.actor_id', $1, true), set_config('app.workspace_id', $2, true)",
        [actor.id, workspaceId || ""],
      );
      if (workspaceId) {
        const { rowCount } = await tx.query(
          `SELECT w.id FROM derslik.workspaces w
           JOIN derslik.memberships m ON m.workspace_id = w.id AND m.user_id = $2
           WHERE w.id = $1 AND w.owner_id = $2 AND m.role = 'OWNER' AND m.active = true`,
          [workspaceId, actor.id],
        );
        if (!rowCount) throw new ForbiddenException("api.noWorkspaceAccess");
      }
      if (workspaceId)
        await tx.query("SELECT derslik.expire_subscription($1)", [workspaceId]);
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  /** Giriş gerektirmeyen okumalar (öğretmen vitrini). Kimlik boş kalır; RLS
   *  hiçbir tabloyu açmaz, yalnızca vitrin fonksiyonları sonuç döndürür. */
  async publicQuery<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN READ ONLY");
      await tx.query("SET LOCAL statement_timeout = '8s'");
      await tx.query(
        "SELECT set_config('app.actor_id', '', true), set_config('app.workspace_id', '', true)",
      );
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  portalTransaction<T>(
    actor: Actor,
    ws: string,
    student: string,
    permission: string,
    fn: (tx: PoolClient) => Promise<T>,
    write = false,
  ) {
    return this.transaction(actor, null, async (tx) => {
      await tx.query("SELECT set_config('app.workspace_id',$1,true)", [ws]);
      const allowed = (
        await tx.query("SELECT derslik.can_student($1,$2,$3,$4) AS allowed", [
          ws,
          student,
          permission,
          write,
        ])
      ).rows[0]?.allowed;
      if (!allowed) throw new ForbiddenException("api.noStudentAccess");
      return fn(tx);
    });
  }
}

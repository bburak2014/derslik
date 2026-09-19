import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function migrateDatabase(connectionString: string, ssl = false) {
  const pool = new Pool({
    connectionString,
    ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const client = await pool.connect();
  try {
    // Serializes deploy-time migrators without giving the runtime role schema rights.
    await client.query("SELECT pg_advisory_lock(871239451)");
    await migrate(drizzle(client), {
      migrationsFolder: resolve("apps/api/drizzle"),
      migrationsSchema: "derslik_migrations",
    });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(871239451)")
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.env.DATABASE_ADMIN_URL)
    throw new Error("DATABASE_ADMIN_URL is required for migrations.");
  await migrateDatabase(
    process.env.DATABASE_ADMIN_URL,
    process.env.DATABASE_SSL === "true",
  );
  console.log("PostgreSQL migrations completed.");
}

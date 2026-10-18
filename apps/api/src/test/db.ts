import pg from "pg";
import { getRedis } from "../lib/redis.js";
import { testMigrationDatabaseUrl } from "./database-url.js";

let owner: pg.Pool | undefined;

/** The table owner, for wiping tables (the app role has no TRUNCATE right, by design). */
function ownerPool(): pg.Pool {
  owner ??= new pg.Pool({ connectionString: testMigrationDatabaseUrl, max: 1 });
  return owner;
}

/** Empties every table (keeping the migration history) and the test Redis database. */
export async function resetDatabase(): Promise<void> {
  const pool = ownerPool();
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (tables) await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  await getRedis().flushdb();
}

/** Raw SQL as the owner, for tests that inspect what the app role cannot see. */
export async function ownerQuery<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await ownerPool().query<T>(sql, params)).rows;
}

import pg from "pg";
import { env } from "../config/env.js";
import { getQdrant } from "../lib/qdrant.js";
import { getRedis } from "../lib/redis.js";
import { testMigrationDatabaseUrl } from "./database-url.js";

let owner: pg.Pool | undefined;

/** The table owner, for wiping tables (the app role has no TRUNCATE right, by design). */
function ownerPool(): pg.Pool {
  owner ??= new pg.Pool({ connectionString: testMigrationDatabaseUrl, max: 1 });
  return owner;
}

/** Reference data seeded by migrations; kept between tests. */
const KEEP = ["_prisma_migrations", "price_table"];

/** Empties every table (keeping migrations and reference data) and the test Redis database. */
export async function resetDatabase(): Promise<void> {
  const pool = ownerPool();
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
    [KEEP],
  );
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (tables) await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  await getRedis().flushdb();
  // Every point of the test collection (a field nobody sets is "empty" on all of them).
  await getQdrant()
    .delete(env.QDRANT_COLLECTION, {
      wait: true,
      filter: { must: [{ is_empty: { key: "__never_set__" } }] },
    })
    .catch(() => undefined);
}

/** Raw SQL as the owner, for tests that inspect what the app role cannot see. */
export async function ownerQuery<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await ownerPool().query<T>(sql, params)).rows;
}

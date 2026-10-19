import { describe, expect, it } from "vitest";
import { ownerQuery } from "../../test/db.js";

interface TableRls {
  table: string;
  enabled: boolean;
  forced: boolean;
  policies: number;
}

/**
 * Every tenant table (a `tenantId` column, plus `tenants` itself) with its RLS flags. A new tenant
 * table must ENABLE and FORCE row-level security and have a policy, in its own migration.
 */
async function tenantTables(): Promise<TableRls[]> {
  return ownerQuery<TableRls>(`
    SELECT c.relname AS "table",
           c.relrowsecurity AS enabled,
           c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND (c.relname = 'tenants' OR EXISTS (
             SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'tenantId'))
     ORDER BY c.relname`);
}

function gaps(tables: TableRls[]): string[] {
  return tables.flatMap((t) => [
    ...(t.enabled ? [] : [`${t.table}: row-level security not enabled`]),
    ...(t.forced ? [] : [`${t.table}: row-level security not forced`]),
    ...(t.policies > 0 ? [] : [`${t.table}: no policy`]),
  ]);
}

describe("row-level security coverage", () => {
  it("every tenant table has RLS enabled, forced and a policy", async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThan(30);
    expect(gaps(tables)).toEqual([]);
  });

  it("flags a new tenant table that was added without RLS", async () => {
    await ownerQuery(`CREATE TABLE "rls_probe" ("id" text PRIMARY KEY, "tenantId" text NOT NULL)`);
    try {
      const probe = gaps(await tenantTables()).filter((gap) => gap.startsWith("rls_probe:"));
      expect(probe).toEqual([
        "rls_probe: row-level security not enabled",
        "rls_probe: row-level security not forced",
        "rls_probe: no policy",
      ]);
    } finally {
      await ownerQuery(`DROP TABLE "rls_probe"`);
    }
  });
});

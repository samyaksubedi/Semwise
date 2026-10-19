import { prisma } from "../../lib/prisma.js";

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/** Runs one SQL query and returns its rows; the Prisma client in the app, a raw pool in tests. */
export type RoleQuery = (sql: string) => Promise<RoleRow[]>;

const ROLE_SQL =
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";

/**
 * Row-level security is the second line of tenant isolation, and Postgres skips it for superusers
 * and roles with BYPASSRLS. Returns why the connected role is unsafe, or null when it is fine.
 */
export async function databaseRoleProblem(query: RoleQuery): Promise<string | null> {
  const [role] = await query(ROLE_SQL);
  if (!role) return "the database role could not be read";
  const flags = [role.rolsuper && "SUPERUSER", role.rolbypassrls && "BYPASSRLS"].filter(Boolean);
  if (flags.length === 0) return null;
  return (
    `DATABASE_URL connects as "${role.rolname}", which has ${flags.join(" and ")}, so row-level ` +
    "security would not apply. Connect as the application role (NOSUPERUSER NOBYPASSRLS); " +
    "the owner role is only for migrations (MIGRATION_DATABASE_URL)."
  );
}

/** Throws when the process's own DATABASE_URL role could bypass row-level security. */
export async function assertSafeDatabaseRole(): Promise<void> {
  const problem = await databaseRoleProblem((sql) => prisma.$queryRawUnsafe<RoleRow[]>(sql));
  if (problem) throw new Error(problem);
}

import { AsyncLocalStorage } from "node:async_hooks";
import { prisma, type Prisma } from "../../lib/prisma.js";

/** The client a repository runs its queries on: always a transaction with the RLS setting applied. */
export type Db = Prisma.TransactionClient;

/**
 * The scope every repository function for tenant data takes. The tenant comes from the session on
 * the server, never from the client. Repositories put `tenantId` in every query AND run inside
 * `withTenant`, so row-level security in Postgres is a second line of defence.
 */
export interface TenantScope {
  tenantId: string;
}

interface Ambient {
  kind: "tenant" | "system";
  tenantId: string | null;
  tx: Db;
}

const ambient = new AsyncLocalStorage<Ambient>();

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Runs `fn` in a transaction where Postgres only shows rows of `tenantId`. Nested calls for the
 * same tenant reuse the open transaction, so a service can group several repository calls into
 * one atomic unit with `transaction(scope, ...)`.
 *
 * Never call AI or other slow network services inside: the transaction holds a connection.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error("withTenant needs a tenant id");
  const current = ambient.getStore();
  if (current) {
    if (current.kind === "system" || current.tenantId === tenantId) return fn(current.tx);
    throw new Error("A tenant transaction cannot open another tenant's scope");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return ambient.run({ kind: "tenant", tenantId, tx }, () => fn(tx));
  }, TX_OPTIONS);
}

/**
 * Runs `fn` with row-level security bypassed. Only for the few lookups that must cross tenants:
 * login and session resolution (a user's memberships in every college), platform administration
 * by the Super Admin, and global emails such as password resets. Never use it for college data
 * on behalf of a college user.
 */
export async function withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const current = ambient.getStore();
  if (current) {
    if (current.kind === "system") return fn(current.tx);
    throw new Error("A tenant transaction cannot switch to system scope");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return ambient.run({ kind: "system", tenantId: null, tx }, () => fn(tx));
  }, TX_OPTIONS);
}

/**
 * For tables without tenant data (users, sessions, prices): the open transaction if there is one,
 * otherwise a new one. Row-level security does not apply to these tables.
 */
export async function withGlobal<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const current = ambient.getStore();
  if (current) return fn(current.tx);
  return prisma.$transaction(async (tx) => fn(tx), TX_OPTIONS);
}

/** Groups several repository calls into one transaction in the tenant's scope. */
export function transaction<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return withTenant(scope.tenantId, () => fn());
}

/** Groups several platform repository calls into one transaction (Super Admin work only). */
export function systemTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return withSystem(() => fn());
}

/** True when the error is a unique-constraint violation (Prisma code P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

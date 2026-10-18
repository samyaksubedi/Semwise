import type { AuditEntry, AuditQuery, CursorMeta } from "@semwise/shared";
import { AppError } from "../../common/errors/app-error.js";
import { currentRequest } from "../../common/http/request-context.js";
import { Action, adminProgramIds, can, hasRole, type Actor } from "../authz/index.js";
import { auditRepository } from "./audit.repository.js";

export interface AuditInput {
  /** Null for platform actions by the Super Admin. */
  tenantId: string | null;
  programId?: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Safe snapshots only: never passwords, tokens, email bodies or private student content. */
  before?: object | null;
  after?: object | null;
}

type Row = Awaited<ReturnType<typeof auditRepository.listForTenant>>[number];

function toEntry(row: Row): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    programId: row.programId,
    actorId: row.actorId,
    actorName: row.actor?.displayName ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}

function page(rows: Row[], limit: number): { data: AuditEntry[]; meta: CursorMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { data: items.map(toEntry), meta: { nextCursor: hasMore ? items.at(-1)!.id : null } };
}

const json = (value: object | null | undefined) =>
  value ? (JSON.parse(JSON.stringify(value)) as object) : undefined;

export const auditService = {
  /** Writes one audit row. Joins the caller's transaction when there is one. */
  async record(input: AuditInput): Promise<void> {
    const ctx = currentRequest();
    await auditRepository.create({
      tenantId: input.tenantId,
      programId: input.programId ?? null,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: json(input.before),
      after: json(input.after),
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  },

  /** University Admins read the whole college; Program Admins only their programs. */
  async listForTenant(actor: Actor, query: AuditQuery) {
    const tenantId = actor.tenantId!;
    if (hasRole(actor, "UNIVERSITY_ADMIN") && can(actor, Action.AUDIT_READ, { tenantId })) {
      const rows = await auditRepository.listForTenant(
        { tenantId },
        query,
        query.programId ? [query.programId] : null,
      );
      return page(rows, query.limit);
    }
    const own = adminProgramIds(actor).filter((programId) =>
      can(actor, Action.AUDIT_READ, { tenantId, programId }),
    );
    if (own.length === 0) throw AppError.forbidden();
    if (query.programId && !own.includes(query.programId)) throw AppError.forbidden();
    const rows = await auditRepository.listForTenant(
      { tenantId },
      query,
      query.programId ? [query.programId] : own,
    );
    return page(rows, query.limit);
  },

  async listAll(actor: Actor, query: AuditQuery, tenantId: string | null) {
    if (!actor.isSuperAdmin) throw AppError.forbidden();
    return page(await auditRepository.listAll(query, tenantId), query.limit);
  },
};

import type { AuditQuery } from "@semwise/shared";
import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Prisma } from "../../generated/prisma/client.js";

export interface AuditRow {
  tenantId: string | null;
  programId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Prisma.InputJsonValue | undefined;
  after: Prisma.InputJsonValue | undefined;
  ip: string | null;
  requestId: string | null;
}

const include = { actor: { select: { displayName: true } } } as const;

function listArgs(query: AuditQuery, where: Prisma.AuditLogWhereInput) {
  return {
    where: {
      ...where,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    },
    include,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

export const auditRepository = {
  create(row: AuditRow) {
    if (row.tenantId) {
      const tenantId = row.tenantId;
      return withTenant(tenantId, (db) => db.auditLog.create({ data: { ...row, tenantId } }));
    }
    return withSystem((db) => db.auditLog.create({ data: row }));
  },

  /** A college's trail; `programIds` limits it to those programs (Program Admins). */
  listForTenant(scope: TenantScope, query: AuditQuery, programIds: string[] | null) {
    return withTenant(scope.tenantId, (db) =>
      db.auditLog.findMany(
        listArgs(query, {
          tenantId: scope.tenantId,
          ...(programIds ? { programId: { in: programIds } } : {}),
        }),
      ),
    );
  },

  /** Every college's trail and platform actions (Super Admin only). */
  listAll(query: AuditQuery, tenantId: string | null) {
    return withSystem((db) => db.auditLog.findMany(listArgs(query, tenantId ? { tenantId } : {})));
  },
};

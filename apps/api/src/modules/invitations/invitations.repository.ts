import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Role } from "../../generated/prisma/enums.js";

export interface InvitationScopeFields {
  programId?: string | null;
  batchId?: string | null;
  semesterId?: string | null;
  sectionId?: string | null;
}

function scopeWhere(s: InvitationScopeFields) {
  return {
    programId: s.programId ?? null,
    batchId: s.batchId ?? null,
    semesterId: s.semesterId ?? null,
    sectionId: s.sectionId ?? null,
  };
}

export const invitationsRepository = {
  create(
    scope: TenantScope,
    data: {
      email: string;
      displayName: string | null;
      rollNo: string | null;
      role: Role;
      tokenHash: string;
      expiresAt: Date;
      invitedById: string | null;
    } & InvitationScopeFields,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.invitation.create({
        data: {
          tenantId: scope.tenantId,
          email: data.email,
          displayName: data.displayName,
          rollNo: data.rollNo,
          role: data.role,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          invitedById: data.invitedById,
          ...scopeWhere(data),
        },
      }),
    );
  },

  findById(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.invitation.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  /**
   * The invite a token belongs to, in whichever college. The token holder is not signed in to
   * that college yet, so this one lookup crosses tenants; everything after it is scoped.
   */
  findByTokenHash(tokenHash: string) {
    return withSystem((db) =>
      db.invitation.findUnique({
        where: { tokenHash },
        include: { tenant: { select: { id: true, name: true, status: true } } },
      }),
    );
  },

  /** An open (unused, not revoked, not expired) invite for the same person, role and scope. */
  findOpen(
    scope: TenantScope,
    email: string,
    role: Role,
    fields: InvitationScopeFields,
    now: Date,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.invitation.findFirst({
        where: {
          tenantId: scope.tenantId,
          email,
          role,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
          ...scopeWhere(fields),
        },
      }),
    );
  },

  rotateToken(scope: TenantScope, id: string, tokenHash: string, expiresAt: Date) {
    return withTenant(scope.tenantId, (db) =>
      db.invitation.update({
        where: { id, tenantId: scope.tenantId },
        data: { tokenHash, expiresAt },
      }),
    );
  },

  /** Marks the invite used only if it is still open, so a token works exactly once. */
  async markUsed(scope: TenantScope, id: string, at: Date): Promise<boolean> {
    const result = await withTenant(scope.tenantId, (db) =>
      db.invitation.updateMany({
        where: {
          id,
          tenantId: scope.tenantId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: at },
        },
        data: { usedAt: at },
      }),
    );
    return result.count === 1;
  },

  recordSent(scope: TenantScope, id: string, emailLogId: string, at: Date) {
    return withTenant(scope.tenantId, (db) =>
      db.invitation.update({
        where: { id, tenantId: scope.tenantId },
        data: { emailLogId, lastSentAt: at, sendCount: { increment: 1 } },
      }),
    );
  },

  /** Open admin invites per college (Super Admin's list). */
  async countOpenByTenant(tenantIds: string[], role: Role, now: Date) {
    const rows = await withSystem((db) =>
      db.invitation.groupBy({
        by: ["tenantId"],
        where: {
          tenantId: { in: tenantIds },
          role,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        _count: { _all: true },
      }),
    );
    return new Map(rows.map((r) => [r.tenantId, r._count._all]));
  },
};

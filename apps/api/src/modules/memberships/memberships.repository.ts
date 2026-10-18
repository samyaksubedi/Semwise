import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Role } from "../../generated/prisma/enums.js";

export interface GrantScope {
  programId?: string | null;
  sectionId?: string | null;
}

function scopeWhere(grant: GrantScope) {
  return { programId: grant.programId ?? null, sectionId: grant.sectionId ?? null };
}

export const membershipsRepository = {
  /** Every active membership of a user, in every college (login and the college switcher). */
  listActiveForUserEverywhere(userId: string) {
    return withSystem((db) =>
      db.membership.findMany({
        where: { userId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      }),
    );
  },

  listActiveForUser(scope: TenantScope, userId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.findMany({
        where: { tenantId: scope.tenantId, userId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      }),
    );
  },

  findActive(scope: TenantScope, userId: string, role: Role, grant: GrantScope = {}) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.findFirst({
        where: { tenantId: scope.tenantId, userId, role, status: "ACTIVE", ...scopeWhere(grant) },
      }),
    );
  },

  /** Active holders of a role, optionally inside one program or section. */
  listHolders(scope: TenantScope, role: Role, grant: GrantScope = {}) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.findMany({
        where: {
          tenantId: scope.tenantId,
          role,
          status: "ACTIVE",
          ...(grant.programId !== undefined ? { programId: grant.programId } : {}),
          ...(grant.sectionId !== undefined ? { sectionId: grant.sectionId } : {}),
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  },

  create(
    scope: TenantScope,
    data: { userId: string; role: Role; grantedById: string | null } & GrantScope,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.create({
        data: {
          userId: data.userId,
          role: data.role,
          grantedById: data.grantedById,
          tenantId: scope.tenantId,
          ...scopeWhere(data),
        },
      }),
    );
  },

  /** Revokes active memberships matching role and scope. Returns how many were revoked. */
  async revoke(
    scope: TenantScope,
    userId: string,
    role: Role,
    grant: GrantScope,
    at: Date,
  ): Promise<number> {
    const result = await withTenant(scope.tenantId, (db) =>
      db.membership.updateMany({
        where: { tenantId: scope.tenantId, userId, role, status: "ACTIVE", ...scopeWhere(grant) },
        data: { status: "REVOKED", revokedAt: at },
      }),
    );
    return result.count;
  },

  /** Revokes every active membership of a user in this college (a person leaving). */
  async revokeAllInTenant(scope: TenantScope, userId: string, at: Date): Promise<number> {
    const result = await withTenant(scope.tenantId, (db) =>
      db.membership.updateMany({
        where: { tenantId: scope.tenantId, userId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: at },
      }),
    );
    return result.count;
  },

  /** The platform role. It has no tenant, so only system scope can see or write it. */
  findSuperAdmin(userId: string) {
    return withSystem((db) =>
      db.membership.findFirst({
        where: { userId, role: "SUPER_ADMIN", tenantId: null, status: "ACTIVE" },
      }),
    );
  },

  createSuperAdmin(userId: string) {
    return withSystem((db) =>
      db.membership.create({ data: { userId, role: "SUPER_ADMIN", tenantId: null } }),
    );
  },

  /** University Admins of several colleges at once (Super Admin's college list). */
  listUniversityAdmins(tenantIds: string[]) {
    return withSystem((db) =>
      db.membership.findMany({
        where: { tenantId: { in: tenantIds }, role: "UNIVERSITY_ADMIN", status: "ACTIVE" },
        include: { user: { select: { email: true, displayName: true, status: true } } },
      }),
    );
  },
};

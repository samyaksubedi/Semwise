import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Role } from "../../generated/prisma/enums.js";

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

  findActive(scope: TenantScope, userId: string, role: Role) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.findFirst({
        where: { tenantId: scope.tenantId, userId, role, status: "ACTIVE" },
      }),
    );
  },

  create(scope: TenantScope, data: { userId: string; role: Role; grantedById: string | null }) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  revoke(scope: TenantScope, id: string, at: Date) {
    return withTenant(scope.tenantId, (db) =>
      db.membership.updateMany({
        where: { id, tenantId: scope.tenantId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: at },
      }),
    );
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
};

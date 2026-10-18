import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";

export const tenantsRepository = {
  /** The caller's own college (row-level security allows exactly this row). */
  findOwn(scope: TenantScope) {
    return withTenant(scope.tenantId, (db) =>
      db.tenant.findUnique({ where: { id: scope.tenantId } }),
    );
  },

  /** Several colleges by id, for a user's college switcher (login crosses tenants). */
  findManyByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return withSystem((db) =>
      db.tenant.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } }),
    );
  },
};

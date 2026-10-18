import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { TenantStatus } from "../../generated/prisma/enums.js";

export const tenantsRepository = {
  /** The caller's own college (row-level security allows exactly this row). */
  findOwn(scope: TenantScope) {
    return withTenant(scope.tenantId, (db) =>
      db.tenant.findUnique({ where: { id: scope.tenantId } }),
    );
  },

  updateOwn(scope: TenantScope, data: { name?: string; timezone?: string }) {
    return withTenant(scope.tenantId, (db) =>
      db.tenant.update({ where: { id: scope.tenantId }, data }),
    );
  },

  /** Several colleges by id, for a user's college switcher (login crosses tenants). */
  findManyByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return withSystem((db) =>
      db.tenant.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } }),
    );
  },

  // ---------- Platform (Super Admin) ----------

  create(data: { name: string; slug: string; timezone: string; monthlyAiBudgetMicros: number }) {
    return withSystem((db) =>
      db.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          timezone: data.timezone,
          plan: { create: { monthlyAiBudgetMicros: data.monthlyAiBudgetMicros } },
        },
      }),
    );
  },

  findById(id: string) {
    return withSystem((db) => db.tenant.findUnique({ where: { id } }));
  },

  list() {
    return withSystem((db) => db.tenant.findMany({ orderBy: { createdAt: "desc" } }));
  },

  update(id: string, data: { name?: string; timezone?: string; status?: TenantStatus }) {
    return withSystem((db) => db.tenant.update({ where: { id }, data }));
  },
};

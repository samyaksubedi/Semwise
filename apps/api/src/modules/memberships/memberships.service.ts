import type { Role, RoleGrant } from "@semwise/shared";
import type { TenantScope } from "../../common/db/scope.js";
import { membershipsRepository } from "./memberships.repository.js";

export interface MembershipRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  role: Role;
}

function toGrant(m: MembershipRecord & { programId?: string | null; sectionId?: string | null }) {
  return { role: m.role, programId: m.programId ?? null, sectionId: m.sectionId ?? null };
}

export const membershipsService = {
  /** Tenant ids and roles of every college the user belongs to (Super Admin excluded). */
  async tenantRolesForUser(userId: string): Promise<Map<string, Role[]>> {
    const rows = await membershipsRepository.listActiveForUserEverywhere(userId);
    const byTenant = new Map<string, Role[]>();
    for (const row of rows) {
      if (!row.tenantId) continue;
      const roles = byTenant.get(row.tenantId) ?? [];
      if (!roles.includes(row.role)) roles.push(row.role);
      byTenant.set(row.tenantId, roles);
    }
    return byTenant;
  },

  /** The user's role grants in one college, each with its scope. */
  async grantsInTenant(scope: TenantScope, userId: string): Promise<RoleGrant[]> {
    const rows = await membershipsRepository.listActiveForUser(scope, userId);
    return rows.map(toGrant);
  },

  async isSuperAdmin(userId: string): Promise<boolean> {
    return Boolean(await membershipsRepository.findSuperAdmin(userId));
  },

  async grantSuperAdmin(userId: string): Promise<void> {
    if (await membershipsRepository.findSuperAdmin(userId)) return;
    await membershipsRepository.createSuperAdmin(userId);
  },

  /** Adds a tenant-level role unless the user already holds it. Returns the membership. */
  async ensureRole(
    scope: TenantScope,
    userId: string,
    role: Role,
    grantedById: string | null,
  ): Promise<MembershipRecord> {
    const existing = await membershipsRepository.findActive(scope, userId, role);
    if (existing) return existing;
    return membershipsRepository.create(scope, { userId, role, grantedById });
  },
};

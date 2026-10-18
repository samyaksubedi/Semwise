import type { Role, RoleGrant } from "@semwise/shared";
import type { TenantScope } from "../../common/db/scope.js";
import { membershipsRepository, type GrantScope } from "./memberships.repository.js";

export type { GrantScope };

export interface MembershipRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  role: Role;
  programId: string | null;
  sectionId: string | null;
}

function toGrant(m: MembershipRecord): RoleGrant {
  return { role: m.role, programId: m.programId, sectionId: m.sectionId };
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

  /** Adds a role (with its scope) unless the user already holds it. Returns the membership. */
  async ensureRole(
    scope: TenantScope,
    userId: string,
    role: Role,
    grantedById: string | null,
    grant: GrantScope = {},
  ): Promise<MembershipRecord> {
    const existing = await membershipsRepository.findActive(scope, userId, role, grant);
    if (existing) return existing;
    return membershipsRepository.create(scope, { userId, role, grantedById, ...grant });
  },

  async hasRole(
    scope: TenantScope,
    userId: string,
    role: Role,
    grant: GrantScope = {},
  ): Promise<boolean> {
    return Boolean(await membershipsRepository.findActive(scope, userId, role, grant));
  },

  /** User ids holding a role (optionally in one program or section), oldest grant first. */
  async holders(scope: TenantScope, role: Role, grant: GrantScope = {}): Promise<string[]> {
    return (await membershipsRepository.listHolders(scope, role, grant)).map((m) => m.userId);
  },

  revoke(scope: TenantScope, userId: string, role: Role, grant: GrantScope, at = new Date()) {
    return membershipsRepository.revoke(scope, userId, role, grant, at);
  },

  revokeAllInTenant(scope: TenantScope, userId: string, at = new Date()) {
    return membershipsRepository.revokeAllInTenant(scope, userId, at);
  },

  async universityAdminsByTenant(tenantIds: string[]) {
    const rows = await membershipsRepository.listUniversityAdmins(tenantIds);
    const byTenant = new Map<string, { email: string; displayName: string; status: string }[]>();
    for (const row of rows) {
      const list = byTenant.get(row.tenantId!) ?? [];
      list.push({
        email: row.user.email,
        displayName: row.user.displayName,
        status: row.user.status,
      });
      byTenant.set(row.tenantId!, list);
    }
    return byTenant;
  },
};

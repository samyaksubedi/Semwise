import { tenantsRepository } from "./tenants.repository.js";

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: "ACTIVE" | "SUSPENDED";
}

function toInfo(t: TenantInfo): TenantInfo {
  return { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, status: t.status };
}

export const tenantsService = {
  async findOwn(tenantId: string): Promise<TenantInfo | null> {
    const tenant = await tenantsRepository.findOwn({ tenantId });
    return tenant ? toInfo(tenant) : null;
  },

  async findManyByIds(ids: string[]): Promise<TenantInfo[]> {
    return (await tenantsRepository.findManyByIds(ids)).map(toInfo);
  },
};

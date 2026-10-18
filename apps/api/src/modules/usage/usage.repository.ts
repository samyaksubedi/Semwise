import { withGlobal, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { AiFeature, QuotaScope } from "../../generated/prisma/enums.js";

export const usageRepository = {
  /** The price in force at `at` for a model: the newest row that has taken effect. */
  findPrice(model: string, at: Date) {
    return withGlobal((db) =>
      db.priceTable.findFirst({
        where: { model, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: "desc" },
      }),
    );
  },

  create(
    scope: TenantScope,
    data: {
      userId: string | null;
      feature: AiFeature;
      task: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      audioSeconds: number;
      costMicros: number;
      priceId: string | null;
      requestId: string;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.aiUsage.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  /** How many separate user actions (requests) used a feature since `since`. */
  async countUserRequests(scope: TenantScope, userId: string, feature: AiFeature, since: Date) {
    const rows = await withTenant(scope.tenantId, (db) =>
      db.aiUsage.groupBy({
        by: ["requestId"],
        where: { tenantId: scope.tenantId, userId, feature, createdAt: { gte: since } },
      }),
    );
    return rows.length;
  },

  async sumTenantCost(scope: TenantScope, since: Date): Promise<number> {
    const result = await withTenant(scope.tenantId, (db) =>
      db.aiUsage.aggregate({
        where: { tenantId: scope.tenantId, createdAt: { gte: since } },
        _sum: { costMicros: true },
      }),
    );
    return result._sum.costMicros ?? 0;
  },

  /** The tenant's own quota row if any, else the platform default row. */
  findQuota(scope: TenantScope, kind: QuotaScope, feature: AiFeature) {
    return withTenant(scope.tenantId, async (db) => {
      const rows = await db.quota.findMany({
        where: { scope: kind, feature, OR: [{ tenantId: scope.tenantId }, { tenantId: null }] },
      });
      return rows.find((r) => r.tenantId === scope.tenantId) ?? rows[0] ?? null;
    });
  },

  findPlan(scope: TenantScope) {
    return withTenant(scope.tenantId, (db) =>
      db.tenantPlan.findUnique({ where: { tenantId: scope.tenantId } }),
    );
  },
};

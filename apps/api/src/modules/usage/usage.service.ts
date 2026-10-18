import { ErrorCode } from "@semwise/shared";
import { AppError } from "../../common/errors/app-error.js";
import { currentRequest } from "../../common/http/request-context.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { usageRepository } from "./usage.repository.js";

export type AiFeature =
  | "SYLLABUS_EXTRACT"
  | "SYLLABUS_CHANGE"
  | "SYLLABUS_INDEX"
  | "ENTRY_ORGANIZE"
  | "ENTRY_INDEX"
  | "DICTATION"
  | "PHOTO_READ"
  | "CHAT"
  | "CATCHUP";

/** Features with a monthly per-person limit; the rest only count toward the college budget. */
const USER_LIMIT_DEFAULTS: Partial<Record<AiFeature, number>> = {
  CHAT: env.QUOTA_STUDENT_CHAT_PER_MONTH,
  DICTATION: env.QUOTA_CR_DICTATIONS_PER_MONTH,
};

/** A warning shows once 80% of a limit is used. */
export const QUOTA_WARN_RATIO = 0.8;

export interface UsageInput {
  tenantId: string;
  userId: string | null;
  feature: AiFeature;
  task: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  audioSeconds?: number;
}

export interface QuotaStatus {
  used: number;
  limit: number | null;
  warn: boolean;
}

interface Price {
  unit: "TOKENS" | "MINUTES";
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
  perMinute: number;
}

/** Cost in micro-dollars. Cached input tokens are billed at the cached rate, not twice. */
export function computeCostMicros(
  price: Price,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; audioSeconds: number },
): number {
  if (price.unit === "MINUTES") return Math.round((usage.audioSeconds / 60) * price.perMinute);
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return Math.round(
    (fresh * price.inputPer1M +
      cached * price.cachedPer1M +
      usage.outputTokens * price.outputPer1M) /
      1_000_000,
  );
}

/** Quotas and budgets are per calendar month (UTC). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const usageService = {
  /** Writes one ledger row for an AI call. Every call through modules/ai ends here. */
  async record(input: UsageInput, now = new Date()): Promise<{ costMicros: number }> {
    const usage = {
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      cachedTokens: input.cachedTokens ?? 0,
      audioSeconds: input.audioSeconds ?? 0,
    };
    const price = await usageRepository.findPrice(input.model, now);
    if (!price) logger.warn({ model: input.model }, "No price for model; cost recorded as 0");
    const costMicros = price ? computeCostMicros(price, usage) : 0;
    await usageRepository.create(
      { tenantId: input.tenantId },
      {
        userId: input.userId,
        feature: input.feature,
        task: input.task,
        model: input.model,
        ...usage,
        costMicros,
        priceId: price?.id ?? null,
        requestId: currentRequest().requestId,
      },
    );
    return { costMicros };
  },

  /** The person's use of a feature this month against its limit (null = no per-person limit). */
  async userQuota(
    tenantId: string,
    userId: string,
    feature: AiFeature,
    now = new Date(),
  ): Promise<QuotaStatus> {
    const scope = { tenantId };
    const row = await usageRepository.findQuota(scope, "USER", feature);
    const limit = row?.limit ?? USER_LIMIT_DEFAULTS[feature] ?? null;
    if (limit === null) return { used: 0, limit: null, warn: false };
    const used = await usageRepository.countUserRequests(scope, userId, feature, monthStart(now));
    return { used, limit, warn: used >= Math.floor(limit * QUOTA_WARN_RATIO) };
  },

  async tenantBudget(tenantId: string, now = new Date()) {
    const scope = { tenantId };
    const plan = await usageRepository.findPlan(scope);
    const budgetMicros = plan?.monthlyAiBudgetMicros ?? env.AI_TENANT_MONTHLY_BUDGET_MICROS;
    const spentMicros = await usageRepository.sumTenantCost(scope, monthStart(now));
    return { budgetMicros, spentMicros };
  },

  /**
   * Checked before every AI call. Stops with QUOTA_EXCEEDED when the person's monthly limit or
   * the college's monthly budget is used up. `countsAsNewRequest` is false for the second and
   * later calls inside one user action, so a question is counted once.
   */
  async assertWithinQuota(
    input: { tenantId: string; userId: string | null; feature: AiFeature },
    { countsAsNewRequest = true, now = new Date() } = {},
  ): Promise<QuotaStatus> {
    const { budgetMicros, spentMicros } = await this.tenantBudget(input.tenantId, now);
    if (spentMicros >= budgetMicros) {
      throw new AppError(
        429,
        ErrorCode.QUOTA_EXCEEDED,
        "Your college has used this month's AI allowance. Ask your administrator.",
      );
    }
    if (!input.userId) return { used: 0, limit: null, warn: false };
    const status = await this.userQuota(input.tenantId, input.userId, input.feature, now);
    if (countsAsNewRequest && status.limit !== null && status.used >= status.limit) {
      throw new AppError(
        429,
        ErrorCode.QUOTA_EXCEEDED,
        `You have used all ${status.limit} for this month. The limit resets on the 1st.`,
      );
    }
    return status;
  },
};

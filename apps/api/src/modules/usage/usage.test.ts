import { beforeEach, describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../../common/db/scope.js";
import { runWithRequestId } from "../../common/http/request-context.js";
import { resetDatabase } from "../../test/db.js";
import { createTenant, createUser } from "../../test/helpers.js";
import { computeCostMicros, usageService } from "./usage.service.js";

describe("cost", () => {
  const terra = {
    unit: "TOKENS",
    inputPer1M: 2_000_000,
    outputPer1M: 12_000_000,
    cachedPer1M: 200_000,
    perMinute: 0,
  } as const;

  it("prices tokens in micro-dollars, cached input at the cached rate", () => {
    // 4,000 in, 500 out on Terra = $0.008 + $0.006 = $0.014.
    expect(
      computeCostMicros(terra, {
        inputTokens: 4000,
        outputTokens: 500,
        cachedTokens: 0,
        audioSeconds: 0,
      }),
    ).toBe(14_000);
    // 1,000 of the 4,000 input tokens cached: 3,000 x 2 + 1,000 x 0.2 + 500 x 12 = 12,200.
    expect(
      computeCostMicros(terra, {
        inputTokens: 4000,
        outputTokens: 500,
        cachedTokens: 1000,
        audioSeconds: 0,
      }),
    ).toBe(12_200);
  });

  it("prices transcription per minute", () => {
    const transcribe = {
      unit: "MINUTES",
      inputPer1M: 0,
      outputPer1M: 0,
      cachedPer1M: 0,
      perMinute: 4500,
    } as const;
    expect(
      computeCostMicros(transcribe, {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        audioSeconds: 120,
      }),
    ).toBe(9000);
  });
});

describe("ledger and quotas", () => {
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    tenantId = (await createTenant()).id;
    otherTenantId = (await createTenant()).id;
    userId = (await createUser()).id;
  });

  it("records each call with its cost and the price row used", async () => {
    await runWithRequestId("req-1", () =>
      usageService.record({
        tenantId,
        userId,
        feature: "CHAT",
        task: "answer",
        model: "gpt-5.4-mini",
        inputTokens: 4000,
        outputTokens: 500,
      }),
    );
    const rows = await withTenant(tenantId, (db) => db.aiUsage.findMany());
    expect(rows).toHaveLength(1);
    // Mini: 4,000 x 0.75 + 500 x 4.5 = 5,250 micro-dollars.
    expect(rows[0]).toEqual(
      expect.objectContaining({
        costMicros: 5250,
        priceId: "price_2026_10_mini",
        requestId: "req-1",
        userId,
      }),
    );
  });

  it("records an unknown model at zero cost instead of failing the call", async () => {
    await usageService.record({
      tenantId,
      userId,
      feature: "CHAT",
      task: "answer",
      model: "mystery",
    });
    const [row] = await withTenant(tenantId, (db) => db.aiUsage.findMany());
    expect(row).toEqual(expect.objectContaining({ costMicros: 0, priceId: null }));
  });

  it("counts a user action once, however many calls it made, and stops at the limit", async () => {
    await withSystem((db) =>
      db.quota.create({ data: { tenantId, scope: "USER", feature: "CHAT", limit: 2 } }),
    );
    for (const requestId of ["q1", "q1", "q2"]) {
      await runWithRequestId(requestId, () =>
        usageService.record({
          tenantId,
          userId,
          feature: "CHAT",
          task: "route",
          model: "gpt-5.6-luna",
        }),
      );
    }
    const status = await usageService.userQuota(tenantId, userId, "CHAT");
    expect(status).toEqual({ used: 2, limit: 2, warn: true });
    await expect(
      usageService.assertWithinQuota({ tenantId, userId, feature: "CHAT" }),
    ).rejects.toMatchObject({ status: 429, code: "QUOTA_EXCEEDED" });
    // A follow-up call inside the same action is still allowed.
    await expect(
      usageService.assertWithinQuota(
        { tenantId, userId, feature: "CHAT" },
        { countsAsNewRequest: false },
      ),
    ).resolves.toBeTruthy();
  });

  it("uses the environment default without a quota row, and a tenant row overrides the platform row", async () => {
    expect((await usageService.userQuota(tenantId, userId, "CHAT")).limit).toBe(60);
    await withSystem((db) =>
      db.quota.createMany({
        data: [
          { tenantId: null, scope: "USER", feature: "CHAT", limit: 30 },
          { tenantId, scope: "USER", feature: "CHAT", limit: 90 },
        ],
      }),
    );
    expect((await usageService.userQuota(tenantId, userId, "CHAT")).limit).toBe(90);
    expect((await usageService.userQuota(otherTenantId, userId, "CHAT")).limit).toBe(30);
  });

  it("stops every AI call once the college budget is spent", async () => {
    await withSystem((db) =>
      db.tenantPlan.create({ data: { tenantId, monthlyAiBudgetMicros: 10_000 } }),
    );
    await usageService.record({
      tenantId,
      userId: null,
      feature: "SYLLABUS_EXTRACT",
      task: "extract",
      model: "gpt-5.6-terra",
      inputTokens: 5000,
    });
    await expect(
      usageService.assertWithinQuota({ tenantId, userId, feature: "CHAT" }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    // Another college is unaffected.
    await expect(
      usageService.assertWithinQuota({ tenantId: otherTenantId, userId, feature: "CHAT" }),
    ).resolves.toBeTruthy();
  });

  it("never counts another college's usage", async () => {
    await withSystem((db) =>
      db.quota.create({ data: { tenantId: null, scope: "USER", feature: "CHAT", limit: 1 } }),
    );
    await usageService.record({
      tenantId: otherTenantId,
      userId,
      feature: "CHAT",
      task: "answer",
      model: "gpt-5.4-mini",
    });
    expect((await usageService.userQuota(tenantId, userId, "CHAT")).used).toBe(0);
  });
});

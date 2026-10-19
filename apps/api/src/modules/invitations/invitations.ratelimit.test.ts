import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { getRedis } from "../../lib/redis.js";
import { resetDatabase } from "../../test/db.js";
import { agent } from "../../test/helpers.js";

const app = createApp();
const preview = (token: string) => agent(app).post("/v1/auth/invitations/preview").send({ token });
const newToken = () => randomBytes(24).toString("base64url");

beforeAll(() => {
  vi.stubEnv("TEST_RATE_LIMITS", "1");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
// Counters live in Redis between runs; every test starts from empty buckets.
beforeEach(async () => {
  await resetDatabase();
});

describe("invite rate limits", () => {
  it("counts per invite token, so reloads of one invite do not use up the address", async () => {
    const token = newToken();
    for (let i = 0; i < 20; i++) {
      expect((await preview(token)).status).not.toBe(429);
    }
    const blocked = await preview(token);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // Another invite from the same address is not affected.
    expect((await preview(newToken())).status).not.toBe(429);
  });

  it("shares the token count between preview and accept", async () => {
    const token = newToken();
    for (let i = 0; i < 10; i++) await preview(token);
    for (let i = 0; i < 10; i++) {
      const res = await agent(app)
        .post("/v1/auth/invitations/accept")
        .send({ token, password: "correct horse battery staple", name: "Test" });
      expect(res.status).not.toBe(429);
    }
    expect((await preview(token)).status).toBe(429);
  });

  it("limits one address to 120 requests an hour across tokens", async () => {
    for (let i = 0; i < 120; i++) {
      expect((await preview(newToken())).status).not.toBe(429);
    }
    expect((await preview(newToken())).status).toBe(429);
  });

  it("keeps the raw token out of Redis keys", async () => {
    const token = newToken();
    await preview(token);
    const keys = await getRedis().keys("rl:*");
    expect(keys.some((key) => key.includes(token))).toBe(false);
    const hashed = createHash("sha256").update(token).digest("hex").slice(0, 32);
    expect(keys).toContain(`rl:invite-token:token:${hashed}`);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { resetDatabase } from "../../test/db.js";
import { agent, unique } from "../../test/helpers.js";

const app = createApp();
const forgot = (email: string) => agent(app).post("/v1/auth/password/forgot").send({ email });

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

describe("password reset rate limits", () => {
  it("allows 5 requests an hour per email, whatever its case", async () => {
    const email = `${unique("reset")}@example.com`;
    for (let i = 0; i < 5; i++) {
      expect((await forgot(i % 2 ? email.toUpperCase() : email)).status).not.toBe(429);
    }
    const blocked = await forgot(email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // Another address still has its own allowance.
    expect((await forgot(`${unique("reset")}@example.com`)).status).not.toBe(429);
  });

  it("allows 10 requests an hour per address across emails", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await forgot(`${unique("reset")}@example.com`)).status).not.toBe(429);
    }
    expect((await forgot(`${unique("reset")}@example.com`)).status).toBe(429);
  });

  it("counts reset attempts in the same per-address bucket", async () => {
    for (let i = 0; i < 10; i++) {
      await agent(app)
        .post("/v1/auth/password/reset")
        .send({ token: "not-a-real-token", password: "correct horse battery staple" });
    }
    expect((await forgot(`${unique("reset")}@example.com`)).status).toBe(429);
  });
});

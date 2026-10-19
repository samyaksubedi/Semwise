import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { agent } from "../../test/helpers.js";

const app = createApp();
const preview = (token: string) => agent(app).post("/v1/auth/invitations/preview").send({ token });

beforeAll(() => {
  process.env.TEST_RATE_LIMITS = "1";
});
afterAll(() => {
  delete process.env.TEST_RATE_LIMITS;
});

describe("invite rate limits", () => {
  it("counts per invite token, so reloads of one invite do not use up the address", async () => {
    // A fresh random token per run, because the counters live in Redis between runs.
    const token = randomBytes(24).toString("base64url");
    for (let i = 0; i < 20; i++) {
      expect((await preview(token)).status).not.toBe(429);
    }
    const blocked = await preview(token);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");

    // Another invite from the same address is not affected.
    const other = await preview(randomBytes(24).toString("base64url"));
    expect(other.status).not.toBe(429);
  });
});

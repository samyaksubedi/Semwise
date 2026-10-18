import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

const app = createApp();

describe("health", () => {
  it("answers liveness", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });

  it("reports database, Redis and Qdrant as ready", async () => {
    const res = await request(app).get("/v1/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: "ready",
      checks: { database: "ok", redis: "ok", qdrant: "ok" },
    });
  });

  it("uses the error envelope for unknown routes", async () => {
    const res = await request(app).get("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(typeof res.body.error.requestId).toBe("string");
  });
});

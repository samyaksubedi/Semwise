import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "@/features/auth/login-form";
import { ApiError, api, buildUrl } from "./api";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status }));

describe("api client", () => {
  it("unwraps the data envelope and sends the cookie", async () => {
    const fetch = respond(200, { data: { ok: 1 } });
    vi.stubGlobal("fetch", fetch);
    expect(await api("/x", { body: { a: 1 } })).toEqual({ ok: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/v1/x");
    expect(init).toEqual(expect.objectContaining({ method: "POST", credentials: "include" }));
  });

  it("turns the error envelope into an ApiError with the stable code and field messages", async () => {
    vi.stubGlobal(
      "fetch",
      respond(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the form",
          details: [{ path: "taughtOn", message: "In the future" }],
          requestId: "r1",
        },
      }),
    );
    const error = await api("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toEqual(
      expect.objectContaining({ status: 400, code: "VALIDATION_FAILED", requestId: "r1" }),
    );
    expect((error as ApiError).field("taughtOn")).toBe("In the future");
  });

  it("reports a network failure as NETWORK, and a 204 as undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await api("/x").catch((e: ApiError) => e.code)).toBe("NETWORK");
    vi.stubGlobal("fetch", respond(204, null));
    expect(await api("/x", { method: "DELETE" })).toBeUndefined();
  });

  it("drops empty query values", () => {
    expect(buildUrl("/catchup", { from: "2026-10-19", to: "", subjectId: undefined })).toBe(
      "http://localhost:4000/v1/catchup?from=2026-10-19",
    );
  });
});

describe("after sign-in", () => {
  it("follows only same-site paths", () => {
    expect(safeNext("/chat?x=1")).toBe("/chat?x=1");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

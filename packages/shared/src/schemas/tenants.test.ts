import { describe, expect, it } from "vitest";
import { slugify, timezoneSchema } from "./tenants.js";

describe("slugify", () => {
  it("makes readable slugs from college names", () => {
    expect(slugify("St. Xavier's College")).toBe("st-xaviers-college");
    expect(slugify("  Kathmandu   University!! ")).toBe("kathmandu-university");
    expect(slugify("Café Académie")).toBe("cafe-academie");
  });
});

describe("timezoneSchema", () => {
  it("accepts IANA zones and rejects the rest", () => {
    expect(timezoneSchema.safeParse("Asia/Kathmandu").success).toBe(true);
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });
});

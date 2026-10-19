import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, timezoneGroups } from "./timezones";

const all = (current?: string) => timezoneGroups(current).flatMap((g) => g.zones);

describe("timezoneGroups", () => {
  it("lists Kathmandu under its current name, once, with its offset", () => {
    const zones = all();
    const kathmandu = zones.filter((z) => z.value.includes("Kat"));
    expect(kathmandu).toEqual([{ value: DEFAULT_TIMEZONE, label: "Kathmandu (GMT+5:45)" }]);
  });

  it("groups by region", () => {
    const regions = timezoneGroups().map((g) => g.region);
    expect(regions).toContain("Asia");
    expect(regions).toContain("Europe");
    expect(new Set(regions).size).toBe(regions.length);
  });

  it("keeps a stored value the browser does not list", () => {
    expect(all("Asia/Katmandu").some((z) => z.value === "Asia/Katmandu")).toBe(true);
  });
});

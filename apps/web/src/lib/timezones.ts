/** The first market; new colleges start here. */
export const DEFAULT_TIMEZONE = "Asia/Kathmandu";

/**
 * Browsers still list some zones under their old names (Chrome has Asia/Katmandu). The API accepts
 * both, so the list shows the current name and a stored old name is never lost.
 */
const RENAMED: Record<string, string> = {
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
};

export interface TimezoneOption {
  value: string;
  /** "Kathmandu (GMT+5:45)" */
  label: string;
}

export interface TimezoneGroup {
  region: string;
  zones: TimezoneOption[];
}

function offsetOf(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return parts?.value ?? "";
  } catch {
    return "";
  }
}

/** Every IANA zone the browser knows, grouped by region, with the current one always present. */
export function timezoneGroups(current?: string, at: Date = new Date()): TimezoneGroup[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = new Set(supported.map((z) => RENAMED[z] ?? z));
  zones.add(DEFAULT_TIMEZONE);
  if (current) zones.add(current);
  const groups = new Map<string, TimezoneOption[]>();
  for (const zone of [...zones].sort()) {
    const slash = zone.indexOf("/");
    const region = slash > 0 ? zone.slice(0, slash) : "Other";
    const place = (slash > 0 ? zone.slice(slash + 1) : zone)
      .replaceAll("_", " ")
      .replaceAll("/", ", ");
    const offset = offsetOf(zone, at);
    const list = groups.get(region) ?? [];
    list.push({ value: zone, label: offset ? `${place} (${offset})` : place });
    groups.set(region, list);
  }
  return [...groups].map(([region, list]) => ({ region, zones: list }));
}

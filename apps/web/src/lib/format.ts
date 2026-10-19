import { t } from "./strings";

/**
 * Dates are shown in the college's timezone. The API sends calendar days as "YYYY-MM-DD" and
 * moments as ISO timestamps.
 */

/** Today's calendar date ("YYYY-MM-DD") in a timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "Mon, 19 Oct" for a calendar day. */
export function formatDay(day: string, today?: string, withYear = false): string {
  if (today) {
    if (day === today) return t.dates.today;
    if (day === addDays(today, -1)) return t.dates.yesterday;
  }
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A moment, as "19 Oct, 14:05" in the college's timezone. */
export function formatMoment(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** Short weekday and day number, for the date strip. */
export function dayParts(day: string): { weekday: string; date: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d),
    date: String(d.getUTCDate()),
  };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

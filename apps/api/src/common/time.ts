/** The calendar date ("YYYY-MM-DD") it is now in a timezone. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "YYYY-MM-DD" plus (or minus) whole days. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The weekday (0 = Sunday) of a "YYYY-MM-DD" date. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

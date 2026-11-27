/** Wall-clock ⇄ instant conversion for the firm's time zone (Reno = Pacific), with no dependencies.
 *  Tasks are typed as a local date + time; they're stored as an instant (timestamptz). */
export const FIRM_TZ = "America/Los_Angeles";

/** Offset (ms) of `tz` from UTC at the instant `ms`. */
function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** "2026-12-01" + "09:30" in `tz` → Date (the real instant). DST-safe. */
export function zonedToUtc(day: string, time: string, tz = FIRM_TZ): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0);
  let t = guess - offsetAt(guess, tz);
  const o2 = offsetAt(t, tz);
  if (guess - o2 !== t) t = guess - o2; // crossed a DST change
  return new Date(t);
}

/** Instant → { day: "YYYY-MM-DD", time: "HH:MM" } on the wall clock of `tz`. */
export function utcToZoned(at: Date | string, tz = FIRM_TZ): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}

export const timeLabel = (at: Date | string, tz = FIRM_TZ) =>
  new Date(at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

/**
 * Hour logging math (pure, no I/O): quarter-hour entries, weeks, totals, and missing-hours detection.
 *
 * Compatibility with the Job List workbook: its weekly log rows are labelled "Thru 11/13/26" — the Friday
 * that ends the work week. Daily entries logged in the app keep their exact day in `work_date` and are also
 * stamped with that week's Friday (`week_ending`) and the same "Thru M/D/YY" label, so the weekly hours log,
 * the per-phase "Hours Completed" (template N10 = SUM of the log) and job cost all keep working unchanged.
 * Weeks run Monday–Sunday; a Saturday or Sunday entry belongs to the Friday of the same Monday-started week.
 */
import { addDays, dayNumber, round2 } from "./util";

export const HOURS_STEP = 0.25;
export const MAX_DAY_HOURS = 24;

/** ISO weekday 1 = Monday … 7 = Sunday. */
export const isoDow = (day: string) => { const d = new Date(dayNumber(day) * 86400000).getUTCDay(); return d === 0 ? 7 : d; };
/** Monday of the week containing `day`. */
export const weekStart = (day: string) => addDays(day, 1 - isoDow(day));
/** Friday of the week containing `day` (the workbook's "Thru" date). */
export const weekEnding = (day: string) => addDays(weekStart(day), 4);
/** "Thru 11/13/26", the workbook's label for the week ending on that Friday. */
export function weekLabel(fridayOrAnyDay: string) {
  const f = weekEnding(fridayOrAnyDay);
  const [y, m, d] = f.split("-").map(Number);
  return `Thru ${m}/${d}/${String(y).slice(2)}`;
}
/** The 7 days Mon..Sun of the week containing `day`. */
export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
export const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

/** Parse typed hours: "1.5", "1:30", "1h 15m", "0.25". Returns null for blank/invalid. */
export function parseHours(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
  const n = Number(s.replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/** Round to the nearest quarter hour. */
export const toQuarter = (h: number) => Math.round(h / HOURS_STEP) * HOURS_STEP;

/** Validate one entry's hours: positive, quarter-hour steps, at most 24. Returns an error message or null. */
export function hoursError(h: number | null): string | null {
  if (h === null || !Number.isFinite(h)) return "Enter the hours worked.";
  if (h <= 0) return "Hours must be more than zero.";
  if (h > MAX_DAY_HOURS) return "That’s more than 24 hours in one entry.";
  if (Math.abs(h / HOURS_STEP - Math.round(h / HOURS_STEP)) > 1e-9) return "Use quarter-hour steps (0.25, 0.5, 0.75 …).";
  return null;
}

/** Would adding `adding` hours (replacing `replacing`) push someone past 24 h that day? */
export function dayTotalError(existingDayTotal: number, adding: number, replacing = 0): string | null {
  const t = round2(existingDayTotal - replacing + adding);
  return t > MAX_DAY_HOURS ? `That makes ${t} h on one day (max ${MAX_DAY_HOURS}).` : null;
}

export interface LoggedEntry { phase: string; hours: number | null; person?: string | null; member_id?: string | null; work_date?: string | null; week_ending?: string | null }

/** Hours worked by phase (template N10 per phase). */
export function hoursByPhase(entries: LoggedEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.phase] = round2((out[e.phase] ?? 0) + Number(e.hours ?? 0));
  return out;
}

/** Assigned / worked / remaining for one phase, and the burn (worked ÷ assigned). Remaining goes negative when over. */
export function phaseHours(assigned: number | null | undefined, worked: number) {
  const a = Number(assigned ?? 0);
  return { assigned: a, worked: round2(worked), remaining: round2(a - worked), burn: a > 0 ? worked / a : null, over: a > 0 && worked > a + 1e-9 };
}

/** Sum of hours per day (work_date) — entries without a day are ignored. */
export function hoursByDay(entries: LoggedEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (e.work_date) m.set(e.work_date, round2((m.get(e.work_date) ?? 0) + Number(e.hours ?? 0)));
  return m;
}

// ---------------------------------------------------------------- missing hours
export interface ExpectedHours {
  hoursPerDay: number;        // e.g. 8
  workDays: number[];         // ISO weekdays, e.g. [1,2,3,4,5]
}
export interface MissingDay { day: string; expected: number; logged: number; short: number; isToday: boolean }

/**
 * Days in [from, to] (clipped to [trackingStart, today]) where someone logged less than expected.
 * Holidays and non-work days are skipped. Today only counts once `now` (HH:MM on the firm clock) has
 * reached the reminder time, so nobody is nagged about a day still in progress.
 */
export function missingDays(o: ExpectedHours & {
  from: string; to: string; today: string; nowTime?: string; remindTime?: string;
  trackingStart?: string | null; holidays?: string[]; logged: Map<string, number>;
}): MissingDay[] {
  if (!(o.hoursPerDay > 0) || !o.workDays.length) return [];
  const start = o.trackingStart && o.trackingStart > o.from ? o.trackingStart : o.from;
  const end = o.to < o.today ? o.to : o.today;
  const hol = new Set(o.holidays ?? []);
  const out: MissingDay[] = [];
  for (const day of start <= end ? daysBetween(start, end) : []) {
    if (!o.workDays.includes(isoDow(day)) || hol.has(day)) continue;
    const isToday = day === o.today;
    if (isToday && (o.nowTime ?? "00:00") < (o.remindTime ?? "16:30")) continue;
    const logged = o.logged.get(day) ?? 0;
    const short = round2(o.hoursPerDay - logged);
    if (short > 0.009) out.push({ day, expected: o.hoursPerDay, logged, short, isToday });
  }
  return out;
}

/** Expected hours in a week for someone (holidays excluded). */
export function expectedInWeek(e: ExpectedHours, anyDay: string, holidays: string[] = []) {
  return weekDays(anyDay).filter((d) => e.workDays.includes(isoDow(d)) && !holidays.includes(d)).length * e.hoursPerDay;
}

/** Only the person who typed an entry (or the person it's for) may change it; spreadsheet rows are read-only
 *  (the importer replaces them from the workbook). */
export function canEditEntry(e: { source_key?: string | null; entered_by?: string | null; person?: string | null }, signedInName: string | null | undefined): boolean {
  if (e.source_key) return false;
  const k = (signedInName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (!k) return false;
  const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  return first(e.entered_by) === k || first(e.person) === k;
}

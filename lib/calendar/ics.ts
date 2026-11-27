/**
 * iCalendar (RFC 5545) writer for task reminders. Pure: no I/O.
 * Timed events are written in UTC (…Z) so no VTIMEZONE block is needed; all-day events use VALUE=DATE.
 * Works with Outlook (web + desktop), Google Calendar and Apple Calendar subscriptions.
 */
export interface CalEvent {
  uid: string;                    // stable per task, so updates replace instead of duplicating
  sequence: number;               // bumped on every change
  title: string;
  description?: string | null;
  url?: string | null;
  start: { at: Date } | { day: string } | { local: { day: string; time: string }; tz: "America/Los_Angeles" };   // a moment, an all-day date "YYYY-MM-DD", or a wall-clock time in a zone (for repeating events)
  rrule?: string;                 // e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" (zoned starts only, so DST never shifts the time)
  exdates?: string[];             // days ("YYYY-MM-DD") a repeating event skips (holidays)
  durationMin?: number;           // timed events only (default 30)
  alarmMinutesBefore?: number | null;      // null/undefined = no alarm; all-day alarms fire at 9 am that day
  updatedAt?: Date;
  categories?: string[];
  priority?: "low" | "normal" | "high";
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const icsUtc = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsDay = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** TEXT escaping: backslash, semicolon, comma, newline. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold lines longer than 75 octets (UTF-8 safe: never splits a character). */
export function icsFold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", len = 0, limit = 75;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    if (len + n > limit) { out.push(cur); cur = ""; len = 0; limit = 74; } // continuation lines start with a space
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const PRIORITY = { high: 1, normal: 5, low: 9 } as const;

function eventLines(e: CalEvent, stamp: Date): string[] {
  const L: string[] = ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${icsUtc(stamp)}`, `SEQUENCE:${Math.max(0, Math.floor(e.sequence))}`];
  if ("at" in e.start) {
    const end = new Date(e.start.at.getTime() + (e.durationMin ?? 30) * 60000);
    L.push(`DTSTART:${icsUtc(e.start.at)}`, `DTEND:${icsUtc(end)}`);
  } else if ("local" in e.start) {
    const { day, time } = e.start.local, tz = e.start.tz;
    const [h, m] = time.split(":").map(Number);
    const endMin = h * 60 + m + (e.durationMin ?? 15);
    const t = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}00`;
    L.push(`DTSTART;TZID=${tz}:${icsDay(day)}T${t(h * 60 + m)}`, `DTEND;TZID=${tz}:${icsDay(day)}T${t(Math.min(endMin, 23 * 60 + 59))}`);
    if (e.rrule) L.push(`RRULE:${e.rrule}`);
    if (e.exdates?.length) L.push(`EXDATE;TZID=${tz}:${e.exdates.map((d) => `${icsDay(d)}T${t(h * 60 + m)}`).join(",")}`);
  } else {
    L.push(`DTSTART;VALUE=DATE:${icsDay(e.start.day)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(e.start.day))}`, "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE");
  }
  L.push(`SUMMARY:${icsEscape(e.title)}`);
  if (e.description) L.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.url) L.push(`URL:${e.url}`);
  if (e.categories?.length) L.push(`CATEGORIES:${e.categories.map(icsEscape).join(",")}`);
  if (e.priority) L.push(`PRIORITY:${PRIORITY[e.priority]}`);
  if (e.updatedAt) L.push(`LAST-MODIFIED:${icsUtc(e.updatedAt)}`);
  L.push("TRANSP:TRANSPARENT", "STATUS:CONFIRMED");
  if (e.alarmMinutesBefore !== null && e.alarmMinutesBefore !== undefined && e.alarmMinutesBefore >= 0) {
    // all-day: remind at 9:00 local-floating on the day (PT9H after the date starts)
    const trigger = !("day" in e.start) ? (e.alarmMinutesBefore === 0 ? "PT0M" : `-PT${Math.floor(e.alarmMinutesBefore)}M`) : "PT9H";
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:${trigger}`, "END:VALARM");
  }
  L.push("END:VEVENT");
  return L;
}

/** America/Los_Angeles (US rules since 2007), so zoned repeating events keep their wall-clock time across DST. */
export const VTIMEZONE_LA = [
  "BEGIN:VTIMEZONE", "TZID:America/Los_Angeles", "X-LIC-LOCATION:America/Los_Angeles",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "TZNAME:PDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "TZNAME:PST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildCalendar(events: CalEvent[], opts: { name: string; method?: "PUBLISH"; stamp?: Date; refreshMinutes?: number; feed?: boolean }): string {
  const stamp = opts.stamp ?? new Date();
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Frame Architecture//Frame Hub//EN", "CALSCALE:GREGORIAN", `METHOD:${opts.method ?? "PUBLISH"}`];
  if (opts.feed) {
    const r = opts.refreshMinutes ?? 60;
    L.push(`X-WR-CALNAME:${icsEscape(opts.name)}`, "X-WR-TIMEZONE:America/Los_Angeles", `REFRESH-INTERVAL;VALUE=DURATION:PT${r}M`, `X-PUBLISHED-TTL:PT${r}M`);
  }
  if (events.some((e) => "local" in e.start)) L.push(...VTIMEZONE_LA);
  for (const e of events) L.push(...eventLines(e, stamp));
  L.push("END:VCALENDAR");
  return L.map(icsFold).join("\r\n") + "\r\n";
}

/**
 * The recurring "Log your hours" reminder that rides in each person's calendar feed (/api/cal/<token>.ics).
 * One repeating event per person: their working days at their reminder time (default 4:30 PM Pacific),
 * with an alarm at that moment, skipping firm holidays. Written in America/Los_Angeles wall-clock time with a
 * VTIMEZONE block, so it stays at 4:30 PM through daylight-saving changes. Turning it off (Settings) drops it
 * from the feed; changing the time or days bumps SEQUENCE so subscribed calendars replace it.
 */
import type { CalEvent } from "./ics";
import { isoDow } from "../calc/hours";
import { addDays } from "../calc/util";

const BYDAY = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export interface ReminderMember { id: string; name: string; work_days: number[]; remind_enabled: boolean; remind_time: string; remind_seq: number; track_hours: boolean; hours_per_day: number }

/** First working day on/after `from`. */
function firstWorkday(from: string, days: number[]) {
  let d = from;
  for (let i = 0; i < 7 && !days.includes(isoDow(d)); i++) d = addDays(d, 1);
  return d;
}

export function logHoursReminder(m: ReminderMember, o: { baseUrl: string; startFrom: string; holidays?: string[]; updatedAt?: Date }): CalEvent | null {
  if (!m.remind_enabled || !m.track_hours) return null;
  const days = [...new Set(m.work_days)].filter((d) => d >= 1 && d <= 7).sort();
  if (!days.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.remind_time)) return null;
  const start = firstWorkday(o.startFrom, days);
  const link = `${o.baseUrl}/timesheet`;
  return {
    uid: `log-hours-${m.id}@frame-hub`,
    sequence: m.remind_seq,
    title: "Log your hours — Frame Hub",
    description: `Log today's hours on your projects (${m.hours_per_day} h expected).\nOpen your timesheet: ${link}`,
    url: link,
    start: { local: { day: start, time: m.remind_time }, tz: "America/Los_Angeles" },
    durationMin: 15,
    rrule: `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")}`,
    exdates: (o.holidays ?? []).filter((h) => h >= start && days.includes(isoDow(h))).sort(),
    alarmMinutesBefore: 0,
    updatedAt: o.updatedAt,
    categories: ["Frame Hub", "Timesheet"],
  };
}

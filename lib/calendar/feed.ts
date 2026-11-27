import type { Db } from "../db/types";
import { buildCalendar } from "./ics";
import { taskToEvent } from "./index";
import { tokenFromSegment } from "./token";
import { memberByToken } from "../repo/team";
import { feedTasks } from "../repo/tasks";
import { getSettings } from "../repo/settings";
import { logHoursReminder } from "./reminder";

export interface FeedResult { status: 200 | 404; body: string; name?: string }

/** The whole subscribable feed for "<token>.ics". Any bad, revoked or unknown token gets the same bare 404. */
export async function renderFeed(db: Db, segment: string, baseUrl: string, now = new Date()): Promise<FeedResult> {
  const token = tokenFromSegment(segment);
  if (!token || !segment.endsWith(".ics")) return { status: 404, body: "Not found" };
  const m = await memberByToken(db, token);
  if (!m) return { status: 404, body: "Not found" };
  const tasks = await feedTasks(db, m.id, m.cal_include_unassigned);
  const events = tasks.map((t) => taskToEvent(t, baseUrl)).filter((e) => e !== null);
  const settings = await getSettings(db);
  const reminder = logHoursReminder(m, { baseUrl, startFrom: settings.hoursTrackingStart, holidays: settings.firmHolidays, updatedAt: m.updated_at ? new Date(m.updated_at) : undefined });
  if (reminder) events.push(reminder);
  return { status: 200, body: buildCalendar(events, { name: `Frame Hub – ${m.name}`, feed: true, stamp: now, refreshMinutes: 60 }), name: m.name };
}

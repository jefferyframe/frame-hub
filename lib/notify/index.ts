/**
 * Reminders to log hours, behind one interface so email / Teams can be added later without touching pages.
 *
 *   in-app    (now)   the banner on the dashboard + the badge on "My timesheet" (computed on every page load)
 *   calendar  (now)   a repeating "Log your hours" event with an alarm in each person's calendar feed (lib/calendar/reminder.ts)
 *   graph     (later) Microsoft Graph, once Entra sign-in exists: POST /users/{id}/sendMail, or a Teams chat message
 *                     (POST /chats/{chat-id}/messages) to each person with missing days. Run it from a daily job
 *                     (Vercel Cron → an authenticated route) that calls runHoursReminders(db, graphNotifier(), now).
 */
import type { Db } from "../db/types";
import type { MissingDay } from "../calc/hours";
import { missingHoursReport } from "../repo/time";

export interface HoursReminder { memberId: string; name: string; email: string | null; days: MissingDay[]; timesheetUrl: string }

export interface HoursNotifier {
  readonly id: "none" | "graph-mail" | "teams";
  /** Deliver one reminder. Returns false when this person can't be reached on this channel (e.g. no email). */
  send(r: HoursReminder): Promise<boolean>;
}

/** Today: nothing is pushed — the calendar alarm and the in-app banner do the reminding. */
export const noNotifier: HoursNotifier = { id: "none", async send() { return false; } };

/** Placeholder for Microsoft Graph mail / Teams. Needs Entra app registration + Mail.Send (or ChatMessage.Send). */
export class GraphHoursNotifier implements HoursNotifier {
  readonly id = "graph-mail" as const;
  async send(): Promise<boolean> { throw new Error("Email / Teams reminders aren't set up yet (needs Microsoft Entra sign-in)."); }
}

export function hoursNotifier(): HoursNotifier { return noNotifier; }

/** Everyone short on hours this week (through today), sent through `notifier`. Returns who was reminded. */
export async function runHoursReminders(db: Db, notifier: HoursNotifier, baseUrl: string, now = new Date()) {
  const rows = await missingHoursReport(db, { now });
  const sent: string[] = [];
  for (const r of rows) {
    if (!r.missing.length) continue;
    if (await notifier.send({ memberId: r.member.id, name: r.member.name, email: r.member.email, days: r.missing, timesheetUrl: `${baseUrl}/timesheet` })) sent.push(r.member.id);
  }
  return sent;
}

/**
 * Calendar layer. Tasks and reminders reach people's calendars through one interface:
 *
 *   feed   (now)   each team member subscribes once to a private iCalendar URL (/api/cal/<token>.ics);
 *                  their calendar app re-reads it on its own schedule, so nothing is pushed — taskChanged is a no-op.
 *   graph  (later) Microsoft Graph (Entra sign-in): create/update/delete an event in the owner's Outlook
 *                  calendar on every change, using the same taskToEvent mapping. See GraphCalendarSync below.
 *
 * Repositories call calendarSync().taskChanged / taskRemoved after every task write, so switching
 * provider later touches no page and no repository.
 */
import type { Db } from "../db/types";
import type { CalEvent } from "./ics";
import { utcToZoned } from "../calc/time";

export interface CalendarSync {
  readonly id: "feed" | "graph";
  taskChanged(db: Db, taskId: string): Promise<void>;
  taskRemoved(db: Db, taskId: string): Promise<void>;
}

const feedSync: CalendarSync = {
  id: "feed",
  async taskChanged() { /* subscribers pull /api/cal/<token>.ics */ },
  async taskRemoved() { /* done/deleted tasks simply drop out of the feed */ },
};

/**
 * Placeholder for Microsoft Graph. When Entra sign-in lands:
 *   - store each member's Graph user id / delegated token (or use an app-only token with Calendars.ReadWrite)
 *   - taskChanged: PUT /users/{id}/events/{eventId} (or POST, keeping the event id on the task; transactionId = task id)
 *     with body from taskToEvent(): subject, start/end (UTC), isAllDay, isReminderOn + reminderMinutesBeforeStart, body (deep link)
 *   - taskRemoved: DELETE /users/{id}/events/{eventId}
 * Until then it isn't selectable (CALENDAR_PROVIDER=graph falls back to the feed).
 */
export class GraphCalendarSync implements CalendarSync {
  readonly id = "graph" as const;
  async taskChanged(): Promise<void> { throw new Error("Microsoft Graph calendar sync isn't set up yet."); }
  async taskRemoved(): Promise<void> { throw new Error("Microsoft Graph calendar sync isn't set up yet."); }
}

export function calendarSync(): CalendarSync {
  return feedSync;
}

export interface TaskForCalendar {
  id: string; title: string; due_on: string | null; due_at: Date | string | null; notes: string | null; kind: string; priority: "low" | "normal" | "high";
  reminder_minutes: number | null; sequence: number; updated_at: Date | string;
  opportunity_id: string | null; opportunity_name?: string | null; contact_name?: string | null; company_name?: string | null; project_job?: string | null; owner_name?: string | null;
}

const KIND_PREFIX: Record<string, string> = { call: "Call: ", email: "Email: ", meeting: "Meet: ", todo: "" };

/** One task → one calendar event (same shape for the .ics feed, the single download, and Graph later). */
export function taskToEvent(t: TaskForCalendar, baseUrl: string): CalEvent | null {
  if (!t.due_on && !t.due_at) return null;
  const about = [t.opportunity_name, t.contact_name, t.company_name, t.project_job ? `Job ${t.project_job}` : null].filter(Boolean);
  const link = t.opportunity_id ? `${baseUrl}/sales/${t.opportunity_id}` : `${baseUrl}/crm?task=${t.id}`;
  const desc = [about.length ? `About: ${[...new Set(about)].join(" · ")}` : null, t.owner_name ? `Owner: ${t.owner_name}` : null, t.notes, `Open in Frame Hub: ${link}`].filter(Boolean).join("\n");
  const prefix = KIND_PREFIX[t.kind] ?? "";
  const title = t.title.toLowerCase().startsWith(prefix.toLowerCase().trim().replace(":", "")) ? t.title : prefix + t.title;
  return {
    uid: `task-${t.id}@frame-hub`,
    sequence: t.sequence ?? 0,
    title: (t.priority === "high" ? "‼ " : "") + title,
    description: desc,
    url: link,
    start: t.due_at ? { at: new Date(t.due_at) } : { day: t.due_on! },
    durationMin: t.kind === "meeting" ? 60 : 15,
    alarmMinutesBefore: t.reminder_minutes,
    updatedAt: new Date(t.updated_at),
    categories: ["Frame Hub"],
    priority: t.priority,
  };
}

export const dayOf = (t: { due_on: string | null; due_at: Date | string | null }) => (t.due_at ? utcToZoned(t.due_at).day : t.due_on);

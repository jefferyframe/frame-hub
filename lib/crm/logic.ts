/** CRM rules that don't touch the database: task buckets, snoozing, who's who, deal stages. */
import { addDays, dayNumber } from "../calc/util";
import { utcToZoned, zonedToUtc } from "../calc/time";

export type TaskBucket = "overdue" | "today" | "week" | "later";
export const BUCKETS: { key: TaskBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
];

export interface TaskTiming { due_on: string | null; due_at: Date | string | null }

/** The local day a task is due ("YYYY-MM-DD"), or null when it has no date. */
export function dueDay(t: TaskTiming): string | null {
  if (t.due_at) return utcToZoned(t.due_at).day;
  return t.due_on ? t.due_on.slice(0, 10) : null;
}

/** Overdue = a past day, or today with a time that has passed. This week = the next 7 days. Later = beyond, or undated. */
export function taskBucket(t: TaskTiming, now: Date = new Date()): TaskBucket {
  const today = utcToZoned(now).day;
  const d = dueDay(t);
  if (!d) return "later";
  if (d < today) return "overdue";
  if (d === today) return t.due_at && new Date(t.due_at).getTime() < now.getTime() ? "overdue" : "today";
  return dayNumber(d) - dayNumber(today) <= 7 ? "week" : "later";
}

export const SNOOZES = [
  { key: "1h", label: "1 hour" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "3d", label: "3 days" },
  { key: "week", label: "Next week" },
] as const;
export type SnoozeKey = (typeof SNOOZES)[number]["key"];

/** Where a snoozed task lands. Keeps its time of day; all-day tasks stay all-day.
 *  "Next week" = next Monday. Snoozing from an overdue date counts from today, not the old date. */
export function snoozeTarget(t: TaskTiming, key: SnoozeKey, now: Date = new Date()): { due_on: string; due_at: Date | null } {
  const today = utcToZoned(now).day;
  const time = t.due_at ? utcToZoned(t.due_at).time : null;
  if (key === "1h") {
    const at = new Date(Math.max(now.getTime(), t.due_at ? new Date(t.due_at).getTime() : 0) + 3600_000);
    return { due_on: utcToZoned(at).day, due_at: at };
  }
  const base = (() => { const d = dueDay(t); return d && d > today ? d : today; })();
  let day: string;
  if (key === "tomorrow") day = addDays(today, 1);
  else if (key === "3d") day = addDays(base, 3);
  else { const dow = new Date(dayNumber(today) * 86400000).getUTCDay(); day = addDays(today, ((8 - dow) % 7) || 7); }
  return { due_on: day, due_at: time ? zonedToUtc(day, time) : null };
}

/** The first word of a sign-in name, lower-cased: "jeff frame" → "jeff". */
export const firstNameKey = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export interface MemberLike { id: string; first_name: string; active: boolean }
/** The team member a signed-in name belongs to (active members only). */
export function matchMember<M extends MemberLike>(members: M[], signedInName: string | null | undefined): M | null {
  const k = firstNameKey(signedInName);
  return (k && members.find((m) => m.active && m.first_name.toLowerCase() === k)) || null;
}

/** Only the person who wrote an activity may edit or delete it (by first name). System entries are read-only. */
export function canEditActivity(a: { author: string; kind: string }, signedInName: string | null | undefined): boolean {
  if (a.kind === "stage") return false;
  const k = firstNameKey(signedInName);
  return !!k && firstNameKey(a.author) === k;
}

// ---------------------------------------------------------------- deals = proposals out
/** Board sections, in order. Deals are proposals that have gone to the client; earlier rows are Leads. */
export const DEAL_STAGES = ["Presented", "Follow Up 1", "Follow Up 1 Completed", "Follow Up 2", "Follow Up 2 Completed"] as const;
export const LEAD_STAGES = ["Proposal Needed", "Consultant Outreach", "Internal Review"] as const;
export const CLOSE_STAGES = [{ status: "Sold", label: "Won" }, { status: "Rejected", label: "Lost" }] as const;
export const isDealStage = (s: string) => (DEAL_STAGES as readonly string[]).includes(s);
export const isLeadStage = (s: string) => (LEAD_STAGES as readonly string[]).includes(s);

/** Days a proposal has been out: today − date presented (sent). */
export function daysOut(datePresented: string | null | undefined, today: string): number | null {
  if (!datePresented) return null;
  return Math.max(0, dayNumber(today) - dayNumber(datePresented));
}

export const TASK_KINDS = [{ key: "call", label: "Call" }, { key: "email", label: "Email" }, { key: "meeting", label: "Meeting" }, { key: "todo", label: "To-do" }] as const;
export const ACTIVITY_KINDS = [{ key: "note", label: "Note" }, { key: "call", label: "Call" }, { key: "email", label: "Email" }, { key: "meeting", label: "Meeting" }] as const;
export const CALL_OUTCOMES = ["Connected", "Left voicemail", "No answer", "Wrong number", "Busy"] as const;

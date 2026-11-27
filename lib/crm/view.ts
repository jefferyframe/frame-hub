/** Plain, serializable shapes the CRM's client components receive. */
import type { TaskRow } from "../repo/tasks";
import type { Activity } from "../repo/activities";

export type RecordKind = "company" | "contact" | "opportunity";
export interface RecordRef { kind: RecordKind; id: string; label: string }
export interface TaskView {
  id: string; title: string; due_on: string | null; due_at: string | null; kind: string; priority: "low" | "normal" | "high";
  owner_id: string | null; owner_name: string | null; reminder_minutes: number | null; notes: string | null; done_at: string | null;
  link: RecordRef | null; cadence: string | null; snoozed_count: number;
}
export interface ActivityView {
  id: string; kind: string; subject: string | null; body: string | null; outcome: string | null; direction: string | null; duration_min: number | null;
  occurred_at: string; author: string; edited_at: string | null; about: RecordRef | null;
}
export interface MemberView { id: string; name: string; first_name: string }

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const CADENCE_LABEL: Record<string, string> = {
  past_client_1m: "Past client · 1 month", past_client_2m: "Past client · 2 months", past_client_6m: "Past client · 6 months",
  prospect_linkedin: "Prospect · LinkedIn", prospect_card: "Prospect · card", prospect_email_1m: "Prospect · 1-month email",
  opp_follow_up_1: "Proposal · follow-up 1", opp_follow_up_2: "Proposal · follow-up 2", opp_present: "Proposal · present",
};

export function toTaskView(t: TaskRow): TaskView {
  const link: RecordRef | null = t.opportunity_id ? { kind: "opportunity", id: t.opportunity_id, label: t.opportunity_name ?? "Deal" }
    : t.contact_id ? { kind: "contact", id: t.contact_id, label: t.contact_name ?? "Contact" }
    : t.company_id ? { kind: "company", id: t.company_id, label: t.company_name ?? "Company" } : null;
  return {
    id: t.id, title: t.title, due_on: t.due_on, due_at: iso(t.due_at), kind: t.kind, priority: t.priority, owner_id: t.owner_id, owner_name: t.owner_name,
    reminder_minutes: t.reminder_minutes, notes: t.notes, done_at: iso(t.done_at), link, cadence: t.cadence && CADENCE_LABEL[t.cadence] ? CADENCE_LABEL[t.cadence] : null,
    snoozed_count: t.snoozed_count,
  };
}

export function toActivityView(a: Activity, here: { kind: RecordKind; id: string }): ActivityView {
  // show what the entry is about when it isn't this record itself (e.g. a deal's note on its company page)
  const about: RecordRef | null = here.kind === "opportunity" ? null
    : a.opportunity_id ? { kind: "opportunity", id: a.opportunity_id, label: a.opportunity_name ?? "Deal" }
    : here.kind === "company" && a.contact_id ? { kind: "contact", id: a.contact_id, label: a.contact_name ?? "Contact" } : null;
  return {
    id: a.id, kind: a.kind, subject: a.subject, body: a.body, outcome: a.outcome, direction: a.direction, duration_min: a.duration_min,
    occurred_at: new Date(a.occurred_at).toISOString(), author: a.author, edited_at: iso(a.edited_at), about,
  };
}

export const recordHref = (r: { kind: RecordKind; id: string }) =>
  r.kind === "opportunity" ? `/sales/${r.id}` : r.kind === "contact" ? `/crm/contacts/${r.id}` : `/crm/companies/${r.id}`;

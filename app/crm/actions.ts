"use server";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/server";
import { createTask, updateTask, completeTask, reopenTask, snoozeTask, deleteTask, type TaskInput } from "@/lib/repo/tasks";
import { logActivity, editActivity, deleteActivity, type ActivityKind } from "@/lib/repo/activities";
import { setOpportunityStatus, createOpportunity } from "@/lib/repo/opportunities";
import { opportunityToProject } from "@/lib/flow";
import { ensureCompany, ensureContact, splitName } from "@/lib/repo/crm";
import { memberForUser, saveMember, rotateFeedToken, revokeFeedToken } from "@/lib/repo/team";
import { PIPELINE_STATUSES } from "@/lib/calc/sales";
import type { SnoozeKey } from "@/lib/crm/logic";
import { todayISO } from "@/lib/calc/util";
import { zonedToUtc } from "@/lib/calc/time";

export type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
const safe = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: (e as Error).message || "Something went wrong." }; }
};
const refresh = (..._paths: string[]) => { revalidatePath("/", "layout"); };

export interface TaskForm {
  title: string; due_day?: string | null; due_time?: string | null; owner_id?: string | null; priority?: "low" | "normal" | "high"; kind?: "todo" | "call" | "email" | "meeting";
  reminder_minutes?: number | null; notes?: string | null; target?: { kind: "company" | "contact" | "opportunity"; id: string } | null;
}
const targetLinks = (t: TaskForm["target"]) => ({
  company_id: t?.kind === "company" ? t.id : null, contact_id: t?.kind === "contact" ? t.id : null, opportunity_id: t?.kind === "opportunity" ? t.id : null,
});
const taskInput = (f: TaskForm): TaskInput => ({
  title: f.title, due_day: f.due_day || null, due_time: f.due_time || null, owner_id: f.owner_id || null, priority: f.priority, kind: f.kind,
  reminder_minutes: f.reminder_minutes === undefined ? 15 : f.reminder_minutes, notes: f.notes ?? null, ...targetLinks(f.target),
});

export async function createTaskAction(f: TaskForm) {
  return safe(async () => { const { db, actor } = await ctx(); const t = await createTask(db, taskInput(f), actor); refresh(); return { id: t.id }; });
}
export async function updateTaskAction(id: string, f: TaskForm) {
  return safe(async () => {
    const { db, actor } = await ctx();
    const input = taskInput(f);
    if (f.target === undefined) { delete input.company_id; delete input.contact_id; delete input.opportunity_id; }
    await updateTask(db, id, input, actor); refresh();
  });
}
export async function completeTaskAction(id: string) { return safe(async () => { const { db, actor } = await ctx(); await completeTask(db, id, actor); refresh(); }); }
export async function reopenTaskAction(id: string) { return safe(async () => { const { db, actor } = await ctx(); await reopenTask(db, id, actor); refresh(); }); }
export async function snoozeTaskAction(id: string, key: SnoozeKey) { return safe(async () => { const { db, actor } = await ctx(); await snoozeTask(db, id, key, actor); refresh(); }); }
export async function deleteTaskAction(id: string) { return safe(async () => { const { db, actor } = await ctx(); await deleteTask(db, id, actor); refresh(); }); }

export interface ActivityForm {
  kind: Exclude<ActivityKind, "task" | "stage">; subject?: string | null; body?: string | null; outcome?: string | null; direction?: "inbound" | "outbound" | null;
  duration_min?: number | null; when_day?: string | null; when_time?: string | null;
  target: { kind: "company" | "contact" | "opportunity"; id: string } | null;
  follow_up?: { day: string; time?: string | null; title?: string | null } | null;
}
export async function logActivityAction(f: ActivityForm) {
  return safe(async () => {
    const { db, actor } = await ctx();
    if (!f.target) throw new Error("Pick who this is about.");
    if (!["note", "call", "email", "meeting"].includes(f.kind)) throw new Error("Unknown activity type.");
    const links = targetLinks(f.target);
    const occurred = f.when_day ? zonedToUtc(f.when_day, f.when_time || "12:00") : null;
    const a = await logActivity(db, { kind: f.kind, author: actor, subject: f.subject, body: f.body, outcome: f.outcome, direction: f.direction, duration_min: f.duration_min, occurred_at: occurred, ...links });
    if (f.follow_up?.day) {
      const me = await memberForUser(db, actor);
      await createTask(db, { title: f.follow_up.title?.trim() || `Follow up${a.subject ? `: ${a.subject}` : ""}`, due_day: f.follow_up.day, due_time: f.follow_up.time || null, kind: f.kind === "email" ? "email" : "call", owner_id: me?.id ?? null, ...links }, actor);
    }
    refresh("/sales/[id]", "/crm/contacts/[id]", "/crm/companies/[id]");
  });
}
export async function editActivityAction(id: string, patch: { subject?: string | null; body?: string | null; outcome?: string | null }) {
  return safe(async () => { const { db, actor } = await ctx(); await editActivity(db, id, actor, patch); refresh(); });
}
export async function deleteActivityAction(id: string) { return safe(async () => { const { db, actor } = await ctx(); await deleteActivity(db, id, actor); refresh(); }); }

/** Board move. Won goes through the existing Won → project flow (job number + lead); Lost can carry a reason. */
export async function moveDealAction(id: string, status: string, extra: { jobNumber?: string; lead?: string; reason?: string } = {}) {
  return safe(async () => {
    const { db, actor } = await ctx();
    if (!PIPELINE_STATUSES.includes(status as never)) throw new Error("Unknown stage.");
    if (status === "Sold") {
      const p = await opportunityToProject(db, id, actor, { jobNumber: extra.jobNumber || undefined, lead: extra.lead || undefined });
      refresh("/sales", "/projects");
      return { projectId: p.id, jobNumber: p.job_number };
    }
    await setOpportunityStatus(db, id, status, actor);
    if (status === "Rejected" && extra.reason?.trim()) await logActivity(db, { kind: "note", author: actor, subject: "Why we lost it", body: extra.reason, opportunity_id: id });
    refresh("/sales");
    return {};
  });
}

export interface DealForm { name: string; company?: string | null; contact?: string | null; email?: string | null; design_fee?: number | null; subs_cost?: number | null; status: string; date_presented?: string | null; project_type?: string | null; owner_id?: string | null }
export async function createDealAction(f: DealForm) {
  return safe(async () => {
    const { db, actor } = await ctx();
    if (!f.name?.trim()) throw new Error("Name the deal (client / project).");
    if (!PIPELINE_STATUSES.includes(f.status as never)) throw new Error("Unknown stage.");
    const company = f.company?.trim() ? await ensureCompany(db, f.company.trim(), "client") : null;
    const contact = f.contact?.trim() ? await ensureContact(db, { ...splitName(f.contact), email: f.email?.trim() || null, company_id: company?.id ?? null }) : null;
    const me = await memberForUser(db, actor);
    const presented = f.status === "Presented" ? (f.date_presented || todayISO()) : f.date_presented || null;
    const o = await createOpportunity(db, {
      name: f.name.trim(), status: "Proposal Needed", company_id: company?.id ?? null, contact_id: contact?.id ?? null, contact_text: f.contact?.trim() || null,
      design_fee: f.design_fee ?? null, subs_cost: f.subs_cost ?? null, date_received: todayISO(), project_type: f.project_type || null, owner_member_id: f.owner_id || me?.id || null,
      date_presented: presented,
    }, actor);
    if (f.status !== "Proposal Needed") await setOpportunityStatus(db, o.id, f.status, actor);
    refresh("/sales");
    return { id: o.id };
  });
}

export async function searchRecordsAction(q: string) {
  const { db } = await ctx();
  const term = `%${q.trim().toLowerCase()}%`;
  if (q.trim().length < 2) return [];
  return db.query<{ kind: "company" | "contact" | "opportunity"; id: string; label: string; sub: string | null }>(
    `(select 'opportunity' as kind, o.id, o.name as label, concat_ws(' · ', o.status, o.job_number) as sub from opportunities o where lower(o.name) like $1 or o.job_number like $1 order by o.updated_at desc limit 8)
     union all (select 'contact', c.id, c.full_name, co.name from contacts c left join companies co on co.id = c.company_id where lower(c.full_name) like $1 or lower(coalesce(c.email,'')) like $1 limit 6)
     union all (select 'company', id, name, kind from companies where lower(name) like $1 limit 6)`, [term]);
}

// ---------------------------------------------------------------- settings: team & calendar
export async function saveMemberAction(m: { id?: string | null; name: string; email?: string | null; role?: string | null; active?: boolean }) {
  return safe(async () => { const { db } = await ctx(); await saveMember(db, m); revalidatePath("/settings"); refresh(); });
}
/** New private calendar link (the old one stops working). Returns the token so the page can show the URL. */
export async function rotateFeedAction(memberId: string) {
  return safe(async () => { const { db } = await ctx(); const token = await rotateFeedToken(db, memberId); revalidatePath("/settings"); return { token }; });
}
export async function revokeFeedAction(memberId: string) {
  return safe(async () => { const { db } = await ctx(); await revokeFeedToken(db, memberId); revalidatePath("/settings"); });
}
export async function setIncludeUnassignedAction(memberId: string, on: boolean) {
  return safe(async () => { const { db } = await ctx(); await db.query(`update team_members set cal_include_unassigned = $2 where id = $1`, [memberId, on]); revalidatePath("/settings"); });
}

import type { Db } from "../db/types";
import { one } from "../db/types";
import type { Task } from "./types";
import { audit } from "./audit";
import { logActivity, expandLinks } from "./activities";
import { snoozeTarget, SNOOZES, type SnoozeKey } from "../crm/logic";
import { zonedToUtc, utcToZoned } from "../calc/time";
import { calendarSync } from "../calendar";
import { date } from "../format";

export type TaskRow = Task & {
  contact_name: string | null; opportunity_name: string | null; project_job: string | null; company_name: string | null;
  owner_name: string | null; owner_first: string | null;
};

const SELECT = `select t.*, c.full_name as contact_name, o.name as opportunity_name, p.job_number as project_job, co.name as company_name,
    m.name as owner_name, m.first_name as owner_first
  from tasks t left join contacts c on c.id = t.contact_id left join opportunities o on o.id = t.opportunity_id
  left join projects p on p.id = t.project_id left join companies co on co.id = t.company_id left join team_members m on m.id = t.owner_id`;

const ORDER = `order by coalesce(t.due_at, (t.due_on::timestamp + interval '23 hours 59 minutes') at time zone 'America/Los_Angeles') nulls last, t.created_at`;

/** Open tasks. owner: a member id, "unassigned", or undefined for everyone. */
export function openTasks(db: Db, opts: { until?: string; owner?: string; withUnassigned?: boolean } = {}) {
  const where = ["t.done_at is null"]; const params: unknown[] = [];
  if (opts.until) { params.push(opts.until); where.push(`(t.due_on is null or t.due_on <= $${params.length})`); }
  if (opts.owner === "unassigned") where.push("t.owner_id is null");
  else if (opts.owner) { params.push(opts.owner); where.push(`(t.owner_id = $${params.length}${opts.withUnassigned ? " or t.owner_id is null" : ""})`); }
  return db.query<TaskRow>(`${SELECT} where ${where.join(" and ")} ${ORDER}`, params);
}

export const getTask = (db: Db, id: string) => one<TaskRow>(db, `${SELECT} where t.id = $1`, [id]);

export function tasksFor(db: Db, entity: "company" | "contact" | "opportunity", id: string) {
  const col = entity === "company" ? "t.company_id" : entity === "contact" ? "t.contact_id" : "t.opportunity_id";
  const extra = entity === "company" ? ` or t.contact_id in (select id from contacts where company_id = $1) or t.opportunity_id in (select id from opportunities where company_id = $1)` : "";
  return db.query<TaskRow>(`${SELECT} where (${col} = $1${extra}) and (t.done_at is null or t.done_at > now() - interval '30 days') order by t.done_at nulls first, ${ORDER.replace("order by ", "")}`, [id]);
}

export interface TaskInput {
  title: string; due_day?: string | null; due_time?: string | null; owner_id?: string | null; priority?: Task["priority"]; kind?: Task["kind"];
  reminder_minutes?: number | null; notes?: string | null;
  company_id?: string | null; contact_id?: string | null; opportunity_id?: string | null; project_id?: string | null;
  cadence?: string | null; source_key?: string | null;
}

/** Day + optional time (firm time zone) → the two stored columns. */
export function timing(day: string | null | undefined, time: string | null | undefined): { due_on: string | null; due_at: Date | null } {
  if (!day) return { due_on: null, due_at: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a due date.");
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error("Pick a due time.");
  return { due_on: day, due_at: time ? zonedToUtc(day, time) : null };
}

const PRIORITIES = ["low", "normal", "high"]; const KINDS = ["todo", "call", "email", "meeting"];
const whenText = (t: { due_on: string | null; due_at: Date | null }) =>
  t.due_at ? `${date(t.due_on)} ${utcToZoned(t.due_at).time}` : t.due_on ? date(t.due_on) : "no date";

async function ownerName(db: Db, id: string | null | undefined) {
  return id ? (await one<{ name: string }>(db, `select name from team_members where id = $1`, [id]))?.name ?? null : null;
}

export async function createTask(db: Db, input: TaskInput, actor: string): Promise<Task> {
  const title = input.title?.trim();
  if (!title) throw new Error("What needs doing?");
  const priority = input.priority ?? "normal", kind = input.kind ?? "todo";
  if (!PRIORITIES.includes(priority) || !KINDS.includes(kind)) throw new Error("Unknown priority or type.");
  const tm = timing(input.due_day, input.due_time);
  const links = await expandLinks(db, input);
  const owner = await ownerName(db, input.owner_id);
  const [t] = await db.query<Task>(
    `insert into tasks (title, due_on, due_at, owner_id, assignee, priority, kind, reminder_minutes, notes, company_id, contact_id, opportunity_id, project_id, cadence, source_key, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (source_key) do nothing returning *`,
    [title, tm.due_on, tm.due_at, input.owner_id ?? null, owner, priority, kind, input.reminder_minutes === undefined ? 15 : input.reminder_minutes, input.notes?.trim() || null,
      links.company_id ?? null, links.contact_id ?? null, links.opportunity_id ?? null, input.project_id ?? null, input.cadence ?? "manual", input.source_key ?? null, actor]);
  if (!t) return (await one<Task>(db, `select * from tasks where source_key = $1`, [input.source_key]))!;
  await audit(db, { actor, entity: "task", id: t.id, action: "create", summary: `Task: ${title}` });
  if (links.company_id || links.contact_id || links.opportunity_id || input.project_id)
    await logActivity(db, { kind: "task", author: actor, subject: `Task added: ${title}`, body: `Due ${whenText(t)}${owner ? ` · for ${owner}` : ""}`, task_id: t.id, ...links, project_id: input.project_id ?? null, expand: false });
  await calendarSync().taskChanged(db, t.id);
  return t;
}

export async function updateTask(db: Db, id: string, input: Partial<TaskInput>, actor: string): Promise<Task> {
  const cur = await one<Task>(db, `select * from tasks where id = $1`, [id]);
  if (!cur) throw new Error("That task is gone.");
  const sets: string[] = []; const vals: unknown[] = [id];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input.title !== undefined) { if (!input.title?.trim()) throw new Error("What needs doing?"); put("title", input.title.trim()); }
  if (input.due_day !== undefined || input.due_time !== undefined) {
    const tm = timing(input.due_day === undefined ? cur.due_on : input.due_day, input.due_time === undefined ? (cur.due_at ? utcToZoned(cur.due_at).time : null) : input.due_time);
    put("due_on", tm.due_on); put("due_at", tm.due_at);
  }
  if (input.owner_id !== undefined) { put("owner_id", input.owner_id); put("assignee", await ownerName(db, input.owner_id)); }
  if (input.priority !== undefined) { if (!PRIORITIES.includes(input.priority!)) throw new Error("Unknown priority."); put("priority", input.priority); }
  if (input.kind !== undefined) { if (!KINDS.includes(input.kind!)) throw new Error("Unknown type."); put("kind", input.kind); }
  if (input.reminder_minutes !== undefined) put("reminder_minutes", input.reminder_minutes);
  if (input.notes !== undefined) put("notes", input.notes?.trim() || null);
  if (input.opportunity_id !== undefined || input.contact_id !== undefined || input.company_id !== undefined) {
    const l = await expandLinks(db, { opportunity_id: input.opportunity_id ?? null, contact_id: input.contact_id ?? null, company_id: input.company_id ?? null });
    put("opportunity_id", l.opportunity_id ?? null); put("contact_id", l.contact_id ?? null); put("company_id", l.company_id ?? null);
  }
  if (!sets.length) return cur;
  const [t] = await db.query<Task>(`update tasks set ${sets.join(", ")}, sequence = sequence + 1 where id = $1 returning *`, vals);
  await audit(db, { actor, entity: "task", id, action: "update", summary: `Task edited: ${t.title}` });
  await calendarSync().taskChanged(db, id);
  return t;
}

export async function completeTask(db: Db, id: string, actor: string, notes?: string | null) {
  const [t] = await db.query<Task>(`update tasks set done_at = coalesce(done_at, now()), notes = coalesce($2, notes), sequence = sequence + 1 where id = $1 returning *`, [id, notes ?? null]);
  if (!t) throw new Error("That task is gone.");
  const entity = t.opportunity_id ? { entity: "opportunity" as const, id: t.opportunity_id } : t.project_id ? { entity: "project" as const, id: t.project_id } : t.contact_id ? { entity: "contact" as const, id: t.contact_id } : null;
  await audit(db, { actor, entity: "task", id, action: "done", summary: `Done: ${t.title}`, related: entity ?? undefined });
  if (t.company_id || t.contact_id || t.opportunity_id || t.project_id)
    await logActivity(db, { kind: "task", author: actor, subject: `Task done: ${t.title}`, task_id: t.id, company_id: t.company_id, contact_id: t.contact_id, opportunity_id: t.opportunity_id, project_id: t.project_id, expand: false });
  await calendarSync().taskRemoved(db, id);
  return t;
}

export async function reopenTask(db: Db, id: string, actor: string) {
  const [t] = await db.query<Task>(`update tasks set done_at = null, sequence = sequence + 1 where id = $1 returning *`, [id]);
  if (!t) throw new Error("That task is gone.");
  await audit(db, { actor, entity: "task", id, action: "reopen", summary: `Reopened: ${t.title}` });
  await calendarSync().taskChanged(db, id);
  return t;
}

export async function snoozeTask(db: Db, id: string, key: SnoozeKey, actor: string, now = new Date()) {
  if (!SNOOZES.some((s) => s.key === key)) throw new Error("Unknown snooze.");
  const cur = await one<Task>(db, `select * from tasks where id = $1`, [id]);
  if (!cur) throw new Error("That task is gone.");
  const to = snoozeTarget(cur, key, now);
  const [t] = await db.query<Task>(`update tasks set due_on = $2, due_at = $3, snoozed_count = snoozed_count + 1, sequence = sequence + 1 where id = $1 returning *`, [id, to.due_on, to.due_at]);
  await audit(db, { actor, entity: "task", id, action: "snooze", summary: `Snoozed to ${whenText(t)}: ${t.title}` });
  await calendarSync().taskChanged(db, id);
  return t;
}

export async function deleteTask(db: Db, id: string, actor: string) {
  const [t] = await db.query<Task>(`delete from tasks where id = $1 returning *`, [id]);
  if (t) {
    await audit(db, { actor, entity: "task", id, action: "delete", summary: `Task deleted: ${t.title}` });
    await calendarSync().taskRemoved(db, id);
  }
}

/** What goes in a member's calendar feed: their open, dated tasks (plus unassigned ones if they opted in), from 60 days back. */
export function feedTasks(db: Db, memberId: string, includeUnassigned: boolean) {
  return db.query<TaskRow>(
    `${SELECT} where t.done_at is null and t.due_on is not null and t.due_on >= (current_date - 60)
       and (t.owner_id = $1 ${includeUnassigned ? "or t.owner_id is null" : ""}) ${ORDER} limit 2000`, [memberId]);
}

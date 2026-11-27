import type { Db } from "../db/types";
import { one } from "../db/types";
import { canEditActivity } from "../crm/logic";

export type ActivityKind = "note" | "call" | "email" | "meeting" | "task" | "stage";
export interface Activity {
  id: string; kind: ActivityKind; subject: string | null; body: string | null; outcome: string | null; direction: string | null; duration_min: number | null;
  occurred_at: Date; author: string; company_id: string | null; contact_id: string | null; opportunity_id: string | null; project_id: string | null; task_id: string | null;
  created_at: Date; edited_at: Date | null;
  opportunity_name?: string | null; contact_name?: string | null; company_name?: string | null;
}
export interface Links { company_id?: string | null; contact_id?: string | null; opportunity_id?: string | null; project_id?: string | null }

/** Fill in the company (and contact) a deal or contact belongs to, so one entry shows on every related record. */
export async function expandLinks(db: Db, l: Links): Promise<Links> {
  const out: Links = { company_id: l.company_id ?? null, contact_id: l.contact_id ?? null, opportunity_id: l.opportunity_id ?? null, project_id: l.project_id ?? null };
  if (out.opportunity_id && (!out.company_id || !out.contact_id)) {
    const o = await one<{ company_id: string | null; contact_id: string | null }>(db, `select company_id, contact_id from opportunities where id = $1`, [out.opportunity_id]);
    out.company_id ??= o?.company_id ?? null;
    out.contact_id ??= o?.contact_id ?? null;
  }
  if (out.contact_id && !out.company_id) {
    out.company_id = (await one<{ company_id: string | null }>(db, `select company_id from contacts where id = $1`, [out.contact_id]))?.company_id ?? null;
  }
  return out;
}

export async function logActivity(db: Db, a: Links & { kind: ActivityKind; author: string; subject?: string | null; body?: string | null; outcome?: string | null; direction?: string | null; duration_min?: number | null; occurred_at?: Date | null; task_id?: string | null; expand?: boolean }) {
  if (!["note", "call", "email", "meeting", "task", "stage"].includes(a.kind)) throw new Error("Unknown activity type.");
  if (a.kind === "note" && !a.body?.trim()) throw new Error("Write the note first.");
  const l: Links = a.expand === false ? { company_id: a.company_id, contact_id: a.contact_id, opportunity_id: a.opportunity_id, project_id: a.project_id } : await expandLinks(db, a);
  if (!l.company_id && !l.contact_id && !l.opportunity_id && !l.project_id) throw new Error("Pick who this is about.");
  const [row] = await db.query<Activity>(
    `insert into activities (kind, subject, body, outcome, direction, duration_min, occurred_at, author, company_id, contact_id, opportunity_id, project_id, task_id)
     values ($1,$2,$3,$4,$5,$6,coalesce($7, now()),$8,$9,$10,$11,$12,$13) returning *`,
    [a.kind, a.subject?.trim() || null, a.body?.trim() || null, a.outcome ?? null, a.direction ?? null, a.duration_min ?? null, a.occurred_at ?? null, a.author,
      l.company_id ?? null, l.contact_id ?? null, l.opportunity_id ?? null, l.project_id ?? null, a.task_id ?? null]);
  return row;
}

export async function editActivity(db: Db, id: string, who: string, patch: { subject?: string | null; body?: string | null; outcome?: string | null; occurred_at?: Date | null }) {
  const a = await one<Activity>(db, `select * from activities where id = $1`, [id]);
  if (!a) throw new Error("That entry is gone.");
  if (!canEditActivity(a, who)) throw new Error(`Only ${a.author} can edit this entry.`);
  const [row] = await db.query<Activity>(
    `update activities set subject = $2, body = $3, outcome = $4, occurred_at = coalesce($5, occurred_at), edited_at = now(), updated_at = now() where id = $1 returning *`,
    [id, patch.subject === undefined ? a.subject : patch.subject, patch.body === undefined ? a.body : patch.body, patch.outcome === undefined ? a.outcome : patch.outcome, patch.occurred_at ?? null]);
  return row;
}

export async function deleteActivity(db: Db, id: string, who: string) {
  const a = await one<Activity>(db, `select * from activities where id = $1`, [id]);
  if (!a) return;
  if (!canEditActivity(a, who)) throw new Error(`Only ${a.author} can delete this entry.`);
  await db.query(`delete from activities where id = $1`, [id]);
}

/** Timeline for one record: entries on it, and for a company also those on its contacts and deals. */
export function timeline(db: Db, entity: "company" | "contact" | "opportunity", id: string) {
  const where = entity === "opportunity" ? `a.opportunity_id = $1`
    : entity === "contact" ? `a.contact_id = $1`
    : `(a.company_id = $1 or a.contact_id in (select id from contacts where company_id = $1) or a.opportunity_id in (select id from opportunities where company_id = $1))`;
  return db.query<Activity>(
    `select a.*, o.name as opportunity_name, c.full_name as contact_name, co.name as company_name from activities a
     left join opportunities o on o.id = a.opportunity_id left join contacts c on c.id = a.contact_id left join companies co on co.id = a.company_id
     where ${where} order by a.occurred_at desc, a.created_at desc limit 300`, [id]);
}

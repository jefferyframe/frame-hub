import type { Db } from "../db/types";
import type { Task } from "./types";
import { audit } from "./audit";

export type TaskRow = Task & { contact_name: string | null; opportunity_name: string | null; project_job: string | null };

export function openTasks(db: Db, opts: { until?: string } = {}) {
  return db.query<TaskRow>(
    `select t.*, c.full_name as contact_name, o.name as opportunity_name, p.job_number as project_job from tasks t
     left join contacts c on c.id = t.contact_id left join opportunities o on o.id = t.opportunity_id left join projects p on p.id = t.project_id
     where t.done_at is null ${opts.until ? "and (t.due_on is null or t.due_on <= $1)" : ""} order by t.due_on nulls last, t.created_at`,
    opts.until ? [opts.until] : []);
}

export async function completeTask(db: Db, id: string, actor: string, notes?: string | null) {
  const [t] = await db.query<Task>(`update tasks set done_at = now(), notes = coalesce($2, notes) where id = $1 returning *`, [id, notes ?? null]);
  const entity = t.opportunity_id ? { entity: "opportunity" as const, id: t.opportunity_id } : t.project_id ? { entity: "project" as const, id: t.project_id } : t.contact_id ? { entity: "contact" as const, id: t.contact_id } : null;
  await audit(db, { actor, entity: "task", id, action: "done", summary: `Done: ${t.title}`, related: entity ?? undefined });
}

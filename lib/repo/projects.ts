import type { Db } from "../db/types";
import { one } from "../db/types";
import type { Project, ProjectPhase, ProjectConsultant, TimeEntry } from "./types";
import { audit } from "./audit";
import { computeJobCost } from "../calc/jobCost";

export const PROJECT_STATUSES = ["active", "on_hold", "phase_complete", "closeout", "archived"] as const;
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "Active", on_hold: "On hold", phase_complete: "Phase complete", closeout: "Closeout", archived: "Archived",
};
/** Lifecycle: work happens in active/on_hold/phase_complete; closeout wraps up billing and
 *  records; archived is end of life (read-only, reopen only back to closeout). */
const NEXT: Record<string, string[]> = {
  active: ["on_hold", "phase_complete", "closeout"],
  on_hold: ["active", "closeout"],
  phase_complete: ["active", "closeout"],
  closeout: ["active", "archived"],
  archived: ["closeout"],
};
export const allowedProjectMoves = (s: string) => NEXT[s] ?? [];

export async function listProjects(db: Db, opts: { includeArchived?: boolean } = {}) {
  const projects = await db.query<Project>(
    `select * from projects ${opts.includeArchived ? "" : "where status <> 'archived'"} order by job_number`);
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [phases, cons, entries] = await Promise.all([
    db.query<ProjectPhase>(`select * from project_phases where project_id = any($1)`, [ids]),
    db.query<ProjectConsultant>(`select * from project_consultants where project_id = any($1)`, [ids]),
    db.query<TimeEntry>(`select project_id, phase, hours, notes from time_entries where project_id = any($1) order by week_ending nulls first, created_at`, [ids]),
  ]);
  return projects.map((p) => ({
    project: p,
    cost: computeJobCost(p, phases.filter((x) => x.project_id === p.id), cons.filter((x) => x.project_id === p.id), entries.filter((x) => x.project_id === p.id)),
    phases: phases.filter((x) => x.project_id === p.id),
  }));
}

export async function getProject(db: Db, id: string) {
  const project = await one<Project>(db, `select * from projects where id = $1`, [id]);
  if (!project) return null;
  const [phases, consultants, entries] = await Promise.all([
    db.query<ProjectPhase>(`select * from project_phases where project_id = $1 order by sort`, [id]),
    db.query<ProjectConsultant>(`select * from project_consultants where project_id = $1 order by discipline, phase`, [id]),
    db.query<TimeEntry>(`select * from time_entries where project_id = $1 order by week_ending nulls first, created_at`, [id]),
  ]);
  return { project, phases, consultants, entries, cost: computeJobCost(project, phases, consultants, entries) };
}

export async function setProjectStatus(db: Db, id: string, status: string, actor: string) {
  return db.tx(async (t) => {
    const cur = await one<Project>(t, `select * from projects where id = $1 for update`, [id]);
    if (!cur) throw new Error("Project not found");
    if (cur.status === status) return cur;
    if (!allowedProjectMoves(cur.status).includes(status)) throw new Error(`Can't move a project from ${PROJECT_STATUS_LABEL[cur.status]} to ${PROJECT_STATUS_LABEL[status] ?? status}.`);
    const [p] = await t.query<Project>(
      `update projects set status = $2,
         closeout_at = case when $2 = 'closeout' then coalesce(closeout_at, now()) when $2 = 'active' then null else closeout_at end,
         archived_at = case when $2 = 'archived' then now() else null end
       where id = $1 returning *`, [id, status]);
    await audit(t, { actor, entity: "project", id, action: "status", summary: `${PROJECT_STATUS_LABEL[cur.status]} → ${PROJECT_STATUS_LABEL[status]}` });
    // End of life closes the loop on the sales side: the pipeline row becomes "Project Completed".
    if (status === "archived" && p.opportunity_id) {
      await t.query(`update opportunities set status = 'Project Completed' where id = $1 and status = 'Sold'`, [p.opportunity_id]);
      await audit(t, { actor, entity: "opportunity", id: p.opportunity_id, action: "status", summary: `Sold → Project Completed (project ${p.job_number} archived)`, related: { entity: "project", id } });
    }
    return p;
  });
}

export async function addTimeEntry(db: Db, e: { project_id: string; phase: string; person?: string | null; hours: number; week_ending?: string | null; week_label?: string | null; notes?: string | null }, actor: string) {
  if (!(e.hours > 0 || e.hours < 0)) throw new Error("Enter the hours worked.");
  const [row] = await db.query<{ id: string }>(
    `insert into time_entries (project_id, phase, person, hours, week_ending, week_label, notes) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [e.project_id, e.phase, e.person ?? null, e.hours, e.week_ending ?? null, e.week_label ?? null, e.notes ?? null]);
  await audit(db, { actor, entity: "project", id: e.project_id, action: "hours", summary: `${e.hours} h logged to ${e.phase}${e.person ? ` by ${e.person}` : ""}` });
  return row.id;
}

export async function updatePhase(db: Db, projectId: string, phase: string, patch: Partial<Pick<ProjectPhase, "fee_pct" | "hours_pct" | "hours_assigned" | "target_date" | "status">>, actor: string) {
  const keys = (["fee_pct", "hours_pct", "hours_assigned", "target_date", "status"] as const).filter((k) => k in patch);
  if (!keys.length) return;
  await db.query(`update project_phases set ${keys.map((k, i) => `${k} = $${i + 3}`).join(", ")} where project_id = $1 and phase = $2`,
    [projectId, phase, ...keys.map((k) => patch[k])]);
  if (patch.status === "active") {
    await db.query(`update project_phases set status = 'complete' where project_id = $1 and status = 'active' and phase <> $2`, [projectId, phase]);
    await db.query(`update projects set current_phase = $2 where id = $1`, [projectId, phase]);
  }
  await audit(db, { actor, entity: "project", id: projectId, action: "update", summary: `${phase}: ${keys.map((k) => `${k} = ${patch[k]}`).join(", ")}` });
}

export async function setConsultantStatus(db: Db, projectId: string, discipline: string, phase: string, status: string | null, actor: string) {
  await db.query(`update project_consultants set status = $4 where project_id = $1 and discipline = $2 and phase = $3`, [projectId, discipline, phase, status]);
  await audit(db, { actor, entity: "project", id: projectId, action: "update", summary: `${discipline} (${phase}) → ${status ?? "no status"}` });
}

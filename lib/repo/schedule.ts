/** Schedule data: assignments (who / how much of their week), phase start & target dates, and the built plan. */
import type { Db } from "../db/types";
import { one } from "../db/types";
import { audit } from "./audit";
import { listProjects } from "./projects";
import { listTeam, type TeamMember } from "./team";
import { getSettings, setSetting } from "./settings";
import { buildSchedule, seedPeople, type Person, type PlanAssignment, type PlanPhase, type PlanProject, type ScheduledProject } from "../calc/schedule";
import { PHASE_NAMES } from "../calc/jobCost";
import { todayISO } from "../calc/util";

export interface AssignmentRow { id: string; project_id: string; phase: string; member_id: string; hours_per_week: number | null; allocation_pct: number | null }

export const toPerson = (m: Pick<TeamMember, "id" | "name" | "hours_per_day" | "work_days">): Person => ({ id: m.id, name: m.name, hoursPerDay: Number(m.hours_per_day), workDays: m.work_days });

const phaseSort = (name: string, sort?: number) => sort ?? (PHASE_NAMES.indexOf(name as never) + 1 || 99);

/** Everything the schedule views need, built for `today`. Archived projects are left out. */
export async function loadSchedule(db: Db, today = todayISO(), preloaded?: Awaited<ReturnType<typeof listProjects>>) {
  const [projects, team, assignments, settings] = await Promise.all([
    preloaded ? Promise.resolve(preloaded.filter((x) => x.project.status !== "archived")) : listProjects(db),
    listTeam(db),
    db.query<AssignmentRow>(`select id, project_id, phase, member_id, hours_per_week::float8 hours_per_week, allocation_pct::float8 allocation_pct from project_assignments`),
    getSettings(db),
  ]);
  const people = team.map(toPerson);
  const planProjects: PlanProject[] = [];
  const planPhases: PlanPhase[] = [];
  const startDates = new Map((await db.query<{ project_id: string; phase: string; start_date: string | null }>(`select project_id, phase, start_date from project_phases where start_date is not null`)).map((r) => [`${r.project_id}|${r.phase}`, r.start_date]));
  for (const { project: p, cost: c, phases } of projects) {
    planProjects.push({ id: p.id, jobNumber: p.job_number, name: p.name, status: p.status, lead: p.lead, currentPhase: c.currentPhase });
    const curSort = c.currentPhase ? phaseSort(c.currentPhase, phases.find((x) => x.phase === c.currentPhase)?.sort) : 0;
    for (const r of c.phases) {
      const row = phases.find((x) => x.phase === r.phase);
      const sort = phaseSort(r.phase, row?.sort);
      const hasPlan = assignments.some((a) => a.project_id === p.id && a.phase === r.phase);
      const inScope = r.hoursAssigned > 0 || !!r.targetDate || hasPlan || r.phase === c.currentPhase || startDates.has(`${p.id}|${r.phase}`);
      if (!inScope) continue;
      planPhases.push({
        projectId: p.id, phase: r.phase, sort, assigned: r.hoursAssigned, worked: r.hoursCompleted, suggested: r.suggestedHours,
        startDate: startDates.get(`${p.id}|${r.phase}`) ?? null, targetDate: r.targetDate,
        done: r.status === "complete" || (curSort > 0 && sort < curSort),
      });
    }
  }
  const planAssignments: PlanAssignment[] = assignments.map((a) => ({ id: a.id, projectId: a.project_id, phase: a.phase, memberId: a.member_id, hoursPerWeek: a.hours_per_week, allocationPct: a.allocation_pct }));
  const schedule = buildSchedule({ projects: planProjects, phases: planPhases, assignments: planAssignments, people }, today);
  return { schedule, people, team, projects, settings, today };
}

export const scheduleFor = (s: ScheduledProject[], projectId: string) => s.find((x) => x.project.id === projectId) ?? null;

export async function saveAssignment(db: Db, a: { project_id: string; phase: string; member_id: string; hours_per_week?: number | null; allocation_pct?: number | null }, actor: string) {
  if (a.hours_per_week != null && !(a.hours_per_week >= 0 && a.hours_per_week <= 80)) throw new Error("Hours a week must be between 0 and 80.");
  if (a.allocation_pct != null && !(a.allocation_pct >= 0 && a.allocation_pct <= 1)) throw new Error("Allocation must be between 0 and 100%.");
  const ph = await one(db, `select 1 from project_phases where project_id = $1 and phase = $2`, [a.project_id, a.phase]);
  if (!ph) throw new Error("Pick one of this job’s phases.");
  const m = await one<{ first_name: string }>(db, `select first_name from team_members where id = $1`, [a.member_id]);
  if (!m) throw new Error("Pick a team member.");
  const hpw = a.hours_per_week ?? null, pct = hpw != null ? null : a.allocation_pct ?? null;
  await db.query(
    `insert into project_assignments (project_id, phase, member_id, hours_per_week, allocation_pct, created_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (project_id, phase, member_id) do update set hours_per_week = excluded.hours_per_week, allocation_pct = excluded.allocation_pct`,
    [a.project_id, a.phase, a.member_id, hpw, pct, actor]);
  await audit(db, { actor, entity: "project", id: a.project_id, action: "schedule", summary: `${m.first_name} on ${a.phase}: ${hpw != null ? `${hpw} h/week` : pct != null ? `${Math.round(pct * 100)}% of their week` : "auto share of their week"}` });
}

export async function removeAssignment(db: Db, id: string, actor: string) {
  const a = await one<{ project_id: string; phase: string; first_name: string }>(db, `select a.project_id, a.phase, m.first_name from project_assignments a join team_members m on m.id = a.member_id where a.id = $1`, [id]);
  if (!a) return;
  await db.query(`delete from project_assignments where id = $1`, [id]);
  await audit(db, { actor, entity: "project", id: a.project_id, action: "schedule", summary: `${a.first_name} taken off ${a.phase}` });
}

/** Planned start and target date for a phase (Gantt drag or the form). Null start = right after the previous phase. */
export async function setPhaseDates(db: Db, projectId: string, phase: string, d: { start_date?: string | null; target_date?: string | null }, actor: string) {
  const iso = (x: string | null | undefined) => (x == null || x === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : (() => { throw new Error("Use a date like 2027-03-15."); })());
  const start = d.start_date === undefined ? undefined : iso(d.start_date);
  const target = d.target_date === undefined ? undefined : iso(d.target_date);
  const cur = await one<{ start_date: string | null; target_date: string | null; status: string }>(db, `select start_date, target_date, status from project_phases where project_id = $1 and phase = $2`, [projectId, phase]);
  if (!cur) throw new Error("Phase not found.");
  const s = start === undefined ? cur.start_date : start, t = target === undefined ? cur.target_date : target;
  if (s && t && t < s) throw new Error("The target date is before the start.");
  await db.query(`update project_phases set start_date = $3, target_date = $4 where project_id = $1 and phase = $2`, [projectId, phase, s, t]);
  await audit(db, { actor, entity: "project", id: projectId, action: "schedule", summary: `${phase}: start ${s ?? "after previous phase"}, target ${t ?? "none"}` });
}

/**
 * One-time seed from the Job List: for each open job, its current phase gets the lead and team as people
 * (auto share of their week). Jobs with no lead/team get whoever logged hours on that phase in the last 8 weeks
 * of the log. Runs once (settings.scheduleSeededAt), and never touches a job that already has a plan.
 */
export async function seedSchedule(db: Db, actor = "system", opts: { force?: boolean } = {}) {
  const s = await getSettings(db);
  if (s.scheduleSeededAt && !opts.force) return { seeded: 0, skipped: true };
  const [projects, team] = await Promise.all([listProjects(db), listTeam(db)]);
  const have = new Set((await db.query<{ project_id: string }>(`select distinct project_id from project_assignments`)).map((r) => r.project_id));
  let seeded = 0;
  for (const { project: p, cost: c } of projects) {
    if (p.status !== "active" || have.has(p.id) || !c.currentPhase) continue;
    let ids = seedPeople(p.lead, p.team, team);
    if (!ids.length) {
      const recent = await db.query<{ member_id: string }>(
        `select member_id from time_entries where project_id = $1 and phase = $2 and member_id is not null
           and coalesce(work_date, week_ending) >= (select max(coalesce(work_date, week_ending)) from time_entries where project_id = $1) - 56
         group by member_id order by sum(hours) desc limit 3`, [p.id, c.currentPhase]);
      ids = recent.map((r) => r.member_id);
    }
    if (!ids.length) continue;
    for (const id of ids) await db.query(`insert into project_assignments (project_id, phase, member_id, created_by) values ($1,$2,$3,'Job List') on conflict do nothing`, [p.id, c.currentPhase, id]);
    seeded++;
  }
  if (seeded || !s.scheduleSeededAt) await setSetting(db, "scheduleSeededAt", new Date().toISOString());
  if (seeded) await audit(db, { actor, entity: "settings", id: "00000000-0000-0000-0000-000000000000", action: "schedule", summary: `Schedule seeded from the Job List for ${seeded} jobs` });
  return { seeded, skipped: false };
}

/**
 * Project schedule (pure, no I/O): who is on which phase, how many hours a week they give it,
 * how long the remaining hours take, and whether that lands before the phase's target date.
 *
 *   capacity      = hours/day × working days a week (default 8 × Mon–Fri = 40 h)
 *   allocation    = hours/week a person gives one phase: typed hours/week, or allocation % × capacity,
 *                   or "auto" — an even share of what's left of their capacity after the fixed ones,
 *                   split across their other auto assignments that are running now
 *   rate          = Σ allocations on the phase (hours/week)
 *   remaining     = hours assigned − hours worked (or the hours allowance share when nothing is assigned yet)
 *   duration      = ⌈remaining ÷ (rate ÷ 5)⌉ working days, counted Mon–Fri from today (or the planned start)
 *   status        = over hours (worked > assigned) · at risk (finish after target, or target passed with
 *                   hours left) · on track · needs plan (hours left but nobody allocated) · no target
 * Phases run one after another: a phase with no planned start begins the working day after the previous one ends.
 */
import { addDays, round2 } from "./util";
import { isoDow, weekStart } from "./hours";

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

export interface Person { id: string; name: string; hoursPerDay: number; workDays: number[] }
export interface PlanAssignment { id: string; projectId: string; phase: string; memberId: string; hoursPerWeek?: number | null; allocationPct?: number | null }
export interface PlanPhase {
  projectId: string; phase: string; sort: number;
  assigned: number; worked: number; suggested?: number;  // suggested = hours allowance × phase hours %
  startDate?: string | null; targetDate?: string | null;
  done?: boolean;                                          // complete, or before the current phase
}
export interface PlanProject { id: string; jobNumber: string; name: string; status: string; lead?: string | null; currentPhase?: string | null }

export type PhaseStatus = "done" | "over_hours" | "at_risk" | "on_track" | "needs_plan" | "no_target" | "no_hours";
export type ProjectScheduleStatus = "over_hours" | "at_risk" | "on_track" | "needs_plan" | "no_target" | "paused" | "done";

export const STATUS_LABEL: Record<ProjectScheduleStatus | PhaseStatus, string> = {
  over_hours: "Over hours", at_risk: "At risk", on_track: "On track", needs_plan: "Needs plan", no_target: "No target",
  no_hours: "No hours", paused: "Paused", done: "Done",
};
export const STATUS_TONE: Record<ProjectScheduleStatus | PhaseStatus, string> = {
  over_hours: "bad", at_risk: "warn", on_track: "ok", needs_plan: "", no_target: "", no_hours: "", paused: "", done: "",
};

export const weeklyCapacity = (p: Pick<Person, "hoursPerDay" | "workDays">) => round2(Math.max(0, p.hoursPerDay) * p.workDays.length);

/** Working day `n` days after `start` (Mon–Fri by default); n = 0 → start itself (moved forward to a working day). */
export function addWorkdays(start: string, n: number, workDays: number[] = DEFAULT_WORK_DAYS): string {
  let d = start;
  while (!workDays.includes(isoDow(d))) d = addDays(d, 1);
  let left = Math.max(0, Math.floor(n));
  while (left > 0) { d = addDays(d, 1); if (workDays.includes(isoDow(d))) left--; }
  return d;
}
export const nextWorkday = (day: string, workDays = DEFAULT_WORK_DAYS) => addWorkdays(addDays(day, 1), 0, workDays);
/** Working days in [from, to] inclusive. */
export function workdaysIn(from: string, to: string, workDays: number[] = DEFAULT_WORK_DAYS): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (workDays.includes(isoDow(d))) n++;
  return n;
}

/** How long `remaining` hours take at `rate` hours/week, starting `start`. Null when nobody is allocated. */
export function estimateFinish(remaining: number, rate: number, start: string): { workdays: number; weeks: number; finish: string } | null {
  if (remaining <= 0) return { workdays: 0, weeks: 0, finish: addWorkdays(start, 0) };
  if (!(rate > 0)) return null;
  const workdays = Math.ceil(remaining / (rate / 5) - 1e-9);
  return { workdays, weeks: round2(workdays / 5), finish: addWorkdays(start, workdays - 1) };
}

/** Hours/week each assignment gets (see header). `now` = assignment ids on phases running today. */
export function resolveAllocations(assignments: PlanAssignment[], people: Person[], now: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of people) {
    const cap = weeklyCapacity(p);
    const mine = assignments.filter((a) => a.memberId === p.id);
    const fixed = (a: PlanAssignment) => (a.hoursPerWeek != null ? Math.max(0, a.hoursPerWeek) : a.allocationPct != null ? Math.max(0, a.allocationPct) * cap : null);
    const fixedNow = mine.filter((a) => now.has(a.id)).reduce((s, a) => s + (fixed(a) ?? 0), 0);
    const autoNow = mine.filter((a) => now.has(a.id) && fixed(a) === null).length;
    const share = round2(Math.max(0, cap - fixedNow) / Math.max(1, autoNow));
    for (const a of mine) out.set(a.id, round2(fixed(a) ?? share));
  }
  return out;
}

export interface ScheduledPhase {
  projectId: string; phase: string; sort: number;
  start: string | null; end: string | null;            // bar on the timeline
  estFinish: string | null; targetDate: string | null; plannedStart: string | null;
  remaining: number | null; hoursSource: "assigned" | "allowance" | null;
  assigned: number; worked: number; rate: number; weeks: number | null;
  people: { assignmentId: string; memberId: string; name: string; hoursPerWeek: number; mode: "hours" | "pct" | "auto"; allocationPct: number | null }[];
  status: PhaseStatus; slipDays: number | null;        // estimated finish − target, in calendar days
}
export interface ScheduledProject { project: PlanProject; phases: ScheduledPhase[]; status: ProjectScheduleStatus; finish: string | null; target: string | null }

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

/** The whole plan. Only active projects are scheduled; on-hold / phase-complete / closeout show as paused. */
export function buildSchedule(input: { projects: PlanProject[]; phases: PlanPhase[]; assignments: PlanAssignment[]; people: Person[] }, today: string): ScheduledProject[] {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const assignments = input.assignments.filter((a) => byId.has(a.memberId));
  // Which phases are running now = the first open phase of each active project.
  const open = (pr: PlanProject) => input.phases.filter((x) => x.projectId === pr.id && !x.done).sort((a, b) => a.sort - b.sort);
  const isActive = (pr: PlanProject) => pr.status === "active";
  const nowKeys = new Set<string>();
  const remainingOf = (ph: PlanPhase) => (ph.assigned > 0 ? ph.assigned - ph.worked : (ph.suggested ?? 0) > 0 ? (ph.suggested ?? 0) - ph.worked : null);
  // Auto shares are split only across phases running now that still have hours left to burn.
  for (const pr of input.projects) if (isActive(pr)) { const f = open(pr)[0]; if (f && (remainingOf(f) ?? 0) > 0) nowKeys.add(`${pr.id}|${f.phase}`); }
  const nowIds = new Set(assignments.filter((a) => nowKeys.has(`${a.projectId}|${a.phase}`)).map((a) => a.id));
  const alloc = resolveAllocations(assignments, input.people, nowIds);

  return input.projects.map((pr) => {
    const phases: ScheduledPhase[] = [];
    let prevEnd: string | null = null;
    for (const ph of open(pr)) {
      const remainingRaw = remainingOf(ph);
      const hoursSource = ph.assigned > 0 ? "assigned" : (ph.suggested ?? 0) > 0 ? "allowance" : null;
      const remaining = remainingRaw === null ? null : round2(Math.max(0, remainingRaw));
      const people = assignments.filter((a) => a.projectId === pr.id && a.phase === ph.phase).map((a) => ({
        assignmentId: a.id, memberId: a.memberId, name: byId.get(a.memberId)!.name, hoursPerWeek: alloc.get(a.id) ?? 0,
        mode: (a.hoursPerWeek != null ? "hours" : a.allocationPct != null ? "pct" : "auto") as "hours" | "pct" | "auto", allocationPct: a.allocationPct ?? null,
      }));
      const rate = round2(people.reduce((s, x) => s + x.hoursPerWeek, 0));
      const plannedStart = ph.startDate ?? null;
      const start: string = plannedStart ?? (prevEnd ? nextWorkday(prevEnd) : today);
      const workFrom: string = start > today ? start : addWorkdays(today, 0);
      const est: ReturnType<typeof estimateFinish> = isActive(pr) && remaining !== null ? estimateFinish(remaining, rate, workFrom) : null;
      const target = ph.targetDate ?? null;
      const over = ph.assigned > 0 && ph.worked > ph.assigned + 1e-9;
      let status: PhaseStatus;
      if (over) status = "over_hours";
      else if (remaining === null) status = "no_hours";
      else if (remaining > 0 && !(rate > 0)) status = target && target < today ? "at_risk" : "needs_plan";
      else if (!target) status = "no_target";
      else if (remaining > 0 && target < today) status = "at_risk";
      else status = est && est.finish > target ? "at_risk" : "on_track";
      const end: string | null = est?.finish ?? target ?? null;
      phases.push({
        projectId: pr.id, phase: ph.phase, sort: ph.sort, start, end: end && end < start ? start : end, estFinish: est?.finish ?? null, targetDate: target, plannedStart,
        remaining, hoursSource, assigned: ph.assigned, worked: ph.worked, rate, weeks: est?.weeks ?? null, people, status,
        slipDays: est && target ? dayDiff(est.finish, target) : null,
      });
      if (end) prevEnd = end && end < start ? start : end;
    }
    return { project: pr, phases, status: projectStatus(pr, phases), finish: phases.reduce<string | null>((m, x) => (x.end && (!m || x.end > m) ? x.end : m), null), target: phases.reduce<string | null>((m, x) => (x.targetDate && (!m || x.targetDate > m) ? x.targetDate : m), null) };
  });
}

/** Worst phase wins: over hours › at risk › needs plan (the phase running now has hours left but nobody on it) › on track › no target.
 *  Later phases nobody is on yet don't count as "needs plan" — they get planned when they come up. */
export function projectStatus(pr: PlanProject, phases: ScheduledPhase[]): ProjectScheduleStatus {
  if (pr.status === "archived") return "done";
  if (phases.some((p) => p.status === "over_hours")) return "over_hours";
  if (pr.status !== "active") return "paused";
  if (phases.some((p) => p.status === "at_risk")) return "at_risk";
  const first = phases[0];
  if (first && first.status === "needs_plan") return "needs_plan";
  if (phases.some((p) => p.status === "on_track")) return "on_track";
  return phases.length ? "no_target" : "done";
}

// ---------------------------------------------------------------- workload & calendar
export interface WorkItem { projectId: string; jobNumber: string; phase: string; hours: number }

/** Planned hours per person per working day: each assignment's hours/week ÷ the person's working days, inside its phase window. */
export function plannedOnDay(schedule: ScheduledProject[], person: Person, day: string, holidays: string[] = []): WorkItem[] {
  if (!person.workDays.includes(isoDow(day)) || holidays.includes(day)) return [];
  const out: WorkItem[] = [];
  for (const sp of schedule) {
    if (sp.project.status !== "active") continue;
    for (const ph of sp.phases) {
      if (!ph.start || !ph.end || day < ph.start || day > ph.end || (ph.remaining ?? 0) <= 0) continue;
      for (const x of ph.people) if (x.memberId === person.id && x.hoursPerWeek > 0) out.push({ projectId: sp.project.id, jobNumber: sp.project.jobNumber, phase: ph.phase, hours: round2(x.hoursPerWeek / person.workDays.length) });
    }
  }
  return out;
}

export interface WeekLoad { week: string; planned: number; capacity: number; logged: number | null; items: WorkItem[]; state: "over" | "full" | "under" | "free" }

/** Who is working on what each week (Monday keys) — planned hours vs capacity; past weeks also carry logged hours. */
export function workload(schedule: ScheduledProject[], person: Person, weeks: string[], loggedByWeek: Map<string, number> = new Map(), holidays: string[] = []): WeekLoad[] {
  return weeks.map((w) => {
    const ws = weekStart(w);
    const items = new Map<string, WorkItem>();
    let capacity = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (person.workDays.includes(isoDow(d)) && !holidays.includes(d)) capacity += person.hoursPerDay;
      for (const it of plannedOnDay(schedule, person, d, holidays)) {
        const k = `${it.projectId}|${it.phase}`;
        const cur = items.get(k);
        items.set(k, cur ? { ...cur, hours: round2(cur.hours + it.hours) } : { ...it });
      }
    }
    const list = [...items.values()].sort((a, b) => b.hours - a.hours);
    const planned = round2(list.reduce((s, x) => s + x.hours, 0));
    const state = capacity <= 0 ? (planned > 0 ? "over" : "free") : planned > capacity * 1.05 ? "over" : planned >= capacity * 0.75 ? "full" : planned > 0 ? "under" : "free";
    return { week: ws, planned, capacity: round2(capacity), logged: loggedByWeek.has(ws) ? loggedByWeek.get(ws)! : null, items: list, state };
  });
}

/** Seed people for a project's current phase from the Job List: lead + team names matched to team members by first name. */
export function seedPeople(lead: string | null | undefined, team: string | null | undefined, members: { id: string; first_name: string }[]): string[] {
  const names = [lead ?? "", ...(team ?? "").split(/[,/&;+]| and /i)].map((s) => s.trim().split(/\s+/)[0]?.toLowerCase()).filter(Boolean);
  const ids: string[] = [];
  for (const n of names) {
    const m = members.find((x) => x.first_name.toLowerCase() === n);
    if (m && !ids.includes(m.id)) ids.push(m.id);
  }
  return ids;
}

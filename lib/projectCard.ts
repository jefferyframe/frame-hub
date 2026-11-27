/** Everything the project card shows, as plain JSON (sent to the client drawer by a server action). */
import type { Db } from "./db/types";
import { getProject } from "./repo/projects";
import { history } from "./repo/audit";
import { projectEntries } from "./repo/time";
import { listTeam } from "./repo/team";
import { loadSchedule, scheduleFor } from "./repo/schedule";
import { matchMember } from "./crm/logic";
import { canEditEntry } from "./calc/hours";
import { todayISO } from "./calc/util";
import type { PhaseStatus, ProjectScheduleStatus } from "./calc/schedule";

export interface CardPhase {
  phase: string; isCurrent: boolean; done: boolean; assigned: number; worked: number; remaining: number; burn: number | null; fee: number;
  start: string | null; plannedStart: string | null; target: string | null; estFinish: string | null; rate: number; weeks: number | null; status: PhaseStatus | null;
  remainingPlan: number | null; hoursSource: "assigned" | "allowance" | null; latestNote: string;
  people: { assignmentId: string; memberId: string; name: string; hoursPerWeek: number; mode: "hours" | "pct" | "auto"; allocationPct: number | null }[];
}
export interface CardEntry { id: string; day: string | null; week: string | null; phase: string; person: string | null; memberId: string | null; hours: number; notes: string | null; canEdit: boolean; fromSheet: boolean }
export interface CardData {
  id: string; jobNumber: string; name: string; status: string; client: string | null; clientContact: string | null; contractor: string | null;
  lead: string | null; team: string | null; currentPhase: string | null; target: string | null; notes: string | null; billing: string | null;
  today: string; me: { name: string; memberId: string | null };
  people: { id: string; name: string; first_name: string }[];
  phaseNames: string[];
  phases: CardPhase[];
  cost: { totalFee: number; archFee: number; consultantTotal: number; hoursAllowance: number; hoursAssigned: number; hoursCompleted: number; hoursRemaining: number; burdenRate: number; costToDate: number; totalBudget: number; budgetUsed: number | null; expectedProfit: number; warnings: string[] };
  schedule: { status: ProjectScheduleStatus | null; finish: string | null; target: string | null };
  consultants: { discipline: string; firm: string | null; total: number; status: string | null }[];
  entries: CardEntry[]; myWeek: number;
  timeline: { at: string; actor: string; summary: string; kind: string }[];
  tasks: { id: string; title: string; due: string | null; owner: string | null; done: boolean }[];
}

export async function projectCard(db: Db, id: string, signedInName: string): Promise<CardData | null> {
  const data = await getProject(db, id);
  if (!data) return null;
  const today = todayISO();
  const { project: p, phases, consultants, cost: c } = data;
  const [team, entries, hist, acts, tasks, sched] = await Promise.all([
    listTeam(db), projectEntries(db, id, 80), history(db, "project", id),
    db.query<{ occurred_at: Date; author: string; kind: string; subject: string | null; body: string | null }>(`select occurred_at, author, kind, subject, body from activities where project_id = $1 order by occurred_at desc limit 50`, [id]),
    db.query<{ id: string; title: string; due_on: string | null; done_at: Date | null; owner: string | null }>(`select t.id, t.title, t.due_on, t.done_at, m.name owner from tasks t left join team_members m on m.id = t.owner_id where t.project_id = $1 and (t.done_at is null or t.done_at > now() - interval '30 days') order by t.done_at nulls first, t.due_on nulls last limit 30`, [id]),
    loadSchedule(db, today),
  ]);
  const me = matchMember(team, signedInName);
  const sp = scheduleFor(sched.schedule, id);
  const curSort = phases.find((x) => x.phase === c.currentPhase)?.sort ?? 0;
  const inScope = c.phases.filter((ph) => ph.feePct > 0 || ph.hoursAssigned > 0 || ph.hoursCompleted !== 0 || ph.phase === c.currentPhase || !!ph.targetDate || sp?.phases.some((x) => x.phase === ph.phase));
  const timeline = [
    ...hist.map((h) => ({ at: new Date(h.at).toISOString(), actor: h.actor, summary: h.summary ?? h.action, kind: h.action })),
    ...acts.map((a) => ({ at: new Date(a.occurred_at).toISOString(), actor: a.author, summary: [a.subject, a.body].filter(Boolean).join(" — ") || a.kind, kind: a.kind })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
  const myWeekStart = (() => { const d = new Date(today + "T12:00:00Z"); const dow = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - dow + 1); return d.toISOString().slice(0, 10); })();
  return {
    id, jobNumber: p.job_number, name: p.name, status: p.status, client: p.client_text, clientContact: p.client_contact, contractor: p.contractor,
    lead: p.lead, team: p.team, currentPhase: c.currentPhase, target: c.current?.targetDate ?? sp?.target ?? null, notes: p.notes, billing: p.billing_notes,
    today, me: { name: signedInName, memberId: me?.id ?? null },
    people: team.map((m) => ({ id: m.id, name: m.name, first_name: m.first_name })),
    phaseNames: phases.map((x) => x.phase),
    phases: inScope.map((ph) => {
      const s = sp?.phases.find((x) => x.phase === ph.phase);
      const sort = phases.find((x) => x.phase === ph.phase)?.sort ?? 0;
      return {
        phase: ph.phase, isCurrent: ph.phase === c.currentPhase, done: ph.status === "complete" || (curSort > 0 && sort < curSort),
        assigned: ph.hoursAssigned, worked: ph.hoursCompleted, remaining: ph.hoursRemaining, burn: ph.hoursAssigned > 0 ? ph.hoursCompleted / ph.hoursAssigned : null, fee: ph.phaseTotalFee,
        start: s?.start ?? null, plannedStart: s?.plannedStart ?? null, target: ph.targetDate, estFinish: s?.estFinish ?? null, rate: s?.rate ?? 0, weeks: s?.weeks ?? null, status: s?.status ?? null,
        remainingPlan: s?.remaining ?? null, hoursSource: s?.hoursSource ?? null, latestNote: ph.latestNote, people: s?.people ?? [],
      };
    }),
    cost: { totalFee: c.totalFee, archFee: c.archFee, consultantTotal: c.consultantTotal, hoursAllowance: c.hoursAllowance, hoursAssigned: c.hoursAssigned, hoursCompleted: c.hoursCompleted, hoursRemaining: c.hoursRemaining, burdenRate: c.burdenRate, costToDate: c.hoursCompleted * c.burdenRate, totalBudget: c.totalBudget, budgetUsed: c.budgetUsed, expectedProfit: c.expectedProfit, warnings: c.warnings },
    schedule: { status: sp?.status ?? null, finish: sp?.finish ?? null, target: sp?.target ?? null },
    consultants: [...new Set(consultants.map((x) => x.discipline))].map((d) => {
      const rows = consultants.filter((x) => x.discipline === d);
      const cur = rows.find((x) => x.phase === c.currentPhase) ?? rows[rows.length - 1];
      return { discipline: d, firm: rows[0].firm, total: rows.reduce((a, x) => a + Number(x.fee ?? 0), 0), status: cur?.status ?? null };
    }),
    entries: entries.map((e) => ({ id: e.id, day: e.work_date, week: e.week_ending ?? null, phase: e.phase, person: e.person, memberId: e.member_id, hours: Number(e.hours), notes: e.notes, canEdit: canEditEntry(e, signedInName), fromSheet: !!e.source_key })),
    myWeek: me ? entries.filter((e) => e.member_id === me.id && e.work_date && e.work_date >= myWeekStart).reduce((s, e) => s + Number(e.hours), 0) : 0,
    timeline,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, due: t.due_on, owner: t.owner, done: !!t.done_at })),
  };
}

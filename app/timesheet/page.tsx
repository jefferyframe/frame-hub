import Link from "next/link";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listTeam } from "@/lib/repo/team";
import { memberEntries, missingHoursReport } from "@/lib/repo/time";
import { getSettings } from "@/lib/repo/settings";
import { matchMember } from "@/lib/crm/logic";
import { weekStart, weekDays, isoDow, expectedInWeek } from "@/lib/calc/hours";
import { addDays, todayISO } from "@/lib/calc/util";
import { TimesheetGrid, type GridRow } from "@/components/time/TimesheetGrid";
import { HoursBanner } from "@/components/time/HoursBanner";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "My timesheet" };

export default async function Timesheet({ searchParams }: { searchParams: Promise<{ who?: string; week?: string }> }) {
  const sp = await searchParams;
  const db = await getDb();
  const today = todayISO();
  const [team, user, settings] = await Promise.all([listTeam(db), currentUser(), getSettings(db)]);
  const me = matchMember(team, user?.name);
  const who = team.find((m) => m.id === sp.who) ?? me ?? null;
  const week = weekStart(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = weekDays(week);
  const qs = (o: Record<string, string>) => `?${new URLSearchParams({ ...(who && who.id !== me?.id ? { who: who.id } : {}), week, ...o })}`;

  if (!who) return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="pagehead"><div><h1>My timesheet</h1></div></div>
      <div className="card"><p className="notice">“{user?.name}” isn’t on the team list, so there’s no timesheet to show. Pick a person:</p>
        <div className="row" style={{ marginTop: 10 }}>{team.map((m) => <Link key={m.id} className="btn sm" href={`?who=${m.id}`}>{m.name}</Link>)}</div></div>
    </div>
  );

  const [entries, assignments, projects, report] = await Promise.all([
    memberEntries(db, who.id, days[0], days[6]),
    db.query<{ project_id: string; phase: string }>(`select a.project_id, a.phase from project_assignments a join projects p on p.id = a.project_id where a.member_id = $1 and p.status = 'active'`, [who.id]),
    db.query<{ id: string; job_number: string; name: string; status: string; current_phase: string | null; phases: string[] }>(
      `select p.id, p.job_number, p.name, p.status, p.current_phase, array_agg(ph.phase order by ph.sort) phases from projects p join project_phases ph on ph.project_id = p.id where p.status <> 'archived' group by p.id order by p.job_number`),
    missingHoursReport(db, { memberId: who.id, from: days[0], to: days[6] }),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rows = new Map<string, GridRow>();
  const key = (p: string, ph: string) => `${p}|${ph}`;
  const ensure = (pid: string, phase: string, job?: string, name?: string) => {
    const k = key(pid, phase);
    if (!rows.has(k)) { const p = byId.get(pid); rows.set(k, { projectId: pid, job: p?.job_number ?? job ?? "?", name: p?.name ?? name ?? "", phase, cells: {}, notes: {} }); }
    return rows.get(k)!;
  };
  for (const e of entries) {
    const r = ensure(e.project_id, e.phase, e.job_number, e.project_name);
    r.cells[e.work_date!] = Math.round(((r.cells[e.work_date!] ?? 0) + Number(e.hours)) * 100) / 100;
    if (e.notes) r.notes[e.work_date!] = [r.notes[e.work_date!], e.notes].filter(Boolean).join(" · ");
  }
  for (const a of assignments) ensure(a.project_id, a.phase);
  const list = [...rows.values()].sort((a, b) => a.job.localeCompare(b.job, undefined, { numeric: true }) || a.phase.localeCompare(b.phase));
  const expected = Object.fromEntries(days.map((d) => [d, who.work_days.includes(isoDow(d)) && !settings.firmHolidays.includes(d) ? Number(who.hours_per_day) : 0]));
  const missing = report[0]?.missing ?? [];
  return (
    <div className="stack">
      <div className="pagehead">
        <div><h1>{who.id === me?.id ? "My timesheet" : `${who.name}’s timesheet`}</h1><p>Week of {date(days[0], { month: "long", day: "numeric", year: "numeric" })} · type hours in quarter steps (1.5 or 1:30); each cell saves when you leave it.</p></div>
        <div className="row">
          <form className="row" style={{ gap: 6 }}><input type="hidden" name="week" value={week} /><select name="who" defaultValue={who.id} aria-label="Whose timesheet" style={{ width: "auto" }}>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="btn sm">Show</button></form>
          <div className="seg"><Link href={qs({ week: addDays(week, -7) })}>‹ Prev</Link><Link href={qs({ week: weekStart(today) })} data-on={week === weekStart(today)}>This week</Link><Link href={qs({ week: addDays(week, 7) })}>Next ›</Link></div>
        </div>
      </div>
      <HoursBanner missing={missing} who={who.id === me?.id ? null : who.name} compact />
      <TimesheetGrid key={`${who.id}-${week}`} memberId={who.id} days={days} today={today} rows={list} expected={expected} weekExpected={expectedInWeek({ hoursPerDay: Number(who.hours_per_day), workDays: who.work_days }, week, settings.firmHolidays)}
        projects={projects.filter((p) => p.status === "active" || list.some((r) => r.projectId === p.id)).map((p) => ({ id: p.id, job: p.job_number, name: p.name, phases: p.phases, current: p.current_phase }))} />
      <p className="small faint">Hours here are the same entries as the project cards and the job’s weekly hours log (each entry is stamped with its week’s Friday, like the Job List). To add details to an entry, open the job’s card. Expected: {Number(who.hours_per_day)} h on {who.work_days.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ")}{settings.firmHolidays.some((h) => days.includes(h)) ? " (holiday this week)" : ""} — change it in Settings → Team hours.</p>
    </div>
  );
}

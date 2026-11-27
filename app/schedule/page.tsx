import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSchedule } from "@/lib/repo/schedule";
import { plannedOnDay, workload, STATUS_LABEL, STATUS_TONE, weeklyCapacity, type ScheduledProject, type Person } from "@/lib/calc/schedule";
import { PHASES } from "@/lib/calc/jobCost";
import { weekStart, weekDays, isoDow } from "@/lib/calc/hours";
import { addDays, addMonths, todayISO } from "@/lib/calc/util";
import { Gantt, type GanttRow } from "@/components/schedule/Gantt";
import { CardLink } from "@/components/project/CardHost";
import { SeedButton } from "@/components/schedule/SeedButton";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

type SP = { view?: string; cal?: string; date?: string; person?: string; project?: string; range?: string };
const SHORT = Object.fromEntries(PHASES.map((p) => [p.key, p.short])) as Record<string, string>;
const h = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const colorOf = (job: string) => { let x = 0; for (const c of job) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `c${x % 7}`; };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "workload" || sp.view === "calendar" ? sp.view : "gantt";
  const cal = sp.cal === "day" || sp.cal === "month" ? sp.cal : "week";
  const db = await getDb();
  const today = todayISO();
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const { schedule, people, settings } = await loadSchedule(db, today);
  const person = people.find((p) => p.id === sp.person) ?? null;
  const project = schedule.find((s) => s.project.id === sp.project) ?? null;
  const shown = schedule.filter((s) => s.project.status === "active" && (!project || s.project.id === project.project.id) && (!person || s.phases.some((ph) => ph.people.some((x) => x.memberId === person.id))));
  const qs = (o: Partial<SP>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ view, cal, date: sp.date, person: sp.person, project: sp.project, range: sp.range, ...o })) if (v) q.set(k, v); return `?${q}`; };
  const counts = shown.reduce<Record<string, number>>((m, x) => { m[x.status] = (m[x.status] ?? 0) + 1; return m; }, {});
  const unplanned = schedule.filter((s) => s.project.status === "active" && !s.phases.some((p) => p.people.length)).length;

  return (
    <div className="stack sched">
      <div className="pagehead">
        <div><h1>Schedule</h1><p>Who’s on what, and how long the hours left take at the hours a week they’re planned. Click a job to open its card and change the plan.</p></div>
        <div className="seg">
          <Link href={qs({ view: "gantt" })} data-on={view === "gantt"}>Timeline</Link>
          <Link href={qs({ view: "workload" })} data-on={view === "workload"}>Workload</Link>
          <Link href={qs({ view: "calendar" })} data-on={view === "calendar"}>Calendar</Link>
        </div>
      </div>
      <form className="card row sched-filters">
        <input type="hidden" name="view" value={view} />{view === "calendar" && <input type="hidden" name="cal" value={cal} />}{sp.date && <input type="hidden" name="date" value={sp.date} />}
        <label className="f inline"><span>Person</span><select name="person" defaultValue={person?.id ?? ""}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f inline"><span>Job</span><select name="project" defaultValue={project?.project.id ?? ""} style={{ maxWidth: 260 }}><option value="">All jobs</option>{schedule.filter((s) => s.project.status === "active").map((s) => <option key={s.project.id} value={s.project.id}>{s.project.jobNumber} · {s.project.name}</option>)}</select></label>
        <button className="btn sm">Filter</button>
        {(person || project) && <Link className="btn sm ghost" href={qs({ person: undefined, project: undefined })}>Clear</Link>}
        <span className="spacer" />
        <span className="row" style={{ gap: 6 }}>{(["over_hours", "at_risk", "on_track", "needs_plan", "no_target"] as const).filter((k) => counts[k]).map((k) => <span key={k} className={`pill ${STATUS_TONE[k]}`}>{STATUS_LABEL[k]} {counts[k]}</span>)}</span>
      </form>
      {unplanned > 0 && <div className="notice row" style={{ justifyContent: "space-between" }}><span>{unplanned} active job{unplanned === 1 ? " has" : "s have"} nobody planned on any phase.</span><SeedButton /></div>}

      {view === "gantt" && <GanttView shown={shown} today={today} range={sp.range} qs={qs} />}
      {view === "workload" && <WorkloadView schedule={schedule} people={person ? [person] : people} today={today} anchor={anchor} holidays={settings.firmHolidays} qs={qs} db={db} />}
      {view === "calendar" && <CalendarView schedule={shown} people={person ? [person] : people} today={today} anchor={anchor} cal={cal} holidays={settings.firmHolidays} qs={qs} db={db} projectId={project?.project.id ?? null} />}
    </div>
  );
}

// ---------------------------------------------------------------- timeline (Gantt)
function GanttView({ shown, today, range, qs }: { shown: ScheduledProject[]; today: string; range?: string; qs: (o: Partial<SP>) => string }) {
  const months = range === "3" ? 3 : range === "12" ? 12 : 6;
  const from = addDays(weekStart(today), -14), to = addMonths(from, months);
  const rows: GanttRow[] = shown.map((s) => ({
    projectId: s.project.id, job: s.project.jobNumber, name: s.project.name, status: s.status, color: colorOf(s.project.jobNumber),
    phases: s.phases.filter((p) => p.start && (p.end || p.targetDate)).map((p) => ({ phase: p.phase, short: SHORT[p.phase] ?? p.phase.slice(0, 2), start: p.start!, end: p.end ?? p.start!, target: p.targetDate, est: p.estFinish, plannedStart: p.plannedStart, status: p.status, people: p.people.map((x) => `${x.name.split(" ")[0]} ${h(x.hoursPerWeek)}h/wk`).join(", "), remaining: p.remaining, rate: p.rate })),
  })).filter((r) => r.phases.length);
  const noBars = shown.length - rows.length;
  return (
    <div className="card">
      <header><h2>Timeline by job and phase <span className="small muted" style={{ fontWeight: 400 }}>{date(from, { month: "short", year: "numeric" })} – {date(to, { month: "short", year: "numeric" })}</span></h2>
        <div className="seg">{["3", "6", "12"].map((m) => <Link key={m} href={qs({ range: m })} data-on={String(months) === m}>{m} mo</Link>)}</div>
      </header>
      <Gantt rows={rows} from={from} to={to} today={today} />
      <div className="legend" style={{ marginTop: 10 }}>
        <span><i className="lg on_track" />On track</span><span><i className="lg at_risk" />At risk (est. finish after target)</span><span><i className="lg over_hours" />Over hours</span><span><i className="lg plain" />No target / needs plan</span><span>◆ target date</span><span className="hide-sm">Drag a bar to move its start · drag its right edge to set the target</span>
      </div>
      {noBars > 0 && <p className="small faint" style={{ marginTop: 8 }}>{noBars} job{noBars === 1 ? "" : "s"} not drawn: no hours budget and no target date on an open phase (open the card to add them).</p>}
    </div>
  );
}

// ---------------------------------------------------------------- workload
async function WorkloadView({ schedule, people, today, anchor, holidays, qs, db }: { schedule: ScheduledProject[]; people: Person[]; today: string; anchor: string; holidays: string[]; qs: (o: Partial<SP>) => string; db: Awaited<ReturnType<typeof getDb>> }) {
  const first = addDays(weekStart(anchor), -14);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(first, i * 7));
  const logged = await db.query<{ member_id: string; wk: string; h: number }>(
    `select member_id, (coalesce(work_date, week_ending) - ((extract(isodow from coalesce(work_date, week_ending))::int - 1)))::text wk, sum(hours)::float8 h
       from time_entries where member_id is not null and coalesce(work_date, week_ending) between $1 and $2 group by 1, 2`, [weeks[0], addDays(weeks[11], 6)]);
  const loads = people.map((p) => {
    const lw = new Map(logged.filter((r) => r.member_id === p.id && r.wk <= weekStart(today)).map((r) => [r.wk, Number(r.h)]));
    return { p, weeks: workload(schedule, p, weeks, lw, holidays) };
  });
  const thisWeek = weekStart(today);
  return (
    <div className="stack">
      <div className="card">
        <header><h2>Workload by person</h2>
          <div className="seg"><Link href={qs({ date: addDays(anchor, -28) })}>‹</Link><Link href={qs({ date: undefined })} data-on={!anchor || weekStart(anchor) === thisWeek}>Now</Link><Link href={qs({ date: addDays(anchor, 28) })}>›</Link></div>
        </header>
        <div className="tablewrap"><table className="wl">
          <thead><tr><th>Person</th>{weeks.map((w) => <th key={w} className={`num${w === thisWeek ? " today" : ""}`}>{date(w, { month: "short", day: "numeric" })}</th>)}</tr></thead>
          <tbody>{loads.map(({ p, weeks: ws }) => (
            <tr key={p.id}>
              <td><Link href={qs({ person: p.id })}><b>{p.name}</b></Link><div className="small faint">{weeklyCapacity(p)} h/wk</div></td>
              {ws.map((w) => {
                const past = w.week < thisWeek, now = w.week === thisWeek;
                const v = past ? w.logged ?? 0 : now ? (w.logged ?? 0) + w.planned : w.planned; // this week = logged so far + planned for the rest
                const ratio = w.capacity ? v / w.capacity : 0;
                return (
                  <td key={w.week} className={`wl-cell ${past ? "past" : w.state}${w.week === thisWeek ? " today" : ""}`} title={past ? `${h(v)} h logged` : (now ? `${h(w.logged ?? 0)} h logged so far + ${h(w.planned)} h planned\n` : "") + w.items.map((x) => `${x.jobNumber} ${SHORT[x.phase] ?? x.phase}: ${h(x.hours)} h`).join("\n") || "Nothing planned"}>
                    <div className="wl-v">{h(v)}<span className="faint">/{h(w.capacity)}</span></div>
                    <div className="wl-bar"><div style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                  </td>);
              })}
            </tr>))}</tbody>
        </table></div>
        <div className="legend" style={{ marginTop: 10 }}><span><i className="lg over_hours" />Over capacity (&gt;105%)</span><span><i className="lg on_track" />Full (75–105%)</span><span><i className="lg at_risk" />Under (&lt;75%)</span><span><i className="lg plain" />Past weeks: hours logged · this week: logged so far + planned</span></div>
      </div>
      <div className="card">
        <header><h2>Who’s working on what — week of {date(weekStart(anchor), { month: "short", day: "numeric" })}</h2></header>
        <div className="wl-who">{loads.map(({ p, weeks: ws }) => {
          const w = ws.find((x) => x.week === weekStart(anchor)) ?? ws[2];
          return (
            <div key={p.id} className="wl-person">
              <div className="row" style={{ justifyContent: "space-between" }}><b>{p.name}</b><span className={`pill ${w.state === "over" ? "bad" : w.state === "full" ? "ok" : w.state === "under" ? "warn" : ""}`}>{h(w.planned)} / {h(w.capacity)} h</span></div>
              {w.items.length ? <ul className="plain small">{w.items.map((x) => <li key={x.projectId + x.phase} className="row" style={{ justifyContent: "space-between" }}><CardLink id={x.projectId}><span className="mono">{x.jobNumber}</span> {x.phase}</CardLink><span className="num">{h(x.hours)} h</span></li>)}</ul> : <p className="small faint">Nothing planned.</p>}
            </div>);
        })}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar (day / week / month)
async function CalendarView({ schedule, people, today, anchor, cal, holidays, qs, db, projectId }: { schedule: ScheduledProject[]; people: Person[]; today: string; anchor: string; cal: "day" | "week" | "month"; holidays: string[]; qs: (o: Partial<SP>) => string; db: Awaited<ReturnType<typeof getDb>>; projectId: string | null }) {
  const monthStart = anchor.slice(0, 8) + "01";
  const days = cal === "day" ? [anchor] : cal === "week" ? weekDays(anchor) : Array.from({ length: 42 }, (_, i) => addDays(weekStart(monthStart), i));
  const from = days[0], to = days[days.length - 1];
  const entries = await db.query<{ member_id: string; project_id: string; job_number: string; phase: string; hours: number; d: string; daily: boolean; notes: string | null }>(
    `select e.member_id, e.project_id, p.job_number, e.phase, e.hours::float8 hours, coalesce(e.work_date, e.week_ending)::text d, e.work_date is not null daily, e.notes
       from time_entries e join projects p on p.id = e.project_id
      where e.member_id = any($1) and coalesce(e.work_date, e.week_ending) between $2 and $3 ${projectId ? "and e.project_id = $4" : ""}`,
    projectId ? [people.map((p) => p.id), from, to, projectId] : [people.map((p) => p.id), from, to]);
  const step = cal === "day" ? 1 : cal === "week" ? 7 : 0;
  const prev = step ? addDays(anchor, -step) : addMonths(monthStart, -1), next = step ? addDays(anchor, step) : addMonths(monthStart, 1);
  const title = cal === "day" ? date(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : cal === "week" ? `Week of ${date(days[0], { month: "long", day: "numeric", year: "numeric" })}` : date(monthStart, { month: "long", year: "numeric" });
  const planned = (p: Person, d: string) => plannedOnDay(schedule, p, d, holidays);
  const loggedOn = (p: Person, d: string) => entries.filter((e) => e.member_id === p.id && e.d === d);
  const sumH = (xs: { hours: number }[]) => xs.reduce((s, x) => s + Number(x.hours), 0);
  const Chip = ({ id, job, phase, hours, kind }: { id: string; job: string; phase: string; hours: number; kind: "plan" | "log" | "week" }) => (
    <CardLink id={id} className={`cchip ${kind} ${colorOf(job)}`} title={`${job} ${phase}: ${h(hours)} h ${kind === "plan" ? "planned" : kind === "week" ? "logged that week (spreadsheet)" : "logged"}`}><span className="mono">{job}</span> {SHORT[phase] ?? phase}<b>{h(hours)}</b></CardLink>
  );
  const group = (xs: typeof entries) => { const m = new Map<string, { id: string; job: string; phase: string; hours: number; daily: boolean }>(); for (const e of xs) { const k = `${e.project_id}|${e.phase}|${e.daily}`; const c = m.get(k); m.set(k, c ? { ...c, hours: c.hours + Number(e.hours) } : { id: e.project_id, job: e.job_number, phase: e.phase, hours: Number(e.hours), daily: e.daily }); } return [...m.values()]; };

  return (
    <div className="card">
      <header className="cal-head">
        <h2>{title}</h2>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg"><Link href={qs({ date: prev })}>‹</Link><Link href={qs({ date: undefined })}>Today</Link><Link href={qs({ date: next })}>›</Link></div>
          <div className="seg">{(["day", "week", "month"] as const).map((c) => <Link key={c} href={qs({ cal: c })} data-on={cal === c}>{c[0].toUpperCase() + c.slice(1)}</Link>)}</div>
        </div>
      </header>
      <div className="legend" style={{ marginBottom: 10 }}><span><i className="lg plain" />Planned (hours/day from the plan)</span><span><i className="lg log" />Logged</span>{cal !== "day" && <span className="hide-sm">Past days show what was logged; today and later show the plan</span>}</div>

      {cal === "day" && (
        <div className="cal-day">{people.map((p) => {
          const pl = planned(p, anchor), lg = loggedOn(p, anchor);
          if (!pl.length && !lg.length) return null;
          return (
            <div key={p.id} className="cal-person">
              <div className="row" style={{ justifyContent: "space-between" }}><b>{p.name}</b><span className="small muted">{anchor <= today ? `${h(sumH(lg))} h logged · ` : ""}{h(sumH(pl))} h planned</span></div>
              {pl.length > 0 && <div className="cal-chips">{pl.map((x) => <Chip key={x.projectId + x.phase} id={x.projectId} job={x.jobNumber} phase={x.phase} hours={x.hours} kind="plan" />)}</div>}
              {lg.length > 0 && <ul className="plain small">{lg.map((e, i) => <li key={i}><Chip id={e.project_id} job={e.job_number} phase={e.phase} hours={e.hours} kind={e.daily ? "log" : "week"} /> {e.notes ? <span className="muted">{e.notes}</span> : null}</li>)}</ul>}
            </div>);
        })}{people.every((p) => !planned(p, anchor).length && !loggedOn(p, anchor).length) && <p className="empty">Nothing planned or logged this day.</p>}</div>
      )}

      {cal === "week" && (
        <div className="tablewrap"><table className="cal-week">
          <thead><tr><th>Person</th>{days.map((d) => <th key={d} className={`${d === today ? "today" : ""}${isoDow(d) > 5 ? " off" : ""}`}><Link href={qs({ cal: "day", date: d })}>{date(d, { weekday: "short", day: "numeric" })}</Link></th>)}</tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name.split(" ")[0]}</b></td>
              {days.map((d) => {
                const past = d < today;
                const lg = group(loggedOn(p, d)), pl = past ? [] : planned(p, d);
                return (
                  <td key={d} className={`${d === today ? "today" : ""}${isoDow(d) > 5 ? " off" : ""}`}>
                    <div className="cal-chips">
                      {lg.map((x) => <Chip key={x.id + x.phase + x.daily} id={x.id} job={x.job} phase={x.phase} hours={x.hours} kind={x.daily ? "log" : "week"} />)}
                      {pl.map((x) => <Chip key={x.projectId + x.phase} id={x.projectId} job={x.jobNumber} phase={x.phase} hours={x.hours} kind="plan" />)}
                    </div>
                    {(lg.length > 0 || pl.length > 0) && <div className="cal-sum">{[lg.length ? `${h(sumH(lg))} h logged` : null, pl.length ? `${h(sumH(pl))} h plan` : null].filter(Boolean).join(" · ")}</div>}
                  </td>);
              })}
            </tr>))}</tbody>
        </table></div>
      )}

      {cal === "month" && (
        <div className="cal-month">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cm-dow">{d}</div>)}
          {days.map((d) => {
            const inMonth = d.slice(0, 7) === monthStart.slice(0, 7);
            const past = d < today;
            const per = people.map((p) => ({ p, lg: loggedOn(p, d), pl: past ? [] : planned(p, d) })).filter((x) => x.lg.length || x.pl.length);
            const single = people.length === 1;
            return (
              <div key={d} className={`cm-day${inMonth ? "" : " out"}${d === today ? " today" : ""}${isoDow(d) > 5 ? " off" : ""}`}>
                <Link className="cm-n" href={qs({ cal: "day", date: d })}>{Number(d.slice(8))}</Link>
                <div className="cal-chips">
                  {single
                    ? [...group(per[0]?.lg ?? []).map((x) => <Chip key={"l" + x.id + x.phase + x.daily} id={x.id} job={x.job} phase={x.phase} hours={x.hours} kind={x.daily ? "log" : "week"} />), ...(per[0]?.pl ?? []).map((x) => <Chip key={"p" + x.projectId + x.phase} id={x.projectId} job={x.jobNumber} phase={x.phase} hours={x.hours} kind="plan" />)]
                    : per.map(({ p, lg, pl }) => <span key={p.id} className={`cperson ${past ? "log" : "plan"}`} title={(past ? lg.map((e) => `${e.job_number} ${e.phase}: ${h(e.hours)} h`) : pl.map((x) => `${x.jobNumber} ${x.phase}: ${h(x.hours)} h`)).join("\n")}>{p.name.split(" ")[0]} <b>{h(past ? sumH(lg) : sumH(pl))}</b><span className="faint"> · {new Set((past ? lg.map((e) => e.project_id) : pl.map((x) => x.projectId))).size} job{new Set((past ? lg.map((e) => e.project_id) : pl.map((x) => x.projectId))).size === 1 ? "" : "s"}</span></span>)}
                </div>
              </div>);
          })}
        </div>
      )}
      {cal === "month" && people.length > 1 && <p className="small faint" style={{ marginTop: 8 }}>Pick a person above to see their jobs on each day.</p>}
    </div>
  );
}

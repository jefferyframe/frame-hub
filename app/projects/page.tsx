import Link from "next/link";
import { getDb } from "@/lib/db";
import { listProjects } from "@/lib/repo/projects";
import { jobListFlags } from "@/lib/calc/jobCost";
import { todayISO } from "@/lib/calc/util";
import { ProjectPill } from "@/components/bits";
import { Kpi } from "@/components/bits";
import { hrs, date, money, compactMoney } from "@/lib/format";
import { loadSchedule } from "@/lib/repo/schedule";
import { STATUS_LABEL, STATUS_TONE, type ProjectScheduleStatus } from "@/lib/calc/schedule";
import { CardLink } from "@/components/project/CardHost";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job list" };

export default async function Projects({ searchParams }: { searchParams: Promise<{ show?: string; lead?: string; sched?: string }> }) {
  const { show = "open", lead, sched } = await searchParams;
  const db = await getDb();
  const today = todayISO();
  const all = await listProjects(db, { includeArchived: true });
  const plan = await loadSchedule(db, today, all);
  const status = new Map(plan.schedule.map((x) => [x.project.id, x]));
  const list = all.filter(({ project: p }) => (show === "archived" ? p.status === "archived" : show === "all" ? true : p.status !== "archived") && (!lead || p.lead === lead) && (!sched || status.get(p.id)?.status === sched));
  const counts = plan.schedule.reduce<Record<string, number>>((m, x) => { m[x.status] = (m[x.status] ?? 0) + 1; return m; }, {});
  const qs = (o: Record<string, string | undefined>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ show, lead, sched, ...o })) if (v) q.set(k, v); return `?${q}`; };
  const leads = [...new Set(all.map((x) => x.project.lead).filter(Boolean))].sort() as string[];
  const open = all.filter((x) => x.project.status !== "archived");
  const fee = open.reduce((a, x) => a + x.cost.totalFee, 0);
  const low = open.filter((x) => x.cost.current && jobListFlags({ hours_assigned: x.cost.current.hoursAssigned, hours_remaining: x.cost.current.hoursRemaining }, today).hoursLow).length;
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Job list</h1><p>Current phase, hours, schedule and consultants for every job. Click a job to open its card and log hours.</p></div>
        <div className="row"><Link className="btn" href="/schedule">Schedule</Link><Link className="btn primary" href="/timesheet">My timesheet</Link></div></div>
      <div className="grid g4">
        <Kpi label="Open jobs" value={open.length} sub={`${open.filter((x) => x.project.status === "closeout").length} in closeout`} />
        <Kpi label="Fees on the books" value={compactMoney(fee)} sub="where a fee is entered" />
        <Kpi label="Hours worked (open jobs)" value={hrs(open.reduce((a, x) => a + x.cost.hoursCompleted, 0))} />
        <Kpi label="Low on hours" value={low} sub="≤ 10% of the phase’s hours left" />
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {[["open", "Open"], ["archived", "Archived"], ["all", "All"]].map(([k, v]) => <a key={k} className={`btn sm ${show === k ? "primary" : ""}`} href={qs({ show: k })}>{v}</a>)}
          <span className="spacer" />
          <span className="small muted">Lead</span>
          {leads.map((l) => <a key={l} className={`btn sm ${lead === l ? "primary" : "ghost"}`} href={qs({ lead: lead === l ? undefined : l })}>{l}</a>)}
        </div>
        <div className="row" style={{ marginBottom: 10, gap: 6 }}>
          <span className="small muted">Schedule</span>
          {(["over_hours", "at_risk", "on_track", "needs_plan", "no_target"] as ProjectScheduleStatus[]).filter((k) => counts[k]).map((k) => (
            <a key={k} className={`pill ${STATUS_TONE[k]}`} data-on={sched === k} style={{ cursor: "pointer", ...(sched === k ? { boxShadow: "0 0 0 2px var(--accent)" } : {}) }} href={qs({ sched: sched === k ? undefined : k })}>{STATUS_LABEL[k]} · {counts[k]}</a>
          ))}
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Job</th><th className="hide-sm">Lead / team</th><th>Phase</th><th>Schedule</th><th className="hide-sm">Target</th><th className="num">Assigned</th><th className="num">Worked</th><th className="num">Remaining</th><th className="hide-sm">Consultants</th><th className="hide-sm">Notes</th></tr></thead>
          <tbody>{list.map(({ project: p, cost: c }) => {
            const cur = c.current;
            const f = jobListFlags({ target_date: cur?.targetDate, hours_assigned: cur?.hoursAssigned, hours_remaining: cur?.hoursRemaining }, today);
            const sp = status.get(p.id);
            const ph = sp?.phases[0];
            return (
              <tr key={p.id} className="jobrow">
                <td><CardLink id={p.id} className="joblink"><span className="mono">{p.job_number}</span> {p.status !== "active" && <ProjectPill s={p.status} />}<div className="small jobname">{p.name}</div></CardLink></td>
                <td className="hide-sm small">{p.lead ?? "—"}<div className="faint">{p.team}</div></td>
                <td className="small">{c.currentPhase ?? "—"}</td>
                <td className="small">{sp ? <span className={`pill ${STATUS_TONE[sp.status]}`}>{STATUS_LABEL[sp.status]}</span> : "—"}{ph?.estFinish && (ph.remaining ?? 0) > 0 && <div className="faint">est. {date(ph.estFinish, { month: "short", day: "numeric", year: "2-digit" })}</div>}</td>
                <td className="hide-sm small"><span className={f.date === "overdue" ? "hl-bad" : f.date === "soon" ? "hl-soon" : ""}>{date(cur?.targetDate)}</span></td>
                <td className="num">{cur ? hrs(cur.hoursAssigned) : "—"}</td>
                <td className="num">{cur ? hrs(cur.hoursCompleted) : "—"}</td>
                <td className="num"><span className={f.hoursLow ? "hl-bad" : ""}>{cur ? hrs(cur.hoursRemaining) : "—"}</span></td>
                <td className="hide-sm small">{cur?.consultantStatus ?? "None"}</td>
                <td className="hide-sm small" style={{ maxWidth: 320 }}>{p.billing_notes ? <span className="pill">{p.billing_notes}</span> : null} {p.notes}</td>
              </tr>);
          })}</tbody>
        </table></div>
        {list.length === 0 && <p className="empty">No jobs.</p>}
        <p className="small faint" style={{ marginTop: 10 }}>Target date turns yellow within 7 days and red when due; hours remaining turns red at 10% or less — same rules as the workbook. Schedule: <b>Over hours</b> = more worked than assigned on a phase; <b>At risk</b> = at the planned hours a week it finishes after its target (or the target has passed); <b>Needs plan</b> = hours left but nobody on the current phase. Fee total {money(fee)}.</p>
      </div>
    </div>
  );
}

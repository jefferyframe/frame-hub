import Link from "next/link";
import { getDb } from "@/lib/db";
import { listOpportunities, applyAutoAdvance } from "@/lib/repo/opportunities";
import { getSettings } from "@/lib/repo/settings";
import { listProjects } from "@/lib/repo/projects";
import { openTasks } from "@/lib/repo/tasks";
import { pipelineSummary, STAGES } from "@/lib/calc/sales";
import { leadTotals, leadTrend, lagTotals, FUNNEL_STEPS, type LeadMeasureRow } from "@/lib/calc/measures";
import { addDays, todayISO } from "@/lib/calc/util";
import { Bars, Funnel, Lines, Meter } from "@/components/charts";
import { Kpi } from "@/components/bits";
import { compactMoney, money, pct, hrs, date } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = await getDb();
  const today = todayISO();
  await applyAutoAdvance(db, "system", today);
  const [opps, settings, projects, tasks, leads, lag, proposals] = await Promise.all([
    listOpportunities(db), getSettings(db), listProjects(db), openTasks(db, { until: addDays(today, 7) }),
    db.query<LeadMeasureRow>(`select * from lead_measures order by day`),
    db.query<{ opportunity: string; status: string }>(`select opportunity, status from lag_measures`),
    db.query<{ status: string; n: number }>(`select status, count(*)::int n from proposals where is_current group by status`),
  ]);
  const s = pipelineSummary(opps, settings.stageLikelihood);
  const lt = leadTotals(leads);
  const trend = leadTrend(leads, "month");
  const lag2 = lagTotals(lag);
  const openProposals = proposals.filter((p) => ["draft", "in_review", "approved", "sent", "viewed"].includes(p.status)).reduce((a, p) => a + p.n, 0);
  const burnOf = (c: (typeof projects)[number]["cost"]) => (c.current && c.current.hoursAssigned > 0 ? c.current.hoursCompleted / c.current.hoursAssigned : null);
  const active = projects.filter((p) => p.cost.current && p.cost.current.hoursAssigned > 0).sort((a, b) => (burnOf(b.cost) ?? 0) - (burnOf(a.cost) ?? 0)).slice(0, 10);
  const totalAssigned = projects.reduce((a, p) => a + p.cost.hoursAssigned, 0);
  const totalDone = projects.reduce((a, p) => a + p.cost.hoursCompleted, 0);
  const overdue = tasks.filter((t) => t.due_on && t.due_on < today).length;

  return (
    <div className="stack">
      <div className="pagehead">
        <div><h1>Dashboard</h1><p>{date(today, { weekday: "long", month: "long", day: "numeric" })}</p></div>
        <div className="row"><Link className="btn primary" href="/proposals/new">New proposal</Link><Link className="btn" href="/sales/measures">Log today’s lead measures</Link></div>
      </div>

      <div className="grid g4">
        <Kpi label="Weighted pipeline" value={compactMoney(s.weightedTotal)} sub={`${compactMoney(s.openTotal)} open across ${s.stages.reduce((a, x) => a + x.count, 0)} opportunities`} />
        <Kpi label="Sold (all time)" value={compactMoney(s.soldTotal)} sub={`${s.soldCount} won · ${s.rejectedCount} rejected`} />
        <Kpi label="Close rate" value={pct(s.closeRateCount)} sub={`by value ${pct(s.closeRateValue)} · lag sheet win rate ${pct(lag2.winRate)}`} />
        <Kpi label="Follow-ups this week" value={tasks.length} sub={overdue ? <span style={{ color: "var(--danger)" }}>{overdue} overdue</span> : `${openProposals} proposals in progress`} />
      </div>

      <div className="grid g2">
        <div className="card">
          <header><h2>Pipeline by stage</h2><span className="small muted">faint bar = total bid · solid = weighted</span></header>
          <Bars data={s.stages.map((x, i) => ({ label: STAGES[i].label.split(" – ")[0], value: x.sum, color: `var(--stage-${i + 2})` }))} overlay={{ values: s.stages.map((x) => x.weighted), label: "Weighted" }} />
          <div className="tablewrap"><table className="small">
            <thead><tr><th>Stage</th><th className="num">Count</th><th className="num">Total bid</th><th className="num">Stage %</th><th className="num">Overall %</th><th className="num">Est. value</th></tr></thead>
            <tbody>{s.stages.map((x) => <tr key={x.key}><td>{x.label}</td><td className="num">{x.count}</td><td className="num">{money(x.sum)}</td><td className="num">{pct(x.likelihood)}</td><td className="num">{pct(x.overall)}</td><td className="num">{money(x.weighted)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total pipeline</td><td /><td className="num">{money(s.openTotal)}</td><td /><td /><td className="num">{money(s.weightedTotal)}</td></tr></tfoot>
          </table></div>
        </div>
        <div className="card">
          <header><h2>Conversion funnel</h2><span className="small muted">lead measures, all time</span></header>
          <Funnel steps={FUNNEL_STEPS.map((f, i) => ({ label: f.label, value: lt.totals[f.key], rate: i ? lt.conversion[i - 1].rate : null }))} />
          <p className="small muted" style={{ marginTop: 12 }}>Yes {lt.totals.yes} · No {lt.totals.no} · proposals that closed {pct(lt.closeRate)}</p>
          <h3 style={{ marginTop: 18 }} className="label">Lead measures by month</h3>
          {trend.length ? (
            <>
              <Lines labels={trend.map((t) => date(t.period + "-01", { month: "short", year: "2-digit" }))} series={[
                { name: "Connection requests", values: trend.map((t) => t.connection_requests), color: "var(--chart-1)" },
                { name: "Conversations", values: trend.map((t) => t.conversations), color: "var(--chart-2)" },
                { name: "Opportunities", values: trend.map((t) => t.opportunities), color: "var(--chart-3)" },
              ]} height={160} />
              <div className="legend"><span><i style={{ background: "var(--chart-1)" }} />Connection requests</span><span><i style={{ background: "var(--chart-2)" }} />Conversations</span><span><i style={{ background: "var(--chart-3)" }} />Opportunities</span></div>
            </>
          ) : <p className="empty">No lead measures logged yet.</p>}
        </div>
      </div>

      <div className="grid g-side">
        <div className="card">
          <header><h2>Project hours burn</h2><span className="small muted">current phase · all jobs {hrs(totalDone)} of {hrs(totalAssigned)} h</span></header>
          <div className="tablewrap"><table>
            <thead><tr><th>Job</th><th className="hide-sm">Phase</th><th className="num">Assigned</th><th className="num">Worked</th><th style={{ width: "28%" }}>Burn</th></tr></thead>
            <tbody>{active.map(({ project: p, cost: c }) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`}>{p.job_number}</Link> <span className="muted small">{p.name}</span></td>
                <td className="hide-sm small">{c.currentPhase ?? "—"}</td>
                <td className="num">{hrs(c.current!.hoursAssigned)}</td><td className="num">{hrs(c.current!.hoursCompleted)}</td>
                <td><Meter value={c.current!.hoursCompleted} max={c.current!.hoursAssigned} warnAt={0.9} /><span className="small faint">{pct(burnOf(c))} · {hrs(c.current!.hoursRemaining)} h left</span></td>
              </tr>))}</tbody>
          </table></div>
        </div>
        <div className="card">
          <header><h2>Follow-ups due</h2><Link className="small" href="/crm">All</Link></header>
          {tasks.length ? (
            <ul className="timeline">{tasks.slice(0, 8).map((t) => (
              <li key={t.id}><div>{t.title}</div><div className={t.due_on && t.due_on < today ? "small" : "faint"} style={t.due_on && t.due_on < today ? { color: "var(--danger)" } : undefined}>{date(t.due_on)}{t.opportunity_name ? ` · ${t.opportunity_name}` : ""}</div></li>
            ))}</ul>
          ) : <p className="empty">Nothing due this week.</p>}
        </div>
      </div>
    </div>
  );
}

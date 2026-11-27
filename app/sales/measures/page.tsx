import { getDb } from "@/lib/db";
import { leadTotals, lagTotals, leadTrend, FUNNEL_STEPS, LAG_STATUSES, type LeadMeasureRow } from "@/lib/calc/measures";
import { todayISO } from "@/lib/calc/util";
import { saveLeadMeasuresAction, addLagAction } from "../actions";
import { LagStatus } from "./LagStatus";
import { Funnel, Lines } from "@/components/charts";
import { Kpi } from "@/components/bits";
import { pct, date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead & lag measures" };

export default async function Measures() {
  const db = await getDb();
  const today = todayISO();
  const [rows, lag] = await Promise.all([
    db.query<LeadMeasureRow>(`select * from lead_measures order by day desc`),
    db.query<{ id: string; day: string | null; project_number: string | null; opportunity: string; status: string; notes: string | null }>(`select * from lag_measures order by day desc nulls last, created_at desc`),
  ]);
  const t = leadTotals(rows);
  const l = lagTotals(lag);
  const todays = rows.find((r) => r.day === today);
  const weeks = leadTrend(rows, "week").slice(-16);
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Lead & lag measures</h1><p>Fill this in daily. Each % is the next step divided by this one — the same math as the sheet’s row 4.</p></div></div>
      <div className="grid g4">
        <Kpi label="Responses ÷ requests" value={pct(t.conversion[0].rate)} />
        <Kpi label="Opportunities ÷ conversations" value={pct(t.conversion[2].rate)} />
        <Kpi label="Yes ÷ proposals" value={pct(t.conversion[4].rate)} sub={`${t.totals.yes} yes · ${t.totals.no} no`} />
        <Kpi label="Win rate (lag)" value={pct(l.winRate)} sub={`${l.won} won · ${l.lost} lost · ${l.total} opportunities`} />
      </div>
      <div className="grid g2">
        <form action={saveLeadMeasuresAction} className="card stack">
          <header><h2>Today’s numbers</h2><span className="small muted">saving a date again overwrites it</span></header>
          <label className="f" style={{ maxWidth: 200 }}><span>Date</span><input type="date" name="day" defaultValue={today} /></label>
          <div className="fields">
            {[...FUNNEL_STEPS.map((f) => [f.key, f.label] as const), ["no", "No"] as const].map(([k, label]) => (
              <label key={k} className="f"><span>{label}</span><input name={k} type="number" min={0} inputMode="numeric" defaultValue={todays ? (todays as unknown as Record<string, number>)[k] : ""} /></label>
            ))}
          </div>
          <div><button className="btn primary">Save day</button></div>
        </form>
        <div className="card">
          <header><h2>Funnel</h2><span className="small muted">all time</span></header>
          <Funnel steps={FUNNEL_STEPS.map((f, i) => ({ label: f.label, value: t.totals[f.key], rate: i ? t.conversion[i - 1].rate : null }))} />
          {weeks.length > 1 && <><h3 className="label" style={{ marginTop: 16 }}>Weekly</h3>
            <Lines labels={weeks.map((w) => date(w.period, { month: "numeric", day: "numeric" }))} height={150} series={[
              { name: "Requests", values: weeks.map((w) => w.connection_requests), color: "var(--chart-1)" },
              { name: "Conversations", values: weeks.map((w) => w.conversations), color: "var(--chart-2)" },
              { name: "Proposals", values: weeks.map((w) => w.proposals), color: "var(--chart-3)" },
            ]} /></>}
        </div>
      </div>
      <div className="card">
        <header><h2>Daily log</h2></header>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th>{FUNNEL_STEPS.map((f, i) => <th key={f.key} className="num">{f.label}{i < FUNNEL_STEPS.length - 1 ? " / %" : ""}</th>)}<th className="num">No</th></tr></thead>
          <tbody>
            <tr className="stagehead"><td>Total</td>{FUNNEL_STEPS.map((f, i) => <td key={f.key} className="num">{t.totals[f.key]}{i < t.conversion.length ? <span className="faint"> · {pct(t.conversion[i].rate)}</span> : ""}</td>)}<td className="num">{t.totals.no}</td></tr>
            {rows.slice(0, 60).map((r) => <tr key={r.day}><td>{date(r.day)}</td>{FUNNEL_STEPS.map((f) => <td key={f.key} className="num">{r[f.key] || ""}</td>)}<td className="num">{r.no || ""}</td></tr>)}
          </tbody>
        </table></div>
      </div>
      <div className="card stack">
        <header><h2>Lag measures — opportunities</h2><span className="small muted">Win rate = Won ÷ (Won + Lost)</span></header>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Project #</th><th>Opportunity</th><th>Status</th><th className="hide-sm">Notes</th></tr></thead>
          <tbody>{lag.map((r) => <tr key={r.id}><td className="small">{date(r.day)}</td><td className="mono small">{r.project_number ?? ""}</td><td>{r.opportunity}</td><td><LagStatus id={r.id} status={r.status} /></td><td className="hide-sm small">{r.notes}</td></tr>)}</tbody>
        </table></div>
        <form action={addLagAction} className="row">
          <input name="opportunity" placeholder="Opportunity" required style={{ flex: 2, minWidth: 180 }} />
          <input name="project_number" placeholder="Project #" style={{ width: 110 }} />
          <select name="status" style={{ width: 150 }}>{LAG_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <input name="day" type="date" defaultValue={today} style={{ width: 160 }} />
          <button className="btn">Add</button>
        </form>
      </div>
    </div>
  );
}

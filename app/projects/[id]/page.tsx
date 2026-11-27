import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getProject, allowedProjectMoves, PROJECT_STATUS_LABEL } from "@/lib/repo/projects";
import { history } from "@/lib/repo/audit";
import { lineage } from "@/lib/flow";
import { jobListFlags, CONSULTANT_STATUSES } from "@/lib/calc/jobCost";
import { todayISO } from "@/lib/calc/util";
import { Lineage, History, ProjectPill, Kpi } from "@/components/bits";
import { Meter } from "@/components/charts";
import { projectStatusAction, phaseAction, projectHeaderAction } from "../actions";
import { CardLink } from "@/components/project/CardHost";
import { ConsultantStatus } from "./ConsultantStatus";
import { money, pct, hrs, date } from "@/lib/format";

export const dynamic = "force-dynamic";

const MOVE_LABEL: Record<string, string> = { active: "Resume", on_hold: "Put on hold", phase_complete: "Phase complete", closeout: "Start closeout", archived: "Archive (end of life)" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const data = await getProject(db, id);
  if (!data) notFound();
  const { project: p, phases, consultants, entries, cost: c } = data;
  const today = todayISO();
  const [chain, hist, precedents] = await Promise.all([
    lineage(db, "project", id), history(db, "project", id),
    db.query<{ id: string; file: string; project_name: string | null; total_fee: number | null; construction_cost: number | null; fee_pct_of_construction: number | null; building_type: string | null }>(
      `select id, file, project_name, total_fee, construction_cost, fee_pct_of_construction, building_type from fee_precedents where project_number = $1`, [p.job_number]),
  ]);
  const ro = p.status === "archived";
  const inScope = c.phases.filter((ph) => ph.feePct > 0 || ph.hoursAssigned > 0 || ph.hoursCompleted !== 0 || ph.phase === c.currentPhase);
  const disciplines = [...new Set(consultants.map((x) => x.discipline))];
  return (
    <div className="stack">
      <div className="pagehead">
        <div>
          <div className="small muted"><Link href="/projects">Job list</Link> / {p.job_number} · <CardLink id={id}>Open card</CardLink></div>
          <h1>{p.job_number} · {p.name}</h1>
          <p className="row" style={{ gap: 8 }}><ProjectPill s={p.status} /><span>{c.currentPhase ?? "No phase selected"}</span>{p.lead && <span>· Lead {p.lead}</span>}{p.team && <span className="muted">· {p.team}</span>}</p>
        </div>
        <div className="row">{allowedProjectMoves(p.status).map((s) => (
          <form key={s} action={projectStatusAction.bind(null, id, s)}><button className={`btn ${s === "closeout" || s === "archived" ? "" : "ghost"}`}>{MOVE_LABEL[s]}</button></form>
        ))}</div>
      </div>
      {ro && <p className="notice">Archived on {date(p.archived_at)}. Read-only — move it back to closeout to change anything.</p>}

      <div className="grid g4">
        <Kpi label="Total fee" value={money(c.totalFee)} sub={`architecture ${money(c.archFee)} + consultants ${money(c.consultantTotal)}`} />
        <Kpi label="Hours allowance" value={hrs(c.hoursAllowance)} sub={`budget ${money(c.totalBudget)} ÷ ${money(c.burdenRate)}/h burden · profit ${money(c.expectedProfit)}`} />
        <Kpi label="Hours worked" value={hrs(c.hoursCompleted)} sub={`of ${hrs(c.hoursAssigned)} assigned · ${pct(c.burn)}`} />
        <Kpi label="Budget used" value={pct(c.budgetUsed)} sub={`${money(c.hoursCompleted * c.burdenRate)} at burden rate`} />
      </div>
      {c.warnings.length > 0 && <p className="notice">{c.warnings.join(" ")}</p>}

      <div className="grid g-side">
        <div className="stack">
          <div className="card">
            <header><h2>Phases</h2><span className="small muted">fee % of architecture · hours % of allowance</span></header>
            <div className="tablewrap"><table>
              <thead><tr><th>Phase</th><th className="num">Fee</th><th className="num">Assigned</th><th className="num">Worked</th><th className="num">Left</th><th style={{ width: 120 }} className="hide-sm">Burn</th><th className="hide-sm">Target</th><th className="hide-sm">Consultants</th></tr></thead>
              <tbody>{inScope.map((ph) => {
                const f = jobListFlags({ target_date: ph.targetDate, hours_assigned: ph.hoursAssigned, hours_remaining: ph.hoursRemaining }, today);
                return (
                  <tr key={ph.phase} style={ph.phase === c.currentPhase ? { background: "var(--accent-soft)" } : undefined}>
                    <td>{ph.phase}<div className="small faint">{ph.status === "complete" ? "complete" : ph.phase === c.currentPhase ? "current" : ""}{ph.latestNote ? ` · ${ph.latestNote}` : ""}</div></td>
                    <td className="num">{money(ph.phaseTotalFee)}<div className="small faint">{pct(ph.feePct)}</div></td>
                    <td className="num">{hrs(ph.hoursAssigned)}</td>
                    <td className="num">{hrs(ph.hoursCompleted)}</td>
                    <td className="num"><span className={f.hoursLow ? "hl-bad" : ""}>{hrs(ph.hoursRemaining)}</span></td>
                    <td className="hide-sm">{ph.hoursAssigned > 0 ? <Meter value={ph.hoursCompleted} max={ph.hoursAssigned} warnAt={0.9} /> : null}</td>
                    <td className="hide-sm small"><span className={f.date === "overdue" ? "hl-bad" : f.date === "soon" ? "hl-soon" : ""}>{date(ph.targetDate)}</span></td>
                    <td className="hide-sm small">{ph.consultantStatus === "None" ? <span className="faint">—</span> : ph.consultantStatus === "NO STATUS HAS BEEN SELECTED" ? <span className="pill warn">no status yet</span> : ph.consultantStatus}</td>
                  </tr>);
              })}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{money(c.phases.reduce((a, x) => a + x.phaseTotalFee, 0))}</td><td className="num">{hrs(c.hoursAssigned)}</td><td className="num">{hrs(c.hoursCompleted)}</td><td className="num">{hrs(c.hoursRemaining)}</td><td className="hide-sm" /><td className="hide-sm" /><td className="hide-sm" /></tr></tfoot>
            </table></div>
            {!ro && <details style={{ marginTop: 12 }}>
              <summary className="small" style={{ cursor: "pointer" }}>Edit a phase (hours, target date, split, make current)</summary>
              <div className="stack" style={{ marginTop: 10 }}>{phases.map((ph) => (
                <form key={ph.id} action={phaseAction.bind(null, id, ph.phase)} className="row small">
                  <b style={{ width: 190 }}>{ph.phase}</b>
                  <label className="row">Fee %<input name="fee_pct" defaultValue={ph.fee_pct === null ? "" : +(ph.fee_pct * 100).toFixed(3)} style={{ width: 70 }} /></label>
                  <label className="row">Hours %<input name="hours_pct" defaultValue={ph.hours_pct === null ? "" : +(ph.hours_pct * 100).toFixed(3)} style={{ width: 70 }} /></label>
                  <label className="row">Assigned<input name="hours_assigned" defaultValue={ph.hours_assigned ?? ""} style={{ width: 80 }} /></label>
                  <label className="row">Target<input name="target_date" type="date" defaultValue={ph.target_date ?? ""} style={{ width: 150 }} /></label>
                  <label className="row"><input type="checkbox" name="status" value="active" defaultChecked={ph.phase === c.currentPhase} /> current</label>
                  <button className="btn sm">Save</button>
                </form>))}</div>
            </details>}
          </div>

          {disciplines.length > 0 && (() => {
            const cols = [...new Set(consultants.map((x) => x.phase))].sort((a, b) => (phases.find((p) => p.phase === a)?.sort ?? 99) - (phases.find((p) => p.phase === b)?.sort ?? 99));
            const statusPhase = cols.includes(c.currentPhase ?? "") ? c.currentPhase! : cols[cols.length - 1];
            return (
              <div className="card">
                <header><h2>Consultants</h2><span className="small muted">fee by phase · status for {statusPhase}</span></header>
                <div className="tablewrap"><table>
                  <thead><tr><th>Discipline</th>{cols.map((ph) => <th key={ph} className="num hide-sm">{ph.replace("Construction ", "Const. ")}</th>)}<th className="num">Total</th><th>Status</th></tr></thead>
                  <tbody>{disciplines.map((d) => {
                    const rows = consultants.filter((x) => x.discipline === d);
                    const cur = rows.find((x) => x.phase === statusPhase);
                    return (
                      <tr key={d}>
                        <td>{d}{rows[0].firm ? <div className="small faint">{rows[0].firm}</div> : null}</td>
                        {cols.map((ph) => <td key={ph} className="num hide-sm small">{rows.find((x) => x.phase === ph) ? money(rows.find((x) => x.phase === ph)!.fee) : ""}</td>)}
                        <td className="num">{money(rows.reduce((a, x) => a + Number(x.fee ?? 0), 0))}</td>
                        <td>{cur ? (ro ? cur.status ?? "—" : <ConsultantStatus id={id} discipline={d} phase={statusPhase} status={cur.status} options={[...CONSULTANT_STATUSES]} />) : <span className="faint small">—</span>}</td>
                      </tr>);
                  })}</tbody>
                </table></div>
              </div>);
          })()}

          <div className="card">
            <header><h2>Hours log</h2><span className="small muted">{entries.length} entries</span></header>
            {!ro && <p className="row" style={{ marginBottom: 12 }}><CardLink id={id} className="btn primary">Log hours</CardLink><span className="small muted">Opens the job card: pick the day, phase and hours, add details. <Link href="/timesheet">My timesheet</Link> logs a whole week at once.</span></p>}
            <div className="tablewrap" style={{ maxHeight: 420, overflowY: "auto" }}><table>
              <thead><tr><th>Day / week</th><th>Phase</th><th>Who</th><th className="num">Hours</th><th className="hide-sm">Notes</th></tr></thead>
              <tbody>{[...entries].sort((a, b) => String(b.work_date ?? b.week_ending ?? "").localeCompare(String(a.work_date ?? a.week_ending ?? ""))).map((e) => <tr key={e.id}><td className="small">{e.work_date ? date(e.work_date, { weekday: "short", month: "short", day: "numeric" }) : e.week_ending ? `wk ${date(e.week_ending)}` : e.week_label}</td><td className="small">{e.phase}</td><td className="small">{e.person}</td><td className="num">{hrs(e.hours)}</td><td className="hide-sm small">{e.notes}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>

        <aside className="stack">
          <div className="card"><h2>Linked records</h2><Lineage chain={chain} here="project" /></div>
          <form action={projectHeaderAction.bind(null, id)} className="card stack">
            <h2>Job cost header</h2>
            <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              {([["name", "Project name", p.name], ["lead", "Project lead", p.lead], ["team", "Project team", p.team], ["client_text", "Client", p.client_text], ["client_contact", "Client contact", p.client_contact], ["contractor", "Contractor", p.contractor], ["contractor_contact", "Contractor contact", p.contractor_contact]] as const).map(([k, l, v]) => (
                <label key={k} className="f"><span>{l}</span><input name={k} defaultValue={v ?? ""} /></label>
              ))}
              <input type="hidden" name="client_contact_2" defaultValue={p.client_contact_2 ?? ""} />
              <label className="f"><span>Contract date</span><input name="contract_date" type="date" defaultValue={p.contract_date ?? ""} /></label>
              <div className="fields">
                <label className="f"><span>Architectural fee</span><input name="arch_fee" defaultValue={p.arch_fee ?? ""} inputMode="decimal" /></label>
                <label className="f"><span>Profit % (cost share)</span><input name="profit_pct" defaultValue={+(p.profit_pct * 100).toFixed(2)} inputMode="decimal" /></label>
                <label className="f"><span>Burden rate $/h</span><input name="burden_rate" defaultValue={p.burden_rate} inputMode="decimal" /></label>
              </div>
              <label className="f"><span>Billing</span><input name="billing_notes" defaultValue={p.billing_notes ?? ""} /></label>
              <label className="f"><span>Notes</span><textarea name="notes" defaultValue={p.notes ?? ""} style={{ minHeight: 70 }} /></label>
              <div><button className="btn">Save</button></div>
            </fieldset>
          </form>
          {precedents.length > 0 && (
            <div className="card"><h2>Past proposals for this job</h2>
              <ul className="small" style={{ paddingLeft: 16 }}>{precedents.map((x) => <li key={x.id}>{x.project_name ?? x.file}<div className="faint">{x.total_fee ? `fee ${money(x.total_fee)}` : ""}{x.fee_pct_of_construction ? ` · ${pct(x.fee_pct_of_construction, 2)} of construction` : ""}</div></li>)}</ul>
            </div>
          )}
          <div className="card"><h2>History</h2><History rows={hist} self={id} /></div>
        </aside>
      </div>
    </div>
  );
}

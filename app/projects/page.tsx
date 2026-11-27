import Link from "next/link";
import { getDb } from "@/lib/db";
import { listProjects } from "@/lib/repo/projects";
import { jobListFlags } from "@/lib/calc/jobCost";
import { todayISO } from "@/lib/calc/util";
import { ProjectPill } from "@/components/bits";
import { Kpi } from "@/components/bits";
import { hrs, date, money, compactMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job list" };

export default async function Projects({ searchParams }: { searchParams: Promise<{ show?: string; lead?: string }> }) {
  const { show = "open", lead } = await searchParams;
  const db = await getDb();
  const today = todayISO();
  const all = await listProjects(db, { includeArchived: true });
  const list = all.filter(({ project: p }) => (show === "archived" ? p.status === "archived" : show === "all" ? true : p.status !== "archived") && (!lead || p.lead === lead));
  const leads = [...new Set(all.map((x) => x.project.lead).filter(Boolean))].sort() as string[];
  const open = all.filter((x) => x.project.status !== "archived");
  const fee = open.reduce((a, x) => a + x.cost.totalFee, 0);
  const low = open.filter((x) => x.cost.current && jobListFlags({ hours_assigned: x.cost.current.hoursAssigned, hours_remaining: x.cost.current.hoursRemaining }, today).hoursLow).length;
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Job list</h1><p>Current phase, hours and consultants for every job — the “Update Job List” macro, always up to date.</p></div></div>
      <div className="grid g4">
        <Kpi label="Open jobs" value={open.length} sub={`${open.filter((x) => x.project.status === "closeout").length} in closeout`} />
        <Kpi label="Fees on the books" value={compactMoney(fee)} sub="where a fee is entered" />
        <Kpi label="Hours worked (open jobs)" value={hrs(open.reduce((a, x) => a + x.cost.hoursCompleted, 0))} />
        <Kpi label="Low on hours" value={low} sub="≤ 10% of the phase’s hours left" />
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {[["open", "Open"], ["archived", "Archived"], ["all", "All"]].map(([k, v]) => <a key={k} className={`btn sm ${show === k ? "primary" : ""}`} href={`?show=${k}${lead ? `&lead=${lead}` : ""}`}>{v}</a>)}
          <span className="spacer" />
          <span className="small muted">Lead</span>
          {leads.map((l) => <a key={l} className={`btn sm ${lead === l ? "primary" : "ghost"}`} href={`?show=${show}${lead === l ? "" : `&lead=${l}`}`}>{l}</a>)}
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Job</th><th className="hide-sm">Lead / team</th><th>Phase</th><th className="hide-sm">Target</th><th className="num">Assigned</th><th className="num">Worked</th><th className="num">Remaining</th><th className="hide-sm">Consultants</th><th className="hide-sm">Notes</th></tr></thead>
          <tbody>{list.map(({ project: p, cost: c }) => {
            const cur = c.current;
            const f = jobListFlags({ target_date: cur?.targetDate, hours_assigned: cur?.hoursAssigned, hours_remaining: cur?.hoursRemaining }, today);
            return (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`} className="mono">{p.job_number}</Link> {p.status !== "active" && <ProjectPill s={p.status} />}<div className="small">{p.name}</div></td>
                <td className="hide-sm small">{p.lead ?? "—"}<div className="faint">{p.team}</div></td>
                <td className="small">{c.currentPhase ?? "—"}</td>
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
        <p className="small faint" style={{ marginTop: 10 }}>Target date turns yellow within 7 days and red when due; hours remaining turns red at 10% or less — same rules as the workbook. Fee total {money(fee)}.</p>
      </div>
    </div>
  );
}

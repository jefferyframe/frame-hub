import Link from "next/link";
import { getDb } from "@/lib/db";
import { listOpportunities, applyAutoAdvance } from "@/lib/repo/opportunities";
import { getSettings } from "@/lib/repo/settings";
import { pipelineSummary, stageBucket, totalBid, followUpAlert, isOpen, PIPELINE_STATUSES } from "@/lib/calc/sales";
import { todayISO } from "@/lib/calc/util";
import { Kpi } from "@/components/bits";
import { StatusSelect } from "./StatusSelect";
import { money, compactMoney, date, pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

const VIEWS = { open: "Open", sold: "Sold", rejected: "Rejected", all: "All" } as const;

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ view?: keyof typeof VIEWS; q?: string }> }) {
  const { view = "open", q } = await searchParams;
  const db = await getDb();
  const today = todayISO();
  await applyAutoAdvance(db, "system", today);
  const [all, settings] = await Promise.all([listOpportunities(db), getSettings(db)]);
  const s = pipelineSummary(all, settings.stageLikelihood);
  const term = (q ?? "").toLowerCase();
  const rows = all.filter((o) => {
    if (term && !`${o.name} ${o.job_number ?? ""} ${o.contact_text ?? ""} ${o.company_name ?? ""}`.toLowerCase().includes(term)) return false;
    if (view === "open") return isOpen(o.status);
    if (view === "sold") return o.status === "Sold" || o.status === "Project Completed";
    if (view === "rejected") return o.status === "Rejected";
    return true;
  });
  const groups = PIPELINE_STATUSES.map((st) => ({ st, rows: rows.filter((o) => o.status === st) })).filter((g) => g.rows.length);

  return (
    <div className="stack">
      <div className="pagehead">
        <div><h1>Sales pipeline</h1><p>Every lead from first inquiry to sold — sorted by status like the tracking sheet. Red = follow-up due; dark = gone cold.</p></div>
        <Link className="btn primary" href="/sales/new">New opportunity</Link>
      </div>
      <div className="grid g4">
        <Kpi label="Weighted pipeline" value={compactMoney(s.weightedTotal)} sub={`of ${compactMoney(s.openTotal)} open`} />
        {s.stages.filter((x) => x.key !== "triaged" || x.count).slice(0, 2).map((x) => <Kpi key={x.key} label={x.label} value={money(x.sum)} sub={`${x.count} · ${pct(x.overall)} overall likelihood`} />)}
        <Kpi label="Sold / rejected" value={`${s.soldCount} / ${s.rejectedCount}`} sub={`${compactMoney(s.soldTotal)} sold · close rate ${pct(s.closeRateCount)}`} />
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {Object.entries(VIEWS).map(([k, v]) => <Link key={k} className={`btn sm ${view === k ? "primary" : ""}`} href={`/sales?view=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>{v}</Link>)}
          <span className="spacer" />
          <form className="row"><input type="hidden" name="view" value={view} /><input name="q" defaultValue={q} placeholder="Search name, job #, contact" style={{ width: 240 }} /></form>
        </div>
        {groups.length === 0 ? <p className="empty">Nothing here.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Job #</th><th>Client / project</th><th>Status</th><th className="hide-sm">Type</th><th className="hide-sm">Received</th><th className="hide-sm">Follow-ups</th><th className="num">Total bid</th><th className="num hide-sm">Arch hrs</th></tr></thead>
            {groups.map((g) => (
              <tbody key={g.st}>
                <tr className="stagehead"><td colSpan={8}>{g.st} <span className="faint small">· {g.rows.length} · {money(g.rows.reduce((a, o) => a + totalBid(o), 0))}{stageBucket(g.st) ? "" : " · not counted in pipeline"}</span></td></tr>
                {g.rows.map((o) => {
                  const flag = followUpAlert(o, today);
                  return (
                    <tr key={o.id} className={flag === "due" ? "flag-due" : flag === "cold" ? "flag-cold" : ""}>
                      <td className="mono">{o.job_number ?? <span className="faint">—</span>}</td>
                      <td><Link href={`/sales/${o.id}`}>{o.name}</Link><div className="small faint">{[o.company_name, o.contact_name ?? o.contact_text].filter(Boolean).join(" · ")}</div></td>
                      <td><StatusSelect id={o.id} status={o.status} /></td>
                      <td className="hide-sm small">{o.project_type ?? "—"}</td>
                      <td className="hide-sm small">{date(o.date_received)}</td>
                      <td className="hide-sm small">{o.follow_up_1_date ? `1: ${date(o.follow_up_1_date, { month: "numeric", day: "numeric", year: "2-digit" })}` : ""}{o.follow_up_2_date ? ` · 2: ${date(o.follow_up_2_date, { month: "numeric", day: "numeric", year: "2-digit" })}` : ""}</td>
                      <td className="num">{money(totalBid(o))}</td>
                      <td className="num hide-sm">{o.projected_arch_hours ?? "—"}</td>
                    </tr>);
                })}
              </tbody>
            ))}
          </table></div>
        )}
      </div>
    </div>
  );
}

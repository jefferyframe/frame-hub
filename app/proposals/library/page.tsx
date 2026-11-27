import { getDb } from "@/lib/db";
import { saveTemplateAction } from "../libraryActions";
import { money, pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Line items & precedents" };

const KIND: Record<string, string> = { phase: "Phases", consultant: "Engineers", additional_service: "Additional services", reimbursable: "Reimbursables", exclusion: "Exclusions", clause: "Clauses" };

export default async function Library({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const { cat } = await searchParams;
  const db = await getDb();
  const [items, stats, prec] = await Promise.all([
    db.query<{ id: string; kind: string; label: string; description: string | null; default_pct: number | null; default_amount: number | null; active: boolean }>(`select * from line_item_templates order by kind, sort`),
    db.query<{ category: string | null; n: number; with_pct: number; median_pct: number | null; median_fee: number | null; min_fee: number | null; max_fee: number | null }>(
      `select category, count(*)::int n, count(fee_pct_of_construction)::int with_pct,
         percentile_cont(0.5) within group (order by fee_pct_of_construction) as median_pct,
         percentile_cont(0.5) within group (order by total_fee) as median_fee, min(total_fee) as min_fee, max(total_fee) as max_fee
       from fee_precedents where is_frame_proposal group by category order by n desc`),
    db.query<{ id: string; project_number: string | null; project_name: string | null; file: string; building_type: string | null; delivery_type: string | null; construction_cost: number | null; total_fee: number | null; fee_pct_of_construction: number | null; fee_pct_derived: boolean; job_id: string | null }>(
      `select f.*, p.id as job_id from fee_precedents f left join projects p on p.job_number = f.project_number
       where f.is_frame_proposal and ($1::text is null or f.category = $1) order by f.project_number desc nulls last limit 200`, [cat ?? null]),
  ]);
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Line items & precedents</h1><p>Reusable proposal lines, and the benchmark library of Frame’s past proposals that drives fee suggestions.</p></div></div>
      <div className="card">
        <header><h2>Fee benchmarks by building category</h2><span className="small muted">from {stats.reduce((a, s) => a + s.n, 0)} past Frame proposals</span></header>
        <div className="tablewrap"><table>
          <thead><tr><th>Category</th><th className="num">Proposals</th><th className="num">With fee %</th><th className="num">Median fee % of construction</th><th className="num">Median fee</th><th className="num hide-sm">Range</th></tr></thead>
          <tbody>{stats.map((s) => (
            <tr key={s.category ?? "none"}><td><a href={`?cat=${s.category ?? ""}`}>{(s.category ?? "uncategorized").replace("_", " ")}</a></td><td className="num">{s.n}</td><td className="num">{s.with_pct}</td><td className="num">{pct(s.median_pct, 2)}</td><td className="num">{money(s.median_fee)}</td><td className="num hide-sm small">{money(s.min_fee)} – {money(s.max_fee)}</td></tr>))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <header><h2>Past proposals{cat ? ` · ${cat.replace("_", " ")}` : ""}</h2>{cat && <a className="small" href="?">Show all</a>}</header>
        <div className="tablewrap" style={{ maxHeight: 520, overflowY: "auto" }}><table>
          <thead><tr><th>Job #</th><th>Project</th><th className="hide-sm">Building type</th><th className="num">Construction</th><th className="num">Total fee</th><th className="num">Fee %</th></tr></thead>
          <tbody>{prec.map((p) => (
            <tr key={p.id}><td className="mono small">{p.job_id ? <a href={`/projects/${p.job_id}`}>{p.project_number}</a> : p.project_number ?? "—"}</td><td>{p.project_name ?? p.file}</td><td className="hide-sm small">{p.building_type}{p.delivery_type ? ` · ${p.delivery_type}` : ""}</td>
              <td className="num">{money(p.construction_cost)}</td><td className="num">{money(p.total_fee)}</td><td className="num">{pct(p.fee_pct_of_construction, 2)}{p.fee_pct_derived ? <span className="faint">*</span> : ""}</td></tr>))}</tbody>
        </table></div>
        <p className="small faint">* fee % computed from total fee ÷ construction cost. Linked job numbers open the project.</p>
      </div>
      <div className="card">
        <header><h2>Reusable line items</h2></header>
        {Object.keys(KIND).filter((k) => items.some((i) => i.kind === k)).map((k) => (
          <div key={k} style={{ marginBottom: 16 }}>
            <h3 className="label">{KIND[k]}</h3>
            {items.filter((i) => i.kind === k).map((i) => (
              <form key={i.id} action={saveTemplateAction.bind(null, i.id)} className="row small" style={{ marginBottom: 6 }}>
                <input name="label" defaultValue={i.label} style={{ width: 220 }} />
                <input name="description" defaultValue={i.description ?? ""} placeholder="Description used when the line is added" style={{ flex: 1, minWidth: 200 }} />
                {(k === "phase" || k === "consultant") && <input name="default_pct" defaultValue={i.default_pct === null ? "" : +(i.default_pct * 100).toFixed(3)} placeholder="%" style={{ width: 70 }} />}
                <label className="row"><input type="checkbox" name="active" defaultChecked={i.active} /> on</label>
                <button className="btn sm">Save</button>
              </form>))}
          </div>
        ))}
        <form action={saveTemplateAction.bind(null, null)} className="row small">
          <select name="kind" style={{ width: 180 }}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input name="label" placeholder="New line item" required style={{ width: 220 }} />
          <input name="description" placeholder="Description" style={{ flex: 1, minWidth: 200 }} />
          <input type="hidden" name="active" value="on" />
          <button className="btn sm primary">Add</button>
        </form>
      </div>
    </div>
  );
}

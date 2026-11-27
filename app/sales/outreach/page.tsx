import { getDb } from "@/lib/db";
import { addOutreachAction } from "../actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach" };

const KINDS = { cre_firm: "CRE firms", bagels: "Bagels delivered", direct_sales: "Direct sales", biz_dev: "Biz-dev notes" } as const;
type Kind = keyof typeof KINDS;

export default async function Outreach({ searchParams }: { searchParams: Promise<{ k?: Kind }> }) {
  const { k = "cre_firm" } = await searchParams;
  const db = await getDb();
  const counts = await db.query<{ kind: Kind; n: number }>(`select kind, count(*)::int n from outreach group by kind`);
  const rows = await db.query<{ id: string; label: string; day: string | null; period: string | null; status: string | null; phone: string | null; address: string | null; notes: string | null; author: string | null }>(
    `select * from outreach where kind = $1 order by period desc nulls last, day desc nulls last, created_at`, [k]);
  const periods = [...new Set(rows.map((r) => r.period ?? ""))];
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Outreach</h1><p>Presentations to CRE firms, bagel drops, direct sales and business-development notes.</p></div></div>
      <div className="row">{(Object.keys(KINDS) as Kind[]).map((x) => <a key={x} className={`btn sm ${k === x ? "primary" : ""}`} href={`?k=${x}`}>{KINDS[x]} <span className="faint">{counts.find((c) => c.kind === x)?.n ?? 0}</span></a>)}</div>
      <div className="card">
        {rows.length === 0 ? <p className="empty">Nothing logged yet.</p> : k === "biz_dev" ? periods.map((pd) => (
          <div key={pd} style={{ marginBottom: 14 }}><h3 className="label">{pd || "Undated"}</h3><ul>{rows.filter((r) => (r.period ?? "") === pd).map((r) => <li key={r.id}>{r.notes ?? r.label}{r.author ? <span className="faint small"> — {r.author}</span> : null}</li>)}</ul></div>
        )) : (
          <div className="tablewrap"><table>
            <thead><tr><th>{k === "cre_firm" ? "Firm" : "Company"}</th>{k === "cre_firm" && <><th className="hide-sm">Phone</th><th className="hide-sm">Address</th></>}<th>{k === "cre_firm" ? "Booked / status" : "Date"}</th><th>Notes</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{r.label}</td>{k === "cre_firm" && <><td className="hide-sm small">{r.phone}</td><td className="hide-sm small">{r.address}</td></>}
                <td className="small">{k === "cre_firm" ? (r.day ? date(r.day) : r.status ?? "—") : date(r.day)}</td><td className="small">{k === "cre_firm" && !r.day ? "" : r.notes}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>
      <form action={addOutreachAction} className="card stack">
        <h2>Log outreach</h2>
        <input type="hidden" name="kind" value={k} />
        <div className="fields">
          <label className="f"><span>{k === "biz_dev" ? "Headline" : "Company / firm"}</span><input name="label" required /></label>
          <label className="f"><span>Date</span><input name="day" type="date" /></label>
          {k === "cre_firm" && <><label className="f"><span>Phone</span><input name="phone" /></label><label className="f"><span>Address</span><input name="address" /></label><label className="f"><span>Status</span><input name="status" placeholder="e.g. Reached out 2/15" /></label></>}
          <label className="f wide"><span>Notes</span><input name="notes" /></label>
        </div>
        <div><button className="btn primary">Save</button></div>
      </form>
    </div>
  );
}

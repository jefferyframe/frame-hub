import Link from "next/link";
import { getDb } from "@/lib/db";
import { ProposalPill } from "@/components/bits";
import { computeProposal } from "@/lib/calc/proposal";
import type { Proposal, ProposalItem } from "@/lib/repo/types";
import { money, date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposals" };

export default async function Proposals() {
  const db = await getDb();
  const list = await db.query<Proposal & { company_name: string | null; opp_status: string | null }>(
    `select p.*, c.name as company_name, o.status as opp_status from proposals p left join companies c on c.id = p.company_id
     left join opportunities o on o.id = p.opportunity_id where p.is_current order by p.updated_at desc`);
  const items = await db.query<ProposalItem>(`select * from proposal_items where proposal_id = any($1)`, [list.map((p) => p.id)]);
  return (
    <div className="stack">
      <div className="pagehead">
        <div><h1>Proposals</h1><p>Build the fee, approve it, send a branded proposal, then hand it to the sales pipeline in one click.</p></div>
        <Link className="btn primary" href="/proposals/new">New proposal</Link>
      </div>
      <div className="card">
        {list.length === 0 ? <p className="empty">No proposals yet.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Proposal</th><th>Client</th><th className="num hide-sm">Construction</th><th className="num">Total fee</th><th>Status</th><th className="hide-sm">Pipeline</th><th className="hide-sm">Updated</th></tr></thead>
            <tbody>{list.map((p) => {
              const t = computeProposal(p, items.filter((i) => i.proposal_id === p.id));
              return (
                <tr key={p.id}>
                  <td><Link href={`/proposals/${p.id}`}>{p.title}</Link><div className="small faint">{p.number} · v{p.version}</div></td>
                  <td>{p.client?.name || p.company_name || "—"}<div className="small faint">{p.client?.contact_name}</div></td>
                  <td className="num hide-sm">{money(p.construction_cost)}</td>
                  <td className="num">{money(t.total)}</td>
                  <td><ProposalPill s={p.status} /></td>
                  <td className="hide-sm small">{p.opp_status ?? <span className="faint">—</span>}</td>
                  <td className="hide-sm small muted">{date(p.updated_at)}</td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

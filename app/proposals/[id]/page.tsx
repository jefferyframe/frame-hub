import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getProposal } from "@/lib/repo/proposals";
import { getSettings } from "@/lib/repo/settings";
import { history } from "@/lib/repo/audit";
import { lineage } from "@/lib/flow";
import { Lineage, History, ProposalPill } from "@/components/bits";
import { ProposalEditor } from "./Editor";
import { StatusActions } from "./StatusActions";
import { aiConfigured } from "@/lib/ai";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const data = await getProposal(db, id);
  if (!data) notFound();
  const { proposal: p, items, versions } = data;
  const [settings, library, chain, hist] = await Promise.all([
    getSettings(db),
    db.query<{ kind: string; label: string; description: string | null; default_pct: number | null; default_amount: number | null }>(
      `select kind, label, description, default_pct, default_amount from line_item_templates where active order by kind, sort`),
    lineage(db, "proposal", id),
    history(db, "proposal", id),
  ]);
  const editable = ["draft", "in_review", "approved"].includes(p.status) && p.is_current;
  const plain = JSON.parse(JSON.stringify({ p, items })); // dates → strings for the client component
  return (
    <div className="stack">
      <div className="pagehead">
        <div>
          <div className="small muted"><Link href="/proposals">Proposals</Link> / {p.number}</div>
          <h1>{p.title}</h1>
          <p className="row" style={{ gap: 8 }}><ProposalPill s={p.status} /> <span>Version {p.version}</span>{p.valid_until && <span>· valid until {date(p.valid_until)}</span>}</p>
        </div>
        <div className="row noprint">
          <Link className="btn" href={`/proposals/${id}/preview`}>Preview</Link>
          <a className="btn" href={`/api/proposals/${id}/pdf`}>PDF</a>
        </div>
      </div>
      <div className="grid g-side">
        <ProposalEditor key={`${p.status}-${new Date(p.updated_at).getTime()}`} proposal={plain.p} items={plain.items} library={library} editable={editable} aiOn={aiConfigured()}
          settings={{ profitPct: settings.profitPct, burdenRate: settings.burdenRate }} />
        <aside className="stack">
          <div className="card stack">
            <h2>Next step</h2>
            <StatusActions id={id} status={p.status} isCurrent={p.is_current} hasOpportunity={!!p.opportunity_id} token={p.public_token} />
          </div>
          <div className="card"><h2>Linked records</h2><Lineage chain={chain} here="proposal" /></div>
          {versions.length > 1 && (
            <div className="card"><h2>Versions</h2>
              <table className="small"><tbody>{versions.map((v) => (
                <tr key={v.id}><td>{v.id === id ? <b>v{v.version}</b> : <Link href={`/proposals/${v.id}`}>v{v.version}</Link>}</td><td><ProposalPill s={v.status} /></td><td className="faint">{date(v.updated_at)}</td></tr>
              ))}</tbody></table>
            </div>
          )}
          <div className="card"><h2>History</h2><History rows={hist} self={id} /></div>
        </aside>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { one } from "@/lib/db/types";
import { currentUser } from "@/lib/auth";
import { RecordCrm } from "@/components/crm/RecordCrm";
import { StatusPill } from "@/components/bits";
import { date } from "@/lib/format";
import { totalBid } from "@/lib/calc/sales";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const c = await one<{ id: string; full_name: string; title: string | null; email: string | null; phone: string | null; company_id: string | null; company: string | null; is_past_client: boolean; met_on: string | null; notes: string | null; best_contact_method: string | null }>(db,
    `select c.*, co.name as company from contacts c left join companies co on co.id = c.company_id where c.id = $1`, [id]);
  if (!c) notFound();
  const deals = await db.query<{ id: string; name: string; status: string; subs_cost: number | null; design_fee: number | null; total_bid_override: number | null }>(`select id, name, status, subs_cost, design_fee, total_bid_override from opportunities where contact_id = $1 order by updated_at desc`, [id]);
  const user = (await currentUser())!;
  return (
    <div className="stack">
      <div className="pagehead"><div>
        <div className="small muted"><Link href="/sales/contacts">Contacts</Link>{c.company_id && <> / <Link href={`/crm/companies/${c.company_id}`}>{c.company}</Link></>}</div>
        <h1>{c.full_name || c.email || "Contact"}</h1>
        <p className="row" style={{ gap: 8 }}>{c.title && <span>{c.title}</span>}{c.is_past_client && <span className="pill ok">past client</span>}{c.met_on && <span className="small muted">met {date(c.met_on)}</span>}</p>
      </div></div>
      <div className="grid g-side rec">
        <RecordCrm db={db} kind="contact" id={id} label={c.full_name || c.email || "Contact"} userName={user.name} />
        <aside className="stack">
          <div className="card stack" style={{ gap: 6 }}>
            <h2>Contact</h2>
            {c.email && <div><a href={`mailto:${c.email}`}>{c.email}</a></div>}
            {c.phone && <div><a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></div>}
            {c.best_contact_method && <div className="small muted">Prefers {c.best_contact_method}</div>}
            {c.notes && <p className="small">{c.notes}</p>}
            {!c.email && !c.phone && <p className="small muted">No email or phone yet.</p>}
          </div>
          <div className="card"><h2>Deals</h2>{deals.length ? <ul className="plain">{deals.map((d) => <li key={d.id}><Link href={`/sales/${d.id}`}>{d.name}</Link> <StatusPill s={d.status} /> <span className="small muted">{money(totalBid(d))}</span></li>)}</ul> : <p className="small muted">None.</p>}</div>
        </aside>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { one } from "@/lib/db/types";
import { currentUser } from "@/lib/auth";
import { RecordCrm } from "@/components/crm/RecordCrm";
import { StatusPill } from "@/components/bits";
import { totalBid } from "@/lib/calc/sales";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const c = await one<{ id: string; name: string; kind: string; phone: string | null; address: string | null; website: string | null; notes: string | null }>(db, `select * from companies where id = $1`, [id]);
  if (!c) notFound();
  const [people, deals, jobs] = await Promise.all([
    db.query<{ id: string; full_name: string; title: string | null; email: string | null }>(`select id, full_name, title, email from contacts where company_id = $1 order by last_name nulls last`, [id]),
    db.query<{ id: string; name: string; status: string; subs_cost: number | null; design_fee: number | null; total_bid_override: number | null }>(`select id, name, status, subs_cost, design_fee, total_bid_override from opportunities where company_id = $1 order by updated_at desc`, [id]),
    db.query<{ id: string; job_number: string; name: string }>(`select id, job_number, name from projects where company_id = $1 order by job_number desc`, [id]),
  ]);
  const user = (await currentUser())!;
  return (
    <div className="stack">
      <div className="pagehead"><div>
        <div className="small muted"><Link href="/crm/companies">Companies</Link></div>
        <h1>{c.name}</h1>
        <p className="row" style={{ gap: 8 }}><span className="pill">{c.kind.replace("_", " ")}</span>{c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a>}{c.website && <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer">{c.website}</a>}</p>
      </div></div>
      <div className="grid g-side rec">
        <RecordCrm db={db} kind="company" id={id} label={c.name} userName={user.name} />
        <aside className="stack">
          <div className="card"><h2>People</h2>{people.length ? <ul className="plain">{people.map((p) => <li key={p.id}><Link href={`/crm/contacts/${p.id}`}>{p.full_name || p.email}</Link>{p.title && <span className="small muted"> · {p.title}</span>}</li>)}</ul> : <p className="small muted">No contacts yet.</p>}</div>
          <div className="card"><h2>Deals</h2>{deals.length ? <ul className="plain">{deals.map((d) => <li key={d.id}><Link href={`/sales/${d.id}`}>{d.name}</Link> <StatusPill s={d.status} /> <span className="small muted">{money(totalBid(d))}</span></li>)}</ul> : <p className="small muted">None.</p>}</div>
          {jobs.length > 0 && <div className="card"><h2>Projects</h2><ul className="plain">{jobs.map((j) => <li key={j.id}><Link href={`/projects/${j.id}`}>{j.job_number}</Link> <span className="small">{j.name}</span></li>)}</ul></div>}
          {(c.address || c.notes) && <div className="card"><h2>Notes</h2>{c.address && <p className="small">{c.address}</p>}{c.notes && <p className="small">{c.notes}</p>}</div>}
        </aside>
      </div>
    </div>
  );
}

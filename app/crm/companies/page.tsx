import Link from "next/link";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

export default async function Companies({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string; kind: string; people: number; deals: number; open_tasks: number; last: Date | null }>(
    `select co.id, co.name, co.kind,
       (select count(*)::int from contacts c where c.company_id = co.id) people,
       (select count(*)::int from opportunities o where o.company_id = co.id) deals,
       (select count(*)::int from tasks t where t.company_id = co.id and t.done_at is null) open_tasks,
       (select max(occurred_at) from activities a where a.company_id = co.id) as last
     from companies co where ($1::text is null or lower(co.name) like '%' || lower($1::text) || '%') order by lower(co.name) limit 500`, [q?.trim() || null]);
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Companies</h1><p>{rows.length} shown · open one for its people, deals, tasks and timeline.</p></div>
        <form><input name="q" defaultValue={q} placeholder="Search companies" style={{ width: 220 }} /></form></div>
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>Company</th><th className="hide-sm">Type</th><th className="num">People</th><th className="num">Deals</th><th className="num hide-sm">Open tasks</th><th className="hide-sm">Last activity</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td><Link href={`/crm/companies/${r.id}`}>{r.name}</Link></td><td className="hide-sm small">{r.kind.replace("_", " ")}</td><td className="num">{r.people}</td><td className="num">{r.deals}</td><td className="num hide-sm">{r.open_tasks || ""}</td>
            <td className="hide-sm small">{r.last ? new Date(r.last).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }) : ""}</td></tr>))}</tbody>
      </table></div>{rows.length === 0 && <p className="empty">No companies match.</p>}</div>
    </div>
  );
}

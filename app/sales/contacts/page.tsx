import { getDb } from "@/lib/db";
import { addContactAction, makePastClientAction } from "../actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacts" };

type Row = { id: string; full_name: string; title: string | null; email: string | null; phone: string | null; company: string | null; company_kind: string | null; is_past_client: boolean; past_client_since: string | null; met_on: string | null; linkedin_connected: string | null; card_sent: string | null; notes: string | null; open_tasks: number; next_due: string | null };

export default async function Contacts({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const { show = "all", q } = await searchParams;
  const db = await getDb();
  const rows = await db.query<Row>(
    `select c.*, co.name as company, co.kind as company_kind,
       (select count(*)::int from tasks t where t.contact_id = c.id and t.done_at is null) as open_tasks,
       (select min(due_on) from tasks t where t.contact_id = c.id and t.done_at is null) as next_due
     from contacts c left join companies co on co.id = c.company_id order by c.last_name nulls last, c.first_name`);
  const companies = await db.query<{ kind: string; n: number }>(`select kind, count(*)::int n from companies group by kind order by n desc`);
  const term = (q ?? "").toLowerCase();
  const list = rows.filter((r) => (show === "past" ? r.is_past_client : show === "prospects" ? !!r.met_on : true) && (!term || `${r.full_name} ${r.company ?? ""} ${r.email ?? ""}`.toLowerCase().includes(term)));
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Contacts</h1><p>{rows.length} people · {companies.map((c) => `${c.n} ${c.kind.replace("_", " ")}`).join(" · ")} companies</p></div></div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {[["all", "Everyone"], ["prospects", "Prospects met"], ["past", "Past clients"]].map(([k, v]) => <a key={k} className={`btn sm ${show === k ? "primary" : ""}`} href={`?show=${k}`}>{v}</a>)}
          <span className="spacer" /><form><input type="hidden" name="show" value={show} /><input name="q" defaultValue={q} placeholder="Search" style={{ width: 200 }} /></form>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Company</th><th className="hide-sm">Contact</th><th className="hide-sm">Met / client since</th><th className="hide-sm">LinkedIn · card</th><th>Next follow-up</th><th /></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id}>
              <td>{r.full_name || r.email}<div className="small faint">{r.title}</div></td>
              <td>{r.company ?? "—"}{r.is_past_client && <> <span className="pill ok">past client</span></>}</td>
              <td className="hide-sm small">{r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}<div>{r.phone}</div></td>
              <td className="hide-sm small">{r.is_past_client ? date(r.past_client_since) : date(r.met_on)}</td>
              <td className="hide-sm small">{[r.linkedin_connected, r.card_sent].filter(Boolean).join(" · ") || "—"}</td>
              <td className="small">{r.open_tasks ? `${date(r.next_due)} (${r.open_tasks})` : "—"}</td>
              <td>{!r.is_past_client && <form action={makePastClientAction.bind(null, r.id)}><button className="btn sm ghost" title="Start the 1/2/6-month cadence">Make past client</button></form>}</td>
            </tr>))}</tbody>
        </table></div>
        {r0(list.length)}
      </div>
      <form action={addContactAction} className="card stack">
        <h2>Add a contact</h2>
        <div className="fields">
          <label className="f"><span>First name</span><input name="first_name" /></label>
          <label className="f"><span>Last name</span><input name="last_name" /></label>
          <label className="f"><span>Email</span><input name="email" type="email" /></label>
          <label className="f"><span>Phone</span><input name="phone" /></label>
          <label className="f"><span>Company</span><input name="company" /></label>
          <label className="f"><span>Title</span><input name="title" /></label>
          <label className="f"><span>Type</span><select name="kind"><option value="prospect">Prospect I met</option><option value="past_client">Past client (1/2/6-month check-ins)</option><option value="other">Other</option></select></label>
          <label className="f"><span>Date we met</span><input name="met_on" type="date" /></label>
          <label className="f wide"><span>Notes</span><input name="notes" /></label>
        </div>
        <div><button className="btn primary">Add contact</button></div>
      </form>
    </div>
  );
}
const r0 = (n: number) => (n === 0 ? <p className="empty">No contacts match.</p> : null);

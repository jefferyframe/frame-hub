import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getOpportunity } from "@/lib/repo/opportunities";
import { history } from "@/lib/repo/audit";
import { lineage } from "@/lib/flow";
import { issueJobNumber } from "@/lib/repo/numbers";
import { getSettings } from "@/lib/repo/settings";
import { totalBid, stageBucket, overallLikelihoods, followUpAlert } from "@/lib/calc/sales";
import { todayISO } from "@/lib/calc/util";
import { Lineage, History, StatusPill } from "@/components/bits";
import { StatusSelect } from "../StatusSelect";
import { OppFields } from "../OppFields";
import { updateOpportunityAction, winAction, proposalFromOpportunityAction } from "../actions";
import { RecordCrm } from "@/components/crm/RecordCrm";
import { currentUser } from "@/lib/auth";
import { listTeam } from "@/lib/repo/team";
import { daysOut } from "@/lib/crm/logic";
import { money, pct, date } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const o = await getOpportunity(db, id);
  if (!o) notFound();
  const today = todayISO();
  const [chain, hist, nextNo, settings, team, user] = await Promise.all([
    lineage(db, "opportunity", id), history(db, "opportunity", id),
    issueJobNumber(db, today), getSettings(db), listTeam(db), currentUser(),
  ]);
  const out = daysOut(o.date_presented, today);
  const b = stageBucket(o.status);
  const ov = overallLikelihoods(settings.stageLikelihood);
  const likelihood = b && b in ov ? ov[b as keyof typeof ov] : b === "sold" ? 1 : b === "rejected" ? 0 : null;
  const flag = followUpAlert(o, today);
  return (
    <div className="stack">
      <div className="pagehead">
        <div>
          <div className="small muted"><Link href="/sales">Pipeline</Link> / {o.job_number ?? "no job #"}</div>
          <h1>{o.name}</h1>
          <p className="row" style={{ gap: 8 }}><StatusPill s={o.status} />{flag === "due" && <span className="pill bad">Follow-up due</span>}{flag === "cold" && <span className="pill dark">Gone cold</span>}<span>{money(totalBid(o))} bid{likelihood !== null ? ` · ${pct(likelihood)} likely · ${money(totalBid(o) * likelihood)} weighted` : ""}</span>{o.date_presented && <span className="small muted">sent {date(o.date_presented)}{out !== null && !o.closed_at ? ` · out ${out}d` : ""}</span>}</p>
        </div>
        <div className="row"><StatusSelect id={id} status={o.status} /></div>
      </div>
      <div className="grid g-side">
        <div className="stack">
        <RecordCrm db={db} kind="opportunity" id={id} label={o.name} userName={user!.name} />
        <form action={updateOpportunityAction.bind(null, id)} className="card stack">
          <header><h2>Details</h2></header>
          <label className="f"><span>Deal owner</span><select name="owner_member_id" defaultValue={o.owner_member_id ?? ""} style={{ maxWidth: 280 }}><option value="">No owner</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <OppFields o={o} />
          <div><button className="btn primary">Save</button></div>
        </form>
        </div>
        <aside className="stack">
          <div className="card stack">
            <h2>Next step</h2>
            {o.project_id ? <p>Won — <Link href={`/projects/${o.project_id}`}>project {o.project_job_number}</Link> is open.</p> : o.status === "Rejected" ? <p className="muted small">Rejected. Change the status to reopen it.</p> : (
              <form action={winAction.bind(null, id)} className="stack" style={{ gap: 8 }}>
                <p className="small muted">Won the work? This marks it Sold and opens the project with the proposal’s phases and fees.</p>
                <div className="fields">
                  <label className="f"><span>Job number</span><input name="job_number" defaultValue={o.job_number ?? nextNo} /></label>
                  <label className="f"><span>Project lead</span><input name="lead" placeholder="Name" /></label>
                </div>
                <div><button className="btn primary">Won — open project</button></div>
              </form>
            )}
            {!o.proposal_id && !o.project_id && <form action={proposalFromOpportunityAction.bind(null, id)}><button className="btn">Start a proposal</button></form>}
          </div>
          <div className="card"><h2>Linked records</h2><Lineage chain={chain} here="opportunity" /></div>
          <div className="card"><h2>History</h2><History rows={hist} self={id} /></div>
        </aside>
      </div>
    </div>
  );
}

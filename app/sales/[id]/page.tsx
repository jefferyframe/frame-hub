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
import { updateOpportunityAction, winAction, proposalFromOpportunityAction, addTaskAction, completeTaskAction } from "../actions";
import { money, pct, date } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const o = await getOpportunity(db, id);
  if (!o) notFound();
  const today = todayISO();
  const [chain, hist, tasks, nextNo, settings] = await Promise.all([
    lineage(db, "opportunity", id), history(db, "opportunity", id),
    db.query<{ id: string; title: string; due_on: string | null }>(`select id, title, due_on from tasks where opportunity_id = $1 and done_at is null order by due_on`, [id]),
    issueJobNumber(db, today), getSettings(db),
  ]);
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
          <p className="row" style={{ gap: 8 }}><StatusPill s={o.status} />{flag === "due" && <span className="pill bad">Follow-up due</span>}{flag === "cold" && <span className="pill dark">Gone cold</span>}<span>{money(totalBid(o))} bid{likelihood !== null ? ` · ${pct(likelihood)} likely · ${money(totalBid(o) * likelihood)} weighted` : ""}</span></p>
        </div>
        <div className="row"><StatusSelect id={id} status={o.status} /></div>
      </div>
      <div className="grid g-side">
        <form action={updateOpportunityAction.bind(null, id)} className="card stack">
          <header><h2>Details</h2></header>
          <OppFields o={o} />
          <div><button className="btn primary">Save</button></div>
        </form>
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
          <div className="card stack">
            <h2>Follow-ups</h2>
            {tasks.length ? tasks.map((t) => (
              <form key={t.id} action={completeTaskAction.bind(null, t.id)} className="row"><button className="btn sm" aria-label="Done">✓</button><span className="small">{t.title}</span><span className={`small ${t.due_on && t.due_on < today ? "" : "faint"}`} style={t.due_on && t.due_on < today ? { color: "var(--danger)" } : undefined}>{date(t.due_on)}</span></form>
            )) : <p className="small muted">None open.</p>}
            <form action={addTaskAction} className="row">
              <input type="hidden" name="opportunity_id" value={id} /><input type="hidden" name="back" value={`/sales/${id}`} />
              <input name="title" placeholder="Add a follow-up" style={{ flex: 1, minWidth: 140 }} /><input name="due_on" type="date" style={{ width: 150 }} /><button className="btn sm">Add</button>
            </form>
          </div>
          <div className="card"><h2>History</h2><History rows={hist} self={id} /></div>
        </aside>
      </div>
    </div>
  );
}

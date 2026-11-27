import { createOpportunityAction } from "../actions";
import { OppFields } from "../OppFields";

export const metadata = { title: "New opportunity" };
export default function NewOpp() {
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="pagehead"><div><h1>New opportunity</h1><p>Starts as “Proposal Needed”. Most fields can wait.</p></div></div>
      <form action={createOpportunityAction} className="card stack">
        <label className="f"><span>Company</span><input name="company" placeholder="Optional — links the client company" /></label>
        <OppFields />
        <div><button className="btn primary">Add to pipeline</button></div>
      </form>
    </div>
  );
}

import { newProposalAction } from "../actions";

export const metadata = { title: "New proposal" };

export default function NewProposal() {
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="pagehead"><div><h1>New proposal</h1><p>Start with the project and client — everything else is filled in on the next screen.</p></div></div>
      <form action={newProposalAction} className="card stack">
        <label className="f"><span>Project name</span><input name="title" required placeholder="e.g. Medical Office Building" autoFocus /></label>
        <label className="f"><span>Client / company</span><input name="client" placeholder="Client or company" /></label>
        <div className="row"><button className="btn primary">Create proposal</button></div>
      </form>
    </div>
  );
}

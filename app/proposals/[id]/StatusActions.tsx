"use client";
import { useTransition, useState } from "react";
import { setStatusAction, newVersionAction, toPipelineAction } from "../actions";

export function StatusActions({ id, status, isCurrent, hasOpportunity, token }: { id: string; status: string; isCurrent: boolean; hasOpportunity: boolean; token: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState(false);
  const run = (fn: () => Promise<unknown>) => start(async () => { setErr(null); try { await fn(); } catch (e) { if (!String(e).includes("NEXT_REDIRECT")) setErr((e as Error).message); else throw e; } });
  const go = (s: string) => run(() => setStatusAction(id, s));
  if (!isCurrent) return <p className="small muted">This is an older version, kept for the record.</p>;
  const url = typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : `/p/${token}`;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {status === "draft" && <><p className="small muted">When the fee is ready, send it for internal review (or approve it yourself).</p>
        <div className="row"><button className="btn" disabled={pending} onClick={() => go("in_review")}>Submit for review</button><button className="btn primary" disabled={pending} onClick={() => go("approved")}>Approve</button></div></>}
      {status === "in_review" && <><p className="small muted">Check the fee and guardrails, then approve. Changing fees after approval sends it back to review.</p>
        <div className="row"><button className="btn primary" disabled={pending} onClick={() => go("approved")}>Approve</button><button className="btn ghost" disabled={pending} onClick={() => go("draft")}>Back to draft</button></div></>}
      {status === "approved" && <><p className="small muted">Approved — download the PDF or share the client link, then mark it sent.</p>
        <div className="row"><button className="btn primary" disabled={pending} onClick={() => go("sent")}>Mark as sent</button><button className="btn ghost" disabled={pending} onClick={() => go("draft")}>Reopen</button></div></>}
      {(status === "sent" || status === "viewed") && <><p className="small muted">Waiting on the client. They can accept online from the client link.</p>
        <div className="row"><button className="btn primary" disabled={pending} onClick={() => go("accepted")}>Mark accepted</button><button className="btn danger" disabled={pending} onClick={() => go("declined")}>Declined</button></div></>}
      {status === "accepted" && <p className="small">Accepted. Win the opportunity in the pipeline to open the project.</p>}
      {["approved", "sent", "viewed", "accepted"].includes(status) && (
        <div className="row"><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(url); setLink(true); }}>{link ? "Link copied" : "Copy client link"}</button><a className="btn sm ghost" href={`/p/${token}`} target="_blank">Open client view</a></div>
      )}
      <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
      <div className="row">
        <button className="btn" disabled={pending} onClick={() => run(() => toPipelineAction(id))}>{hasOpportunity ? "Open in pipeline" : "Send to sales pipeline"}</button>
        {["sent", "viewed", "declined", "accepted", "approved", "in_review"].includes(status) && <button className="btn ghost" disabled={pending} onClick={() => run(() => newVersionAction(id))}>New version</button>}
      </div>
      {err && <p className="notice bad">{err}</p>}
    </div>
  );
}

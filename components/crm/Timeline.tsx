"use client";
import Link from "next/link";
import { useState } from "react";
import { editActivityAction, deleteActivityAction } from "@/app/crm/actions";
import { useRun, whenLabel } from "./ui";
import { canEditActivity } from "@/lib/crm/logic";
import { recordHref, type ActivityView } from "@/lib/crm/view";
import { IconNote, IconPhone, IconMail, IconUsers, IconCheck, IconFlag } from "@/components/icons";

const ICON: Record<string, () => React.ReactElement> = { note: IconNote, call: IconPhone, email: IconMail, meeting: IconUsers, task: IconCheck, stage: IconFlag };
const LABEL: Record<string, string> = { note: "Note", call: "Call", email: "Email", meeting: "Meeting", task: "Task", stage: "Update" };

/** A record's activity timeline. Authors can edit or delete their own entries. */
export function Timeline({ items, me, filterable = true }: { items: ActivityView[]; me: string; filterable?: boolean }) {
  const [only, setOnly] = useState<string>("all");
  const shown = only === "all" ? items : items.filter((a) => a.kind === only);
  const kinds = [...new Set(items.map((a) => a.kind))];
  return (
    <div>
      {filterable && kinds.length > 1 && (
        <div className="chips">
          {["all", ...kinds].map((k) => <button key={k} type="button" className="chip" data-on={only === k} onClick={() => setOnly(k)}>{k === "all" ? `All ${items.length}` : `${LABEL[k] ?? k}s`}</button>)}
        </div>
      )}
      {shown.length === 0 ? <p className="empty small">Nothing logged yet. Log a call or a note above.</p> : (
        <ol className="tl">{shown.map((a) => <Entry key={a.id} a={a} me={me} />)}</ol>
      )}
    </div>
  );
}

function Entry({ a, me }: { a: ActivityView; me: string }) {
  const { run, busy } = useRun();
  const [edit, setEdit] = useState(false);
  const [subject, setSubject] = useState(a.subject ?? "");
  const [body, setBody] = useState(a.body ?? "");
  const mine = canEditActivity(a, me);
  const I = ICON[a.kind] ?? IconNote;
  return (
    <li className="tl-i" data-kind={a.kind}>
      <span className="tl-ico"><I /></span>
      <div className="tl-b">
        <div className="tl-h">
          <b>{a.kind === "stage" || a.kind === "task" ? a.subject : (a.subject || LABEL[a.kind])}</b>
          {a.outcome && <span className="pill">{a.outcome}</span>}
          {a.direction && <span className="faint small">{a.direction === "inbound" ? "inbound" : "outbound"}</span>}
        </div>
        <div className="tl-m small faint">
          {LABEL[a.kind]} · {whenLabel(a.occurred_at)} · {a.author}{a.edited_at ? " · edited" : ""}
          {a.about && <> · <Link href={recordHref(a.about)}>{a.about.label}</Link></>}
        </div>
        {edit ? (
          <form className="stack" style={{ gap: 8, marginTop: 6 }} onSubmit={async (e) => { e.preventDefault(); if (await run("save", () => editActivityAction(a.id, { subject: subject || null, body: body || null }), "Saved.")) setEdit(false); }}>
            {a.kind !== "note" && <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ minHeight: 70 }} aria-label="Notes" />
            <div className="row"><button className="btn sm primary" disabled={busy === "save"}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button></div>
          </form>
        ) : a.body && <div className="tl-body">{a.body}</div>}
        {mine && !edit && (
          <div className="tl-act">
            <button type="button" className="linkbtn" onClick={() => setEdit(true)}>Edit</button>
            <button type="button" className="linkbtn danger" disabled={!!busy} onClick={() => { if (confirm("Delete this entry?")) run("del", () => deleteActivityAction(a.id), "Deleted."); }}>Delete</button>
          </div>
        )}
      </div>
    </li>
  );
}

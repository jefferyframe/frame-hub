"use client";
import { useState } from "react";
import { logActivityAction, type ActivityForm } from "@/app/crm/actions";
import { RecordPicker } from "./RecordPicker";
import { useRun, dayKey, nowTime } from "./ui";
import { ACTIVITY_KINDS, CALL_OUTCOMES } from "@/lib/crm/logic";
import type { RecordRef } from "@/lib/crm/view";
import { IconNote, IconPhone, IconMail, IconUsers } from "@/components/icons";

const ICON = { note: IconNote, call: IconPhone, email: IconMail, meeting: IconUsers } as const;

/** Log a note, call, email or meeting (and optionally a follow-up task) on a record. Saved under the signed-in name. */
export function LogActivity({ fixed, me }: { fixed?: RecordRef | null; me: string }) {
  const { run, busy } = useRun();
  const [kind, setKind] = useState<ActivityForm["kind"]>("call");
  const [target, setTarget] = useState<RecordRef | null>(fixed ?? null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [day, setDay] = useState(dayKey());
  const [time, setTime] = useState(nowTime());
  const [fu, setFu] = useState("");
  const [fuTime, setFuTime] = useState("09:00");
  const [more, setMore] = useState(false);

  const canSave = !!target && (kind === "note" ? !!body.trim() : true);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    const r = await run("log", () => logActivityAction({
      kind, target, subject: subject || (kind === "call" ? `Call with ${target.label}` : kind === "meeting" ? `Meeting with ${target.label}` : kind === "email" ? `Email with ${target.label}` : null),
      body, outcome: kind === "call" ? outcome || null : null, direction: kind === "call" || kind === "email" ? direction : null,
      when_day: day, when_time: time, follow_up: fu ? { day: fu, time: fuTime || null } : null,
    }), `${ACTIVITY_KINDS.find((k) => k.key === kind)?.label} logged${fu ? " and follow-up task added" : ""}.`);
    if (r) { setSubject(""); setBody(""); setOutcome(""); setFu(""); if (!fixed) setTarget(null); setDay(dayKey()); setTime(nowTime()); setMore(false); }
  }

  return (
    <form className="logact" onSubmit={save}>
      <div className="seg" role="tablist" aria-label="What to log">
        {ACTIVITY_KINDS.map((k) => { const I = ICON[k.key]; return <button type="button" key={k.key} role="tab" aria-selected={kind === k.key} data-on={kind === k.key} onClick={() => setKind(k.key)}><I />{k.label}</button>; })}
      </div>
      {!fixed && <div className="f"><span className="label">About</span><RecordPicker value={target} onChange={setTarget} /></div>}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ minHeight: 76 }} aria-label={kind === "note" ? "Note" : "Notes"}
        placeholder={kind === "call" ? "Call notes: who you spoke with, what they need, next step" : kind === "email" ? "Paste or summarize the email" : kind === "meeting" ? "Who was there, what was decided" : "Write a note…"} />
      <div className="la-grid">
        {kind === "call" && <label className="f"><span>Outcome</span><select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Choose…</option>{CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>}
        {(kind === "call" || kind === "email") && <label className="f"><span>Direction</span><select value={direction} onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}><option value="outbound">Outgoing</option><option value="inbound">Incoming</option></select></label>}
        <label className="f"><span>Follow-up task on</span><input type="date" value={fu} min={dayKey()} onChange={(e) => setFu(e.target.value)} /></label>
        {fu && <label className="f"><span>at</span><input type="time" value={fuTime} onChange={(e) => setFuTime(e.target.value)} /></label>}
      </div>
      {more && (
        <div className="la-grid">
          {kind !== "note" && <label className="f wide"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={target ? `${kind === "call" ? "Call" : kind === "meeting" ? "Meeting" : "Email"} with ${target.label}` : "Optional"} /></label>}
          <label className="f"><span>When</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="f"><span>Time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
      )}
      <div className="tf-foot">
        {!more && <button type="button" className="btn sm ghost" onClick={() => setMore(true)}>{kind === "note" ? "Change date" : "Subject, date"}</button>}
        <span className="small muted">{target ? `${fixed ? "" : `On ${target.label} · `}saved as ${me}${more ? "" : " · now"}` : "Pick who it's about first."}</span>
        <span className="spacer" />
        <button className="btn primary" disabled={!canSave || busy === "log"}>{busy === "log" ? "Saving…" : `Log ${kind}`}</button>
      </div>
    </form>
  );
}

"use client";
import { useState } from "react";
import { createTaskAction, updateTaskAction, type TaskForm as TF } from "@/app/crm/actions";
import { RecordPicker } from "./RecordPicker";
import { useRun, dayKey, localDay, localTime } from "./ui";
import type { MemberView, RecordRef, TaskView } from "@/lib/crm/view";
import { TASK_KINDS } from "@/lib/crm/logic";

const REMINDERS = [{ v: "", l: "No reminder" }, { v: "0", l: "At the time" }, { v: "15", l: "15 min before" }, { v: "30", l: "30 min before" }, { v: "60", l: "1 hour before" }, { v: "1440", l: "1 day before" }];

/** New task / edit task. `fixed` pins it to a record (record pages); otherwise the picker chooses one. */
export function TaskForm({ team, me, task, fixed, onDone, compact }: { team: MemberView[]; me: string | null; task?: TaskView; fixed?: RecordRef | null; onDone?: () => void; compact?: boolean }) {
  const { run, busy } = useRun();
  const [title, setTitle] = useState(task?.title ?? "");
  const [kind, setKind] = useState<TF["kind"]>((task?.kind as TF["kind"]) ?? "call");
  const [day, setDay] = useState(task ? (task.due_at ? localDay(task.due_at) : task.due_on ?? "") : dayKey(1));
  const [time, setTime] = useState(task?.due_at ? localTime(task.due_at) : task ? "" : "09:00");
  const [owner, setOwner] = useState(task ? task.owner_id ?? "" : me ?? "");
  const [priority, setPriority] = useState<TF["priority"]>(task?.priority ?? "normal");
  const [reminder, setReminder] = useState(task ? (task.reminder_minutes == null ? "" : String(task.reminder_minutes)) : "15");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [target, setTarget] = useState<RecordRef | null>(fixed ?? task?.link ?? null);
  const [more, setMore] = useState(!!task);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const f: TF = { title, kind, due_day: day || null, due_time: day && time ? time : null, owner_id: owner || null, priority, reminder_minutes: reminder === "" ? null : Number(reminder), notes, target };
    const r = await run<unknown>("save", (): Promise<{ ok: true; data?: unknown } | { ok: false; error: string }> => (task ? updateTaskAction(task.id, f) : createTaskAction(f)), task ? "Task saved." : `Task added${owner ? ` for ${team.find((m) => m.id === owner)?.first_name ?? ""}` : ""}.`);
    if (r) { if (!task) { setTitle(""); setNotes(""); if (!fixed) setTarget(null); } onDone?.(); }
  }

  return (
    <form className={`taskform${compact ? " compact" : ""}`} onSubmit={save}>
      <div className="tf-row">
        <input className="tf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={target ? `e.g. Call ${target.label} about the proposal` : "What needs doing? e.g. Call back about fee"} required aria-label="Task" />
      </div>
      <div className="tf-grid">
        <label className="f"><span>Due</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="f"><span>Time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!day} /></label>
        <label className="f"><span>Owner</span><select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Unassigned</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="f"><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value as TF["kind"])}>{TASK_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
        {more && <>
          <label className="f"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value as TF["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
          <label className="f"><span>Calendar reminder</span><select value={reminder} onChange={(e) => setReminder(e.target.value)}>{REMINDERS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select></label>
          {!fixed && <div className="f wide"><span className="label">About</span><RecordPicker value={target} onChange={setTarget} /></div>}
          <label className="f wide"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ minHeight: 56 }} /></label>
        </>}
      </div>
      <div className="tf-foot">
        {!more && <button type="button" className="btn sm ghost" onClick={() => setMore(true)}>More: priority, reminder{fixed ? "" : ", who it's about"}</button>}
        <span className="spacer" />
        {onDone && task && <button type="button" className="btn sm ghost" onClick={onDone}>Cancel</button>}
        <button className="btn primary" disabled={busy === "save" || !title.trim()}>{busy === "save" ? "Saving…" : task ? "Save task" : "Add task"}</button>
      </div>
    </form>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { completeTaskAction, reopenTaskAction, snoozeTaskAction, deleteTaskAction } from "@/app/crm/actions";
import { useRun, shortDay, timeOf, localDay } from "./ui";
import { TaskForm } from "./TaskForm";
import { SNOOZES, taskBucket, BUCKETS, type SnoozeKey, type TaskBucket } from "@/lib/crm/logic";
import { recordHref, type MemberView, type TaskView } from "@/lib/crm/view";
import { IconCal, IconPhone, IconMail, IconUsers, IconCheck } from "@/components/icons";

const KIND_ICON: Record<string, () => React.ReactElement> = { call: IconPhone, email: IconMail, meeting: IconUsers, todo: IconCheck };

/** Tasks grouped Overdue / Today / This week / Later (or flat on record pages). */
export function TaskList({ tasks, team, me, grouped = true, showOwner = true, hideLink = false, emptyText = "Nothing open." }: { tasks: TaskView[]; team: MemberView[]; me: string | null; grouped?: boolean; showOwner?: boolean; hideLink?: boolean; emptyText?: string }) {
  const now = new Date();
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at);
  if (!tasks.length) return <p className="empty small">{emptyText}</p>;
  if (!grouped) return (
    <div className="tlist">
      {open.map((t) => <TaskRow key={t.id} t={t} team={team} me={me} bucket={taskBucket({ due_on: t.due_on, due_at: t.due_at }, now)} showOwner={showOwner} hideLink={hideLink} />)}
      {done.length > 0 && <details className="tdone"><summary className="small muted">{done.length} done recently</summary>{done.map((t) => <TaskRow key={t.id} t={t} team={team} me={me} bucket="later" showOwner={showOwner} hideLink={hideLink} />)}</details>}
    </div>
  );
  const groups = new Map<TaskBucket, TaskView[]>(BUCKETS.map((b) => [b.key, []]));
  for (const t of open) groups.get(taskBucket({ due_on: t.due_on, due_at: t.due_at }, now))!.push(t);
  return (
    <div className="tlist">
      {BUCKETS.map((b) => {
        const list = groups.get(b.key)!;
        if (!list.length) return null;
        return (
          <section key={b.key} className="tgroup" data-bucket={b.key}>
            <h3 className="tg-head">{b.label} <span className="cnt">{list.length}</span></h3>
            {list.map((t) => <TaskRow key={t.id} t={t} team={team} me={me} bucket={b.key} showOwner={showOwner} hideLink={hideLink} />)}
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({ t, team, me, bucket, showOwner, hideLink }: { t: TaskView; team: MemberView[]; me: string | null; bucket: TaskBucket; showOwner: boolean; hideLink: boolean }) {
  const { run, busy } = useRun();
  const [edit, setEdit] = useState(false);
  const Icon = KIND_ICON[t.kind] ?? IconCheck;
  const day = t.due_at ? localDay(t.due_at) : t.due_on;
  if (edit) return <div className="trow editing"><TaskForm team={team} me={me} task={t} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="trow" data-busy={!!busy} data-done={!!t.done_at} id={`task-${t.id}`}>
      <label className="tick" title={t.done_at ? "Reopen" : "Mark done"}>
        <input type="checkbox" checked={!!t.done_at} disabled={!!busy}
          onChange={() => run("done", () => (t.done_at ? reopenTaskAction(t.id) : completeTaskAction(t.id)), t.done_at ? "Reopened." : `Done: ${t.title}`)} aria-label={t.done_at ? `Reopen ${t.title}` : `Mark ${t.title} done`} />
        <span className="box">✓</span>
      </label>
      <div className="tmain">
        <div className="tt"><span className="kind" title={t.kind}><Icon /></span>{t.title}{t.priority === "high" && <span className="pill bad">High</span>}</div>
        <div className="tm">
          <span className={`due ${bucket}`}>{shortDay(day)}{t.due_at ? ` · ${timeOf(t.due_at)}` : ""}</span>
          {!hideLink && t.link && <Link href={recordHref(t.link)}>{t.link.label}</Link>}
          {showOwner && <span className="owner">{t.owner_name ?? "Unassigned"}</span>}
          {t.cadence && <span className="faint">{t.cadence}</span>}
        </div>
        {t.notes && <div className="tb small muted">{t.notes}</div>}
      </div>
      {!t.done_at && (
        <div className="tact">
          <select className="snooze" value="" disabled={!!busy} aria-label="Snooze" title="Snooze"
            onChange={(e) => { const k = e.target.value as SnoozeKey; if (k) run("snooze", () => snoozeTaskAction(t.id, k), `Snoozed: ${SNOOZES.find((s) => s.key === k)?.label.toLowerCase()}.`); }}>
            <option value="">Snooze…</option>{SNOOZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {(t.due_on || t.due_at) && <a className="btn sm ghost icon" href={`/api/tasks/${t.id}/ics`} title="Add to calendar (.ics)" aria-label="Add to calendar"><IconCal /></a>}
          <details className="more">
            <summary className="btn sm ghost" aria-label="More">⋯</summary>
            <div className="menu">
              <button type="button" onClick={() => setEdit(true)}>Edit</button>
              <button type="button" className="danger" onClick={() => { if (confirm(`Delete “${t.title}”?`)) run("del", () => deleteTaskAction(t.id), "Task deleted."); }}>Delete</button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

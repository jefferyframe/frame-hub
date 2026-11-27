import type { Db } from "@/lib/db/types";
import { listTeam } from "@/lib/repo/team";
import { tasksFor } from "@/lib/repo/tasks";
import { timeline } from "@/lib/repo/activities";
import { matchMember } from "@/lib/crm/logic";
import { toTaskView, toActivityView, type RecordKind } from "@/lib/crm/view";
import { ToastProvider } from "./ui";
import { TaskList } from "./TaskList";
import { TaskForm } from "./TaskForm";
import { LogActivity } from "./LogActivity";
import { Timeline } from "./Timeline";

/** Tasks + "log a call/note" + activity timeline for one company, contact or deal. */
export async function RecordCrm({ db, kind, id, label, userName }: { db: Db; kind: RecordKind; id: string; label: string; userName: string }) {
  const [team, tasks, acts] = await Promise.all([listTeam(db), tasksFor(db, kind, id), timeline(db, kind, id)]);
  const me = matchMember(team, userName);
  const members = team.map((m) => ({ id: m.id, name: m.name, first_name: m.first_name }));
  const ref = { kind, id, label };
  const first = userName.split(/\s+/)[0];
  return (
    <ToastProvider>
      <div className="stack">
        <section className="card">
          <header><h2>Tasks & reminders</h2><span className="small muted">{tasks.filter((t) => !t.done_at).length} open</span></header>
          <TaskList tasks={tasks.map(toTaskView)} team={members} me={me?.id ?? null} grouped={false} hideLink={kind === "opportunity"} emptyText="No tasks yet." />
          <details className="addtask"><summary className="btn sm">+ Add a task</summary><TaskForm team={members} me={me?.id ?? null} fixed={ref} compact /></details>
        </section>
        <section className="card">
          <header><h2>Activity</h2><span className="small muted">{acts.length} logged</span></header>
          <LogActivity fixed={ref} me={first} />
          <hr className="sep" />
          <Timeline items={acts.map((a) => toActivityView(a, { kind, id }))} me={first} />
        </section>
      </div>
    </ToastProvider>
  );
}

import Link from "next/link";
import { getDb } from "@/lib/db";
import { openTasks } from "@/lib/repo/tasks";
import { addDays, todayISO } from "@/lib/calc/util";
import { completeTaskAction, addTaskAction } from "../actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Follow-ups" };

const CADENCE: Record<string, string> = {
  past_client_1m: "Past client · 1 month", past_client_2m: "Past client · 2 months", past_client_6m: "Past client · 6 months",
  prospect_linkedin: "Prospect · LinkedIn", prospect_card: "Prospect · card", prospect_email_1m: "Prospect · 1-month email",
  opp_follow_up_1: "Proposal · follow-up 1", opp_follow_up_2: "Proposal · follow-up 2", opp_present: "Proposal · present", manual: "",
};

export default async function FollowUps() {
  const db = await getDb();
  const today = todayISO();
  const tasks = await openTasks(db);
  const week = addDays(today, 7);
  const groups = [
    { title: "Overdue", rows: tasks.filter((t) => t.due_on && t.due_on < today) },
    { title: "Today & this week", rows: tasks.filter((t) => t.due_on && t.due_on >= today && t.due_on <= week) },
    { title: "Later", rows: tasks.filter((t) => !t.due_on || t.due_on > week) },
  ];
  return (
    <div className="stack">
      <div className="pagehead"><div><h1>Follow-ups</h1><p>Proposal follow-ups (3 and 7-day rules), past-client check-ins at 1, 2 and 6 months, and prospect touches.</p></div></div>
      <form action={addTaskAction} className="card row">
        <input name="title" placeholder="New follow-up…" style={{ flex: 2, minWidth: 200 }} required />
        <input name="due_on" type="date" style={{ width: 160 }} defaultValue={today} />
        <input name="assignee" placeholder="Who" style={{ width: 140 }} />
        <button className="btn primary">Add</button>
      </form>
      {groups.map((g) => (
        <div key={g.title} className="card">
          <header><h2>{g.title}</h2><span className="small muted">{g.rows.length}</span></header>
          {g.rows.length === 0 ? <p className="muted small">Nothing.</p> : (
            <div className="tablewrap"><table><tbody>{g.rows.map((t) => (
              <tr key={t.id}>
                <td style={{ width: 44 }}><form action={completeTaskAction.bind(null, t.id)}><button className="btn sm" aria-label="Mark done">✓</button></form></td>
                <td>{t.title}<div className="small faint">{[CADENCE[t.cadence ?? ""] ?? t.cadence, t.notes].filter(Boolean).join(" · ")}</div></td>
                <td className="small hide-sm">{t.opportunity_id ? <Link href={`/sales/${t.opportunity_id}`}>{t.opportunity_name}</Link> : t.contact_name ?? (t.project_job ? `Job ${t.project_job}` : "")}</td>
                <td className="small num" style={g.title === "Overdue" ? { color: "var(--danger)" } : undefined}>{date(t.due_on)}</td>
              </tr>))}</tbody></table></div>
          )}
        </div>
      ))}
    </div>
  );
}

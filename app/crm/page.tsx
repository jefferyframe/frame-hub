import Link from "next/link";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listTeam } from "@/lib/repo/team";
import { openTasks } from "@/lib/repo/tasks";
import { applyAutoAdvance } from "@/lib/repo/opportunities";
import { boardDeals, stageProbability } from "@/lib/repo/deals";
import { getSettings } from "@/lib/repo/settings";
import { issueJobNumber } from "@/lib/repo/numbers";
import { matchMember, taskBucket, DEAL_STAGES, LEAD_STAGES, CLOSE_STAGES } from "@/lib/crm/logic";
import { toTaskView, type MemberView } from "@/lib/crm/view";
import { todayISO } from "@/lib/calc/util";
import { PIPELINE_STATUSES } from "@/lib/calc/sales";
import { ToastProvider } from "@/components/crm/ui";
import { TaskList } from "@/components/crm/TaskList";
import { TaskForm } from "@/components/crm/TaskForm";
import { LogActivity } from "@/components/crm/LogActivity";
import { DealsBoard } from "@/components/crm/DealsBoard";
import { WhoSelect } from "@/components/crm/WhoSelect";
import { IconPhone, IconGrid, IconFunnel } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM" };

type View = "follow" | "deals" | "leads";

export default async function Crm({ searchParams }: { searchParams: Promise<{ view?: string; who?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.view === "deals" || sp.view === "leads" ? sp.view : "follow";
  const db = await getDb();
  const user = (await currentUser())!;
  const team = await listTeam(db);
  const me = matchMember(team, user.name);
  const members: MemberView[] = team.map((m) => ({ id: m.id, name: m.name, first_name: m.first_name }));
  const first = user.name.split(/\s+/)[0];
  const today = todayISO();

  const tabs = (
    <div className="seg crm-views" role="tablist" aria-label="CRM view">
      <Link role="tab" href="/crm" data-on={view === "follow"} aria-selected={view === "follow"}><IconPhone />Follow-ups</Link>
      <Link role="tab" href="/crm?view=deals" data-on={view === "deals"} aria-selected={view === "deals"}><IconGrid />Proposals sent</Link>
      <Link role="tab" href="/crm?view=leads" data-on={view === "leads"} aria-selected={view === "leads"}><IconFunnel />Leads</Link>
    </div>
  );

  if (view !== "follow") {
    await applyAutoAdvance(db, "system", today);
    const [deals, settings, nextJob] = await Promise.all([boardDeals(db, view, today), getSettings(db), issueJobNumber(db, today)]);
    const statuses = view === "deals" ? DEAL_STAGES : LEAD_STAGES;
    const stages = statuses.map((s) => ({ status: s, label: s, prob: stageProbability(s, settings.stageLikelihood) }));
    return (
      <ToastProvider>
        <div className="stack crm">
          <div className="crm-top">
            <div><h1>{view === "deals" ? "Proposals sent" : "Leads"}</h1><p className="muted">{view === "deals" ? "Every proposal that’s out with a client, by follow-up stage. Drag a row to move it (or use Move on a phone). Won opens the project." : "Inquiries that don’t have a proposal out yet. Sending a proposal moves it to Proposals sent."}</p></div>
            {tabs}
          </div>
          <DealsBoard deals={deals} stages={stages} closeStages={CLOSE_STAGES.map((c) => ({ ...c }))} allStages={[...PIPELINE_STATUSES.filter((s) => s !== "Project Completed")]} team={members} nextJob={nextJob} mode={view} />
        </div>
      </ToastProvider>
    );
  }

  const who = sp.who && (sp.who === "all" || sp.who === "unassigned" || team.some((m) => m.id === sp.who) || (sp.who === "me" && me)) ? sp.who : me ? "me" : "all";
  const owner = who === "me" ? me!.id : who === "all" ? undefined : who;
  const withUnassigned = who === "me" && !!me?.cal_include_unassigned; // same rule as their calendar (Settings)
  const tasks = (await openTasks(db, { owner, withUnassigned })).map(toTaskView);
  const now = new Date();
  const overdue = tasks.filter((t) => taskBucket(t, now) === "overdue").length;
  const dueToday = tasks.filter((t) => taskBucket(t, now) === "today").length;
  const whoName = who === "me" ? "you" : who === "all" ? "the team" : who === "unassigned" ? "nobody yet" : team.find((m) => m.id === who)?.name ?? "";

  return (
    <ToastProvider>
      <div className="stack crm">
        <div className="crm-top">
          <div>
            <h1>Hi {first}. <span className="muted">Here’s who to follow up with.</span></h1>
            <p className="muted small">
              {overdue > 0 && <span className="pill bad">{overdue} overdue</span>} {dueToday > 0 && <span className="pill warn">{dueToday} today</span>} {tasks.length} open for {whoName}
              {!me && <> · <span className="faint">“{first}” isn’t on the team list yet, so you’re seeing everyone. Add yourself in <Link href="/settings#team">Settings</Link>.</span></>}
            </p>
          </div>
          {tabs}
        </div>
        <div className="crm-grid">
          <section className="card">
            <header><h2>{who === "me" ? "My follow-ups" : who === "all" ? "Team follow-ups" : `Follow-ups · ${whoName}`}</h2><WhoSelect team={members} who={who} meId={me?.id ?? null} /></header>
            {withUnassigned && <p className="small muted" style={{ marginTop: -4 }}>Includes follow-ups nobody owns yet — use ⋯ → Edit to give one an owner, or change this under Settings → Your calendar.</p>}
            <TaskList tasks={tasks} team={members} me={me?.id ?? null} showOwner={who !== "me" || withUnassigned} emptyText={who === "me" ? "Nothing open for you. Nice." : "Nothing open."} />
          </section>
          <div className="stack">
            <section className="card"><header><h2>New task or reminder</h2><span className="small muted">Shows in the owner’s calendar</span></header><TaskForm team={members} me={me?.id ?? null} /></section>
            <section className="card"><header><h2>Log a call, email or note</h2></header><LogActivity me={first} /></section>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

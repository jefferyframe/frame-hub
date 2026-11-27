import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { STAGES, overallLikelihoods } from "@/lib/calc/sales";
import { quickbooks } from "@/lib/integrations/quickbooks";
import { authProvider } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { saveSettingsAction, saveHoursSettingsAction } from "./actions";
import { HoursTeamSettings, ReminderToggle } from "@/components/time/HoursSettings";
import { pct } from "@/lib/format";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth";
import { listTeam, currentFeedToken } from "@/lib/repo/team";
import { matchMember } from "@/lib/crm/logic";
import { TeamSettings } from "@/components/crm/TeamSettings";
import { CalendarSettings } from "@/components/crm/CalendarSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ cal?: string }> }) {
  const db = await getDb();
  const { cal } = await searchParams;
  const [team, user, h] = await Promise.all([listTeam(db, { all: true }), currentUser(), headers()]);
  const counts = new Map((await db.query<{ owner_id: string; n: number }>(`select owner_id, count(*)::int n from tasks where done_at is null and owner_id is not null group by owner_id`)).map((r) => [r.owner_id, r.n]));
  const me = matchMember(team, user?.name);
  const calFor = team.find((m) => m.id === cal && m.active) ?? me;
  const origin = `${h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") ? "http" : "https")}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const calToken = calFor ? await currentFeedToken(db, calFor.id) : null;
  const s = await getSettings(db);
  const ov = overallLikelihoods(s.stageLikelihood);
  const [runs] = await Promise.all([db.query<{ at: Date; source: string }>(`select at, source from import_runs order by at desc limit 1`)]);
  const qb = await quickbooks().connected();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="pagehead"><div><h1>Settings</h1><p>Your calendar, the team, firm details used on proposals, and the numbers behind the pipeline and job-cost math.</p></div></div>
      <div className="card stack" id="calendar">
        <header><h2>{calFor && calFor.id !== me?.id ? `${calFor.name}’s calendar` : "Your calendar"}</h2>
          <form className="row" style={{ gap: 6 }}><select name="cal" defaultValue={calFor?.id ?? ""} aria-label="Whose calendar" style={{ width: "auto" }}>{!me && <option value="">Choose a person…</option>}{team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="btn sm">Show</button></form>
        </header>
        <p className="small muted">Tasks and reminders assigned to a person show up in their own calendar (Outlook, Google or Apple) through a private link that updates as tasks change. Done tasks disappear from it. Set it up once per person.</p>
        {calFor ? <>
          <CalendarSettings key={calFor.id} memberId={calFor.id} name={calFor.name} origin={origin} token={calToken} includeUnassigned={calFor.cal_include_unassigned} hasFeed={!!calFor.has_feed} />
          <ReminderToggle key={`r-${calFor.id}`} id={calFor.id} enabled={calFor.remind_enabled} time={calFor.remind_time} />
        </> : <p className="notice">“{user?.name}” isn’t on the team list below, so pick a person above (or add yourself to the team).</p>}
      </div>
      <div className="card stack" id="team">
        <header><h2>Team</h2><span className="small muted">Who tasks can be assigned to · the first name you sign in with is you</span></header>
        <TeamSettings rows={team.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, active: m.active, has_feed: !!m.has_feed, open_tasks: counts.get(m.id) ?? 0 }))} />
      </div>
      <div className="card stack" id="hours">
        <header><h2>Team hours & reminders</h2><span className="small muted">expected hours drive the missing-hours banner, the report and schedule capacity</span></header>
        <HoursTeamSettings rows={team.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, hours_per_day: Number(m.hours_per_day), work_days: m.work_days, track_hours: m.track_hours, remind_enabled: m.remind_enabled, remind_time: m.remind_time, has_feed: !!m.has_feed }))} />
        <p className="small muted">Track = counted in “Missing hours”. The calendar reminder is a repeating event with an alert in that person’s Frame Hub calendar link (set it up under Your calendar), on their working days at that time, skipping the holidays below. Email / Teams reminders come with Microsoft sign-in.</p>
        <form action={saveHoursSettingsAction} className="fields">
          <label className="f"><span>Count missing hours from</span><input type="date" name="hoursTrackingStart" defaultValue={s.hoursTrackingStart} /></label>
          <label className="f"><span>Firm holidays (one date per line)</span><textarea name="firmHolidays" defaultValue={s.firmHolidays.join("\n")} style={{ minHeight: 90 }} /></label>
          <div className="wide"><button className="btn">Save hours settings</button></div>
        </form>
      </div>
      <form action={saveSettingsAction} className="stack">
        <div className="card stack">
          <h2>Firm (proposal letterhead)</h2>
          <div className="fields">
            <label className="f"><span>Firm name</span><input name="firmName" defaultValue={s.firmName} /></label>
            <label className="f"><span>Phone</span><input name="firmPhone" defaultValue={s.firmPhone} /></label>
            <label className="f"><span>Address</span><textarea name="firmAddress" defaultValue={s.firmAddress} style={{ minHeight: 60 }} /></label>
            <label className="f"><span>Email</span><input name="firmEmail" defaultValue={s.firmEmail} /></label>
            <label className="f"><span>Proposals valid for (days)</span><input name="proposalValidDays" defaultValue={s.proposalValidDays} inputMode="numeric" /></label>
            <label className="f wide"><span>“Why Frame” (one per line)</span><textarea name="whyFrame" defaultValue={s.whyFrame.join("\n")} style={{ minHeight: 80 }} /></label>
            <label className="f wide"><span>Default terms</span><textarea name="defaultTerms" defaultValue={s.defaultTerms} /></label>
          </div>
        </div>
        <div className="card stack">
          <h2>Stage likelihood (Pipeline Tracking row 3)</h2>
          <p className="small muted">Overall likelihood for a stage = its likelihood × every later stage’s (row 4). Weighted pipeline = Σ overall × stage total (row 6).</p>
          <div className="fields">{STAGES.map((st) => (
            <label key={st.key} className="f"><span>{st.label} — overall {pct(ov[st.key])}</span><input name={`stage_${st.key}`} defaultValue={+(s.stageLikelihood[st.key] * 100).toFixed(2)} inputMode="decimal" /></label>
          ))}</div>
        </div>
        <div className="card stack">
          <h2>Job cost defaults (template E30 / E33)</h2>
          <div className="fields">
            <label className="f"><span>Profit percentage (cost share of fee, %)</span><input name="profitPct" defaultValue={+(s.profitPct * 100).toFixed(2)} inputMode="decimal" /></label>
            <label className="f"><span>Burden rate ($/hour)</span><input name="burdenRate" defaultValue={s.burdenRate} inputMode="decimal" /></label>
          </div>
          <p className="small muted">Expected profit = fee × (1 − profit %). Hours allowance = ⌊(fee − expected profit) ÷ burden rate⌋. New projects start with these; each job can override its own.</p>
        </div>
        <div><button className="btn primary">Save settings</button></div>
      </form>
      <div className="card stack">
        <h2>Connections</h2>
        <table className="small"><tbody>
          <tr><td>Sign-in</td><td>{authProvider().id === "dev" ? "Local stand-in user" : <>Shared password (Microsoft Entra sign-in later) · <form action="/auth/signout" method="post" style={{ display: "inline" }}><button className="btn small" type="submit">Sign out</button></form></>}</td></tr>
          <tr><td>QuickBooks</td><td>{qb ? "Connected" : "Not connected — customer and invoice mapping is ready for it"}</td></tr>
          <tr><td>Claude scope drafting</td><td>{aiConfigured() ? "On" : "Off (set ANTHROPIC_API_KEY)"}</td></tr>
          <tr><td>Theme</td><td>styles/theme.css — one line switches between the design directions</td></tr>
          <tr><td>Last data import</td><td>{runs[0] ? new Date(runs[0].at).toLocaleString("en-US") : "never"}</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}

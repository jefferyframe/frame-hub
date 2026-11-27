import Link from "next/link";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { missingHoursReport } from "@/lib/repo/time";
import { getSettings } from "@/lib/repo/settings";
import { weekStart, weekDays, isoDow } from "@/lib/calc/hours";
import { addDays, todayISO } from "@/lib/calc/util";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Missing hours" };
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const h = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

export default async function Missing({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (user && user.role !== "owner" && user.role !== "admin") return <p className="notice">Only Jeff and admins can see the team’s missing hours.</p>;
  const db = await getDb();
  const today = todayISO();
  const week = weekStart(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = weekDays(week);
  const [rows, settings, last] = await Promise.all([
    missingHoursReport(db, { from: days[0], to: days[6] }),
    getSettings(db),
    db.query<{ member_id: string; d: string }>(`select member_id, max(work_date)::text d from time_entries where member_id is not null and work_date is not null group by member_id`),
  ]);
  const lastBy = new Map(last.map((r) => [r.member_id, r.d]));
  const workCols = days.filter((d) => rows.some((r) => r.member.work_days.includes(isoDow(d))));
  const behind = rows.filter((r) => r.missing.length);
  return (
    <div className="stack">
      <div className="pagehead">
        <div><h1>Missing hours</h1><p>Who hasn’t logged their expected hours, by day, for the week of {date(days[0], { month: "long", day: "numeric" })}. Today counts after each person’s reminder time.</p></div>
        <div className="seg"><Link href={`?week=${addDays(week, -7)}`}>‹ Prev</Link><Link href="?" data-on={week === weekStart(today)}>This week</Link><Link href={`?week=${addDays(week, 7)}`}>Next ›</Link></div>
      </div>
      {week < weekStart(settings.hoursTrackingStart) && <p className="notice">Daily hour logging counts from {date(settings.hoursTrackingStart)} (Settings → Hours), so days before that aren’t flagged.</p>}
      <div className="grid g3">
        <div className="card kpi"><div className="label">People behind</div><div className="value">{behind.length}<span className="small muted"> of {rows.length}</span></div></div>
        <div className="card kpi"><div className="label">Days short</div><div className="value">{behind.reduce((s, r) => s + r.missing.length, 0)}</div></div>
        <div className="card kpi"><div className="label">Hours short</div><div className="value">{h(behind.reduce((s, r) => s + r.shortHours, 0))}</div></div>
      </div>
      <div className="card">
        <div className="tablewrap"><table className="mgrid">
          <thead><tr><th>Person</th>{workCols.map((d) => <th key={d} className={`num${d === today ? " today" : ""}`}>{DOW[isoDow(d)]} {Number(d.slice(8))}</th>)}<th className="num">Short</th><th className="hide-sm">Last logged</th><th /></tr></thead>
          <tbody>{rows.map((r) => {
            const miss = new Map(r.missing.map((m) => [m.day, m]));
            return (
              <tr key={r.member.id}>
                <td><b>{r.member.name}</b><div className="small faint">{Number(r.member.hours_per_day)} h/day · reminder {r.member.remind_enabled ? r.member.remind_time : "off"}</div></td>
                {workCols.map((d) => {
                  const works = r.member.work_days.includes(isoDow(d)) && !settings.firmHolidays.includes(d);
                  const got = r.logged.get(d) ?? 0;
                  const m = miss.get(d);
                  return <td key={d} className={`num ${m ? (got === 0 ? "m-none" : "m-short") : works && d <= today && d >= settings.hoursTrackingStart ? "m-ok" : "faint"}`}>{works ? (d > today ? "" : `${h(got)}`) : "—"}{m ? <span className="small">/{h(m.expected)}</span> : null}</td>;
                })}
                <td className="num">{r.shortHours ? <b style={{ color: "var(--danger)" }}>{h(r.shortHours)} h</b> : <span className="pill ok">OK</span>}</td>
                <td className="hide-sm small">{lastBy.get(r.member.id) ? date(lastBy.get(r.member.id)!, { weekday: "short", month: "short", day: "numeric" }) : <span className="faint">never (daily)</span>}</td>
                <td><Link className="btn sm ghost" href={`/timesheet?who=${r.member.id}&week=${week}`}>Timesheet</Link></td>
              </tr>);
          })}</tbody>
        </table></div>
        <p className="small faint" style={{ marginTop: 10 }}>Red = nothing logged, amber = some but under the expected hours. Only team members with “Track hours” on are listed (Settings → Team hours). Reminders: each person gets a banner in Frame Hub and, if they subscribed to their calendar link, a repeating “Log your hours” alarm. Email / Teams nudges come with Microsoft sign-in.</p>
      </div>
    </div>
  );
}

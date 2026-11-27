import Link from "next/link";
import type { MissingDay } from "@/lib/calc/hours";

const day = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const h = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

/** "You're short on hours" — the in-app reminder (dashboard + timesheet). */
export function HoursBanner({ missing, who, compact = false }: { missing: MissingDay[]; who?: string | null; compact?: boolean }) {
  if (!missing.length) return compact ? null : <div className="hbanner ok"><b>Hours are up to date</b><span className="small muted">Nothing missing this week.</span></div>;
  const short = missing.reduce((s, d) => s + d.short, 0);
  return (
    <div className="hbanner" role="status">
      <div className="hb-main">
        <b>{who ? `${who} is` : "You’re"} short {h(short)} h this week</b>
        <div className="hb-days">{missing.map((d) => <span key={d.day} className="pill warn" title={`${h(d.logged)} of ${h(d.expected)} h logged`}>{d.isToday ? "Today" : day(d.day)} · {h(d.logged)}/{h(d.expected)}</span>)}</div>
      </div>
      {!compact && <Link className="btn primary" href="/timesheet">Log hours</Link>}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveMemberHoursAction, setReminderAction } from "@/app/settings/actions";

export interface HoursRow { id: string; name: string; hours_per_day: number; work_days: number[]; track_hours: boolean; remind_enabled: boolean; remind_time: string; has_feed: boolean }
const D = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Row({ r }: { r: HoursRow }) {
  const router = useRouter();
  const [hpd, setHpd] = useState(String(r.hours_per_day));
  const [days, setDays] = useState(r.work_days);
  const [track, setTrack] = useState(r.track_hours);
  const [rem, setRem] = useState(r.remind_enabled);
  const [time, setTime] = useState(r.remind_time);
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  const dirty = hpd !== String(r.hours_per_day) || days.join() !== r.work_days.join() || track !== r.track_hours || rem !== r.remind_enabled || time !== r.remind_time;
  return (
    <tr>
      <td><b>{r.name}</b>{!r.has_feed && <div className="small faint">no calendar link yet</div>}</td>
      <td><input value={hpd} onChange={(e) => setHpd(e.target.value)} inputMode="decimal" style={{ width: 64 }} aria-label={`${r.name} hours per day`} /></td>
      <td><div className="daypick">{D.map((d, i) => <label key={d} data-on={days.includes(i + 1)}><input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays(e.target.checked ? [...days, i + 1].sort() : days.filter((x) => x !== i + 1))} />{d[0]}</label>)}</div></td>
      <td className="num">{(Number(hpd) || 0) * days.length}</td>
      <td><input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} aria-label="Track hours" /></td>
      <td><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><input type="checkbox" checked={rem} onChange={(e) => setRem(e.target.checked)} aria-label="Calendar reminder" /><input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!rem} style={{ width: 110 }} /></span></td>
      <td><button className="btn sm" disabled={!dirty || state === "saving"} onClick={async () => {
        setState("saving");
        const res = await saveMemberHoursAction(r.id, { hours_per_day: hpd, work_days: days, track_hours: track, remind_enabled: rem, remind_time: time });
        setState(res.ok ? "saved" : res.error); if (res.ok) router.refresh();
      }}>{state === "saving" ? "Saving…" : "Save"}</button>{state && state !== "saving" && <div className={`small ${state === "saved" ? "muted" : "warnt"}`}>{state === "saved" ? "Saved" : state}</div>}</td>
    </tr>
  );
}

export function HoursTeamSettings({ rows }: { rows: HoursRow[] }) {
  return (
    <div className="tablewrap"><table className="small hset">
      <thead><tr><th>Person</th><th>Hours / day</th><th>Works</th><th className="num">h / wk</th><th>Track</th><th>Calendar reminder (Pacific)</th><th /></tr></thead>
      <tbody>{rows.map((r) => <Row key={r.id} r={r} />)}</tbody>
    </table></div>
  );
}

/** In "Your calendar": the "Log your hours" reminder on/off + time for this person. */
export function ReminderToggle({ id, enabled, time }: { id: string; enabled: boolean; time: string }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled), [t, setT] = useState(time), [msg, setMsg] = useState("");
  const save = async (o: boolean, tt: string) => { setMsg("Saving…"); const r = await setReminderAction(id, o, tt); setMsg(r.ok ? (o ? `Reminder on: weekdays at ${tt}` : "Reminder off") : r.error); if (r.ok) router.refresh(); };
  return (
    <div className="row small remtoggle">
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); save(e.target.checked, t); }} /> Add a repeating <b>“Log your hours”</b> reminder (with an alert) on working days at</label>
      <input type="time" value={t} disabled={!on} onChange={(e) => setT(e.target.value)} onBlur={() => t !== time && save(on, t)} style={{ width: 110 }} />
      <span className="muted">Pacific</span>
      {msg && <span className="muted">· {msg}</span>}
    </div>
  );
}

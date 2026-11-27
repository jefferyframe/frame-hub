"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { moveBarAction } from "@/app/projects/cardActions";
import { CardLink } from "@/components/project/CardHost";

export interface GanttPhase { phase: string; short: string; start: string; end: string; target: string | null; est: string | null; plannedStart: string | null; status: string; people: string; remaining: number | null; rate: number }
export interface GanttRow { projectId: string; job: string; name: string; status: string; color: string; phases: GanttPhase[] }

const DAY = 86400000;
const dn = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / DAY);
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");
const LABEL: Record<string, string> = { on_track: "On track", at_risk: "At risk", over_hours: "Over hours", needs_plan: "Needs plan", no_target: "No target", no_hours: "No hours budget" };

type Drag = { key: string; projectId: string; phase: string; mode: "move" | "end"; x0: number; delta: number; ph: GanttPhase };

/** Timeline: one row per job, a bar per open phase. Drag (desktop) to move a phase's start or set its target. */
export function Gantt({ rows, from, to, today }: { rows: GanttRow[]; from: string; to: string; today: string }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = dn(from), b = dn(to), span = Math.max(1, b - a);
  const pct = (d: string) => ((dn(d) - a) / span) * 100;
  const months: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCMonth(d.getUTCMonth() + 1, 1)) months.push(d.toISOString().slice(0, 10).slice(0, 8) + "01");
  const dayPx = () => (wrap.current ? wrap.current.querySelector(".g-track")!.getBoundingClientRect().width / span : 4);

  const touch = useRef(false);
  const openCard = (id: string) => { const u = new URL(window.location.href); u.searchParams.set("card", id); router.push(u.pathname + u.search, { scroll: false }); };
  function down(e: React.PointerEvent, r: GanttRow, ph: GanttPhase, mode: "move" | "end") {
    touch.current = e.pointerType !== "mouse";
    if (touch.current || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ key: `${r.projectId}|${ph.phase}`, projectId: r.projectId, phase: ph.phase, mode, x0: e.clientX, delta: 0, ph });
  }
  function move(e: React.PointerEvent) { if (drag) setDrag({ ...drag, delta: Math.round((e.clientX - drag.x0) / dayPx()) }); }
  async function up() {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (!d.delta) { if (d.mode === "move") openCard(d.projectId); return; }
    const shift = (x: string | null) => (x ? iso(dn(x) + d.delta) : null);
    const patch = d.mode === "move" ? { start_date: shift(d.ph.start), target_date: d.ph.target ? shift(d.ph.target) : undefined } : { target_date: iso(Math.max(dn(d.ph.start), dn(d.ph.end) + d.delta)) };
    setBusy(d.key); setErr(null);
    const r = await moveBarAction(d.projectId, d.phase, patch).catch((x) => ({ ok: false as const, error: String(x?.message ?? x) }));
    setBusy(null);
    if (!r.ok) setErr(r.error); else router.refresh();
  }

  if (!rows.length) return <p className="empty">No scheduled phases match.</p>;
  return (
    <div className="gantt" ref={wrap} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      {err && <p className="notice bad">{err}</p>}
      <div className="g-row g-axis">
        <div className="g-label" />
        <div className="g-track">
          {months.map((m) => pct(m) >= 0 && pct(m) <= 100 ? <span key={m} className="g-month" style={{ left: `${pct(m)}%` }}>{new Date(m + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</span> : null)}
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.projectId} className="g-row">
          <div className="g-label"><CardLink id={r.projectId}><span className="mono">{r.job}</span> <span className="g-name">{r.name}</span></CardLink><span className={`g-dot ${r.status}`} title={LABEL[r.status] ?? r.status} /></div>
          <div className="g-track">
            {months.map((m) => <span key={m} className="g-grid" style={{ left: `${pct(m)}%` }} />)}
            {today >= from && today <= to && <span className="g-today" style={{ left: `${pct(today)}%` }} />}
            {r.phases.map((ph) => {
              const k = `${r.projectId}|${ph.phase}`;
              const dd = drag?.key === k ? drag : null;
              const s = dd?.mode === "move" ? iso(dn(ph.start) + dd.delta) : ph.start;
              const e = dd ? iso(Math.max(dn(s), dn(ph.end) + dd.delta)) : ph.end;
              const t = dd?.mode === "move" && ph.target ? iso(dn(ph.target) + dd.delta) : dd?.mode === "end" ? e : ph.target;
              const left = Math.max(0, pct(s)), right = Math.min(100, pct(iso(dn(e) + 1)));
              if (right <= 0 || left >= 100) return null;
              const tip = `${r.job} · ${ph.phase}\n${fmt(s)} → ${fmt(e)}${ph.est ? `\nEst. finish ${fmt(ph.est)}` : ""}\nTarget ${fmt(t)}\n${ph.remaining == null ? "No hours budget" : `${ph.remaining} h left at ${ph.rate} h/wk`}${ph.people ? `\n${ph.people}` : "\nNobody planned"}\n${LABEL[ph.status] ?? ph.status}`;
              return (
                <span key={ph.phase}>
                  <span className={`g-bar ${ph.status} ${r.color}${dd ? " dragging" : ""}${busy === k ? " busy" : ""}`} style={{ left: `${left}%`, width: `${Math.max(ph.status === "over_hours" ? 4.5 : 0.6, right - left)}%` }} title={tip} onPointerDown={(ev) => down(ev, r, ph, "move")} onClick={() => { if (touch.current) openCard(r.projectId); }}>
                    <span className="g-txt">{ph.short}{ph.status === "over_hours" ? " over" : ""}</span>
                    <span className="g-handle" onPointerDown={(ev) => down(ev, r, ph, "end")} />
                  </span>
                  {t && pct(t) >= 0 && pct(t) <= 100 && <span className={`g-target${ph.est && t < ph.est ? " late" : ""}`} style={{ left: `${pct(t)}%` }} title={`Target ${fmt(t)}`}>◆</span>}
                </span>);
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

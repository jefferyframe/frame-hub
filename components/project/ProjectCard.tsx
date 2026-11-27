"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CardData, CardEntry, CardPhase } from "@/lib/projectCard";
import { logHoursAction, updateEntryAction, deleteEntryAction, saveAssignmentAction, removeAssignmentAction, setPhaseDatesAction, addProjectTaskAction, type Res } from "@/app/projects/cardActions";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/calc/schedule";

const fmtH = (n: number | null | undefined) => (n == null ? "—" : (Math.round(n * 100) / 100).toLocaleString("en-US"));
const fmt$ = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmtD = (d: string | null | undefined, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => (d ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o }) : "—");
const fmtDay = (d: string | null) => fmtD(d, { weekday: "short", month: "short", day: "numeric" });
const pctS = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const PROJECT_LABEL: Record<string, string> = { active: "Active", on_hold: "On hold", phase_complete: "Phase complete", closeout: "Closeout", archived: "Archived" };

export function SchedPill({ s }: { s: keyof typeof STATUS_LABEL | null | undefined }) {
  if (!s) return null;
  return <span className={`pill ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span>;
}

function Burn({ worked, assigned }: { worked: number; assigned: number }) {
  if (!(assigned > 0)) return <div className="burn none"><span className="small faint">no hours assigned</span></div>;
  const p = worked / assigned;
  const tone = p > 1 ? "bad" : p >= 0.9 ? "warn" : "";
  return (
    <div className={`burn ${tone}`} title={`${fmtH(worked)} of ${fmtH(assigned)} h`}>
      <div className="burn-track"><div className="burn-fill" style={{ width: `${Math.min(100, p * 100)}%` }} /></div>
      <span className="small">{pctS(p)}</span>
    </div>
  );
}

type Tab = "hours" | "schedule" | "cost" | "activity";

export function ProjectCard({ data: initial, onClose, full = false }: { data: CardData; onClose?: () => void; full?: boolean }) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<Tab>("hours");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => setD(initial), [initial]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), msg.err ? 6000 : 2800); return () => clearTimeout(t); }, [msg]);

  async function run(key: string, fn: () => Promise<Res<CardData>>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) { setMsg({ text: r.error, err: true }); return false; }
      if (r.data) setD(r.data);
      if (ok) setMsg({ text: ok });
      router.refresh();
      return true;
    } catch (e) { setMsg({ text: (e as Error).message || "Something went wrong.", err: true }); return false; }
    finally { setBusy(null); }
  }

  const ro = d.status === "archived";
  const cur = d.phases.find((p) => p.isCurrent);
  return (
    <div className={`pcard${full ? " full" : ""}`}>
      <header className="pc-head">
        <div className="pc-title">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono pc-job">{d.jobNumber}</span>
            <span className={`pill ${d.status === "active" ? "accent" : d.status === "on_hold" ? "warn" : ""}`}>{PROJECT_LABEL[d.status] ?? d.status}</span>
            <SchedPill s={d.schedule.status} />
          </div>
          <h2>{d.name}</h2>
          <dl className="pc-meta">
            <div><dt>Client</dt><dd>{d.client ?? "—"}{d.clientContact ? <span className="faint"> · {d.clientContact}</span> : null}</dd></div>
            <div><dt>Lead</dt><dd>{d.lead ?? "—"}</dd></div>
            <div><dt>Team</dt><dd>{d.team ?? "—"}</dd></div>
            <div><dt>Phase</dt><dd>{d.currentPhase ?? "—"}</dd></div>
            <div><dt>Target</dt><dd className={d.target && d.target < d.today && (cur?.remaining ?? 0) > 0 ? "hl-bad" : ""}>{fmtD(d.target)}</dd></div>
            <div><dt>Est. finish</dt><dd>{fmtD(cur?.estFinish ?? d.schedule.finish)}</dd></div>
          </dl>
        </div>
        <div className="pc-actions">
          {!full && <Link className="btn sm ghost" href={`/projects/${d.id}`}>Full job page</Link>}
          {onClose && <button className="btn sm pc-close" onClick={onClose} aria-label="Close">✕</button>}
        </div>
      </header>

      <div className="pc-body">
        <div className="pc-kpis">
          <div><span className="label">Assigned</span><b>{fmtH(d.cost.hoursAssigned)}</b></div>
          <div><span className="label">Worked</span><b>{fmtH(d.cost.hoursCompleted)}</b></div>
          <div><span className="label">Remaining</span><b className={d.cost.hoursRemaining < 0 ? "neg" : ""}>{fmtH(d.cost.hoursRemaining)}</b></div>
          <div><span className="label">Cost to date</span><b>{fmt$(d.cost.costToDate)}</b></div>
          <div><span className="label">Budget used</span><b className={(d.cost.budgetUsed ?? 0) > 1 ? "neg" : ""}>{pctS(d.cost.budgetUsed)}</b></div>
        </div>

        {!ro && <LogForm d={d} busy={busy === "log"} onLog={(f) => run("log", () => logHoursAction(f), `Logged ${f.hours} h`)} />}
        {ro && <p className="notice">Archived — read-only. Reopen it to closeout to log hours.</p>}

        <div className="seg pc-tabs" role="tablist">
          {([["hours", "Hours"], ["schedule", "Schedule"], ["cost", "Job cost"], ["activity", "Activity & tasks"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === "hours" && (
          <>
            <section className="pc-sec">
              <h3>Hours by phase</h3>
              <div className="ph-list">
                <div className="ph-row ph-headrow"><span>Phase</span><span className="r">Assigned</span><span className="r">Worked</span><span className="r">Left</span><span>Burn</span></div>
                {d.phases.map((p) => (
                  <div key={p.phase} className={`ph-row${p.isCurrent ? " cur" : ""}${p.done ? " done" : ""}`}>
                    <span className="ph-name">{p.phase}<span className="small faint">{p.isCurrent ? " · current" : p.done ? " · done" : ""}{p.target ? ` · due ${fmtD(p.target, { month: "short", day: "numeric" })}` : ""}</span></span>
                    <span className="r num">{fmtH(p.assigned)}</span>
                    <span className="r num">{fmtH(p.worked)}</span>
                    <span className={`r num${p.assigned > 0 && p.remaining < 0 ? " neg" : ""}`}>{p.assigned > 0 ? fmtH(p.remaining) : "—"}</span>
                    <Burn worked={p.worked} assigned={p.assigned} />
                  </div>
                ))}
              </div>
            </section>
            <Entries d={d} busy={busy} run={run} />
          </>
        )}

        {tab === "schedule" && <SchedulePanel d={d} ro={ro} busy={busy} run={run} />}

        {tab === "cost" && (
          <section className="pc-sec">
            <h3>Job cost</h3>
            <div className="pc-costgrid">
              <div><span className="label">Total fee</span><b>{fmt$(d.cost.totalFee)}</b><span className="small faint">architecture {fmt$(d.cost.archFee)} + consultants {fmt$(d.cost.consultantTotal)}</span></div>
              <div><span className="label">Budget (fee × profit %)</span><b>{fmt$(d.cost.totalBudget)}</b><span className="small faint">expected profit {fmt$(d.cost.expectedProfit)}</span></div>
              <div><span className="label">Hours allowance</span><b>{fmtH(d.cost.hoursAllowance)}</b><span className="small faint">budget ÷ {fmt$(d.cost.burdenRate)}/h</span></div>
              <div><span className="label">Cost to date</span><b>{fmt$(d.cost.costToDate)}</b><span className="small faint">{fmtH(d.cost.hoursCompleted)} h × {fmt$(d.cost.burdenRate)}</span></div>
              <div><span className="label">Budget left</span><b className={d.cost.totalBudget - d.cost.costToDate < 0 ? "neg" : ""}>{fmt$(d.cost.totalBudget - d.cost.costToDate)}</b><span className="small faint">{pctS(d.cost.budgetUsed)} used</span></div>
              <div><span className="label">Phase fees</span><b>{fmt$(d.phases.reduce((s, p) => s + p.fee, 0))}</b><span className="small faint">phases shown</span></div>
            </div>
            {d.cost.warnings.length > 0 && <p className="notice" style={{ marginTop: 10 }}>{d.cost.warnings.join(" ")}</p>}
            <h3 style={{ marginTop: 18 }}>Consultants</h3>
            {d.consultants.length ? (
              <ul className="plain small">{d.consultants.map((c) => (
                <li key={c.discipline} className="row" style={{ justifyContent: "space-between" }}><span><b>{c.discipline}</b>{c.firm ? <span className="faint"> · {c.firm}</span> : null}</span><span className="row" style={{ gap: 8 }}><span className="num">{fmt$(c.total)}</span>{c.status ? <span className={`pill ${c.status === "Off Task" ? "bad" : c.status === "Complete" ? "ok" : "accent"}`}>{c.status}</span> : <span className="faint">no status</span>}</span></li>
              ))}</ul>
            ) : <p className="small muted">No consultants on this job.</p>}
            {d.billing || d.notes ? <><h3 style={{ marginTop: 18 }}>Notes</h3><p className="small">{d.billing ? <span className="pill">{d.billing}</span> : null} {d.notes}</p></> : null}
          </section>
        )}

        {tab === "activity" && <ActivityPanel d={d} ro={ro} busy={busy} run={run} />}
      </div>
      <div className={`toast${msg?.err ? " err" : ""}`} data-show={!!msg} role="status" aria-live="polite">{msg?.text}</div>
    </div>
  );
}

// ---------------------------------------------------------------- log hours
const QUICK = [0.5, 1, 2, 4, 8];
function LogForm({ d, busy, onLog }: { d: CardData; busy: boolean; onLog: (f: { project_id: string; phase: string; member_id: string; work_date: string; hours: string; notes: string }) => Promise<boolean> }) {
  const [member, setMember] = useState(d.me.memberId ?? "");
  const [day, setDay] = useState(d.today);
  const [phase, setPhase] = useState(d.currentPhase ?? d.phaseNames[0] ?? "");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form className="pc-log" onSubmit={async (e) => { e.preventDefault(); if (await onLog({ project_id: d.id, phase, member_id: member, work_date: day, hours, notes })) { setHours(""); setNotes(""); } }}>
      <div className="pc-log-h"><b>Log hours</b>{d.me.memberId ? <span className="small muted">You’ve logged {fmtH(d.myWeek)} h here this week</span> : <span className="small warnt">“{d.me.name}” isn’t on the team list — pick who worked</span>}</div>
      <div className="pc-log-grid">
        <label className="f"><span>Who</span><select value={member} onChange={(e) => setMember(e.target.value)} required><option value="">Pick a person…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f"><span>Date</span><input type="date" value={day} max={d.today} onChange={(e) => setDay(e.target.value)} required /></label>
        <label className="f"><span>Phase</span><select value={phase} onChange={(e) => setPhase(e.target.value)}>{d.phaseNames.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="f"><span>Hours</span><input type="number" inputMode="decimal" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0.00" required /></label>
        <label className="f wide"><span>Details</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you worked on (e.g. CD set: wall sections, RFI #12 response)" rows={2} /></label>
      </div>
      <div className="pc-log-foot">
        <div className="chips" style={{ margin: 0 }}>{QUICK.map((q) => <button type="button" key={q} className="chip" data-on={Number(hours) === q} onClick={() => setHours(String(q))}>{q} h</button>)}</div>
        <span className="spacer" />
        <button className="btn primary" disabled={busy || !member || !hours}>{busy ? "Saving…" : "Log hours"}</button>
      </div>
    </form>
  );
}

function Entries({ d, busy, run }: { d: CardData; busy: string | null; run: (k: string, fn: () => Promise<Res<CardData>>, ok?: string) => Promise<boolean> }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = all ? d.entries : d.entries.slice(0, 12);
  return (
    <section className="pc-sec">
      <h3>Recent entries <span className="small faint">· {d.entries.length}{d.entries.length >= 80 ? "+" : ""} shown</span></h3>
      {d.entries.length === 0 ? <p className="small muted">No hours logged yet.</p> : (
        <ul className="ent-list">{list.map((e) => edit === e.id
          ? <EntryEdit key={e.id} e={e} d={d} busy={busy === `e-${e.id}`} onCancel={() => setEdit(null)} onSave={async (f) => { if (await run(`e-${e.id}`, () => updateEntryAction(d.id, e.id, f), "Entry updated")) setEdit(null); }} />
          : (
            <li key={e.id} className="ent">
              <div className="ent-main">
                <div className="ent-top"><b>{e.person ?? "—"}</b><span className="num">{fmtH(e.hours)} h</span></div>
                <div className="small muted">{e.day ? fmtDay(e.day) : `Week ${e.week ? `thru ${fmtD(e.week, { month: "short", day: "numeric" })}` : "—"}`} · {e.phase}{e.fromSheet ? " · from Job List" : ""}</div>
                {e.notes && <div className="ent-notes small">{e.notes}</div>}
              </div>
              {e.canEdit && <div className="ent-act"><button className="linkbtn" onClick={() => setEdit(e.id)}>Edit</button><button className="linkbtn danger" disabled={busy === `d-${e.id}`} onClick={() => { if (confirm(`Delete ${e.hours} h on ${e.day ?? e.week}?`)) run(`d-${e.id}`, () => deleteEntryAction(d.id, e.id), "Entry deleted"); }}>Delete</button></div>}
            </li>))}
        </ul>
      )}
      {d.entries.length > 12 && <button className="linkbtn" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${d.entries.length}`}</button>}
    </section>
  );
}

function EntryEdit({ e, d, busy, onSave, onCancel }: { e: CardEntry; d: CardData; busy: boolean; onSave: (f: { phase: string; work_date: string; hours: string; notes: string }) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState(e.phase), [day, setDay] = useState(e.day ?? d.today), [hours, setHours] = useState(String(e.hours)), [notes, setNotes] = useState(e.notes ?? "");
  return (
    <li className="ent editing">
      <form className="pc-log-grid" onSubmit={(ev) => { ev.preventDefault(); onSave({ phase, work_date: day, hours, notes }); }}>
        <label className="f"><span>Date</span><input type="date" value={day} onChange={(x) => setDay(x.target.value)} /></label>
        <label className="f"><span>Phase</span><select value={phase} onChange={(x) => setPhase(x.target.value)}>{d.phaseNames.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="f"><span>Hours</span><input type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(x) => setHours(x.target.value)} /></label>
        <label className="f wide"><span>Details</span><textarea rows={2} value={notes} onChange={(x) => setNotes(x.target.value)} /></label>
        <div className="row wide"><button className="btn sm primary" disabled={busy}>Save</button><button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button></div>
      </form>
    </li>
  );
}

// ---------------------------------------------------------------- schedule
function SchedulePanel({ d, ro, busy, run }: { d: CardData; ro: boolean; busy: string | null; run: (k: string, fn: () => Promise<Res<CardData>>, ok?: string) => Promise<boolean> }) {
  const open = d.phases.filter((p) => !p.done);
  return (
    <section className="pc-sec">
      <h3>Plan <span className="small faint">· who’s on it, hours a week, and when it finishes</span></h3>
      <p className="small muted" style={{ margin: "0 0 10px" }}>Duration = hours left ÷ the team’s hours a week on the phase. “Auto” gives the phase an even share of the person’s free week. Phases run one after another unless you set a start.</p>
      {open.length === 0 && <p className="small muted">No open phases.</p>}
      {open.map((p) => <PhasePlan key={p.phase} p={p} d={d} ro={ro} busy={busy} run={run} />)}
    </section>
  );
}

function PhasePlan({ p, d, ro, busy, run }: { p: CardPhase; d: CardData; ro: boolean; busy: string | null; run: (k: string, fn: () => Promise<Res<CardData>>, ok?: string) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState(""), [mode, setMode] = useState<"auto" | "hours" | "pct">("auto"), [val, setVal] = useState("");
  const [start, setStart] = useState(p.plannedStart ?? ""), [target, setTarget] = useState(p.target ?? "");
  useEffect(() => { setStart(p.plannedStart ?? ""); setTarget(p.target ?? ""); }, [p.plannedStart, p.target]);
  const free = useMemo(() => d.people.filter((x) => !p.people.some((y) => y.memberId === x.id)), [d.people, p.people]);
  return (
    <div className={`plan${p.isCurrent ? " cur" : ""}`}>
      <div className="plan-h">
        <b>{p.phase}</b><SchedPill s={p.status} />
        <span className="spacer" />
        <span className="small muted">{p.remainingPlan == null ? "no hours budget" : `${fmtH(p.remainingPlan)} h left${p.hoursSource === "allowance" ? " (from allowance)" : ""}`} · {fmtH(p.rate)} h/wk{p.weeks != null ? ` · ~${fmtH(p.weeks)} wks` : ""}</span>
      </div>
      <div className="plan-dates small">
        <span>Start <b>{fmtD(p.start, { month: "short", day: "numeric", year: "numeric" })}</b>{p.plannedStart ? "" : <span className="faint"> (auto)</span>}</span>
        <span>Est. finish <b className={p.status === "at_risk" ? "hl-bad" : ""}>{fmtD(p.estFinish)}</b></span>
        <span>Target <b>{fmtD(p.target)}</b></span>
      </div>
      <ul className="plan-people">
        {p.people.map((x) => (
          <li key={x.assignmentId}>
            <span className="who">{x.name}</span>
            <span className="small muted">{fmtH(x.hoursPerWeek)} h/wk · {x.mode === "auto" ? "auto" : x.mode === "pct" ? `${Math.round((x.allocationPct ?? 0) * 100)}% of week` : "set"}</span>
            {!ro && <AllocEdit x={x} busy={busy === `a-${x.assignmentId}`} onSave={(m, v) => run(`a-${x.assignmentId}`, () => saveAssignmentAction({ project_id: d.id, phase: p.phase, member_id: x.memberId, mode: m, value: v }), "Plan updated")} onRemove={() => run(`a-${x.assignmentId}`, () => removeAssignmentAction(d.id, x.assignmentId), `${x.name} taken off ${p.phase}`)} />}
          </li>
        ))}
        {p.people.length === 0 && <li className="small faint">Nobody on this phase yet.</li>}
      </ul>
      {!ro && (
        <div className="plan-edit">
          {adding ? (
            <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run("add", () => saveAssignmentAction({ project_id: d.id, phase: p.phase, member_id: who, mode, value: val }), "Added to plan")) { setAdding(false); setWho(""); setVal(""); setMode("auto"); } }}>
              <select value={who} onChange={(e) => setWho(e.target.value)} required style={{ width: "auto" }}><option value="">Person…</option>{free.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <select value={mode} onChange={(e) => setMode(e.target.value as "auto")} style={{ width: "auto" }}><option value="auto">Auto share</option><option value="hours">Hours / week</option><option value="pct">% of week</option></select>
              {mode !== "auto" && <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder={mode === "hours" ? "h/wk" : "%"} style={{ width: 80 }} required />}
              <button className="btn sm primary" disabled={busy === "add"}>Add</button><button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          ) : <button className="btn sm" onClick={() => setAdding(true)}>+ Add person</button>}
          <form className="row plan-dateform" onSubmit={(e) => { e.preventDefault(); run(`dates-${p.phase}`, () => setPhaseDatesAction(d.id, p.phase, { start_date: start || null, target_date: target || null }), "Dates saved"); }}>
            <label className="f inline"><span>Start</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="f inline"><span>Target</span><input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
            <button className="btn sm" disabled={busy === `dates-${p.phase}`}>Save dates</button>
          </form>
        </div>
      )}
    </div>
  );
}

function AllocEdit({ x, busy, onSave, onRemove }: { x: CardPhase["people"][number]; busy: boolean; onSave: (m: "auto" | "hours" | "pct", v: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(x.mode), [val, setVal] = useState(x.mode === "hours" ? String(x.hoursPerWeek) : x.mode === "pct" ? String(Math.round((x.allocationPct ?? 0) * 100)) : "");
  if (!open) return <span className="row" style={{ gap: 8 }}><button className="linkbtn" onClick={() => setOpen(true)}>Change</button><button className="linkbtn danger" disabled={busy} onClick={onRemove}>Remove</button></span>;
  return (
    <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); onSave(mode, val); setOpen(false); }}>
      <select value={mode} onChange={(e) => setMode(e.target.value as "auto")} style={{ width: "auto" }}><option value="auto">Auto</option><option value="hours">h/wk</option><option value="pct">% of week</option></select>
      {mode !== "auto" && <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" style={{ width: 70 }} required />}
      <button className="btn sm primary" disabled={busy}>Save</button><button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

// ---------------------------------------------------------------- activity & tasks
function ActivityPanel({ d, ro, busy, run }: { d: CardData; ro: boolean; busy: string | null; run: (k: string, fn: () => Promise<Res<CardData>>, ok?: string) => Promise<boolean> }) {
  const [title, setTitle] = useState(""), [due, setDue] = useState(""), [owner, setOwner] = useState(d.me.memberId ?? "");
  return (
    <>
      <section className="pc-sec">
        <h3>Tasks</h3>
        {d.tasks.length ? <ul className="plain small">{d.tasks.map((t) => <li key={t.id} className="row" style={{ justifyContent: "space-between" }}><span style={t.done ? { textDecoration: "line-through", color: "var(--text-faint)" } : undefined}>{t.title}</span><span className="faint">{t.owner ?? "unassigned"} · {t.due ? fmtD(t.due, { month: "short", day: "numeric" }) : "no date"}</span></li>)}</ul> : <p className="small muted">No tasks on this job.</p>}
        {!ro && (
          <form className="row" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await run("task", () => addProjectTaskAction(d.id, { title, due_day: due, owner_id: owner }), "Task added")) { setTitle(""); setDue(""); } }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task for this job" required style={{ flex: "2 1 200px" }} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ flex: "1 1 130px" }} />
            <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ flex: "1 1 120px" }}><option value="">Unassigned</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button className="btn sm" disabled={busy === "task"}>Add task</button>
          </form>
        )}
      </section>
      <section className="pc-sec">
        <h3>Notes & activity</h3>
        {d.timeline.length ? (
          <ul className="timeline">{d.timeline.map((t, i) => <li key={i}><div>{t.summary}</div><div className="faint">{new Date(t.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {t.actor}</div></li>)}</ul>
        ) : <p className="small muted">Nothing yet.</p>}
      </section>
    </>
  );
}

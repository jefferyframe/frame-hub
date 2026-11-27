"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { moveDealAction, createDealAction } from "@/app/crm/actions";
import { useRun, useToast, money, shortDay, timeOf, dayKey } from "./ui";
import type { MemberView } from "@/lib/crm/view";
import { IconGrip, IconChevron, IconFlag, IconPlus } from "@/components/icons";
import { useRouter } from "next/navigation";

export interface DealView {
  id: string; name: string; status: string; company: string | null; contact: string | null; total: number; sent: string | null; daysOut: number | null;
  next: { day: string; at: string | null; overdue: boolean } | null; owner_id: string | null; owner: string | null; job: string | null; flag: "due" | "cold" | null; proposal: string | null;
}
export interface StageView { status: string; label: string; prob: number | null }

const FOLD = "crm.fold.";

export function DealsBoard({ deals: initial, stages, closeStages, allStages, team, nextJob, mode }: {
  deals: DealView[]; stages: StageView[]; closeStages: { status: string; label: string }[]; allStages: string[]; team: MemberView[]; nextJob: string; mode: "deals" | "leads";
}) {
  const [deals, setDeals] = useState(initial);
  useEffect(() => setDeals(initial), [initial]);
  const [owner, setOwner] = useState("all");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ deal: DealView; status: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [fine, setFine] = useState(true);
  const dragRef = useRef<string | null>(null);
  const notify = useToast();
  const router = useRouter();

  useEffect(() => {
    setFolded(new Set(stages.filter((s) => localStorage.getItem(FOLD + s.status) === "1").map((s) => s.status)));
    const q = window.matchMedia("(pointer: fine)"); setFine(q.matches);
    const o = localStorage.getItem("crm.board.owner"); if (o && (o === "all" || team.some((m) => m.id === o))) setOwner(o);
  }, [stages, team]);
  const toggle = (s: string) => setFolded((f) => { const n = new Set(f); if (n.has(s)) { n.delete(s); localStorage.removeItem(FOLD + s); } else { n.add(s); localStorage.setItem(FOLD + s, "1"); } return n; });

  const shown = useMemo(() => deals.filter((d) => owner === "all" || (owner === "none" ? !d.owner_id : d.owner_id === owner)), [deals, owner]);
  const by = useMemo(() => { const m = new Map<string, DealView[]>(); for (const d of shown) m.set(d.status, [...(m.get(d.status) ?? []), d]); return m; }, [shown]);
  const total = shown.reduce((a, d) => a + d.total, 0);

  function requestMove(d: DealView, status: string) {
    if (!status || status === d.status) return;
    if (status === "Sold" || status === "Rejected") setPending({ deal: d, status });
    else void doMove(d, status);
  }
  async function doMove(d: DealView, status: string, extra: { jobNumber?: string; lead?: string; reason?: string } = {}) {
    const stays = stages.some((s) => s.status === status);
    setDeals((ds) => (stays ? ds.map((x) => (x.id === d.id ? { ...x, status } : x)) : ds.filter((x) => x.id !== d.id)));
    if (stays && folded.has(status)) toggle(status);
    setSaving((s) => new Set(s).add(d.id));
    try {
      const r = await moveDealAction(d.id, status, extra);
      if (!r.ok) throw new Error(r.error);
      const data = r.data as { projectId?: string; jobNumber?: string } | undefined;
      const label = closeStages.find((c) => c.status === status)?.label ?? status;
      notify(data?.projectId ? `${d.name} won — project ${data.jobNumber} is open.` : `Moved ${d.name} to ${label}.`, { href: data?.projectId ? `/projects/${data.projectId}` : undefined });
      router.refresh();
    } catch (e) {
      setDeals((ds) => [...ds.filter((x) => x.id !== d.id), d]);
      notify(`Couldn't move ${d.name}: ${(e as Error).message}`, { err: true });
    } finally { setSaving((s) => { const n = new Set(s); n.delete(d.id); return n; }); }
  }

  const drop = (status: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = dragRef.current || e.dataTransfer.getData("text/plain");
    dragRef.current = null; setDragId(null); setOver(null);
    const d = deals.find((x) => x.id === id);
    if (d) requestMove(d, status);
  };
  const dragOver = (key: string) => (e: React.DragEvent) => { if (!dragRef.current) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); };

  return (
    <section className="board">
      <div className="board-bar card">
        <label className="f inline"><span>Owner</span>
          <select value={owner} onChange={(e) => { setOwner(e.target.value); localStorage.setItem("crm.board.owner", e.target.value); }}>
            <option value="all">Everyone ({deals.length})</option>
            {team.map((m) => { const n = deals.filter((d) => d.owner_id === m.id).length; return n ? <option key={m.id} value={m.id}>{m.name} ({n})</option> : null; })}
            <option value="none">No owner ({deals.filter((d) => !d.owner_id).length})</option>
          </select>
        </label>
        <div className="board-sum"><b>{shown.length}</b> {mode === "deals" ? `proposal${shown.length === 1 ? "" : "s"} out` : `lead${shown.length === 1 ? "" : "s"}`}{total > 0 && <> · <b>{money(total)}</b></>}</div>
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => setNewOpen(true)}><IconPlus />{mode === "deals" ? "Add a sent proposal" : "New lead"}</button>
      </div>

      <div className="stages" data-dragging={!!dragId} onDragEnd={() => { dragRef.current = null; setDragId(null); setOver(null); }}>
        <div className="drow dhead" aria-hidden><span /><span>{mode === "deals" ? "Proposal" : "Lead"}</span><span>Client</span><span className="r">Fee</span><span>{mode === "deals" ? "Sent" : "Received"}</span><span>Out</span><span>Next follow-up</span><span /></div>
        {stages.map((s) => {
          const list = by.get(s.status) ?? [];
          const sum = list.reduce((a, d) => a + d.total, 0);
          const f = folded.has(s.status);
          return (
            <section key={s.status} className="stage" data-over={over === s.status} data-folded={f} onDragOver={dragOver(s.status)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={drop(s.status)}>
              <button className="stage-h" onClick={() => toggle(s.status)} aria-expanded={!f}>
                <span className="fold"><IconChevron /></span>
                <span className="st-t">{s.label}</span>
                <span className="cnt">{list.length}</span>
                <span className="st-m"><b>{money(sum)}</b>{s.prob != null && <span className="st-p" title="Chance this stage ends Sold (Settings → stage likelihood)">{Math.round(s.prob * 100)}%</span>}</span>
              </button>
              {!f && (
                <div className="stage-b">
                  {list.length === 0 && <div className="stage-empty">{dragId ? "Drop here" : "Nothing in this stage"}</div>}
                  {list.map((d) => (
                    <div key={d.id} className={`drow deal${d.flag ? ` flag-${d.flag}` : ""}`} draggable={fine && !saving.has(d.id)} data-busy={saving.has(d.id)} data-dragging={dragId === d.id}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; dragRef.current = d.id; setTimeout(() => dragRef.current === d.id && setDragId(d.id), 0); }}>
                      <span className="grip" title="Drag to another stage" aria-hidden><IconGrip /></span>
                      <span className="dr-name"><Link href={`/sales/${d.id}`} draggable={false}>{d.name}</Link>{d.job && <span className="mono faint small"> {d.job}</span>}</span>
                      <span className="dr-co">{d.company ?? d.contact ?? <span className="faint">—</span>}</span>
                      <span className="dr-amt">{d.total ? money(d.total) : <span className="faint">—</span>}</span>
                      <span className="dr-sent">{d.sent ? shortDay(d.sent).replace(/^\w+, /, "") : <span className="faint">—</span>}</span>
                      <span className="dr-days">{d.daysOut != null ? <span className={`pill${d.daysOut >= 30 ? " warn" : ""}`} title="Days since it was sent">{d.daysOut}d</span> : <span className="faint">—</span>}</span>
                      <span className={`dr-next${d.next?.overdue || (!d.next && d.flag === "due") ? " late" : ""}`}>{d.next ? <>{shortDay(d.next.day).replace(/^\w+, /, "")}{d.next.at ? ` · ${timeOf(d.next.at)}` : ""}</> : d.flag === "due" ? "due now" : <span className="faint">none</span>}</span>
                      <span className="dr-meta small">
                        {d.company && <span>{d.company}</span>}
                        {d.total > 0 && <b>{money(d.total)}</b>}
                        {d.daysOut != null && <span className={d.daysOut >= 30 ? "warnt" : ""}>{mode === "deals" ? "out " : ""}{d.daysOut}d</span>}
                        <span className={d.next?.overdue || (!d.next && d.flag === "due") ? "late" : ""}>{d.next ? `next ${shortDay(d.next.day).replace(/^\w+, /, "")}` : d.flag === "due" ? "follow-up due now" : "no follow-up set"}</span>
                      </span>
                      <span className="dr-move">
                        {saving.has(d.id) ? <span className="spin" aria-label="Saving" /> : (
                          <label className="movesel"><span className="ms-l">Move</span>
                            <select value="" aria-label={`Move ${d.name}`} onChange={(e) => requestMove(d, e.target.value)}>
                              <option value="">Move to…</option>
                              {allStages.map((st) => <option key={st} value={st} disabled={st === d.status}>{closeStages.find((c) => c.status === st)?.label ?? st}{st === d.status ? " (now)" : ""}</option>)}
                            </select>
                          </label>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <section className="stage closeout">
          <div className="stage-h static"><span className="fold"><IconFlag /></span><span className="st-t">Close out</span><span className="st-m small muted">Drag a row here or use Move</span></div>
          <div className="drops">
            {closeStages.map((c) => (
              <div key={c.status} className={`drop ${c.status === "Sold" ? "won" : "lost"}`} data-over={over === c.status} onDragOver={dragOver(c.status)} onDragLeave={() => setOver(null)} onDrop={drop(c.status)}>
                {c.label}<span className="small faint">{c.status === "Sold" ? " · opens the project" : " · keeps the record"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {pending && <CloseDialog p={pending} nextJob={nextJob} team={team} onCancel={() => setPending(null)} onConfirm={(x) => { const p = pending; setPending(null); void doMove(p.deal, p.status, x); }} />}
      {newOpen && <NewDeal mode={mode} team={team} stages={allStages.filter((s) => s !== "Sold" && s !== "Rejected")} onClose={() => setNewOpen(false)} />}
    </section>
  );
}

function CloseDialog({ p, nextJob, team, onCancel, onConfirm }: { p: { deal: DealView; status: string }; nextJob: string; team: MemberView[]; onCancel: () => void; onConfirm: (x: { jobNumber?: string; lead?: string; reason?: string }) => void }) {
  const won = p.status === "Sold";
  const [job, setJob] = useState(p.deal.job ?? nextJob);
  const [lead, setLead] = useState(p.deal.owner ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={won ? "Mark won" : "Mark lost"} onClick={onCancel}>
      <form className="card stack" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onConfirm(won ? { jobNumber: job, lead } : { reason }); }}>
        <h2>{won ? `Won: ${p.deal.name}` : `Lost: ${p.deal.name}`}</h2>
        {won ? <>
          <p className="small muted">Marks it Sold and opens the project with the proposal’s phases and fees.</p>
          <div className="fields">
            <label className="f"><span>Job number</span><input value={job} onChange={(e) => setJob(e.target.value)} /></label>
            <label className="f"><span>Project lead</span><select value={lead} onChange={(e) => setLead(e.target.value)}><option value="">Choose…</option>{team.map((m) => <option key={m.id} value={m.first_name}>{m.name}</option>)}</select></label>
          </div>
        </> : <label className="f"><span>Why did we lose it? (optional, saved as a note)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ minHeight: 70 }} /></label>}
        <div className="row"><span className="spacer" /><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><button className={`btn ${won ? "primary" : "danger"}`}>{won ? "Won — open project" : "Mark lost"}</button></div>
      </form>
    </div>
  );
}

function NewDeal({ mode, team, stages, onClose }: { mode: "deals" | "leads"; team: MemberView[]; stages: string[]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", company: "", contact: "", email: "", fee: "", subs: "", status: mode === "deals" ? "Presented" : "Proposal Needed", sent: dayKey(), owner: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v.trim() ? Number(v.replace(/[$,\s]/g, "")) || null : null);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="New deal" onClick={onClose}>
      <form className="card stack" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("new", () => createDealAction({ name: f.name, company: f.company, contact: f.contact, email: f.email, design_fee: n(f.fee), subs_cost: n(f.subs), status: f.status, date_presented: f.status === "Presented" ? f.sent : null, owner_id: f.owner || null }), "Added.", (d) => (d as { id: string } | undefined)?.id ? `/sales/${(d as { id: string }).id}` : undefined);
        if (r) onClose();
      }}>
        <h2>{mode === "deals" ? "Add a proposal that's out" : "New lead"}</h2>
        <p className="small muted">{mode === "deals" ? "For proposals sent outside Frame Hub. Proposals you mark Sent in Proposals show up here on their own." : "An inquiry before there's a proposal."}</p>
        <div className="fields">
          <label className="f wide"><span>Client / project</span><input value={f.name} onChange={set("name")} required placeholder="Client – Project" /></label>
          <label className="f"><span>Company</span><input value={f.company} onChange={set("company")} /></label>
          <label className="f"><span>Contact</span><input value={f.contact} onChange={set("contact")} placeholder="First Last" /></label>
          <label className="f"><span>Contact email</span><input type="email" value={f.email} onChange={set("email")} /></label>
          <label className="f"><span>Owner</span><select value={f.owner} onChange={set("owner")}><option value="">Me</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label className="f"><span>Design fee</span><input inputMode="decimal" value={f.fee} onChange={set("fee")} placeholder="$" /></label>
          <label className="f"><span>Subs / consultants</span><input inputMode="decimal" value={f.subs} onChange={set("subs")} placeholder="$" /></label>
          <label className="f"><span>Stage</span><select value={f.status} onChange={set("status")}>{stages.map((s) => <option key={s}>{s}</option>)}</select></label>
          {f.status === "Presented" && <label className="f"><span>Date sent</span><input type="date" value={f.sent} onChange={set("sent")} /></label>}
        </div>
        <div className="row"><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy === "new" || !f.name.trim()}>{busy === "new" ? "Saving…" : "Add"}</button></div>
      </form>
    </div>
  );
}

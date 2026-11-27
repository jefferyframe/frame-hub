"use client";
import { useMemo, useState, useTransition, useEffect, useCallback } from "react";
import type { Proposal, ProposalItem } from "@/lib/repo/types";
import {
  computeProposal, computeSuggested, suggestConsultantFee, DISCIPLINES, LEGACY_PHASES, BUILDING_TYPES, DELIVERY_TYPES,
  ARCH_MIN_PCT_OF_CONSTRUCTION, ARCH_TARGET_PCT_OF_CONSTRUCTION, ARCH_TARGET_PCT_OF_GROSS, type ItemKind, type Guard,
} from "@/lib/calc/proposal";
import { PHASES } from "@/lib/calc/jobCost";
import { PROJECT_TYPES } from "@/lib/calc/sales";
import { saveProposalAction, suggestFeeAction, draftScopeAction } from "../actions";
import { money, pct } from "@/lib/format";

type Item = { kind: ItemKind; label: string; description: string | null; pct: number | null; amount: number | null; hours: number | null; included: boolean; optional: boolean };
type Lib = { kind: string; label: string; description: string | null; default_pct: number | null; default_amount: number | null };
const NARRATIVE_KEY: Record<string, string> = { sd: "Schematic Design", dd: "Design Development", cd: "Construction Documents", ca: "Construction Administration" };
const nOrNull = (v: string) => { const t = v.replace(/[$,%\s]/g, ""); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const label = (s: string) => s.replace(/_/g, " ");

function MoneyInput({ value, onChange, disabled, placeholder }: { value: number | null; onChange: (n: number | null) => void; disabled?: boolean; placeholder?: string }) {
  const [txt, setTxt] = useState(value === null ? "" : String(value));
  useEffect(() => { setTxt(value === null ? "" : String(value)); }, [value]);
  return <input className="num" inputMode="decimal" value={txt} disabled={disabled} placeholder={placeholder}
    onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange(nOrNull(txt))} />;
}
function PctInput({ value, onChange, disabled }: { value: number | null; onChange: (n: number | null) => void; disabled?: boolean }) {
  const [txt, setTxt] = useState(value === null ? "" : String(+(value * 100).toFixed(3)));
  useEffect(() => { setTxt(value === null ? "" : String(+(value * 100).toFixed(3))); }, [value]);
  return <input className="num" inputMode="decimal" value={txt} disabled={disabled} style={{ maxWidth: 90 }}
    onChange={(e) => setTxt(e.target.value)} onBlur={() => { const n = nOrNull(txt); onChange(n === null ? null : n / 100); }} />;
}
const GuardCard = ({ title, value, min, target, g }: { title: string; value: number; min: number; target: number; g: Guard | null }) => (
  <div className={`notice ${g === "ok" ? "ok" : g === "fail" ? "bad" : ""}`}>
    <div className="row"><b>{g === "ok" ? "✓" : g === "warn" ? "!" : g === "fail" ? "✕" : "–"} {title}</b><span className="spacer" /><span className="mono">{g ? pct(value, 1) : "—"}</span></div>
    <div className="faint">minimum {pct(min, 1)} · target {pct(target, 1)}</div>
  </div>
);

export function ProposalEditor({ proposal, items: initial, library, editable, aiOn, settings }: {
  proposal: Proposal; items: ProposalItem[]; library: Lib[]; editable: boolean; aiOn: boolean; settings: { profitPct: number; burdenRate: number };
}) {
  const [p, setP] = useState(proposal);
  const [items, setItems] = useState<Item[]>(initial.map(({ kind, label, description, pct, amount, hours, included, optional }) => ({ kind, label, description, pct, amount, hours, included, optional })));
  const [dirty, setDirty] = useState(false);
  const [saving, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | ""; text: string } | null>(null);
  const [prec, setPrec] = useState<Awaited<ReturnType<typeof suggestFeeAction>> | null>(null);
  const [drafting, setDrafting] = useState(false);
  const ro = !editable;

  const set = <K extends keyof Proposal>(k: K, v: Proposal[K]) => { setP((x) => ({ ...x, [k]: v })); setDirty(true); };
  const setClient = (k: string, v: string) => { setP((x) => ({ ...x, client: { ...x.client, [k]: v } })); setDirty(true); };
  const setItem = (i: number, patch: Partial<Item>) => { setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const addItem = (it: Item) => { setItems((xs) => [...xs, it]); setDirty(true); };
  const removeItem = (i: number) => { setItems((xs) => xs.filter((_, j) => j !== i)); setDirty(true); };

  const totals = useMemo(() => computeProposal(p, items, settings), [p, items, settings]);
  const consultantsCarried = items.filter((i) => i.kind === "consultant").map((i) => i.label);
  const suggested = useMemo(() => computeSuggested({ construction_cost: p.construction_cost, arch_target_pct: p.arch_target_pct, disciplines: consultantsCarried }), [p.construction_cost, p.arch_target_pct, consultantsCarried.join("|")]);

  const save = useCallback(() => start(async () => {
    setMsg(null);
    try {
      const { title, client, project_name, address, project_type, building_type, delivery_type, construction_cost, fee_basis, arch_fee, arch_target_pct, scope_text_raw, scope_text, phase_narrative, exclusions, terms, valid_until } = p;
      await saveProposalAction(p.id, { title, client, project_name, address, project_type, building_type, delivery_type, construction_cost, fee_basis, arch_fee, arch_target_pct, scope_text_raw, scope_text, phase_narrative, exclusions, terms, valid_until }, items);
      setDirty(false); setMsg({ tone: "ok", text: "Saved." });
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  }), [p, items]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (!ro) save(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [save, ro]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function suggest() {
    const r = await suggestFeeAction(p.building_type ?? p.project_type ?? null, p.delivery_type);
    setPrec(r);
    const anyTyped = p.fee_basis === "fixed" && p.arch_fee;
    if (!anyTyped) set("arch_target_pct", r.suggested_arch_pct); // don't clobber a fee typed by hand (old tool rule)
  }
  async function polish() {
    setDrafting(true); setMsg(null);
    const r = await draftScopeAction({ scope_text_raw: p.scope_text_raw ?? "", project_name: p.project_name ?? p.title, client_name: p.client?.name ?? "", disciplines: consultantsCarried });
    setDrafting(false);
    if ("error" in r && r.error) { setMsg({ tone: "bad", text: r.error }); return; }
    if ("draft" in r && r.draft) {
      const d = r.draft;
      const narrative = { ...p.phase_narrative };
      for (const [k, v] of Object.entries(d.phase_narrative)) narrative[NARRATIVE_KEY[k] ?? k] = v;
      setP((x) => ({ ...x, scope_text: d.polished_scope, phase_narrative: narrative, building_type: d.building_type, delivery_type: d.delivery_type }));
      setDirty(true);
    }
  }
  function applyPhaseTemplate(which: "firm" | "legacy") {
    const others = items.filter((i) => i.kind !== "phase");
    const phases: Item[] = which === "firm"
      ? PHASES.filter((x) => x.feePct > 0).map((x) => ({ kind: "phase", label: x.key, description: null, pct: x.feePct, amount: null, hours: null, included: true, optional: false }))
      : LEGACY_PHASES.map((x) => ({ kind: "phase", label: x.label, description: null, pct: x.pct, amount: null, hours: null, included: true, optional: false }));
    setItems([...phases, ...others]); setDirty(true);
  }

  const section = (kind: ItemKind) => items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === kind);
  const libFor = (kind: string) => library.filter((l) => l.kind === kind && !items.some((i) => i.kind === kind && i.label === l.label));
  const phaseLabels = section("phase").filter((x) => x.it.included).map((x) => x.it.label);

  return (
    <div className="stack">
      {ro && <p className="notice">This proposal is {p.status}. It’s read-only — start a new version to change it.</p>}
      <section className="card stack" id="client">
        <header><h2>1 · Client & project</h2></header>
        <div className="fields">
          <label className="f"><span>Client / company</span><input value={p.client?.name ?? ""} disabled={ro} onChange={(e) => setClient("name", e.target.value)} /></label>
          <label className="f"><span>Project name</span><input value={p.project_name ?? ""} disabled={ro} onChange={(e) => { set("project_name", e.target.value); set("title", e.target.value || p.title); }} /></label>
          <label className="f"><span>Contact name</span><input value={p.client?.contact_name ?? ""} disabled={ro} onChange={(e) => setClient("contact_name", e.target.value)} /></label>
          <label className="f"><span>Contact title</span><input value={p.client?.contact_title ?? ""} disabled={ro} onChange={(e) => setClient("contact_title", e.target.value)} /></label>
          <label className="f"><span>Contact email</span><input type="email" value={p.client?.email ?? ""} disabled={ro} onChange={(e) => setClient("email", e.target.value)} /></label>
          <label className="f"><span>Contact phone</span><input type="tel" value={p.client?.phone ?? ""} disabled={ro} onChange={(e) => setClient("phone", e.target.value)} /></label>
          <label className="f wide"><span>Project address</span><input value={p.address ?? ""} disabled={ro} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="f"><span>Project type (sales)</span><select value={p.project_type ?? ""} disabled={ro} onChange={(e) => set("project_type", e.target.value || null)}><option value="">—</option>{PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f"><span>Building type</span><select value={p.building_type ?? ""} disabled={ro} onChange={(e) => set("building_type", e.target.value || null)}><option value="">—</option>{BUILDING_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}{p.building_type && !BUILDING_TYPES.includes(p.building_type as never) && <option value={p.building_type}>{p.building_type}</option>}</select></label>
          <label className="f"><span>Delivery</span><select value={p.delivery_type ?? ""} disabled={ro} onChange={(e) => set("delivery_type", e.target.value || null)}><option value="">—</option>{DELIVERY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}{p.delivery_type && !DELIVERY_TYPES.includes(p.delivery_type as never) && <option value={p.delivery_type}>{p.delivery_type}</option>}</select></label>
        </div>
      </section>

      <section className="card stack" id="scope">
        <header><h2>2 · Scope</h2>{!ro && <button className="btn sm" disabled={drafting} onClick={polish} title={aiOn ? "" : "Needs ANTHROPIC_API_KEY on the server"}>{drafting ? "Drafting…" : "Polish with Claude"}</button>}</header>
        <label className="f"><span>Rough scope — notes, an email, an outline</span><textarea value={p.scope_text_raw ?? ""} disabled={ro} onChange={(e) => set("scope_text_raw", e.target.value)} placeholder="Describe the project…" /></label>
        <label className="f"><span>Project understanding (as the client will read it)</span><textarea style={{ minHeight: 160 }} value={p.scope_text ?? ""} disabled={ro} onChange={(e) => set("scope_text", e.target.value)} placeholder={aiOn ? "Write it, or polish the rough scope with Claude." : "Write the polished scope here."} /></label>
        {phaseLabels.map((ph) => (
          <label key={ph} className="f"><span>{ph}</span><textarea style={{ minHeight: 80 }} value={p.phase_narrative?.[ph] ?? ""} disabled={ro}
            placeholder={library.find((l) => l.kind === "phase" && l.label === ph)?.description ?? ""}
            onChange={(e) => set("phase_narrative", { ...p.phase_narrative, [ph]: e.target.value })} /></label>
        ))}
      </section>

      <section className="card stack" id="fee">
        <header><h2>3 · Fee</h2>{!ro && <button className="btn sm" onClick={suggest}>Suggest from past proposals</button>}</header>
        <div className="fields">
          <label className="f"><span>Fee basis</span><select value={p.fee_basis} disabled={ro} onChange={(e) => set("fee_basis", e.target.value as Proposal["fee_basis"])}>
            <option value="pct_construction">% of construction cost</option><option value="fixed">Fixed fee</option><option value="hourly_nte">Hourly, not to exceed</option></select></label>
          <label className="f"><span>Construction cost</span><MoneyInput value={p.construction_cost} disabled={ro} onChange={(n) => set("construction_cost", n)} placeholder="15,000,000" /></label>
          {p.fee_basis === "pct_construction"
            ? <label className="f"><span>Target % of construction (min {pct(ARCH_MIN_PCT_OF_CONSTRUCTION, 1)})</span><PctInput value={p.arch_target_pct} disabled={ro} onChange={(n) => set("arch_target_pct", n)} /></label>
            : <label className="f"><span>{p.fee_basis === "fixed" ? "Architectural fee" : "Not-to-exceed amount"}</span><MoneyInput value={p.arch_fee} disabled={ro} onChange={(n) => set("arch_fee", n)} placeholder={suggested.arch ? String(suggested.arch) : ""} /></label>}
          <div className="f"><span className="label">Architectural fee</span><div className="kpi"><div className="value" style={{ fontSize: 22, marginTop: 2 }}>{money(totals.archFee)}</div></div></div>
        </div>
        {prec && (
          <div className="notice ok">
            <b>{prec.basis === "precedent" ? "Grounded in real precedent" : "No close precedent found"}</b> — {prec.basis === "precedent" ? `target set to ${pct(prec.suggested_arch_pct, 2)}, the median of ${prec.precedents.length} similar past Frame proposals.` : `using the firm-wide ${pct(ARCH_TARGET_PCT_OF_CONSTRUCTION)} default.`}
            {prec.precedents.length > 0 && <table className="small" style={{ marginTop: 8 }}><thead><tr><th>Project</th><th className="num">Construction</th><th className="num">Fee % of cost</th></tr></thead>
              <tbody>{prec.precedents.slice(0, 6).map((x, i) => <tr key={i}><td>{x.project_number ? `${x.project_number} ` : ""}{x.project_name ?? x.file}</td><td className="num">{money(x.construction_cost)}</td><td className="num">{pct(x.fee_pct_of_construction, 2)}</td></tr>)}</tbody></table>}
          </div>
        )}

        <div>
          <div className="row"><h3>Architecture by phase</h3><span className="spacer" />{!ro && <><button className="btn sm ghost" onClick={() => applyPhaseTemplate("firm")}>Firm split (job cost)</button><button className="btn sm ghost" onClick={() => applyPhaseTemplate("legacy")}>Old tool split</button></>}</div>
          <div className="tablewrap"><table>
            <thead><tr><th style={{ width: 30 }} /><th>Phase</th><th className="num">% of fee</th><th className="num">Amount</th>{!ro && <th />}</tr></thead>
            <tbody>{section("phase").map(({ it, i }) => (
              <tr key={i}>
                <td><input type="checkbox" checked={it.included} disabled={ro} onChange={(e) => setItem(i, { included: e.target.checked })} /></td>
                <td><input value={it.label} disabled={ro} onChange={(e) => setItem(i, { label: e.target.value })} /></td>
                <td className="num"><PctInput value={it.pct} disabled={ro || it.amount !== null} onChange={(n) => setItem(i, { pct: n })} /></td>
                <td className="num"><MoneyInput value={it.amount} disabled={ro} onChange={(n) => setItem(i, { amount: n })} placeholder={money(totals.archFee * (it.pct ?? 0))} /></td>
                {!ro && <td><button className="btn sm ghost" onClick={() => removeItem(i)} aria-label="Remove">✕</button></td>}
              </tr>))}</tbody>
            <tfoot><tr><td /><td>Phases {totals.phasePctTotal ? `(${pct(totals.phasePctTotal, 1)})` : ""}</td><td /><td className="num">{money(totals.phasesTotal)}</td>{!ro && <td />}</tr></tfoot>
          </table></div>
          {!ro && <div className="row" style={{ marginTop: 8 }}><select defaultValue="" onChange={(e) => { const l = library.find((x) => x.kind === "phase" && x.label === e.target.value); if (l) addItem({ kind: "phase", label: l.label, description: null, pct: l.default_pct ?? 0, amount: null, hours: null, included: true, optional: false }); e.target.value = ""; }} style={{ maxWidth: 260 }}>
            <option value="">+ Add a phase…</option>{libFor("phase").map((l) => <option key={l.label}>{l.label}</option>)}</select></div>}
        </div>

        <div>
          <h3>Engineers Frame carries</h3>
          <div className="tablewrap"><table>
            <thead><tr><th>Discipline</th><th className="hide-sm">Firm</th><th className="num">Suggested</th><th className="num">Fee</th><th>Optional</th><th className="hide-sm" />{!ro && <th />}</tr></thead>
            <tbody>{section("consultant").map(({ it, i }) => (
              <tr key={i}>
                <td>{it.label}</td>
                <td className="hide-sm"><input value={it.description ?? ""} disabled={ro} placeholder="Engineer firm" onChange={(e) => setItem(i, { description: e.target.value })} /></td>
                <td className="num muted">{money(suggested[it.label] ?? suggestConsultantFee(totals.archFee, it.label))}</td>
                <td className="num"><MoneyInput value={it.amount} disabled={ro} onChange={(n) => setItem(i, { amount: n })} /></td>
                <td><input type="checkbox" checked={it.optional} disabled={ro} onChange={(e) => setItem(i, { optional: e.target.checked })} /></td>
                <td className="hide-sm"><a className="btn sm ghost" href={`/api/proposals/${p.id}/engineer-scope?discipline=${encodeURIComponent(it.label)}`} title="Scope sheet to send this engineer for their fee (save first)">Scope PDF</a></td>
                {!ro && <td><button className="btn sm ghost" onClick={() => removeItem(i)} aria-label="Remove">✕</button></td>}
              </tr>))}</tbody>
          </table></div>
          {!ro && <div className="row" style={{ marginTop: 8 }}>
            {DISCIPLINES.filter((d) => !consultantsCarried.includes(d.label)).map((d) => (
              <button key={d.key} className="btn sm" onClick={() => addItem({ kind: "consultant", label: d.label, description: null, pct: null, amount: suggested[d.label] ?? suggestConsultantFee(totals.archFee, d.label), hours: null, included: true, optional: false })}>+ {d.label}</button>
            ))}
          </div>}
        </div>

        {(["additional_service", "reimbursable"] as const).map((kind) => (
          <div key={kind}>
            <h3>{kind === "additional_service" ? "Additional services" : "Reimbursables"}</h3>
            {section(kind).length > 0 && <div className="tablewrap"><table>
              <thead><tr><th>Item</th><th className="num">Amount</th><th>Optional</th>{!ro && <th />}</tr></thead>
              <tbody>{section(kind).map(({ it, i }) => (
                <tr key={i}>
                  <td><input value={it.label} disabled={ro} onChange={(e) => setItem(i, { label: e.target.value })} /></td>
                  <td className="num"><MoneyInput value={it.amount} disabled={ro} onChange={(n) => setItem(i, { amount: n })} placeholder="hourly / at cost" /></td>
                  <td><input type="checkbox" checked={it.optional} disabled={ro} onChange={(e) => setItem(i, { optional: e.target.checked })} /></td>
                  {!ro && <td><button className="btn sm ghost" onClick={() => removeItem(i)} aria-label="Remove">✕</button></td>}
                </tr>))}</tbody>
            </table></div>}
            {!ro && <select defaultValue="" style={{ maxWidth: 320, marginTop: 6 }} onChange={(e) => {
              const v = e.target.value; e.target.value = "";
              if (!v) return;
              const l = library.find((x) => x.kind === kind && x.label === v);
              addItem({ kind, label: v === "__new" ? "New item" : v, description: l?.description ?? null, pct: null, amount: l?.default_amount ?? null, hours: null, included: true, optional: kind === "additional_service" });
            }}><option value="">+ Add…</option>{libFor(kind).map((l) => <option key={l.label}>{l.label}</option>)}<option value="__new">Something else</option></select>}
          </div>
        ))}

        <div className="grid g2">
          <GuardCard title="Architecture ÷ gross contract" value={totals.archPctOfGross} min={ARCH_TARGET_PCT_OF_GROSS} target={ARCH_TARGET_PCT_OF_GROSS} g={totals.consultantsTotal > 0 ? totals.guards.archOfGross : null} />
          <GuardCard title="Architecture ÷ construction cost" value={totals.archPctOfConstruction} min={ARCH_MIN_PCT_OF_CONSTRUCTION} target={ARCH_TARGET_PCT_OF_CONSTRUCTION} g={totals.guards.archOfConstruction} />
        </div>
      </section>

      <section className="card stack" id="terms">
        <header><h2>4 · Exclusions & terms</h2></header>
        <label className="f"><span>Exclusions (one per line)</span><textarea value={p.exclusions ?? ""} disabled={ro} onChange={(e) => set("exclusions", e.target.value)}
          placeholder={library.filter((l) => l.kind === "exclusion").map((l) => l.label).join("\n")} /></label>
        <label className="f"><span>Terms</span><textarea value={p.terms ?? ""} disabled={ro} onChange={(e) => set("terms", e.target.value)} /></label>
        <label className="f" style={{ maxWidth: 220 }}><span>Valid until</span><input type="date" value={p.valid_until ?? ""} disabled={ro} onChange={(e) => set("valid_until", e.target.value || null)} /></label>
      </section>

      <div className="card noprint" style={{ position: "sticky", bottom: 12, zIndex: 5 }}>
        <div className="row">
          <div><div className="label">Total fee</div><div className="mono" style={{ fontSize: 20 }}>{money(totals.total)}</div></div>
          <div className="small muted hide-sm">Arch {money(totals.archFee)} · engineers {money(totals.consultantsTotal)} · added {money(totals.additionalTotal + totals.reimbursablesTotal)}{totals.optionalTotal ? ` · options ${money(totals.optionalTotal)}` : ""}{totals.feePctOfConstruction ? ` · ${pct(totals.feePctOfConstruction, 1)} of construction` : ""}</div>
          <span className="spacer" />
          {msg && <span className={`small ${msg.tone === "bad" ? "" : "muted"}`} style={msg.tone === "bad" ? { color: "var(--danger)" } : undefined}>{msg.text}</span>}
          {!ro && <button className="btn primary" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>}
        </div>
        {totals.warnings.length > 0 && <div className="small" style={{ color: "var(--warning)", marginTop: 6 }}>{totals.warnings.join(" ")}</div>}
      </div>
    </div>
  );
}

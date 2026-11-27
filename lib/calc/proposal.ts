/**
 * Proposal fee math. Combines the firm's job-cost phase split (5/10/20/40/5/20) with the
 * fee rules found in the first quoting tool (frame-quoting, lib/types.ts):
 *   ARCH_TARGET_PCT_OF_CONSTRUCTION 5 %, ARCH_MIN_PCT_OF_CONSTRUCTION 4.5 %,
 *   ARCH_TARGET_PCT_OF_GROSS 55 %, per-discipline midpoint % (Structural 17.5 % …).
 */
import { num, sum, round2 } from "./util";
import { PHASES, PHASE_NAMES, hoursAllowance, DEFAULT_BURDEN_RATE, DEFAULT_PROFIT_PCT } from "./jobCost";

export const ARCH_TARGET_PCT_OF_CONSTRUCTION = 0.05;
export const ARCH_MIN_PCT_OF_CONSTRUCTION = 0.045;
export const ARCH_TARGET_PCT_OF_GROSS = 0.55;

/** Old tool's DISCIPLINES (lib/types.ts): key, label, midpoint share of the gross contract, and
 *  the solicitation note used on the per-engineer scope PDF. Labels match the job-cost sheet. */
export const DISCIPLINES = [
  { key: "structural", label: "Structural", midPct: 0.175, note: "Gravity and lateral system design, foundation design, and coordination with the architectural and civil drawings through all phases." },
  { key: "mechanical", label: "Mechanical", midPct: 0.1, note: "HVAC system design, load calculations, energy code compliance, and coordination with the architectural reflected ceiling plan and electrical loads." },
  { key: "plumbing", label: "Plumbing", midPct: 0.065, note: "Domestic water, sanitary, and storm drainage system design, fixture layout coordination, and gas piping where applicable." },
  { key: "electrical", label: "Electrical", midPct: 0.1, note: "Power distribution, lighting design, low-voltage/data rough-in coordination, and standby power where applicable." },
  { key: "civil", label: "Civil", midPct: 0.065, note: "Site grading, utility connections, drainage design, and coordination with the governing jurisdiction's civil review requirements." },
  { key: "landscape", label: "Landscape", midPct: 0.04, note: "Planting design, irrigation, and hardscape coordination consistent with the jurisdiction's landscape ordinance." },
  { key: "fire_protection", label: "Fire Protection", midPct: 0.04, note: "Fire sprinkler and/or fire alarm system design coordinated with the architectural and structural drawings." },
  { key: "survey", label: "Survey", midPct: 0.03, note: "Topographic and boundary survey to establish existing conditions ahead of design." },
  { key: "geotech", label: "GeoTech", midPct: 0.03, note: "Subsurface investigation and geotechnical report to inform foundation design." },
] as const;
export const DISCIPLINE_MID_PCT: Record<string, number> = Object.fromEntries(DISCIPLINES.map((d) => [d.label, d.midPct]));
export const disciplineByKeyOrLabel = (k: string) => DISCIPLINES.find((d) => d.key === k || d.label.toLowerCase() === k.toLowerCase());

/** Old tool's phase split (lib/types.ts PHASES) — kept as a selectable template. */
export const LEGACY_PHASES = [
  { key: "sd", label: "Schematic Design", pct: 0.15 },
  { key: "dd", label: "Design Development", pct: 0.2 },
  { key: "cd", label: "Construction Documents", pct: 0.4 },
  { key: "bn", label: "Bidding / Negotiation", pct: 0.05 },
  { key: "ca", label: "Construction Administration", pct: 0.2 },
] as const;

/** Claude draft vocabularies from the old /api/draft-scope tool schema. */
export const BUILDING_TYPES = ["medical", "restaurant", "multifamily", "office", "retail", "industrial", "residential", "institutional", "educational", "hospitality", "mixed_use", "roofing", "religious", "other"] as const;
export const DELIVERY_TYPES = ["tenant_improvement", "new_construction", "renovation_remodel", "feasibility_study", "master_plan", "on_call_services", "roofing_replacement", "other"] as const;

/** Old fees.ts computeSuggested: arch = round(C × target%), implied gross = arch ÷ 55 %,
 *  each carried discipline = round(gross × midpoint). */
export function computeSuggested(q: { construction_cost?: number | null; arch_target_pct?: number | null; disciplines: string[] }): Record<string, number> {
  const C = num(q.construction_cost);
  const arch = Math.round(C * (num(q.arch_target_pct) || ARCH_TARGET_PCT_OF_CONSTRUCTION));
  const gross = arch > 0 ? arch / ARCH_TARGET_PCT_OF_GROSS : 0;
  const out: Record<string, number> = { arch };
  for (const d of DISCIPLINES) if (q.disciplines.includes(d.label)) out[d.label] = Math.round(gross * d.midPct);
  return out;
}

export type Guard = "ok" | "warn" | "fail";
/** Old FeeForm/ReviewPanel guardrail cards: ✓ at/above target, ! at/above minimum, ✕ below minimum. */
export function guardrail(value: number, min: number, target: number): Guard {
  if (value >= target) return "ok";
  if (value >= min) return "warn";
  return "fail";
}

/** Old /api/suggest-fee: median fee-% of construction from Frame precedents (building + delivery
 *  type, falling back to building type), never below the 4.5 % floor; default 5 % with < 2 matches.
 *  The median is the upper-middle element, as in the original. */
export function suggestArchPct<T extends { fee_pct_of_construction: number | null; building_type?: string | null; delivery_type?: string | null; is_frame_proposal?: boolean | null }>(
  all: T[], buildingType?: string | null, deliveryType?: string | null,
): { suggested_arch_pct: number; basis: "precedent" | "default"; precedents: T[] } {
  const usable = all.filter((p) => p.is_frame_proposal !== false && p.fee_pct_of_construction !== null && p.fee_pct_of_construction !== undefined);
  let precedents = usable.filter((p) => (!buildingType || p.building_type === buildingType) && (!deliveryType || p.delivery_type === deliveryType)).slice(0, 12);
  if (precedents.length < 2) {
    const fb = usable.filter((p) => p.building_type === (buildingType ?? "")).slice(0, 12);
    if (fb.length > precedents.length) precedents = fb;
  }
  const pcts = precedents.map((p) => Number(p.fee_pct_of_construction)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (pcts.length >= 2) {
    return { suggested_arch_pct: Math.max(pcts[Math.floor(pcts.length / 2)], ARCH_MIN_PCT_OF_CONSTRUCTION), basis: "precedent", precedents: precedents.slice(0, 8) };
  }
  return { suggested_arch_pct: ARCH_TARGET_PCT_OF_CONSTRUCTION, basis: "default", precedents: precedents.slice(0, 8) };
}

export type FeeBasis = "fixed" | "pct_construction" | "hourly_nte";
export type ItemKind = "phase" | "consultant" | "additional_service" | "reimbursable" | "exclusion";

export interface ProposalFeeInput {
  fee_basis: FeeBasis;
  arch_fee?: number | null;
  construction_cost?: number | null;
  arch_target_pct?: number | null;
}
export interface ProposalItemInput {
  kind: ItemKind;
  label: string;
  description?: string | null;
  pct?: number | null;
  amount?: number | null;
  hours?: number | null;
  included?: boolean | null;
  optional?: boolean | null;
}

export function architecturalFee(p: ProposalFeeInput): number {
  if (p.fee_basis === "pct_construction") return round2(num(p.construction_cost) * num(p.arch_target_pct ?? ARCH_TARGET_PCT_OF_CONSTRUCTION));
  return num(p.arch_fee);
}

/** A phase line's amount: explicit amount wins, else its % of the architectural fee. */
export const phaseAmount = (archFee: number, it: ProposalItemInput) =>
  it.amount !== null && it.amount !== undefined ? num(it.amount) : round2(archFee * num(it.pct));

export interface ProposalTotals {
  archFee: number;
  phases: { label: string; pct: number; amount: number }[];
  phasePctTotal: number;
  phasesTotal: number;
  consultantsTotal: number;
  additionalTotal: number;
  optionalTotal: number;
  reimbursablesTotal: number;
  total: number; // what the client signs for (optional items excluded)
  feePctOfConstruction: number | null;
  /** Old tool's "Gross Contract Amount" = architecture + carried engineers. */
  gross: number;
  archPctOfGross: number;
  archPctOfConstruction: number;
  guards: { archOfGross: Guard; archOfConstruction: Guard | null };
  hoursAllowance: number;
  warnings: string[];
}

export function computeProposal(p: ProposalFeeInput, items: ProposalItemInput[], opts?: { profitPct?: number; burdenRate?: number }): ProposalTotals {
  const archFee = architecturalFee(p);
  const live = items.filter((i) => i.included !== false);
  const phases = live.filter((i) => i.kind === "phase").map((i) => ({ label: i.label, pct: num(i.pct), amount: phaseAmount(archFee, i) }));
  const firm = (k: ItemKind) => sum(live.filter((i) => i.kind === k && !i.optional).map((i) => i.amount));
  const consultantsTotal = firm("consultant");
  const additionalTotal = firm("additional_service");
  const reimbursablesTotal = firm("reimbursable");
  const optionalTotal = sum(live.filter((i) => i.optional && i.kind !== "phase").map((i) => i.amount));
  const phasesTotal = sum(phases.map((x) => x.amount));
  const phasePctTotal = sum(live.filter((i) => i.kind === "phase" && (i.amount === null || i.amount === undefined)).map((i) => i.pct));
  const total = round2(phasesTotal + consultantsTotal + additionalTotal + reimbursablesTotal);
  const cc = num(p.construction_cost);
  const warnings: string[] = [];
  const pctPhases = live.filter((i) => i.kind === "phase" && (i.amount === null || i.amount === undefined));
  if (pctPhases.length && Math.abs(phasePctTotal - 1) > 0.0001) warnings.push(`Phases cover ${(phasePctTotal * 100).toFixed(1)}% of the architectural fee, not 100%.`);
  if (cc > 0 && archFee > 0 && archFee / cc < ARCH_MIN_PCT_OF_CONSTRUCTION)
    warnings.push(`Architectural fee is ${((archFee / cc) * 100).toFixed(2)}% of construction cost — below the ${(ARCH_MIN_PCT_OF_CONSTRUCTION * 100).toFixed(1)}% floor.`);
  if (archFee <= 0) warnings.push("No architectural fee yet.");
  const gross = archFee + consultantsTotal;
  const archPctOfGross = gross > 0 ? archFee / gross : 0;
  const archPctOfConstruction = cc > 0 ? archFee / cc : 0;
  if (consultantsTotal > 0 && archPctOfGross < ARCH_TARGET_PCT_OF_GROSS)
    warnings.push(`Frame keeps ${(archPctOfGross * 100).toFixed(1)}% of the gross contract — below the 55% guardrail.`);
  return {
    archFee, phases, phasePctTotal, phasesTotal, consultantsTotal, additionalTotal, optionalTotal, reimbursablesTotal, total,
    feePctOfConstruction: cc > 0 ? total / cc : null,
    gross, archPctOfGross, archPctOfConstruction,
    guards: {
      archOfGross: consultantsTotal > 0 ? guardrail(archPctOfGross, ARCH_TARGET_PCT_OF_GROSS, ARCH_TARGET_PCT_OF_GROSS) : "ok",
      archOfConstruction: cc > 0 ? guardrail(archPctOfConstruction, ARCH_MIN_PCT_OF_CONSTRUCTION, ARCH_TARGET_PCT_OF_CONSTRUCTION) : null,
    },
    hoursAllowance: hoursAllowance(archFee, opts?.profitPct ?? DEFAULT_PROFIT_PCT, opts?.burdenRate ?? DEFAULT_BURDEN_RATE),
    warnings,
  };
}

/** Suggested consultant fee for a given arch fee (old fees.ts: gross = arch ÷ 55 %, × midpoint). */
export function suggestConsultantFee(archFee: number, discipline: string): number | null {
  const mid = DISCIPLINE_MID_PCT[discipline];
  if (mid === undefined || archFee <= 0) return null;
  return Math.round((archFee / ARCH_TARGET_PCT_OF_GROSS) * mid);
}

/** Fee-affecting fields: changing any after approval sends the proposal back to review (old PATCH rule). */
export const FEE_AFFECTING = ["construction_cost", "arch_target_pct", "arch_fee", "fee_basis"] as const;

/** Map a proposal phase label to a job-cost template phase. */
const ALIASES: Record<string, string> = {
  "sd": "Schematic Design", "dd": "Design Development", "cd": "Construction Documents", "bn": "Bidding & Permitting", "ca": "Construction Administration",
  "bidding / negotiation": "Bidding & Permitting",
  "bidding & negotiation": "Bidding & Permitting",
  "bidding and permitting": "Bidding & Permitting",
  "permitting": "Bidding & Permitting",
  "feasibility": "Feasability",
  "feasibility study": "Feasability",
  "predesign": "Pre Design",
  "pre-design": "Pre Design",
  "programming": "Pre Design",
  "construction administration": "Construction Administration",
  "construction observation": "Construction Administration",
};
export function toTemplatePhase(label: string): string | null {
  const l = label.trim().toLowerCase();
  const direct = PHASE_NAMES.find((p) => p.toLowerCase() === l);
  if (direct) return direct;
  return ALIASES[l] ?? null;
}

export const DEFAULT_PHASE_ITEMS: ProposalItemInput[] = PHASES.filter((p) => p.feePct > 0).map((p) => ({
  kind: "phase", label: p.key, pct: p.feePct, included: true,
}));

/** Spread a consultant total across phases in proportion to the arch phase split (cents exact). */
export function spreadByPhase(total: number, phases: { phase: string; pct: number }[]): { phase: string; amount: number }[] {
  const weight = sum(phases.map((p) => p.pct));
  if (!phases.length || weight <= 0) return [];
  let left = round2(total);
  return phases.map((p, i) => {
    const amt = i === phases.length - 1 ? left : round2((total * p.pct) / weight);
    left = round2(left - amt);
    return { phase: p.phase, amount: amt };
  });
}

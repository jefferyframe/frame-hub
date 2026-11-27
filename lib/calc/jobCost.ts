/**
 * Job cost math — a port of the "Job Cost Template - Blank" sheet and the
 * workbook's macros (Module1: UpdateJobListFromSheets, GetConsultantStatus,
 * GetPhaseNotes, ApplyJobListConditionalFormatting).
 *
 * Template layout → app:
 *   B10                Architectural fee                                  project.arch_fee
 *   C12..K12           phase share of arch fee (5/10/20/40/5/20/0/0/0 %)   phase.fee_pct
 *   C11..K11           = $B$10 * C12                                       phaseArchFee()
 *   B11                = SUM(C11:K11)                                      feeAllocated
 *   B12                = SUM(C11:K11)  ← sheet bug (repeats B11); app shows SUM of %s → pctAllocated
 *   rows 13–26 A/B/C:K consultant (Civil … Other 5) total fee / fee by phase   project_consultants
 *   B28                = SUM(B10, B13:B26)                                 totalFee
 *   L28, Q28 …         Total Fee For Phase = arch phase fee + consultants that phase  phaseTotalFee
 *   row 7 (L7, Q7 …)   share of hours per phase (10 % each, Interior 20 %) phase.hours_pct
 *   B30                = SUM(L7:BD7)  Total Percentages                    hoursPctTotal
 *   E30                Profit Percentage 0.85                              project.profit_pct
 *   E31                Expected Profit = B10 * (1 - E30)                   expectedProfit
 *   E32                Total Budget = B10 - E31                            totalBudget
 *   E33                Burden Rate 180                                     project.burden_rate
 *   E34                Hours Allowance = ROUNDDOWN(E32 / E33, 0)           hoursAllowance
 *   M10, R10 …         Hours Assigned (typed)                              phase.hours_assigned
 *   N10                = SUM(N31:N430) Hours Completed                     hoursCompleted
 *   O10                = M10 - N10 Hours Remaining                         hoursRemaining
 *   P10 …              Target Completion Date                              phase.target_date
 *   rows 31+           weekly log: Week, Assigned To, Hours Worked, Notes  time_entries
 *   Sheet notes (B88–B91): "Profit Changes per Project / Profit Target Creates Hours /
 *   Hours are auto calculated / Burden Rate Should be Adjustable" → suggestedHours().
 */
import { num, sum, dayNumber } from "./util";

export const PHASES = [
  { key: "Pre Design", short: "PD", feePct: 0.05, hoursPct: 0.1 },
  { key: "Schematic Design", short: "SD", feePct: 0.1, hoursPct: 0.1 },
  { key: "Design Development", short: "DD", feePct: 0.2, hoursPct: 0.1 },
  { key: "Construction Documents", short: "CD", feePct: 0.4, hoursPct: 0.1 },
  { key: "Bidding & Permitting", short: "BP", feePct: 0.05, hoursPct: 0.1 },
  { key: "Construction Administration", short: "CA", feePct: 0.2, hoursPct: 0.1 },
  { key: "Master Planning", short: "MP", feePct: 0, hoursPct: 0.1 },
  { key: "Feasability", short: "FS", feePct: 0, hoursPct: 0.1 }, // spelling as in the workbook
  { key: "Interior Design", short: "ID", feePct: 0, hoursPct: 0.2 },
] as const;
export type PhaseName = (typeof PHASES)[number]["key"];
export const PHASE_NAMES = PHASES.map((p) => p.key) as PhaseName[];

export const CONSULTANT_DISCIPLINES = [
  "Civil", "Landscape", "Structural", "Mechanical", "Plumbing", "Electrical",
  "Fire Protection", "Survey", "GeoTech", "Other 1", "Other 2", "Other 3", "Other 4", "Other 5",
] as const;
export const CONSULTANT_STATUSES = ["On Task", "Off Task", "Complete"] as const;
/** Consultant fee typed only in column B (not split by phase). */
export const UNPHASED = "All phases";

export const DEFAULT_PROFIT_PCT = 0.85;
export const DEFAULT_BURDEN_RATE = 180;

export interface PhaseInput {
  phase: string;
  fee_pct?: number | null;
  arch_fee?: number | null; // explicit override (template row 10 C..K)
  hours_pct?: number | null;
  hours_assigned?: number | null;
  target_date?: string | null;
  status?: string | null;
}
export interface ConsultantInput {
  discipline: string;
  firm?: string | null;
  phase: string;
  fee?: number | null;
  status?: string | null;
}
export interface EntryInput {
  phase: string;
  hours?: number | null;
  notes?: string | null;
  person?: string | null;
  week_label?: string | null;
  week_ending?: string | null;
}
export interface ProjectInput {
  arch_fee?: number | null;
  profit_pct?: number | null;
  burden_rate?: number | null;
  current_phase?: string | null;
}

/** C11 = $B$10 * C12 (an explicit row-10 figure wins). */
export function phaseArchFee(archFee: number | null | undefined, p: Pick<PhaseInput, "fee_pct" | "arch_fee">): number {
  if (p.arch_fee !== null && p.arch_fee !== undefined) return num(p.arch_fee);
  return num(archFee) * num(p.fee_pct);
}

export const expectedProfit = (archFee: number, profitPct: number) => archFee * (1 - profitPct); // E31
export const totalBudget = (archFee: number, profitPct: number) => archFee - expectedProfit(archFee, profitPct); // E32
export const hoursAllowance = (archFee: number, profitPct: number, burdenRate: number) =>
  burdenRate > 0 ? Math.floor(totalBudget(archFee, profitPct) / burdenRate) : 0; // E34

export interface PhaseResult {
  phase: string;
  feePct: number;
  archFee: number;
  consultantFee: number;
  phaseTotalFee: number;
  hoursPct: number;
  hoursAssigned: number;
  hoursCompleted: number;
  hoursRemaining: number;
  suggestedHours: number;
  targetDate: string | null;
  status: string;
  consultantStatus: string;
  latestNote: string;
}

export interface JobCostResult {
  archFee: number;
  feeAllocated: number; // B11
  pctAllocated: number; // what B12 was meant to show
  consultantTotal: number;
  totalFee: number; // B28
  profitPct: number;
  burdenRate: number;
  expectedProfit: number; // E31
  totalBudget: number; // E32
  hoursAllowance: number; // E34
  hoursPctTotal: number; // B30
  hoursAssigned: number;
  hoursCompleted: number;
  hoursRemaining: number;
  /** Not in the sheet: burn = completed ÷ assigned; budget used = completed × burden ÷ budget. */
  burn: number | null;
  budgetUsed: number | null;
  phases: PhaseResult[];
  currentPhase: string | null;
  /** The current phase's row — what the Job List shows (hours assigned/worked/remaining). */
  current: PhaseResult | null;
  warnings: string[];
}

/** GetConsultantStatus macro: consultants with a fee > 0 in this phase → summary text. */
export function consultantStatusSummary(consultants: ConsultantInput[], phase: string): string {
  const withFee = consultants.filter((c) => c.phase === phase && num(c.fee) > 0);
  if (withFee.length === 0) return "None";
  const withStatus = withFee.filter((c) => c.status && c.status !== "NO STATUS HAS BEEN SELECTED");
  if (withStatus.length === 0) return "NO STATUS HAS BEEN SELECTED";
  return withStatus.map((c) => `${c.discipline} (${c.status})`).join("; ");
}

/** GetPhaseNotes macro: the last non-empty, non-numeric note in the phase's log. */
export function latestNote(entries: EntryInput[], phase: string): string {
  let note = "";
  for (const e of entries) {
    if (e.phase !== phase) continue;
    const t = (e.notes ?? "").trim();
    if (t && t !== "Week" && !/^-?\d+(\.\d+)?$/.test(t)) note = t;
  }
  return note;
}

/** GetSelectedPhase "Method 3": the first phase with hours assigned > 0 or any hours logged. */
export function detectCurrentPhase(phases: PhaseInput[], entries: EntryInput[]): string | null {
  for (const p of PHASE_NAMES) {
    const ph = phases.find((x) => x.phase === p);
    const done = sum(entries.filter((e) => e.phase === p).map((e) => e.hours));
    if ((ph && num(ph.hours_assigned) > 0) || done !== 0) return p;
  }
  return null;
}

export function computeJobCost(project: ProjectInput, phases: PhaseInput[], consultants: ConsultantInput[], entries: EntryInput[]): JobCostResult {
  const archFee = num(project.arch_fee);
  const profitPct = project.profit_pct ?? DEFAULT_PROFIT_PCT;
  const burdenRate = project.burden_rate ?? DEFAULT_BURDEN_RATE;
  const allowance = hoursAllowance(archFee, profitPct, burdenRate);
  const ordered = PHASE_NAMES.map((name) => phases.find((p) => p.phase === name) ?? { phase: name })
    .concat(phases.filter((p) => !PHASE_NAMES.includes(p.phase as PhaseName)));

  const results: PhaseResult[] = ordered.map((p) => {
    const def = PHASES.find((d) => d.key === p.phase);
    const feePct = p.fee_pct ?? 0;
    const hoursPct = p.hours_pct ?? def?.hoursPct ?? 0;
    const af = phaseArchFee(archFee, p);
    const cf = sum(consultants.filter((c) => c.phase === p.phase).map((c) => c.fee));
    const done = sum(entries.filter((e) => e.phase === p.phase).map((e) => e.hours));
    const assigned = num(p.hours_assigned);
    return {
      phase: p.phase, feePct, archFee: af, consultantFee: cf, phaseTotalFee: af + cf,
      hoursPct, hoursAssigned: assigned, hoursCompleted: done, hoursRemaining: assigned - done,
      suggestedHours: Math.floor(allowance * hoursPct),
      targetDate: p.target_date ?? null, status: p.status ?? "not_started",
      consultantStatus: consultantStatusSummary(consultants, p.phase),
      latestNote: latestNote(entries, p.phase),
    };
  });

  const consultantTotal = sum(consultants.map((c) => c.fee));
  const hoursAssigned = sum(results.map((r) => r.hoursAssigned));
  const hoursCompleted = sum(entries.map((e) => e.hours));
  const pctAllocated = sum(ordered.map((p) => p.fee_pct));
  const hoursPctTotal = sum(results.map((r) => r.hoursPct));
  const warnings: string[] = [];
  if (archFee > 0 && Math.abs(pctAllocated - 1) > 0.0001) warnings.push(`Phase fee split adds to ${(pctAllocated * 100).toFixed(1)}%, not 100%.`);
  if (Math.abs(hoursPctTotal - 1) > 0.0001) warnings.push(`Hours split adds to ${(hoursPctTotal * 100).toFixed(1)}%, not 100%.`);
  if (allowance > 0 && hoursAssigned > allowance) warnings.push(`Hours assigned (${hoursAssigned}) exceed the hours allowance (${allowance}).`);

  const currentPhase = project.current_phase ?? detectCurrentPhase(ordered, entries);
  return {
    current: results.find((r) => r.phase === currentPhase) ?? null,
    archFee, feeAllocated: sum(results.map((r) => r.archFee)), pctAllocated,
    consultantTotal, totalFee: archFee + consultantTotal,
    profitPct, burdenRate,
    expectedProfit: expectedProfit(archFee, profitPct), totalBudget: totalBudget(archFee, profitPct), hoursAllowance: allowance,
    hoursPctTotal, hoursAssigned, hoursCompleted, hoursRemaining: hoursAssigned - hoursCompleted,
    burn: hoursAssigned > 0 ? hoursCompleted / hoursAssigned : null,
    budgetUsed: totalBudget(archFee, profitPct) > 0 ? (hoursCompleted * burdenRate) / totalBudget(archFee, profitPct) : null,
    phases: results,
    currentPhase,
    warnings,
  };
}

/** ApplyJobListConditionalFormatting: target date yellow within 7 days, red when due/past;
 *  hours remaining red when ≤ 10 % of hours assigned. */
export function jobListFlags(row: { target_date?: string | null; hours_assigned?: number | null; hours_remaining?: number | null }, today: string) {
  let date: "soon" | "overdue" | null = null;
  if (row.target_date) {
    const diff = dayNumber(row.target_date) - dayNumber(today);
    if (diff <= 0) date = "overdue";
    else if (diff <= 7) date = "soon";
  }
  const assigned = num(row.hours_assigned);
  const hoursLow = assigned > 0 && num(row.hours_remaining) <= assigned * 0.1;
  return { date, hoursLow };
}

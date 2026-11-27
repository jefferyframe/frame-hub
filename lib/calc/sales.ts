/**
 * Sales pipeline math — a faithful port of the "Pipeline Tracking" sheet
 * (Tracking Sales Sheet) and its worksheet macro.
 *
 * Sheet → app:
 *   AB  Total Bid            = Z (Subs Cost) + AA (Design Fee)                 → totalBid()
 *   AD..AJ stage buckets       macro UpdateStageValue copies AB into the column
 *                              for the row's status                            → stageBucket()
 *   row 3 Stage Likelihood     AD3..AG3 = 0.5, 1, 0.7, 0.6                      → DEFAULT_STAGE_LIKELIHOOD
 *   row 4 Overall Likelihood   AD4 = AD3*AE3*AF3*AG3, AE4 = AE3*AF3*AG3, …      → overallLikelihoods()
 *   row 5 Sum                  SUM of each bucket column                        → pipelineSummary().stages[].sum
 *   row 6 Total Est. Value     AD6 = AD4*AD5 …; AH6 = SUM(AD6:AG6)              → .weighted / .weightedTotal
 *   AI6 / AJ6                  SUM(Rejected) / SUM(Sold)                        → .rejectedTotal / .soldTotal
 *   AB1                        SUM(AB)                                          → .totalBidAll
 *   AZ SortOrder               macro SortByStatus                               → statusSortOrder()
 *   macro UpdateRowFormatting  auto-advance + red/black row colours             → autoAdvance(), followUpAlert()
 */
import { num, sum, addDays, dayNumber, ratio } from "./util";

export const PIPELINE_STATUSES = [
  "Proposal Needed",
  "Consultant Outreach",
  "Internal Review",
  "Presented",
  "Follow Up 1",
  "Follow Up 1 Completed",
  "Follow Up 2",
  "Follow Up 2 Completed",
  "Sold",
  "Project Completed",
  "Rejected",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PROJECT_TYPES = [
  "Master Planning", "Office", "Public Works", "Healthcare", "Education", "Religious",
  "Residential", "Hospitality", "Industrial", "Interior Design", "Spec", "Other",
] as const;

export type StageKey = "inquiry" | "triaged" | "qualify" | "presented";
export type Bucket = StageKey | "rejected" | "sold";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "inquiry", label: "Inquiry – Need to Triage" },
  { key: "triaged", label: "Triaged – Need to Qualify" },
  { key: "qualify", label: "Qualify – Need Presentation" },
  { key: "presented", label: "Presented – Need to Close" },
];

/** Row 3 of the sheet. Editable in Settings. */
export const DEFAULT_STAGE_LIKELIHOOD: Record<StageKey, number> = {
  inquiry: 0.5,
  triaged: 1,
  qualify: 0.7,
  presented: 0.6,
};

/** Macro SortByStatus: position in the dropdown list, unknown statuses last (999). */
export function statusSortOrder(status: string | null | undefined): number {
  const s = (status ?? "").trim();
  if (s === "Follow Up Completed") return 6; // legacy spelling the macro also accepts
  const i = PIPELINE_STATUSES.indexOf(s as PipelineStatus);
  return i === -1 ? 999 : i + 1;
}

/** Macro UpdateStageValue: which bucket column (AD..AJ) a row's Total Bid lands in. */
export function stageBucket(status: string | null | undefined): Bucket | null {
  switch ((status ?? "").trim()) {
    case "Proposal Needed":
      return "inquiry";
    case "Consultant Outreach":
      return "triaged";
    case "Internal Review":
      return "qualify";
    case "Presented":
    case "Follow Up 1":
    case "Follow Up 1 Completed":
    case "Follow Up 2":
    case "Follow Up 2 Completed":
      return "presented";
    case "Rejected":
      return "rejected";
    case "Sold":
      return "sold";
    default:
      return null; // "Project Completed" and blanks clear every bucket
  }
}

export interface BidFields {
  subs_cost?: number | null;
  design_fee?: number | null;
  total_bid_override?: number | null;
}

/** AB = Z + AA (blank cells count as 0, as in Excel). A typed Total Bid wins. */
export function totalBid(o: BidFields): number {
  if (o.total_bid_override !== null && o.total_bid_override !== undefined) return num(o.total_bid_override);
  return num(o.subs_cost) + num(o.design_fee);
}

/** Row 4: each stage's chance of ending Sold = product of its own and every later stage's likelihood. */
export function overallLikelihoods(l: Record<StageKey, number> = DEFAULT_STAGE_LIKELIHOOD): Record<StageKey, number> {
  const keys = STAGES.map((s) => s.key);
  const out = {} as Record<StageKey, number>;
  keys.forEach((k, i) => {
    out[k] = keys.slice(i).reduce((p, kk) => p * l[kk], 1);
  });
  return out;
}

export interface PipelineRow extends BidFields {
  status: string;
  projected_arch_hours?: number | null;
}

export interface PipelineSummary {
  stages: { key: StageKey; label: string; count: number; sum: number; likelihood: number; overall: number; weighted: number }[];
  weightedTotal: number; // AH6 / AH3
  openTotal: number; // AH1 intent: SUM(AD:AG) unweighted
  rejectedTotal: number; // AI6
  rejectedCount: number;
  soldTotal: number; // AJ6
  soldCount: number;
  totalBidAll: number; // AB1
  projectedHoursOpen: number;
  /** Not in the sheet: Sold ÷ (Sold + Rejected) by count and by value. */
  closeRateCount: number | null;
  closeRateValue: number | null;
}

export function pipelineSummary(rows: PipelineRow[], likelihood: Record<StageKey, number> = DEFAULT_STAGE_LIKELIHOOD): PipelineSummary {
  const overall = overallLikelihoods(likelihood);
  const by: Record<Bucket, { count: number; sum: number }> = {
    inquiry: { count: 0, sum: 0 }, triaged: { count: 0, sum: 0 }, qualify: { count: 0, sum: 0 },
    presented: { count: 0, sum: 0 }, rejected: { count: 0, sum: 0 }, sold: { count: 0, sum: 0 },
  };
  let hours = 0;
  for (const r of rows) {
    const b = stageBucket(r.status);
    if (!b) continue;
    by[b].count++;
    by[b].sum += totalBid(r);
    if (b !== "rejected" && b !== "sold") hours += num(r.projected_arch_hours);
  }
  const stages = STAGES.map((s) => ({
    key: s.key, label: s.label, count: by[s.key].count, sum: by[s.key].sum,
    likelihood: likelihood[s.key], overall: overall[s.key], weighted: overall[s.key] * by[s.key].sum,
  }));
  return {
    stages,
    weightedTotal: sum(stages.map((s) => s.weighted)),
    openTotal: sum(stages.map((s) => s.sum)),
    rejectedTotal: by.rejected.sum, rejectedCount: by.rejected.count,
    soldTotal: by.sold.sum, soldCount: by.sold.count,
    totalBidAll: sum(rows.map(totalBid)),
    projectedHoursOpen: hours,
    closeRateCount: ratio(by.sold.count, by.sold.count + by.rejected.count),
    closeRateValue: ratio(by.sold.sum, by.sold.sum + by.rejected.sum),
  };
}

export interface FollowUpFields {
  status: string;
  date_presented?: string | null; // S
  follow_up_1_date?: string | null; // T
  follow_up_2_date?: string | null; // W
}

/** Macro UpdateRowFormatting step 2: Presented → Follow Up 1 once more than 3 days past
 *  Date Presented; Follow Up 1 Completed → Follow Up 2 once more than 7 days past the
 *  first follow-up date. Returns the status the row should have today. */
export function autoAdvance(o: FollowUpFields, today: string): string {
  const t = dayNumber(today);
  if (o.status === "Presented" && o.date_presented && t > dayNumber(o.date_presented) + 3) return "Follow Up 1";
  if (o.status === "Follow Up 1 Completed" && o.follow_up_1_date && t > dayNumber(o.follow_up_1_date) + 7) return "Follow Up 2";
  return o.status;
}

/** Macro row colours: red = a follow-up is due now; black = second follow-up done
 *  more than 7 days ago with no decision (gone cold). */
export function followUpAlert(o: FollowUpFields, today: string): "due" | "cold" | null {
  const s = autoAdvance(o, today);
  if (s === "Follow Up 1" || s === "Follow Up 2") return "due";
  if (s === "Follow Up 2 Completed" && o.follow_up_2_date && dayNumber(today) > dayNumber(o.follow_up_2_date) + 7) return "cold";
  return null;
}

/** When the next follow-up should happen, for task generation (same 3/7-day rules). */
export function nextFollowUpDue(o: FollowUpFields): { cadence: string; due: string } | null {
  if (o.status === "Presented" && o.date_presented) return { cadence: "opp_follow_up_1", due: addDays(o.date_presented, 4) };
  if (o.status === "Follow Up 1 Completed" && o.follow_up_1_date) return { cadence: "opp_follow_up_2", due: addDays(o.follow_up_1_date, 8) };
  return null;
}

export const isOpen = (status: string) => {
  const b = stageBucket(status);
  return b !== null && b !== "rejected" && b !== "sold";
};

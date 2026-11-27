/**
 * Lead & lag measures — ports of the "Lead Measures" and "Lag Measures" sheets.
 *
 * Lead Measures row 4:  B4 = SUM(B), C4 = IFERROR(D4/B4,""), D4 = SUM(D), E4 = IFERROR(F4/D4,""),
 *   F4 = SUM(F), G4 = IFERROR(H4/F4,""), H4 = SUM(H), I4 = IFERROR(J4/H4,""), J4 = SUM(J),
 *   K4 = IFERROR(L4/J4,""), L4 = SUM(L), M4 = SUM(M)
 *   i.e. each % is the next step ÷ this step (Connection Requests → Responses → Conversations
 *   → Opportunities → Proposals → Yes).
 * Lag Measures row 1:  E1 = COUNTIF(C,"<>")  H1 = COUNTIF(D,"Won")  K1 = COUNTIF(D,"Lost")
 *   N1 = H1/(H1+K1)  (shown as null instead of #DIV/0!).
 */
import { num, ratio } from "./util";

export interface LeadMeasureRow {
  day: string;
  connection_requests: number;
  responses: number;
  conversations: number;
  opportunities: number;
  proposals: number;
  yes: number;
  no: number;
}

export const FUNNEL_STEPS = [
  { key: "connection_requests", label: "Connection requests" },
  { key: "responses", label: "Responses" },
  { key: "conversations", label: "Conversations" },
  { key: "opportunities", label: "Opportunities" },
  { key: "proposals", label: "Proposals" },
  { key: "yes", label: "Yes" },
] as const;

export type FunnelKey = (typeof FUNNEL_STEPS)[number]["key"];

export interface LeadTotals {
  totals: Record<FunnelKey | "no", number>;
  /** C4, E4, G4, I4, K4 — conversion from each step to the next (null = sheet's ""). */
  conversion: { from: FunnelKey; to: FunnelKey; rate: number | null }[];
  /** Not in the sheet: decided proposals that were a yes. */
  closeRate: number | null;
}

export function leadTotals(rows: LeadMeasureRow[]): LeadTotals {
  const t = { connection_requests: 0, responses: 0, conversations: 0, opportunities: 0, proposals: 0, yes: 0, no: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += num(r[k]);
  const conversion = FUNNEL_STEPS.slice(0, -1).map((s, i) => ({
    from: s.key, to: FUNNEL_STEPS[i + 1].key, rate: ratio(t[FUNNEL_STEPS[i + 1].key], t[s.key]),
  }));
  return { totals: t, conversion, closeRate: ratio(t.yes, t.yes + t.no) };
}

/** Bucket daily rows into weeks (Monday start) or months for trend charts. */
export function leadTrend(rows: LeadMeasureRow[], by: "week" | "month"): (LeadMeasureRow & { period: string })[] {
  const map = new Map<string, LeadMeasureRow & { period: string }>();
  for (const r of rows) {
    let period: string;
    if (by === "month") period = r.day.slice(0, 7);
    else {
      const d = new Date(r.day + "T00:00:00Z");
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      period = d.toISOString().slice(0, 10);
    }
    const cur = map.get(period) ?? { period, day: period, connection_requests: 0, responses: 0, conversations: 0, opportunities: 0, proposals: 0, yes: 0, no: 0 };
    for (const k of ["connection_requests", "responses", "conversations", "opportunities", "proposals", "yes", "no"] as const) cur[k] += num(r[k]);
    map.set(period, cur);
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export const LAG_STATUSES = ["Opportunity", "Investigation", "Pitching", "Won", "Lost"] as const;

export function lagTotals(rows: { opportunity: string | null; status: string | null }[]) {
  const total = rows.filter((r) => (r.opportunity ?? "") !== "").length;
  const won = rows.filter((r) => r.status === "Won").length;
  const lost = rows.filter((r) => r.status === "Lost").length;
  return { total, won, lost, winRate: ratio(won, won + lost) };
}

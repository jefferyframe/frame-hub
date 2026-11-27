import { describe, it, expect } from "vitest";
import { leadTotals, leadTrend, lagTotals, type LeadMeasureRow } from "@/lib/calc/measures";
import { pastClientCadence, prospectCadence } from "@/lib/calc/cadence";
import { addMonths } from "@/lib/calc/util";

const r = (day: string, a: number[]): LeadMeasureRow => {
  const [connection_requests, responses, conversations, opportunities, proposals, yes, no] = a;
  return { day, connection_requests, responses, conversations, opportunities, proposals, yes, no };
};

describe("Lead Measures row 4", () => {
  it("sums each column and divides each step by the one before (C4 = D4/B4 …)", () => {
    const t = leadTotals([r("2023-08-08", [2, 2, 1, 1, 0, 0, 0]), r("2023-08-11", [1, 1, 1, 1, 1, 1, 1]), r("2023-08-14", [2, 2, 2, 2, 2, 0, 1])]);
    expect(t.totals).toEqual({ connection_requests: 5, responses: 5, conversations: 4, opportunities: 4, proposals: 3, yes: 1, no: 2 });
    expect(t.conversion.map((c) => c.rate)).toEqual([1, 0.8, 1, 0.75, 1 / 3]);
    expect(t.closeRate).toBeCloseTo(1 / 3, 10);
  });
  it('IFERROR(x/0,"") → null', () => {
    const t = leadTotals([r("2023-01-01", [0, 0, 0, 0, 0, 0, 0])]);
    expect(t.conversion.every((c) => c.rate === null)).toBe(true);
    expect(leadTotals([]).totals.connection_requests).toBe(0);
  });
  it("groups days into Monday weeks and months", () => {
    const rows = [r("2023-08-07", [1, 0, 0, 0, 0, 0, 0]), r("2023-08-13", [2, 0, 0, 0, 0, 0, 0]), r("2023-08-14", [4, 0, 0, 0, 0, 0, 0])];
    expect(leadTrend(rows, "week").map((w) => [w.period, w.connection_requests])).toEqual([["2023-08-07", 3], ["2023-08-14", 4]]);
    expect(leadTrend(rows, "month")).toHaveLength(1);
  });
});

describe("Lag Measures row 1", () => {
  it("E1 counts named rows, H1/K1 count Won/Lost, N1 = H1/(H1+K1)", () => {
    const l = lagTotals([{ opportunity: "A", status: "Opportunity" }, { opportunity: "B", status: "Investigation" }, { opportunity: "C", status: "Lost" }, { opportunity: "D", status: "Won" }, { opportunity: "E", status: "Won" }, { opportunity: "", status: "Won" }]);
    expect(l.total).toBe(5);
    expect(l.won).toBe(3);
    expect(l.lost).toBe(1);
    expect(l.winRate).toBe(0.75);
    expect(lagTotals([{ opportunity: "A", status: "Pitching" }]).winRate).toBeNull();
  });
});

describe("cadences", () => {
  it("past clients: 1, 2 and 6 months from the date added (month-end safe)", () => {
    expect(pastClientCadence("2026-01-31", "X").map((t) => t.due)).toEqual(["2026-02-28", "2026-03-31", "2026-07-31"]);
    expect(addMonths("2025-09-08", 1)).toBe("2025-10-08"); // Prospects Met: meeting date + 1 month
  });
  it("prospects: LinkedIn and card right after, email one month later; done steps skipped", () => {
    expect(prospectCadence("2025-09-08", "Sam").map((t) => [t.cadence, t.due])).toEqual([["prospect_linkedin", "2025-09-09"], ["prospect_card", "2025-09-10"], ["prospect_email_1m", "2025-10-08"]]);
    expect(prospectCadence("2025-09-08", "J", { linkedinDone: true, cardDone: true }).map((t) => t.cadence)).toEqual(["prospect_email_1m"]);
  });
});

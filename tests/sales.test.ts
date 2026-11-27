import { describe, it, expect } from "vitest";
import {
  PIPELINE_STATUSES, statusSortOrder, stageBucket, totalBid, overallLikelihoods, pipelineSummary,
  autoAdvance, followUpAlert, nextFollowUpDue, DEFAULT_STAGE_LIKELIHOOD, isOpen,
} from "@/lib/calc/sales";

describe("Pipeline Tracking sheet formulas", () => {
  it("SortOrder macro: dropdown position, unknown last, legacy spelling", () => {
    expect(PIPELINE_STATUSES.map(statusSortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(statusSortOrder("Follow Up Completed")).toBe(6);
    expect(statusSortOrder("whatever")).toBe(999);
    expect(statusSortOrder(" Sold ")).toBe(9);
  });

  it("UpdateStageValue macro: which bucket column a status fills", () => {
    expect(stageBucket("Proposal Needed")).toBe("inquiry"); // AD
    expect(stageBucket("Consultant Outreach")).toBe("triaged"); // AE
    expect(stageBucket("Internal Review")).toBe("qualify"); // AF
    for (const s of ["Presented", "Follow Up 1", "Follow Up 1 Completed", "Follow Up 2", "Follow Up 2 Completed"]) expect(stageBucket(s)).toBe("presented"); // AG
    expect(stageBucket("Rejected")).toBe("rejected"); // AI
    expect(stageBucket("Sold")).toBe("sold"); // AJ
    expect(stageBucket("Project Completed")).toBeNull();
    expect(isOpen("Follow Up 2")).toBe(true);
    expect(isOpen("Sold")).toBe(false);
  });

  it("AB = Z + AA, blanks as zero, typed total wins", () => {
    expect(totalBid({ subs_cost: 1200.5, design_fee: 4000 })).toBeCloseTo(5200.5, 6);
    expect(totalBid({ subs_cost: null, design_fee: 41700 })).toBe(41700);
    expect(totalBid({})).toBe(0);
    expect(totalBid({ subs_cost: 1, design_fee: 2, total_bid_override: 50 })).toBe(50);
  });

  it("row 4 Overall Likelihood = product of this and later stages (sheet: .21 .42 .42 .6)", () => {
    const o = overallLikelihoods(DEFAULT_STAGE_LIKELIHOOD);
    expect(o.inquiry).toBeCloseTo(0.21, 10);
    expect(o.triaged).toBeCloseTo(0.42, 10);
    expect(o.qualify).toBeCloseTo(0.42, 10);
    expect(o.presented).toBeCloseTo(0.6, 10);
  });

  it("rows 5–6 and AH6: weighted pipeline = 60% of the presented bucket", () => {
    const s = pipelineSummary([
      { status: "Follow Up 1", design_fee: 1000000 },
      { status: "Sold", design_fee: 100 },
      { status: "Rejected", subs_cost: 50, design_fee: 25 },
      { status: "Project Completed", design_fee: 999 },
    ]);
    expect(s.stages.find((x) => x.key === "presented")!.sum).toBeCloseTo(1000000, 4);
    expect(s.weightedTotal).toBeCloseTo(600000, 2);
    expect(s.soldTotal).toBe(100);
    expect(s.rejectedTotal).toBe(75);
    expect(s.totalBidAll).toBeCloseTo(1000000 + 100 + 75 + 999, 4);
    expect(s.closeRateCount).toBe(0.5);
  });

  it("weights every stage, not just presented", () => {
    const s = pipelineSummary([
      { status: "Proposal Needed", design_fee: 1000 },
      { status: "Consultant Outreach", design_fee: 1000 },
      { status: "Internal Review", design_fee: 1000 },
      { status: "Presented", design_fee: 1000, projected_arch_hours: 10 },
    ]);
    expect(s.weightedTotal).toBeCloseTo(210 + 420 + 420 + 600, 6);
    expect(s.openTotal).toBe(4000);
    expect(s.projectedHoursOpen).toBe(10);
    expect(s.closeRateCount).toBeNull();
  });

  it("auto-advance: Presented → Follow Up 1 only when MORE than 3 days have passed", () => {
    const o = { status: "Presented", date_presented: "2026-11-01" };
    expect(autoAdvance(o, "2026-11-04")).toBe("Presented");
    expect(autoAdvance(o, "2026-11-05")).toBe("Follow Up 1");
    expect(autoAdvance({ status: "Presented", date_presented: null }, "2027-01-01")).toBe("Presented");
  });

  it("auto-advance: Follow Up 1 Completed → Follow Up 2 after more than 7 days", () => {
    const o = { status: "Follow Up 1 Completed", follow_up_1_date: "2026-11-01" };
    expect(autoAdvance(o, "2026-11-08")).toBe("Follow Up 1 Completed");
    expect(autoAdvance(o, "2026-11-09")).toBe("Follow Up 2");
  });

  it("row colours: red while a follow-up is due, black once FU2 completed is >7 days old", () => {
    expect(followUpAlert({ status: "Follow Up 2" }, "2026-11-27")).toBe("due");
    expect(followUpAlert({ status: "Presented", date_presented: "2026-11-01" }, "2026-11-27")).toBe("due");
    expect(followUpAlert({ status: "Follow Up 2 Completed", follow_up_2_date: "2026-11-19" }, "2026-11-27")).toBe("cold");
    expect(followUpAlert({ status: "Follow Up 2 Completed", follow_up_2_date: "2026-11-20" }, "2026-11-27")).toBeNull();
    expect(followUpAlert({ status: "Sold" }, "2026-11-27")).toBeNull();
  });

  it("schedules the next follow-up on the day the sheet would flip it", () => {
    expect(nextFollowUpDue({ status: "Presented", date_presented: "2026-11-01" })).toEqual({ cadence: "opp_follow_up_1", due: "2026-11-05" });
    expect(nextFollowUpDue({ status: "Follow Up 1 Completed", follow_up_1_date: "2026-11-01" })).toEqual({ cadence: "opp_follow_up_2", due: "2026-11-09" });
    expect(nextFollowUpDue({ status: "Sold" })).toBeNull();
  });
});

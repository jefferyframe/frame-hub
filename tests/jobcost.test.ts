import { describe, it, expect } from "vitest";
import {
  phaseArchFee, expectedProfit, totalBudget, hoursAllowance, consultantStatusSummary, latestNote, detectCurrentPhase,
  computeJobCost, jobListFlags, PHASES,
} from "@/lib/calc/jobCost";
import { parseJobNumber, normalizeJobNumber, nextJobNumber, nextSubJobNumber } from "@/lib/calc/jobNumber";

const phases = PHASES.map((p) => ({ phase: p.key, fee_pct: p.feePct, hours_pct: p.hoursPct }));

describe("Job Cost Template formulas", () => {
  it("C11 = $B$10 × C12; an explicit row-10 amount wins", () => {
    expect(phaseArchFee(100000, { fee_pct: 0.4 })).toBe(40000);
    expect(phaseArchFee(100000, { fee_pct: 0.4, arch_fee: 12345 })).toBe(12345);
    expect(phaseArchFee(null, { fee_pct: 0.4 })).toBe(0);
  });
  it("E31 = B10×(1−E30), E32 = B10−E31, E34 = ROUNDDOWN(E32/E33,0)", () => {
    expect(expectedProfit(100000, 0.85)).toBeCloseTo(15000, 6);
    expect(totalBudget(100000, 0.85)).toBeCloseTo(85000, 6);
    expect(hoursAllowance(100000, 0.85, 180)).toBe(472); // 472.2 rounded down
    expect(hoursAllowance(1000000, 0.85, 180)).toBe(4722);
    expect(hoursAllowance(100000, 0.85, 0)).toBe(0);
  });
  it("B28 total fee = arch fee + consultants; L28 phase fee = arch phase + consultants that phase", () => {
    const c = computeJobCost({ arch_fee: 150000 }, phases, [
      { discipline: "Civil", phase: "All phases", fee: 50000 },
      { discipline: "Other 1", firm: "Sample Co", phase: "All phases", fee: 25000 },
      { discipline: "Structural", phase: "Construction Documents", fee: 1000 },
    ], []);
    expect(c.totalFee).toBe(150000 + 50000 + 25000 + 1000);
    expect(c.feeAllocated).toBeCloseTo(150000, 6);
    expect(c.pctAllocated).toBeCloseTo(1, 10);
    expect(c.phases.find((p) => p.phase === "Construction Documents")!.phaseTotalFee).toBeCloseTo(150000 * 0.4 + 1000, 6);
  });
  it("N10 = SUM(log), O10 = M10 − N10, B30 = Σ hours %", () => {
    const c = computeJobCost({ arch_fee: 0 }, phases.map((p) => (p.phase === "Construction Administration" ? { ...p, hours_assigned: 1420 } : p)), [],
      [{ phase: "Construction Administration", hours: 69 }, { phase: "Construction Administration", hours: 22 }, { phase: "Construction Documents", hours: 3 }]);
    const ca = c.phases.find((p) => p.phase === "Construction Administration")!;
    expect(ca.hoursCompleted).toBe(91);
    expect(ca.hoursRemaining).toBe(1329);
    expect(c.hoursCompleted).toBe(94);
    expect(c.hoursPctTotal).toBeCloseTo(1, 10);
    expect(c.currentPhase).toBe("Construction Documents"); // first phase with work, like the macro
    expect(c.burn).toBeCloseTo(94 / 1420, 10);
  });
  it("warns when the splits don't add to 100% or assigned hours exceed the allowance", () => {
    const c = computeJobCost({ arch_fee: 100000 }, [{ phase: "Schematic Design", fee_pct: 0.5, hours_assigned: 900, hours_pct: 1 }], [], []);
    expect(c.warnings.join(" ")).toMatch(/50.0%, not 100%/);
    expect(c.warnings.join(" ")).toMatch(/exceed the hours allowance \(472\)/);
  });
  it("GetConsultantStatus macro", () => {
    expect(consultantStatusSummary([], "Schematic Design")).toBe("None");
    expect(consultantStatusSummary([{ discipline: "Civil", phase: "Schematic Design", fee: 0, status: "On Task" }], "Schematic Design")).toBe("None");
    expect(consultantStatusSummary([{ discipline: "Civil", phase: "Schematic Design", fee: 10 }], "Schematic Design")).toBe("NO STATUS HAS BEEN SELECTED");
    expect(consultantStatusSummary([
      { discipline: "Civil", phase: "Schematic Design", fee: 10, status: "On Task" },
      { discipline: "Structural", phase: "Schematic Design", fee: 10, status: "Complete" },
      { discipline: "Mechanical", phase: "Schematic Design", fee: 10 },
    ], "Schematic Design")).toBe("Civil (On Task); Structural (Complete)");
  });
  it("GetPhaseNotes macro: last non-empty, non-numeric note", () => {
    expect(latestNote([{ phase: "X", notes: "QB" }, { phase: "X", notes: "12" }, { phase: "X", notes: "Detailing" }, { phase: "X", notes: " " }, { phase: "Y", notes: "other" }], "X")).toBe("Detailing");
  });
  it("detectCurrentPhase: assigned hours or logged hours", () => {
    expect(detectCurrentPhase([{ phase: "Design Development", hours_assigned: 10 }], [])).toBe("Design Development");
    expect(detectCurrentPhase([], [])).toBeNull();
  });
  it("Job List conditional formatting", () => {
    expect(jobListFlags({ target_date: "2026-12-04" }, "2026-11-27").date).toBe("soon"); // 7 days
    expect(jobListFlags({ target_date: "2026-12-05" }, "2026-11-27").date).toBeNull();
    expect(jobListFlags({ target_date: "2026-11-27" }, "2026-11-27").date).toBe("overdue");
    expect(jobListFlags({ hours_assigned: 100, hours_remaining: 10 }, "2026-11-27").hoursLow).toBe(true);
    expect(jobListFlags({ hours_assigned: 100, hours_remaining: 10.5 }, "2026-11-27").hoursLow).toBe(false);
    expect(jobListFlags({ hours_assigned: 0, hours_remaining: -5 }, "2026-11-27").hoursLow).toBe(false);
  });
});

describe("job numbers (NN-NN)", () => {
  it("parses, normalizes and pads", () => {
    expect(parseJobNumber("24-17.3")).toEqual({ year: 24, seq: 17, sub: 3 });
    expect(normalizeJobNumber("26-02 ")).toBe("26-02");
    expect(normalizeJobNumber("26-2")).toBe("26-02");
    expect(normalizeJobNumber("26-A09")).toBeNull();
    expect(normalizeJobNumber("")).toBeNull();
  });
  it("next number = highest this year + 1, across projects and pipeline", () => {
    expect(nextJobNumber(["26-114", "26-129", "25-200", null, "bogus"], "2026-11-27")).toBe("26-130");
    expect(nextJobNumber(["26-114"], "2027-01-02")).toBe("27-01");
    expect(nextSubJobNumber(["24-17.1", "24-17.5", "24-17"], "24-17")).toBe("24-17.6");
  });
});

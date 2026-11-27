import { describe, it, expect } from "vitest";
import {
  computeSuggested, computeProposal, guardrail, suggestArchPct, spreadByPhase, toTemplatePhase, architecturalFee, suggestConsultantFee,
  DEFAULT_PHASE_ITEMS, LEGACY_PHASES,
} from "@/lib/calc/proposal";
import { cleanPolishedScope, classifyBuilding } from "@/lib/import/legacy";

describe("old quoting tool fee logic (fees.ts)", () => {
  it("computeSuggested: arch = round(C × %), engineers = round(arch ÷ 55% × midpoint)", () => {
    const s = computeSuggested({ construction_cost: 2500000, arch_target_pct: 0.05, disciplines: ["Structural", "Mechanical", "Survey"] });
    expect(s.arch).toBe(125000);
    expect(s.Structural).toBe(Math.round((125000 / 0.55) * 0.175)); // 39,773
    expect(s.Mechanical).toBe(22727);
    expect(s.Survey).toBe(6818);
    expect(computeSuggested({ construction_cost: null, arch_target_pct: null, disciplines: ["Civil"] })).toEqual({ arch: 0, Civil: 0 });
    expect(suggestConsultantFee(125000, "Structural")).toBe(39773);
  });
  it("guardrail cards: ✓ ≥ target, ! ≥ minimum, ✕ below", () => {
    expect(guardrail(0.05, 0.045, 0.05)).toBe("ok");
    expect(guardrail(0.047, 0.045, 0.05)).toBe("warn");
    expect(guardrail(0.04, 0.045, 0.05)).toBe("fail");
  });
  it("suggest-fee: upper-middle median of precedents, never below 4.5%, default 5% with < 2", () => {
    const P = (pct: number, b = "office", d: string | null = null) => ({ fee_pct_of_construction: pct, building_type: b, delivery_type: d });
    expect(suggestArchPct([P(0.06), P(0.08), P(0.07), P(0.09)], "office").suggested_arch_pct).toBe(0.08);
    expect(suggestArchPct([P(0.03), P(0.035)], "office").suggested_arch_pct).toBe(0.045);
    const d = suggestArchPct([P(0.07)], "office");
    expect(d.basis).toBe("default");
    expect(d.suggested_arch_pct).toBe(0.05);
    // building+delivery too narrow → falls back to building type only
    expect(suggestArchPct([P(0.06, "office", "tenant_improvement"), P(0.08), P(0.1)], "office", "tenant_improvement").basis).toBe("precedent");
    expect(suggestArchPct([{ ...P(0.2), is_frame_proposal: false }, P(0.06), P(0.07)], "office").precedents).toHaveLength(2);
  });
});

describe("proposal totals", () => {
  const items = [
    ...DEFAULT_PHASE_ITEMS,
    { kind: "consultant" as const, label: "Structural", amount: 20000 },
    { kind: "consultant" as const, label: "Civil", amount: 5000, optional: true },
    { kind: "additional_service" as const, label: "Renderings", amount: 3000 },
    { kind: "additional_service" as const, label: "LEED", amount: 7000, optional: true },
    { kind: "reimbursable" as const, label: "Printing", amount: 500 },
    { kind: "phase" as const, label: "Interior Design", amount: 9999, included: false },
  ];
  it("% of construction basis, firm phase split, optional items kept out of the total", () => {
    const t = computeProposal({ fee_basis: "pct_construction", construction_cost: 2000000, arch_target_pct: 0.05 }, items);
    expect(t.archFee).toBe(100000);
    expect(t.phases.map((p) => p.amount)).toEqual([5000, 10000, 20000, 40000, 5000, 20000]);
    expect(t.phasesTotal).toBe(100000);
    expect(t.consultantsTotal).toBe(20000);
    expect(t.optionalTotal).toBe(12000);
    expect(t.total).toBe(100000 + 20000 + 3000 + 500);
    expect(t.gross).toBe(120000);
    expect(t.archPctOfGross).toBeCloseTo(100000 / 120000, 10);
    expect(t.guards.archOfConstruction).toBe("ok");
    expect(t.hoursAllowance).toBe(472);
    expect(t.warnings).toEqual([]);
  });
  it("fixed fee, explicit phase amounts, and guardrail warnings", () => {
    expect(architecturalFee({ fee_basis: "fixed", arch_fee: 80000, construction_cost: 2000000 })).toBe(80000);
    const t = computeProposal({ fee_basis: "fixed", arch_fee: 80000, construction_cost: 2000000 }, [
      { kind: "phase", label: "Schematic Design", pct: 0.5 }, { kind: "phase", label: "CA", amount: 1234 },
      { kind: "consultant", label: "Structural", amount: 90000 },
    ]);
    expect(t.phases[1].amount).toBe(1234);
    expect(t.warnings.join(" ")).toMatch(/Phases cover 50.0%/);
    expect(t.warnings.join(" ")).toMatch(/below the 4.5% floor/);
    expect(t.warnings.join(" ")).toMatch(/below the 55% guardrail/);
    expect(t.guards.archOfGross).toBe("fail");
  });
  it("old tool split is 15/20/40/5/20", () => {
    expect(LEGACY_PHASES.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(1, 10);
  });
  it("spreads a consultant fee over phases to the cent", () => {
    const s = spreadByPhase(1000, [{ phase: "A", pct: 0.15 }, { phase: "B", pct: 0.2 }, { phase: "C", pct: 0.4 }, { phase: "D", pct: 0.05 }, { phase: "E", pct: 0.2 }]);
    expect(s.map((x) => x.amount)).toEqual([150, 200, 400, 50, 200]);
    const odd = spreadByPhase(100, [{ phase: "A", pct: 1 }, { phase: "B", pct: 1 }, { phase: "C", pct: 1 }]);
    expect(odd.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(100, 10);
    expect(spreadByPhase(100, [])).toEqual([]);
  });
  it("maps proposal phase labels onto the job-cost template", () => {
    expect(toTemplatePhase("Bidding / Negotiation")).toBe("Bidding & Permitting");
    expect(toTemplatePhase("feasibility")).toBe("Feasability");
    expect(toTemplatePhase("schematic design")).toBe("Schematic Design");
    expect(toTemplatePhase("Landscape")).toBeNull();
  });
});

describe("legacy data clean-up", () => {
  it("splits leaked tool-call text out of the polished scope", () => {
    const r = cleanPolishedScope('Para one.\n\nPara two.</polished_scope>\n<parameter name="phase_narrative">{"sd":"S","ca":"C"}');
    expect(r.scope).toBe("Para one.\n\nPara two.");
    expect(r.narrative).toEqual({ sd: "S", ca: "C" });
    expect(r.leaked).toBe(true);
    expect(cleanPolishedScope("Clean.").leaked).toBe(false);
  });
  it("classifies free-text building types", () => {
    expect(classifyBuilding("Multifamily (Affordable Housing / LIHTC)")).toBe("multifamily");
    expect(classifyBuilding("Restaurant (TI, ~2,250 sf)")).toBe("restaurant");
    expect(classifyBuilding("Government/Institutional - Roof Replacement")).toBe("roofing");
    expect(classifyBuilding("Medical Office Building / Cancer Care Oncology")).toBe("medical");
    expect(classifyBuilding("office")).toBe("office");
    expect(classifyBuilding("")).toBeNull();
    expect(classifyBuilding("Something odd")).toBe("other");
  });
});

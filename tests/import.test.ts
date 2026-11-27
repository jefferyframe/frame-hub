import { describe, it, expect } from "vitest";
import type { Grid } from "@/lib/import/workbook";
import { col } from "@/lib/import/workbook";
import { parsePipeline, parseLeadMeasures, parseLagMeasures, parseBizDevNotes, parsePastClients, parseCreFirms } from "@/lib/import/sales";
import { parseJobSheet, splitConsultant, weekEnding, parseJobList, PHASE_START_COLS } from "@/lib/import/jobs";
import { parseCsv, parseJsonish } from "@/lib/import/csv";
import { parseLegacyQuotes, parseArchive } from "@/lib/import/legacy";
import { section } from "@/lib/import/report";
import { testDb } from "./helpers";
import * as L from "@/lib/import/load";

/** Build a grid from { "A1": value } cells. */
function grid(cells: Record<string, string | number | null>): Grid {
  const g: Grid = [];
  for (const [ref, v] of Object.entries(cells)) {
    const m = ref.match(/^([A-Z]+)(\d+)$/)!;
    const r = Number(m[2]) - 1, c = col(m[1]) - 1;
    g[r] = g[r] ?? [];
    g[r][c] = v;
  }
  for (let i = 0; i < g.length; i++) g[i] = g[i] ?? [];
  return g;
}

describe("sales workbook parsers", () => {
  const g = grid({
    AB1: 999, AH6: 600, AG5: 1000,
    J7: "25-90", K7: "2025-10-01", L7: "Example Mini Storage", M7: "Follow Up 1", P7: "industrial", Z7: 100, AA7: 900, AB7: 1000, T7: "2025-10-17", W7: "2025-01-21",
    J8: "26-A1", L8: "Typed total", M8: "Sold", AB8: 5000,
    L9: "Odd status", M9: "Maybe",
    L10: "Example Mini Storage", J10: "25-90", K10: "2025-10-01", M10: "Rejected", S10: "12/01/20225",
  });
  const { rows, report, sheetTotals } = parsePipeline(g);
  it("reads rows from 7 down, keeps the sheet's own totals for cross-checking", () => {
    expect(rows).toHaveLength(4);
    expect(sheetTotals).toMatchObject({ totalBidAll: 999, weightedTotal: 600, presentedSum: 1000 });
  });
  it("Total Bid is only an override when it differs from Subs + Design", () => {
    expect(rows[0].total_bid_override).toBeNull();
    expect(rows[1].total_bid_override).toBe(5000);
  });
  it("normalizes dropdown values and flags what it can't use", () => {
    expect(rows[0].project_type).toBe("Industrial");
    expect(rows[1].job_number).toBeNull();
    expect(rows[2].status).toBe("Proposal Needed");
    expect(rows[3].date_presented).toBeNull();
    const notes = report.notes.join("\n");
    expect(notes).toMatch(/“Maybe” isn't one of the sheet's statuses/);
    expect(notes).toMatch(/job # “26-A1”/);
    expect(notes).toMatch(/12\/01\/20225/);
    expect(notes).toMatch(/1 rows have a Second Follow Up Date earlier/);
    expect(notes).toMatch(/appears 2 times/);
    expect(new Set(rows.map((r) => r.source_key)).size).toBe(4);
  });
  it("lead measures skip pre-filled empty days; lag rows keep their status", () => {
    const lead = parseLeadMeasures(grid({ A5: "2023-08-01", A6: "2023-08-08", B6: 2, D6: 2, F6: 1, H6: 1, M6: 0 }));
    expect(lead.rows).toEqual([{ day: "2023-08-08", connection_requests: 2, responses: 2, conversations: 1, opportunities: 1, proposals: 0, yes: 0, no: 0 }]);
    const lag = parseLagMeasures(grid({ A6: "2020-01-20", C6: "Sample Classroom Building", D6: "Opportunity", C7: "Sample Remodel", D7: "Won", C8: "Bad", D8: "Huh" }));
    expect(lag.rows.map((r) => r.status)).toEqual(["Opportunity", "Won"]);
    expect(lag.report.skipped).toBe(1);
  });
  it("biz-dev notes take their month from the heading rows", () => {
    const b = parseBizDevNotes(grid({ A1: "October 2026 Biz Dev Notes", A3: "Attended a breakfast mixer", A15: "November 2026 Biz Dev Notes", A16: "Coffee with a broker" }), "Becky");
    expect(b.rows.map((r) => [r.period, r.notes])).toEqual([["October 2026", "Attended a breakfast mixer"], ["November 2026", "Coffee with a broker"]]);
  });
  it("past clients: follow-up cells hold either a date or what was done", () => {
    const p = parsePastClients(grid({ A4: "w@x.com", B4: "Alex", C4: "B", G4: "Sample Utility", B5: "Jo", G5: "Sample Housing", J5: "Sent email with brochure 9/24/25", K5: "2025-10-24" }));
    expect(p.rows[1].followUps.map((f) => [f.date, f.text])).toEqual([[null, "Sent email with brochure 9/24/25"], ["2025-10-24", null], [null, null]]);
    expect(p.report.notes.length).toBe(2);
  });
  it("CRE firms: a date in “Date booked” is a booking, text is a status", () => {
    const c = parseCreFirms(grid({ A2: "Sample Realty", D2: "Presented AI in June 2026", A3: "Example Brokers", D3: "2026-12-09" }));
    expect(c.rows.map((r) => [r.status, r.day])).toEqual([["Presented AI in June 2026", null], ["Booked", "2026-12-09"]]);
  });
});

describe("job workbook parsers", () => {
  const CA = PHASE_START_COLS[5]; // AK
  const L = (c: number) => { let s = ""; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const g = grid({
    J2: "Lee", M2: "21-07", S2: "2025-12-24", M4: "Example Apartments", J3: "Kim", B10: 150000, E30: 0.85, E33: 180,
    [`${L(CA)}7`]: 0.1, [`${L(CA + 1)}10`]: 1420, [`${L(CA + 4)}10`]: "2026-12-07",
    H12: 0.2, F12: 0.4,
    A13: "Civil", B13: 50000, A15: "Structural - Acme", H15: 15000, [`${L(CA + 1)}15`]: "On Task",
    [`${L(CA)}31`]: "Week 1", [`${L(CA + 2)}31`]: 69, [`${L(CA + 3)}31`]: "Detailing",
    [`${L(CA)}32`]: "Thru 1/5/26", [`${L(CA + 1)}32`]: "Lee", [`${L(CA + 2)}32`]: 22.3, [`${L(CA + 3)}32`]: "QB",
    [`${L(CA)}33`]: "Week 3",
    [`${L(CA + 2)}34`]: "lots",
  });
  const r = section();
  const s = parseJobSheet("21-07", g, r)!;
  it("reads the header block", () => {
    expect(s).toMatchObject({ job_number: "21-07", name: "Example Apartments", lead: "Lee", team: "Kim", contract_date: "2025-12-24", arch_fee: 150000, profit_pct: 0.85, burden_rate: 180 });
  });
  it("reads each phase block: hours, target, splits", () => {
    const ca = s.phases.find((p) => p.phase === "Construction Administration")!;
    expect(ca).toMatchObject({ hours_assigned: 1420, target_date: "2026-12-07", hours_pct: 0.1, fee_pct: 0.2 });
    expect(s.phases.find((p) => p.phase === "Construction Documents")!.fee_pct).toBe(0.4);
  });
  it("consultants: by-phase fees with status; column-B-only totals become “All phases”", () => {
    expect(s.consultants).toEqual(expect.arrayContaining([
      { discipline: "Structural", firm: "Acme", phase: "Construction Administration", fee: 15000, status: "On Task" },
      { discipline: "Civil", firm: null, phase: "All phases", fee: 50000, status: null },
    ]));
  });
  it("weekly log: real entries only; bad numbers reported", () => {
    expect(s.entries.map((e) => [e.week_label, e.hours, e.person, e.week_ending])).toEqual([["Week 1", 69, null, null], ["Thru 1/5/26", 22.3, "Lee", "2026-01-05"]]);
    expect(r.notes.join(" ")).toMatch(/“lots” isn't a number/);
  });
  it("helpers", () => {
    expect(splitConsultant("Other 1 - Sample Co")).toEqual({ discipline: "Other 1", firm: "Sample Co" });
    expect(splitConsultant("Structural -acme")).toEqual({ discipline: "Structural", firm: "acme" });
    expect(weekEnding("Thru 10/16/26")).toBe("2026-10-16");
    expect(weekEnding("Week 4")).toBeNull();
    const jl = parseJobList(grid({ A3: "26-02 ", B3: "Example Roof", F3: "Schematic Design", H3: 26, A4: "junk" }));
    expect(jl.rows[0]).toMatchObject({ job_number: "26-02", phase: "Schematic Design", hours_assigned: 26 });
    expect(jl.report.skipped).toBe(1);
  });
});

describe("old quoting tool export", () => {
  const csv = `id,status,approved,client,project_name,address,construction_cost,scope_text_raw,scope_text_polished,disciplines,arch_target_pct,fees,phase_narrative,precedents_used,created_at,building_type,delivery_type
q1,fee,false,"{""name"":""Example Builders"",""contact_name"":""Pat"",""email"":""a@x.com""}",100 Example Way,"100 Example Way, Reno",2500000,"Renovate, ""quickly""","Polished.</polished_scope>
<parameter name=""phase_narrative"">{""sd"":""SD text""}","{""structural"":true,""civil"":true}",0.05,"{""civil"":9000}",{},,2026-09-10 23:11:19+00,industrial,
q2,intake,false,{},,,,,,{},0.05,{},{},,2026-09-11 00:00:00+00,,`;
  it("parses quoted CSV with embedded newlines and JSON", () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].scope_text_raw).toBe('Renovate, "quickly"');
    expect(parseJsonish<string[]>('{a,"b c"}')).toEqual(["a", "b c"]);
    expect(parseJsonish<string[]>('["x","y"]')).toEqual(["x", "y"]);
  });
  it("maps quotes to proposals: typed fees kept, missing ones suggested, empties skipped, junk cleaned", () => {
    const { rows, report } = parseLegacyQuotes(parseCsv(csv));
    expect(rows).toHaveLength(1);
    expect(report.skipped).toBe(1);
    const q = rows[0];
    expect(q.fee_basis).toBe("pct_construction");
    expect(q.scope_text).toBe("Polished.");
    expect(q.phase_narrative).toEqual({ "Schematic Design": "SD text" });
    const cons = q.items!.filter((i) => i.kind === "consultant");
    expect(cons.map((c) => [c.label, c.amount])).toEqual([["Structural", 39773], ["Civil", 9000]]);
    expect(q.items!.filter((i) => i.kind === "phase").map((i) => i.label)).toContain("Bidding / Negotiation");
  });
  it("archive_index → precedents with derived fee % and normalized job numbers", () => {
    const { rows } = parseArchive([{ id: "a", file: "x.pdf", project_number: "26-2", is_frame_proposal: "true", building_type: "Office (TI)", construction_cost: "1000000", total_fee: "60000", fee_pct_of_construction: "", disciplines: '["Architecture"]', phases: "", discipline_fees: "" }]);
    expect(rows[0]).toMatchObject({ project_number: "26-02", category: "office", fee_pct_of_construction: 0.06, fee_pct_derived: true });
  });
});

describe("loading is idempotent", () => {
  it("running the same records twice updates instead of duplicating", async () => {
    const db = await testDb();
    const pipe = parsePipeline(grid({ L7: "A", M7: "Sold", J7: "26-10", AA7: 10, L8: "B", M8: "Presented" })).rows;
    const jobs = parseJobList(grid({ A3: "26-10", B3: "A project", F3: "Schematic Design" })).rows;
    for (let i = 0; i < 2; i++) {
      const r = section();
      await L.loadPipeline(db, pipe, r);
      await L.loadJobs(db, jobs, [], section());
      await L.linkPipelineToProjects(db, section());
      expect(i === 0 ? r.imported : r.updated).toBe(2);
    }
    expect((await db.query<{ n: number }>(`select count(*)::int n from opportunities`))[0].n).toBe(2);
    expect((await db.query<{ n: number }>(`select count(*)::int n from projects`))[0].n).toBe(1);
    expect((await db.query<{ n: number }>(`select count(*)::int n from project_phases`))[0].n).toBe(9);
    expect((await db.query<{ linked: number }>(`select count(*)::int linked from projects where opportunity_id is not null`))[0].linked).toBe(1);
  });
});

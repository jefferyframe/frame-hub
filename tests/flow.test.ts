import { describe, it, expect, beforeAll } from "vitest";
import type { Db } from "@/lib/db/types";
import { testDb } from "./helpers";
import { createProposal, setProposalStatus, updateProposal, newVersion, getProposal } from "@/lib/repo/proposals";
import { proposalToOpportunity, opportunityToProject, lineage } from "@/lib/flow";
import { getProject, setProjectStatus } from "@/lib/repo/projects";
import { createOpportunity, setOpportunityStatus, applyAutoAdvance } from "@/lib/repo/opportunities";
import { history } from "@/lib/repo/audit";
import { LEGACY_PHASES } from "@/lib/calc/proposal";

let db: Db;
beforeAll(async () => { db = await testDb(); });

async function sentProposal() {
  const p = await createProposal(db, {
    title: "Sample Medical Office Building", project_name: "Sample Medical Office Building", address: "100 Example Way, Reno",
    client: { name: "Sample Clinic Group", contact_name: "Pat Rivera", contact_title: "Facilities Director", email: "pat@example.com", phone: "775-555-0100" },
    fee_basis: "pct_construction", construction_cost: 2000000, arch_target_pct: 0.05, project_type: "Healthcare", scope_text: "New two-story MOB.",
    items: [
      ...LEGACY_PHASES.map((x) => ({ kind: "phase" as const, label: x.label, pct: x.pct })),
      { kind: "consultant", label: "Structural", amount: 20000, description: "Acme Structural" },
      { kind: "consultant", label: "Civil", amount: 6000, optional: true },
      { kind: "additional_service", label: "Renderings", amount: 3000 },
    ],
  }, "Jeff", "2026-11-20");
  await setProposalStatus(db, p.id, "approved", "Jeff");
  await setProposalStatus(db, p.id, "sent", "Jeff");
  return p;
}

describe("Proposal → Opportunity → Project → Closeout → Archived", () => {
  it("runs end to end, carrying data and linking every record", async () => {
    const p = await sentProposal();
    expect(p.number).toMatch(/^P-26-\d{3}$/);

    // 1. one click into the pipeline
    const o = await proposalToOpportunity(db, p.id, "Jeff", "2026-11-21");
    expect(o.status).toBe("Presented");
    expect(o.name).toBe("Sample Clinic Group – Sample Medical Office Building");
    expect(Number(o.design_fee)).toBe(100000 + 3000); // architecture + additional services
    expect(Number(o.subs_cost)).toBe(20000); // optional Civil left out
    expect(Number(o.projected_arch_hours)).toBe(472);
    expect(o.project_type).toBe("Healthcare");
    expect(o.proposal_id).toBe(p.id);
    const [contact] = await db.query<{ full_name: string; email: string; company: string }>(
      `select c.full_name, c.email, co.name as company from contacts c join companies co on co.id = c.company_id where c.id = $1`, [o.contact_id]);
    expect(contact).toEqual({ full_name: "Pat Rivera", email: "pat@example.com", company: "Sample Clinic Group" });
    const tasks = await db.query<{ cadence: string; due_on: string }>(`select cadence, due_on from tasks where opportunity_id = $1`, [o.id]);
    expect(tasks).toEqual([{ cadence: "opp_follow_up_1", due_on: expect.any(String) }]);
    // idempotent
    expect((await proposalToOpportunity(db, p.id, "Jeff")).id).toBe(o.id);
    expect((await getProposal(db, p.id))!.proposal.opportunity_id).toBe(o.id);

    // 2. won → project
    const proj = await opportunityToProject(db, o.id, "Jeff", { today: "2026-11-27", lead: "Kim" });
    expect(proj.job_number).toMatch(/^26-\d{2,}$/);
    expect(proj.lead).toBe("Kim");
    expect(Number(proj.arch_fee)).toBe(100000);
    expect(proj.proposal_id).toBe(p.id);
    expect(proj.opportunity_id).toBe(o.id);
    expect(proj.current_phase).toBe("Schematic Design");
    const full = (await getProject(db, proj.id))!;
    const fee = Object.fromEntries(full.phases.map((x) => [x.phase, Number(x.fee_pct)]));
    expect(fee["Schematic Design"]).toBe(0.15);
    expect(fee["Bidding & Permitting"]).toBe(0.05); // "Bidding / Negotiation" mapped
    expect(fee["Pre Design"]).toBe(0);
    expect(full.cost.archFee).toBe(100000);
    expect(full.cost.consultantTotal).toBeCloseTo(20000, 6);
    expect(full.consultants.find((c) => c.phase === "Construction Documents")!.fee).toBeCloseTo(8000, 6);
    expect(full.consultants[0].firm).toBe("Acme Structural");
    expect(full.phases.find((x) => x.phase === "Construction Documents")!.hours_assigned).toBe(Math.floor(472 * 0.4));
    const [opp] = await db.query<{ status: string; job_number: string }>(`select status, job_number from opportunities where id = $1`, [o.id]);
    expect(opp).toEqual({ status: "Sold", job_number: proj.job_number });
    expect(await db.query(`select 1 from tasks where opportunity_id = $1 and done_at is null`, [o.id])).toHaveLength(0);
    // idempotent
    expect((await opportunityToProject(db, o.id, "Jeff")).id).toBe(proj.id);

    // 3. lifecycle to end of life
    await expect(setProjectStatus(db, proj.id, "archived", "Jeff")).rejects.toThrow(/Can't move/);
    await setProjectStatus(db, proj.id, "closeout", "Jeff");
    const archived = await setProjectStatus(db, proj.id, "archived", "Jeff");
    expect(archived.archived_at).toBeTruthy();
    expect((await db.query<{ status: string }>(`select status from opportunities where id = $1`, [o.id]))[0].status).toBe("Project Completed");

    // 4. links and audit trail from every record
    for (const [e, id] of [["proposal", p.id], ["opportunity", o.id], ["project", proj.id]] as const) {
      const l = await lineage(db, e, id);
      expect([l.proposal?.id, l.opportunity?.id, l.project?.id]).toEqual([p.id, o.id, proj.id]);
    }
    const ph = await history(db, "project", proj.id);
    expect(ph.map((h) => h.action)).toEqual(expect.arrayContaining(["convert", "status"]));
    expect((await history(db, "proposal", p.id)).some((h) => h.summary?.includes(proj.job_number))).toBe(true);
    expect((await history(db, "opportunity", o.id)).some((h) => h.related_id === proj.id)).toBe(true);
  });

  it("keeps the pipeline row's own job number, rejects a taken one, and issues the next otherwise", async () => {
    const a = await createOpportunity(db, { name: "Keeps its number", job_number: "26-501" }, "Jeff");
    expect((await opportunityToProject(db, a.id, "Jeff", { today: "2026-11-27" })).job_number).toBe("26-501");
    const b = await createOpportunity(db, { name: "Wants a taken number" }, "Jeff");
    await expect(opportunityToProject(db, b.id, "Jeff", { jobNumber: "26-501" })).rejects.toThrow(/already used/);
    const c = await createOpportunity(db, { name: "Gets the next one" }, "Jeff");
    expect((await opportunityToProject(db, c.id, "Jeff", { today: "2026-11-27" })).job_number).toBe("26-502");
    // without a proposal: template phases (5/10/20/40/5/20)
    const g = (await getProject(db, (await db.query<{ id: string }>(`select id from projects where job_number = '26-502'`))[0].id))!;
    expect(g.phases.find((x) => x.phase === "Construction Documents")!.fee_pct).toBe(0.4);
  });

  it("proposal rules: fee edits after approval un-approve; sent proposals are locked; versions", async () => {
    const p = await createProposal(db, { title: "Rules", fee_basis: "fixed", arch_fee: 50000 }, "Jeff");
    await setProposalStatus(db, p.id, "approved", "Jeff");
    await updateProposal(db, p.id, { address: "1 Main" }, null, "Jeff");
    expect((await getProposal(db, p.id))!.proposal.status).toBe("approved");
    await updateProposal(db, p.id, { arch_fee: 60000 }, null, "Jeff");
    expect((await getProposal(db, p.id))!.proposal.status).toBe("in_review");
    await setProposalStatus(db, p.id, "approved", "Jeff");
    await setProposalStatus(db, p.id, "sent", "Jeff");
    await expect(updateProposal(db, p.id, { title: "x" }, null, "Jeff")).rejects.toThrow(/new version/);
    await expect(setProposalStatus(db, p.id, "draft", "Jeff")).rejects.toThrow(/Can't move/);
    const v2 = await newVersion(db, p.id, "Jeff");
    expect(v2.version).toBe(2);
    expect(v2.number).toBe(p.number);
    const all = (await getProposal(db, v2.id))!;
    expect(all.versions.map((v) => [v.version, v.is_current, v.status])).toEqual([[2, true, "draft"], [1, false, "superseded"]]);
    expect(all.items.length).toBeGreaterThan(0);
  });

  it("status changes schedule follow-ups and the sheet's auto-advance runs", async () => {
    const o = await createOpportunity(db, { name: "Auto", date_received: "2026-11-01" }, "Jeff");
    await setOpportunityStatus(db, o.id, "Presented", "Jeff", "2026-11-10");
    expect(await db.query(`select 1 from tasks where opportunity_id = $1 and cadence = 'opp_follow_up_1' and due_on = '2026-11-14'`, [o.id])).toHaveLength(1);
    expect(await applyAutoAdvance(db, "system", "2026-11-14")).toBeGreaterThanOrEqual(1);
    expect((await db.query<{ status: string }>(`select status from opportunities where id = $1`, [o.id]))[0].status).toBe("Follow Up 1");
    await setOpportunityStatus(db, o.id, "Rejected", "Jeff");
    expect((await db.query<{ closed_at: Date | null }>(`select closed_at from opportunities where id = $1`, [o.id]))[0].closed_at).toBeTruthy();
  });
});

/**
 * The flow between the three modules — each step is one click, idempotent, and
 * audited on both records:
 *
 *   Proposal ──convert──▶ Opportunity (pipeline row + follow-up task)
 *   Opportunity ──Won──▶ Project (job number NN-NN, phases & fees from the proposal)
 *   Project ──▶ Closeout ──▶ Archived (pipeline row → "Project Completed")
 */
import type { Db } from "./db/types";
import { one } from "./db/types";
import type { Opportunity, Proposal, ProposalItem, Project } from "./repo/types";
import { audit } from "./repo/audit";
import { addTask, ensureCompany, ensureContact, splitName } from "./repo/crm";
import { setOpportunityStatus } from "./repo/opportunities";
import { allJobNumbers } from "./repo/numbers";
import { computeProposal, toTemplatePhase, spreadByPhase } from "./calc/proposal";
import { PHASES, PHASE_NAMES, hoursAllowance } from "./calc/jobCost";
import { nextJobNumber, normalizeJobNumber } from "./calc/jobNumber";
import { nextFollowUpDue } from "./calc/sales";
import { todayISO } from "./calc/util";
import { getSettings } from "./repo/settings";
import { logActivity } from "./repo/activities";
import { memberForUser } from "./repo/team";
import { LEAD_STAGES } from "./crm/logic";

const PROPOSAL_TO_PIPELINE: Record<string, string> = {
  draft: "Proposal Needed", in_review: "Internal Review", approved: "Internal Review",
  sent: "Presented", viewed: "Presented", accepted: "Sold", declined: "Rejected",
};

/** Proposal → CRM opportunity. Carries client, scope, fee split (design fee vs. subs) and
 *  hours; links both ways; schedules the first follow-up. Re-running returns the same row. */
export async function proposalToOpportunity(db: Db, proposalId: string, actor: string, today = todayISO()): Promise<Opportunity> {
  return db.tx(async (t) => {
    const p = await one<Proposal>(t, `select * from proposals where id = $1 for update`, [proposalId]);
    if (!p) throw new Error("Proposal not found");
    if (p.opportunity_id) {
      const existing = await one<Opportunity>(t, `select * from opportunities where id = $1`, [p.opportunity_id]);
      if (existing) return existing;
    }
    const items = await t.query<ProposalItem>(`select * from proposal_items where proposal_id = $1 order by sort`, [p.id]);
    const s = await getSettings(t);
    const totals = computeProposal(p, items, { profitPct: s.profitPct, burdenRate: s.burdenRate });

    let companyId = p.company_id;
    if (!companyId && p.client?.name) companyId = (await ensureCompany(t, p.client.name, "client")).id;
    let contactId = p.contact_id;
    if (!contactId && p.client?.contact_name) {
      contactId = (await ensureContact(t, { ...splitName(p.client.contact_name), email: p.client.email || null, phone: p.client.phone || null, title: p.client.contact_title || null, company_id: companyId })).id;
    }
    const status = PROPOSAL_TO_PIPELINE[p.status] ?? "Proposal Needed";
    const sentDay = p.sent_at ? new Date(p.sent_at).toISOString().slice(0, 10) : null;
    const name = [p.client?.name, p.project_name || p.title].filter(Boolean).join(" – ");
    const [o] = await t.query<Opportunity>(
      `insert into opportunities (name, status, company_id, contact_id, contact_text, best_contact_method, project_type, project_detail,
          date_received, date_presented, subs_cost, design_fee, projected_arch_hours, proposal_id, closed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, case when $2 in ('Sold','Rejected') then now() end) returning *`,
      [name, status, companyId, contactId, p.client?.contact_name || null, p.client?.email ? "Email" : p.client?.phone ? "Phone" : null,
        p.project_type, (p.scope_text || p.scope_text_raw || "").slice(0, 500) || null, today, sentDay,
        totals.consultantsTotal, totals.phasesTotal + totals.additionalTotal + totals.reimbursablesTotal, totals.hoursAllowance || null, p.id]);
    await t.query(`update proposals set opportunity_id = $2, company_id = coalesce(company_id, $3), contact_id = coalesce(contact_id, $4) where number = $1`,
      [p.number, o.id, companyId, contactId]);
    await audit(t, { actor, entity: "opportunity", id: o.id, action: "convert", summary: `Created from proposal ${p.number} v${p.version}`, related: { entity: "proposal", id: p.id } });
    await audit(t, { actor, entity: "proposal", id: p.id, action: "convert", summary: `Sent to the sales pipeline as “${o.name}” (${status})`, related: { entity: "opportunity", id: o.id } });
    const next = nextFollowUpDue(o);
    await addTask(t, {
      title: next ? `Follow up on proposal: ${o.name}` : `Present proposal: ${o.name}`,
      due_on: next?.due ?? today, cadence: next?.cadence ?? "opp_present", opportunity_id: o.id, contact_id: contactId,
      source_key: `opp:${o.id}:${next?.cadence ?? "opp_present"}`,
    });
    return o;
  });
}

/**
 * A proposal went to the client → its deal row in the CRM ("Proposals sent").
 *  - no deal yet: create it (Presented, sent date, fee/subs from the proposal, first follow-up task in 4 days — the sheet's 3-day rule)
 *  - deal still a lead (Proposal Needed / Consultant Outreach / Internal Review): move it to Presented (same follow-up task)
 *  - deal already out (e.g. a revised version): refresh its fees and sent date
 * The deal is owned by whoever sent it (if they're on the team list); open follow-ups without an owner get that owner.
 * Logged on the deal's timeline. Idempotent: sending twice doesn't duplicate the deal or the task.
 */
export async function proposalSent(db: Db, proposalId: string, actor: string, today = todayISO()): Promise<Opportunity> {
  const p = await one<Proposal>(db, `select * from proposals where id = $1`, [proposalId]);
  if (!p) throw new Error("Proposal not found");
  const sentDay = p.sent_at ? new Date(p.sent_at).toISOString().slice(0, 10) : today;
  const member = await memberForUser(db, actor);
  let o: Opportunity;
  const existing = p.opportunity_id ? await one<Opportunity>(db, `select * from opportunities where id = $1`, [p.opportunity_id]) : null;
  if (!existing) {
    o = await proposalToOpportunity(db, proposalId, actor, today);
  } else {
    const items = await db.query<ProposalItem>(`select * from proposal_items where proposal_id = $1 order by sort`, [p.id]);
    const st = await getSettings(db);
    const totals = computeProposal(p, items, { profitPct: st.profitPct, burdenRate: st.burdenRate });
    await db.query(`update opportunities set subs_cost = $2, design_fee = $3, total_bid_override = null, date_presented = case when status in ('Proposal Needed','Consultant Outreach','Internal Review') or date_presented is null then $4::date else date_presented end where id = $1`,
      [existing.id, totals.consultantsTotal, totals.phasesTotal + totals.additionalTotal + totals.reimbursablesTotal, sentDay]);
    o = (LEAD_STAGES as readonly string[]).includes(existing.status)
      ? await setOpportunityStatus(db, existing.id, "Presented", actor, today)
      : (await one<Opportunity>(db, `select * from opportunities where id = $1`, [existing.id]))!;
  }
  if (member) {
    await db.query(`update opportunities set owner_member_id = coalesce(owner_member_id, $2) where id = $1`, [o.id, member.id]);
    await db.query(`update tasks set owner_id = $2, assignee = $3 where opportunity_id = $1 and done_at is null and owner_id is null`, [o.id, member.id, member.name]);
  }
  await logActivity(db, { kind: "stage", author: actor, subject: `Proposal ${p.number} v${p.version} sent to the client`, opportunity_id: o.id });
  return (await one<Opportunity>(db, `select * from opportunities where id = $1`, [o.id]))!;
}

/** Opportunity Won → Project. Marks the row Sold, issues (or keeps) a job number, creates the
 *  nine template phases with the proposal's fee split, and spreads consultant fees by phase. */
export async function opportunityToProject(db: Db, oppId: string, actor: string, opts: { jobNumber?: string; lead?: string; today?: string } = {}): Promise<Project> {
  const today = opts.today ?? todayISO();
  const existing = await one<Project>(db, `select * from projects where opportunity_id = $1`, [oppId]);
  if (existing) return existing;
  let o = await one<Opportunity>(db, `select * from opportunities where id = $1`, [oppId]);
  if (!o) throw new Error("Opportunity not found");
  if (o.status !== "Sold") o = await setOpportunityStatus(db, oppId, "Sold", actor, today);

  return db.tx(async (t) => {
    const used = await allJobNumbers(t);
    const own = normalizeJobNumber(o!.job_number);
    const requested = normalizeJobNumber(opts.jobNumber);
    const takenByProject = async (n: string) => !!(await one(t, `select 1 from projects where job_number = $1`, [n]));
    let jobNumber: string;
    if (requested) {
      if (await takenByProject(requested)) throw new Error(`Job number ${requested} is already used by another project.`);
      jobNumber = requested;
    } else if (own && !(await takenByProject(own))) jobNumber = own;
    else jobNumber = nextJobNumber(used, today);

    const s = await getSettings(t);
    const p = o!.proposal_id ? await one<Proposal>(t, `select * from proposals where id = $1`, [o!.proposal_id]) : null;
    const items = p ? await t.query<ProposalItem>(`select * from proposal_items where proposal_id = $1 and included order by sort`, [p.id]) : [];
    const totals = p ? computeProposal(p, items, { profitPct: s.profitPct, burdenRate: s.burdenRate }) : null;
    const archFee = totals ? totals.archFee : o!.design_fee ?? null;
    const company = o!.company_id ? await one<{ name: string }>(t, `select name from companies where id = $1`, [o!.company_id]) : null;
    const contact = o!.contact_id ? await one<{ full_name: string }>(t, `select full_name from contacts where id = $1`, [o!.contact_id]) : null;

    const [proj] = await t.query<Project>(
      `insert into projects (job_number, name, status, lead, contract_date, company_id, client_text, client_contact, arch_fee, profit_pct, burden_rate, opportunity_id, proposal_id, notes)
       values ($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [jobNumber, p?.project_name || o!.name, opts.lead ?? null, today, o!.company_id, company?.name ?? p?.client?.name ?? null,
        contact?.full_name ?? o!.contact_text ?? null, archFee, s.profitPct, s.burdenRate, o!.id, p?.id ?? null, o!.project_detail]);

    // Phases: proposal phase lines mapped onto the template; template defaults otherwise.
    const fromProposal = new Map<string, { pct: number; amount: number | null }>();
    for (const it of items.filter((i) => i.kind === "phase")) {
      const ph = toTemplatePhase(it.label);
      if (ph) fromProposal.set(ph, { pct: it.pct ?? 0, amount: it.amount });
    }
    const allowance = hoursAllowance(Number(archFee) || 0, s.profitPct, s.burdenRate);
    for (const [i, def] of PHASES.entries()) {
      const fp = fromProposal.get(def.key);
      const feePct = p ? (fp?.pct ?? 0) : def.feePct;
      const inScope = p ? !!fp : def.feePct > 0;
      const hoursPct = def.hoursPct;
      await t.query(
        `insert into project_phases (project_id, phase, sort, fee_pct, arch_fee, hours_pct, hours_assigned, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [proj.id, def.key, i, feePct, fp?.amount ?? null, hoursPct, inScope && allowance ? Math.floor(allowance * feePct) : null, "not_started"]);
    }
    const firstPhase = PHASE_NAMES.find((ph) => (p ? fromProposal.has(ph) : PHASES.find((d) => d.key === ph)!.feePct > 0));
    if (firstPhase) {
      await t.query(`update project_phases set status = 'active' where project_id = $1 and phase = $2`, [proj.id, firstPhase]);
      await t.query(`update projects set current_phase = $2 where id = $1`, [proj.id, firstPhase]);
    }
    // Consultants: each proposal consultant line spread over the in-scope phases.
    const scopePhases = [...fromProposal.entries()].map(([phase, v]) => ({ phase, pct: v.pct }));
    for (const c of items.filter((i) => i.kind === "consultant" && !i.optional && (i.amount ?? 0) > 0)) {
      const split = scopePhases.length ? spreadByPhase(Number(c.amount), scopePhases) : [{ phase: "All phases", amount: Number(c.amount) }];
      for (const sp of split) {
        await t.query(
          `insert into project_consultants (project_id, discipline, firm, phase, fee) values ($1,$2,$3,$4,$5)
           on conflict (project_id, discipline, phase) do update set fee = project_consultants.fee + excluded.fee`,
          [proj.id, c.label, c.description, sp.phase, sp.amount]);
      }
    }
    if (o!.job_number !== jobNumber) await t.query(`update opportunities set job_number = $2 where id = $1`, [o!.id, jobNumber]);
    await t.query(`update tasks set done_at = now() where opportunity_id = $1 and done_at is null`, [o!.id]);
    await audit(t, { actor, entity: "project", id: proj.id, action: "convert", summary: `Project ${jobNumber} opened from won opportunity “${o!.name}”`, related: { entity: "opportunity", id: o!.id } });
    await audit(t, { actor, entity: "opportunity", id: o!.id, action: "convert", summary: `Won — project ${jobNumber} opened`, related: { entity: "project", id: proj.id } });
    if (p) await audit(t, { actor, entity: "proposal", id: p.id, action: "convert", summary: `Became project ${jobNumber}`, related: { entity: "project", id: proj.id } });
    return { ...proj, current_phase: firstPhase ?? null };
  });
}

/** The chain of linked records for any one of them. */
export async function lineage(db: Db, entity: "proposal" | "opportunity" | "project", id: string) {
  let proposalId: string | null = null, oppId: string | null = null, projectId: string | null = null;
  if (entity === "proposal") {
    proposalId = id;
    oppId = (await one<{ opportunity_id: string | null }>(db, `select opportunity_id from proposals where id = $1`, [id]))?.opportunity_id ?? null;
  } else if (entity === "opportunity") {
    oppId = id;
  } else {
    projectId = id;
    const pr = await one<{ opportunity_id: string | null; proposal_id: string | null }>(db, `select opportunity_id, proposal_id from projects where id = $1`, [id]);
    oppId = pr?.opportunity_id ?? null;
    proposalId = pr?.proposal_id ?? null;
  }
  if (oppId) {
    const o = await one<{ proposal_id: string | null }>(db, `select proposal_id from opportunities where id = $1`, [oppId]);
    proposalId = proposalId ?? o?.proposal_id ?? null;
    projectId = projectId ?? (await one<{ id: string }>(db, `select id from projects where opportunity_id = $1`, [oppId]))?.id ?? null;
  }
  const proposal = proposalId ? await one<{ id: string; number: string; version: number; status: string; title: string }>(db, `select id, number, version, status, title from proposals where id = $1`, [proposalId]) : null;
  const opportunity = oppId ? await one<{ id: string; name: string; status: string }>(db, `select id, name, status from opportunities where id = $1`, [oppId]) : null;
  const project = projectId ? await one<{ id: string; job_number: string; name: string; status: string }>(db, `select id, job_number, name, status from projects where id = $1`, [projectId]) : null;
  return { proposal, opportunity, project };
}

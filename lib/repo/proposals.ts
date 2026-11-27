import type { Db } from "../db/types";
import { one } from "../db/types";
import type { Proposal, ProposalItem } from "./types";
import { audit } from "./audit";
import { issueProposalNumber } from "./numbers";
import { DEFAULT_PHASE_ITEMS, FEE_AFFECTING, type ProposalItemInput } from "../calc/proposal";
import { addDays, todayISO } from "../calc/util";
import { getSettings } from "./settings";

export const PROPOSAL_STATUSES = ["draft", "in_review", "approved", "sent", "viewed", "accepted", "declined", "superseded"] as const;

const ITEM_COLS = "kind, label, description, pct, amount, hours, included, optional, sort";

export async function listProposals(db: Db) {
  return db.query<Proposal & { total_hint: number | null; company_name: string | null }>(
    `select p.*, c.name as company_name, null::numeric as total_hint from proposals p
     left join companies c on c.id = p.company_id where p.is_current order by p.updated_at desc`);
}

export async function getProposal(db: Db, id: string) {
  const p = await one<Proposal>(db, `select * from proposals where id = $1`, [id]);
  if (!p) return null;
  const items = await db.query<ProposalItem>(`select * from proposal_items where proposal_id = $1 order by sort, label`, [id]);
  const versions = await db.query<Pick<Proposal, "id" | "version" | "status" | "is_current" | "updated_at">>(
    `select id, version, status, is_current, updated_at from proposals where number = $1 order by version desc`, [p.number]);
  return { proposal: p, items, versions };
}

export async function getProposalByToken(db: Db, token: string) {
  const p = await one<Proposal>(db, `select * from proposals where public_token = $1`, [token]);
  return p ? getProposal(db, p.id) : null;
}

export interface NewProposal {
  title: string;
  company_id?: string | null;
  contact_id?: string | null;
  client?: Proposal["client"];
  project_name?: string | null;
  address?: string | null;
  project_type?: string | null;
  building_type?: string | null;
  delivery_type?: string | null;
  phase_narrative?: Record<string, string>;
  precedents_used?: unknown;
  status?: string;
  valid_until?: string | null;
  construction_cost?: number | null;
  fee_basis?: Proposal["fee_basis"];
  arch_fee?: number | null;
  arch_target_pct?: number | null;
  scope_text_raw?: string | null;
  scope_text?: string | null;
  items?: ProposalItemInput[];
  opportunity_id?: string | null;
  legacy_quote_id?: string | null;
}

export async function createProposal(db: Db, input: NewProposal, actor: string, today = todayISO()) {
  return db.tx(async (t) => {
    const s = await getSettings(t);
    const number = await issueProposalNumber(t, today);
    const [p] = await t.query<Proposal>(
      `insert into proposals (number, title, company_id, contact_id, client, project_name, address, project_type, delivery_type,
         construction_cost, fee_basis, arch_fee, arch_target_pct, scope_text_raw, scope_text, terms, valid_until, opportunity_id, legacy_quote_id,
         building_type, phase_narrative, precedents_used, status, approved_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, case when $23 = 'approved' then now() end) returning *`,
      [number, input.title, input.company_id ?? null, input.contact_id ?? null, JSON.stringify(input.client ?? {}), input.project_name ?? null,
        input.address ?? null, input.project_type ?? null, input.delivery_type ?? null, input.construction_cost ?? null,
        input.fee_basis ?? "fixed", input.arch_fee ?? null, input.arch_target_pct ?? 0.05, input.scope_text_raw ?? null,
        input.scope_text ?? null, s.defaultTerms, input.valid_until === undefined ? addDays(today, s.proposalValidDays) : input.valid_until, input.opportunity_id ?? null, input.legacy_quote_id ?? null,
        input.building_type ?? null, JSON.stringify(input.phase_narrative ?? {}), input.precedents_used === undefined ? null : JSON.stringify(input.precedents_used), input.status ?? "draft"],
    );
    await replaceItems(t, p.id, input.items ?? DEFAULT_PHASE_ITEMS);
    await audit(t, { actor, entity: "proposal", id: p.id, action: "create", summary: `Proposal ${number} created` });
    return p;
  });
}

export async function replaceItems(db: Db, proposalId: string, items: (ProposalItemInput & { description?: string | null })[]) {
  await db.query(`delete from proposal_items where proposal_id = $1`, [proposalId]);
  let sort = 0;
  for (const it of items) {
    await db.query(
      `insert into proposal_items (proposal_id, ${ITEM_COLS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [proposalId, it.kind, it.label, it.description ?? null, it.pct ?? null, it.amount ?? null, it.hours ?? null, it.included ?? true, it.optional ?? false, sort++],
    );
  }
}

const EDITABLE = ["title", "company_id", "contact_id", "client", "project_name", "address", "project_type", "building_type", "delivery_type", "construction_cost",
  "fee_basis", "arch_fee", "arch_target_pct", "scope_text_raw", "scope_text", "phase_narrative", "exclusions", "terms", "valid_until"] as const;
export type ProposalPatch = Partial<Pick<Proposal, (typeof EDITABLE)[number]>>;

/** Edits are allowed until the proposal is sent; after that, make a new version. */
export async function updateProposal(db: Db, id: string, patch: ProposalPatch, items: ProposalItemInput[] | null, actor: string) {
  return db.tx(async (t) => {
    const cur = await one<Proposal>(t, `select * from proposals where id = $1 for update`, [id]);
    if (!cur) throw new Error("Proposal not found");
    if (!["draft", "in_review", "approved"].includes(cur.status)) throw new Error("This proposal was already sent. Create a new version to change it.");
    const keys = EDITABLE.filter((k) => k in patch);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const vals = keys.map((k) => (k === "client" || k === "phase_narrative" ? JSON.stringify(patch[k]) : patch[k]));
      await t.query(`update proposals set ${sets} where id = $1`, [id, ...vals]);
    }
    if (items) await replaceItems(t, id, items);
    await audit(t, { actor, entity: "proposal", id, action: "update", summary: `Edited ${[...keys, ...(items ? ["line items"] : [])].join(", ") || "nothing"}` });
    // Old tool rule: changing the fee picture after approval un-approves — it must be reviewed again.
    const feeChanged = !!items || keys.some((k) => (FEE_AFFECTING as readonly string[]).includes(k));
    if (cur.status === "approved" && feeChanged) {
      await t.query(`update proposals set status = 'in_review', approved_at = null, approved_by = null where id = $1`, [id]);
      await audit(t, { actor, entity: "proposal", id, action: "status", summary: "approved → in_review (fees changed after approval)" });
    }
  });
}

/** Copy a proposal to version N+1 (the old one is kept, read-only, as history). */
export async function newVersion(db: Db, id: string, actor: string) {
  return db.tx(async (t) => {
    const cur = await one<Proposal>(t, `select * from proposals where id = $1`, [id]);
    if (!cur) throw new Error("Proposal not found");
    const [{ v }] = await t.query<{ v: number }>(`select max(version)::int as v from proposals where number = $1`, [cur.number]);
    await t.query(`update proposals set is_current = false, status = case when status in ('accepted','declined') then status else 'superseded' end where number = $1`, [cur.number]);
    const [p] = await t.query<Proposal>(
      `insert into proposals (number, version, parent_id, title, company_id, contact_id, client, project_name, address, project_type, building_type, delivery_type,
         construction_cost, fee_basis, arch_fee, arch_target_pct, scope_text_raw, scope_text, phase_narrative, exclusions, terms, valid_until, opportunity_id, precedents_used)
       select number, $2, id, title, company_id, contact_id, client, project_name, address, project_type, building_type, delivery_type,
         construction_cost, fee_basis, arch_fee, arch_target_pct, scope_text_raw, scope_text, phase_narrative, exclusions, terms, valid_until, opportunity_id, precedents_used
       from proposals where id = $1 returning *`, [id, v + 1]);
    await t.query(`insert into proposal_items (proposal_id, ${ITEM_COLS}) select $2, ${ITEM_COLS} from proposal_items where proposal_id = $1`, [id, p.id]);
    if (p.opportunity_id) await t.query(`update opportunities set proposal_id = $1 where id = $2`, [p.id, p.opportunity_id]);
    await audit(t, { actor, entity: "proposal", id: p.id, action: "version", summary: `Version ${p.version} started from v${cur.version}`, related: { entity: "proposal", id: cur.id } });
    return p;
  });
}

const STAMP: Record<string, string | null> = { approved: "approved_at", sent: "sent_at", viewed: "viewed_at", accepted: "accepted_at", declined: "declined_at" };
const ALLOWED: Record<string, string[]> = {
  draft: ["in_review", "approved"],
  in_review: ["draft", "approved"],
  approved: ["draft", "sent"],
  sent: ["viewed", "accepted", "declined"],
  viewed: ["accepted", "declined"],
  accepted: [],
  declined: [],
  superseded: [],
};

/** A proposal can go to the client (PDF / web link) once it has been approved internally. */
export const isFinal = (status: string) => ["approved", "sent", "viewed", "accepted"].includes(status);

export async function setProposalStatus(db: Db, id: string, status: string, actor: string, extra: { accepted_by_name?: string } = {}) {
  return db.tx(async (t) => {
    const cur = await one<Proposal>(t, `select * from proposals where id = $1 for update`, [id]);
    if (!cur) throw new Error("Proposal not found");
    if (cur.status === status) return cur;
    if (!ALLOWED[cur.status]?.includes(status)) throw new Error(`Can't move a ${cur.status} proposal to ${status}.`);
    const col = STAMP[status];
    const [p] = await t.query<Proposal>(
      `update proposals set status = $2 ${col ? `, ${col} = coalesce(${col}, now())` : ""} ${status === "accepted" ? ", accepted_by_name = $3" : ""} where id = $1 returning *`,
      status === "accepted" ? [id, status, extra.accepted_by_name ?? null] : [id, status]);
    if (status === "approved") await t.query(`update proposals set approved_by = $2 where id = $1`, [id, actor]);
    if (status === "draft" || status === "in_review") await t.query(`update proposals set approved_at = null, approved_by = null where id = $1`, [id]);
    await audit(t, { actor, entity: "proposal", id, action: "status", summary: `${cur.status} → ${status}` });
    return p;
  });
}

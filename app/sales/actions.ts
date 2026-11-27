"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ctx, str, num } from "@/lib/server";
import { createOpportunity, updateOpportunity, setOpportunityStatus, type OpportunityPatch } from "@/lib/repo/opportunities";
import { opportunityToProject } from "@/lib/flow";
import { addTask, ensureCompany } from "@/lib/repo/crm";
import { completeTask } from "@/lib/repo/tasks";
import { createProposal } from "@/lib/repo/proposals";
import { audit } from "@/lib/repo/audit";
import { pastClientCadence, prospectCadence } from "@/lib/calc/cadence";
import { todayISO } from "@/lib/calc/util";
import { normalizeJobNumber } from "@/lib/calc/jobNumber";

const OPP_FIELDS = {
  text: ["name", "contact_text", "best_contact_method", "project_type", "project_detail", "follow_up_1_by", "follow_up_1_result", "follow_up_2_by", "follow_up_2_result"],
  date: ["date_received", "construction_start", "date_presented", "follow_up_1_date", "follow_up_2_date"],
  num: ["subs_cost", "design_fee", "total_bid_override", "projected_arch_hours"],
} as const;

function oppPatch(f: FormData): OpportunityPatch {
  const out: Record<string, unknown> = {};
  for (const k of [...OPP_FIELDS.text, ...OPP_FIELDS.date]) if (f.has(k)) out[k] = str(f, k);
  for (const k of OPP_FIELDS.num) if (f.has(k)) out[k] = num(f, k);
  if (f.has("job_number")) {
    const raw = str(f, "job_number");
    const j = normalizeJobNumber(raw);
    if (raw && !j) throw new Error("Job numbers look like 26-117.");
    out.job_number = j;
  }
  return out as OpportunityPatch;
}

export async function createOpportunityAction(f: FormData) {
  const { db, actor } = await ctx();
  const patch = oppPatch(f);
  const company = str(f, "company");
  const o = await createOpportunity(db, { ...patch, name: patch.name ?? "New opportunity", date_received: patch.date_received ?? todayISO(), company_id: company ? (await ensureCompany(db, company)).id : null }, actor);
  redirect(`/sales/${o.id}`);
}

export async function updateOpportunityAction(id: string, f: FormData) {
  const { db, actor } = await ctx();
  await updateOpportunity(db, id, oppPatch(f), actor);
  revalidatePath(`/sales/${id}`);
}

export async function setOppStatusAction(id: string, status: string) {
  const { db, actor } = await ctx();
  await setOpportunityStatus(db, id, status, actor);
  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
}

export async function winAction(id: string, f: FormData) {
  const { db, actor } = await ctx();
  const p = await opportunityToProject(db, id, actor, { jobNumber: str(f, "job_number") ?? undefined, lead: str(f, "lead") ?? undefined });
  redirect(`/projects/${p.id}`);
}

export async function proposalFromOpportunityAction(id: string) {
  const { db, actor } = await ctx();
  const [o] = await db.query<{ name: string; company_id: string | null; contact_id: string | null; project_type: string | null; project_detail: string | null; proposal_id: string | null; company: string | null; contact: string | null }>(
    `select o.*, c.name as company, ct.full_name as contact from opportunities o left join companies c on c.id = o.company_id left join contacts ct on ct.id = o.contact_id where o.id = $1`, [id]);
  if (o.proposal_id) redirect(`/proposals/${o.proposal_id}`);
  const p = await createProposal(db, {
    title: o.name, project_name: o.name, company_id: o.company_id, contact_id: o.contact_id, project_type: o.project_type,
    client: { name: o.company ?? "", contact_name: o.contact ?? "", contact_title: "", email: "", phone: "" },
    scope_text_raw: o.project_detail, fee_basis: "pct_construction", opportunity_id: id,
  }, actor);
  await db.query(`update opportunities set proposal_id = $2 where id = $1`, [id, p.id]);
  await audit(db, { actor, entity: "opportunity", id, action: "link", summary: `Proposal ${p.number} started from this opportunity`, related: { entity: "proposal", id: p.id } });
  redirect(`/proposals/${p.id}`);
}

export async function addTaskAction(f: FormData) {
  const { db, actor } = await ctx();
  const title = str(f, "title");
  if (!title) throw new Error("What needs doing?");
  const id = await addTask(db, { title, due_on: str(f, "due_on"), assignee: str(f, "assignee"), opportunity_id: str(f, "opportunity_id"), contact_id: str(f, "contact_id"), project_id: str(f, "project_id"), cadence: "manual" });
  if (id) await audit(db, { actor, entity: "task", id, action: "create", summary: `Task: ${title}` });
  revalidatePath("/sales/follow-ups");
  const back = str(f, "back");
  if (back) redirect(back);
}

export async function completeTaskAction(id: string) {
  const { db, actor } = await ctx();
  await completeTask(db, id, actor);
  revalidatePath("/sales/follow-ups");
  revalidatePath("/");
}

export async function addContactAction(f: FormData) {
  const { db, actor } = await ctx();
  const company = str(f, "company");
  const kind = str(f, "kind") ?? "prospect";
  const companyId = company ? (await ensureCompany(db, company, kind === "past_client" ? "client" : "prospect")).id : null;
  const today = todayISO();
  const metOn = str(f, "met_on");
  const [c] = await db.query<{ id: string; full_name: string }>(
    `insert into contacts (first_name, last_name, email, phone, title, company_id, is_past_client, past_client_since, met_on, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, full_name`,
    [str(f, "first_name"), str(f, "last_name"), str(f, "email"), str(f, "phone"), str(f, "title"), companyId, kind === "past_client", kind === "past_client" ? today : null, metOn, str(f, "notes")]);
  await audit(db, { actor, entity: "contact", id: c.id, action: "create", summary: `Contact ${c.full_name} added` });
  const tasks = kind === "past_client" ? pastClientCadence(today, c.full_name) : metOn ? prospectCadence(metOn, c.full_name) : [];
  for (const t of tasks) await addTask(db, { title: t.title, due_on: t.due, cadence: t.cadence, contact_id: c.id, source_key: `contact:${c.id}:${t.cadence}` });
  revalidatePath("/sales/contacts");
}

export async function makePastClientAction(contactId: string) {
  const { db, actor } = await ctx();
  const today = todayISO();
  const [c] = await db.query<{ full_name: string }>(`update contacts set is_past_client = true, past_client_since = coalesce(past_client_since, $2) where id = $1 returning full_name`, [contactId, today]);
  for (const t of pastClientCadence(today, c.full_name)) await addTask(db, { title: t.title, due_on: t.due, cadence: t.cadence, contact_id: contactId, source_key: `contact:${contactId}:${t.cadence}` });
  await audit(db, { actor, entity: "contact", id: contactId, action: "update", summary: `${c.full_name} added to past clients — 1, 2 and 6-month check-ins scheduled` });
  revalidatePath("/sales/contacts");
}

export async function saveLeadMeasuresAction(f: FormData) {
  const { db, actor } = await ctx();
  const day = str(f, "day") ?? todayISO();
  const v = (k: string) => Math.max(0, Math.round(num(f, k) ?? 0));
  await db.query(
    `insert into lead_measures (day, connection_requests, responses, conversations, opportunities, proposals, yes, no) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (day) do update set connection_requests = excluded.connection_requests, responses = excluded.responses, conversations = excluded.conversations,
       opportunities = excluded.opportunities, proposals = excluded.proposals, yes = excluded.yes, no = excluded.no, updated_at = now()`,
    [day, v("connection_requests"), v("responses"), v("conversations"), v("opportunities"), v("proposals"), v("yes"), v("no")]);
  void actor;
  revalidatePath("/sales/measures");
  revalidatePath("/");
}

export async function addLagAction(f: FormData) {
  const { db } = await ctx();
  const opp = str(f, "opportunity");
  if (!opp) throw new Error("Name the opportunity.");
  await db.query(`insert into lag_measures (day, project_number, opportunity, status, notes) values ($1,$2,$3,$4,$5)`,
    [str(f, "day") ?? todayISO(), str(f, "project_number"), opp, str(f, "status") ?? "Opportunity", str(f, "notes")]);
  revalidatePath("/sales/measures");
}

export async function setLagStatusAction(id: string, status: string) {
  const { db } = await ctx();
  await db.query(`update lag_measures set status = $2 where id = $1`, [id, status]);
  revalidatePath("/sales/measures");
}

export async function addOutreachAction(f: FormData) {
  const { db, actor } = await ctx();
  const kind = str(f, "kind") ?? "biz_dev";
  const label = str(f, "label");
  if (!label) throw new Error("Who or what?");
  const company = kind === "biz_dev" ? null : await ensureCompany(db, label, kind === "cre_firm" ? "cre_firm" : "prospect");
  const [o] = await db.query<{ id: string }>(
    `insert into outreach (kind, label, company_id, day, status, phone, address, notes, author, period) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [kind, label, company?.id ?? null, str(f, "day"), str(f, "status"), str(f, "phone"), str(f, "address"), str(f, "notes"), actor,
      kind === "biz_dev" ? new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }) : null]);
  await audit(db, { actor, entity: "outreach", id: o.id, action: "create", summary: `${kind.replace("_", " ")}: ${label}` });
  revalidatePath("/sales/outreach");
}

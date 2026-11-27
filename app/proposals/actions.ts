"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ctx } from "@/lib/server";
import { createProposal, updateProposal, setProposalStatus, newVersion, type ProposalPatch } from "@/lib/repo/proposals";
import { proposalToOpportunity, proposalSent } from "@/lib/flow";
import type { ProposalItemInput } from "@/lib/calc/proposal";
import { suggestArchPct } from "@/lib/calc/proposal";
import { draftScope, aiConfigured } from "@/lib/ai";

export async function newProposalAction(f: FormData) {
  const { db, actor } = await ctx();
  const title = String(f.get("title") || "").trim() || "New proposal";
  const p = await createProposal(db, {
    title, project_name: title,
    client: { name: String(f.get("client") || ""), contact_name: "", contact_title: "", email: "", phone: "" },
    fee_basis: "pct_construction",
  }, actor);
  redirect(`/proposals/${p.id}`);
}

export async function saveProposalAction(id: string, patch: ProposalPatch, items: (ProposalItemInput & { description?: string | null })[] | null) {
  const { db, actor } = await ctx();
  await updateProposal(db, id, patch, items, actor);
  revalidatePath(`/proposals/${id}`);
  return { ok: true };
}

export async function setStatusAction(id: string, status: string, extra?: { accepted_by_name?: string }) {
  const { db, actor } = await ctx();
  await setProposalStatus(db, id, status, actor, extra);
  // Sending a proposal creates/updates its deal in the CRM, with a follow-up task.
  if (status === "sent") await proposalSent(db, id, actor);
  // Accepting or declining a proposal moves its pipeline row too.
  if (status === "accepted" || status === "declined") {
    const [p] = await db.query<{ opportunity_id: string | null }>(`select opportunity_id from proposals where id = $1`, [id]);
    if (p?.opportunity_id) {
      const { setOpportunityStatus } = await import("@/lib/repo/opportunities");
      const target = status === "accepted" ? "Sold" : "Rejected";
      await setOpportunityStatus(db, p.opportunity_id, target, actor);
    }
  }
  revalidatePath(`/proposals/${id}`);
  revalidatePath("/crm");
}

export async function newVersionAction(id: string) {
  const { db, actor } = await ctx();
  const p = await newVersion(db, id, actor);
  redirect(`/proposals/${p.id}`);
}

export async function toPipelineAction(id: string) {
  const { db, actor } = await ctx();
  const o = await proposalToOpportunity(db, id, actor);
  redirect(`/sales/${o.id}`);
}

export async function suggestFeeAction(buildingType: string | null, deliveryType: string | null) {
  const { db } = await ctx();
  const { classifyBuilding } = await import("@/lib/import/legacy");
  const rows = await db.query<{ project_name: string | null; project_number: string | null; file: string; construction_cost: number | null; total_fee: number | null; fee_pct_of_construction: number | null; building_type: string | null; category: string | null; delivery_type: string | null; is_frame_proposal: boolean }>(
    `select project_name, project_number, file, construction_cost, total_fee, fee_pct_of_construction, building_type, category, delivery_type, is_frame_proposal
     from fee_precedents where fee_pct_of_construction is not null order by created_at desc`);
  // Match on the normalized category so free-text building types still find their peers.
  const cat = classifyBuilding(buildingType);
  const keyed = rows.map((r) => ({ ...r, building_type: r.category, delivery_type: r.delivery_type }));
  return suggestArchPct(keyed, cat, deliveryType && keyed.some((r) => r.delivery_type === deliveryType) ? deliveryType : null);
}

export async function draftScopeAction(input: { scope_text_raw: string; project_name: string; client_name: string; disciplines: string[] }) {
  await ctx();
  if (!aiConfigured()) return { error: "AI drafting isn't switched on yet — add ANTHROPIC_API_KEY on the server (see README)." };
  try {
    const { getDb } = await import("@/lib/db");
    return { draft: await draftScope(await getDb(), input) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}


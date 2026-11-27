"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { one } from "@/lib/db/types";
import { setProposalStatus } from "@/lib/repo/proposals";
import { setOpportunityStatus } from "@/lib/repo/opportunities";

/** Public: the client accepts from their link. Only a sent/viewed current proposal can be accepted. */
export async function acceptAction(f: FormData) {
  const token = String(f.get("token") ?? "");
  const name = String(f.get("name") ?? "").trim().slice(0, 120);
  if (!name || f.get("agree") !== "on") throw new Error("Please enter your name and tick the box.");
  const db = await getDb();
  const p = await one<{ id: string; status: string; is_current: boolean; opportunity_id: string | null }>(db,
    `select id, status, is_current, opportunity_id from proposals where public_token = $1`, [token]);
  if (!p || !p.is_current || !["sent", "viewed"].includes(p.status)) throw new Error("This proposal can’t be accepted online.");
  await setProposalStatus(db, p.id, "accepted", `client: ${name}`, { accepted_by_name: name });
  if (p.opportunity_id) await setOpportunityStatus(db, p.opportunity_id, "Sold", `client: ${name}`);
  redirect(`/p/${token}?done=1`);
}

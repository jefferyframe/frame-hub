"use server";
import { revalidatePath } from "next/cache";
import { ctx, str, num } from "@/lib/server";
import { setProjectStatus, addTimeEntry, updatePhase, setConsultantStatus } from "@/lib/repo/projects";
import { audit } from "@/lib/repo/audit";

export async function projectStatusAction(id: string, status: string) {
  const { db, actor } = await ctx();
  await setProjectStatus(db, id, status, actor);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

export async function addHoursAction(id: string, f: FormData) {
  const { db, actor } = await ctx();
  const hours = num(f, "hours");
  if (hours === null) throw new Error("Enter the hours worked.");
  const week = str(f, "week_ending");
  await addTimeEntry(db, { project_id: id, phase: str(f, "phase")!, person: str(f, "person"), hours, week_ending: week, week_label: week ? `Thru ${week}` : null, notes: str(f, "notes") }, actor);
  revalidatePath(`/projects/${id}`);
}

export async function phaseAction(id: string, phase: string, f: FormData) {
  const { db, actor } = await ctx();
  const pctIn = (k: string) => { const n = num(f, k); return n === null ? null : n / 100; };
  await updatePhase(db, id, phase, { hours_assigned: num(f, "hours_assigned"), target_date: str(f, "target_date"), fee_pct: pctIn("fee_pct"), hours_pct: pctIn("hours_pct"), ...(str(f, "status") ? { status: str(f, "status")! } : {}) }, actor);
  revalidatePath(`/projects/${id}`);
}

export async function consultantStatusAction(id: string, discipline: string, phase: string, status: string) {
  const { db, actor } = await ctx();
  await setConsultantStatus(db, id, discipline, phase, status || null, actor);
  revalidatePath(`/projects/${id}`);
}

const HEADER = ["name", "lead", "team", "contract_date", "client_text", "client_contact", "client_contact_2", "contractor", "contractor_contact", "billing_notes", "notes"] as const;
export async function projectHeaderAction(id: string, f: FormData) {
  const { db, actor } = await ctx();
  const vals: unknown[] = HEADER.map((k) => str(f, k));
  const fee = num(f, "arch_fee"), profit = num(f, "profit_pct"), burden = num(f, "burden_rate");
  await db.query(`update projects set ${HEADER.map((k, i) => `${k} = $${i + 2}`).join(", ")}, arch_fee = $${HEADER.length + 2}, profit_pct = coalesce($${HEADER.length + 3}, profit_pct), burden_rate = coalesce($${HEADER.length + 4}, burden_rate) where id = $1`,
    [id, ...vals, fee, profit === null ? null : profit / 100, burden]);
  await audit(db, { actor, entity: "project", id, action: "update", summary: "Edited project details / fee" });
  revalidatePath(`/projects/${id}`);
}

"use server";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/server";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { projectCard, type CardData } from "@/lib/projectCard";
import { logHours, updateEntry, deleteEntry, setCell, type LogInput } from "@/lib/repo/time";
import { saveAssignment, removeAssignment, setPhaseDates, seedSchedule } from "@/lib/repo/schedule";
import { createTask } from "@/lib/repo/tasks";
import { parseHours } from "@/lib/calc/hours";

export type Res<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
const safe = async <T,>(fn: () => Promise<T>): Promise<Res<T>> => {
  try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: (e as Error).message || "Something went wrong." }; }
};
const refresh = () => revalidatePath("/", "layout");

async function card(projectId: string, actor: string): Promise<CardData> {
  const c = await projectCard(await getDb(), projectId, actor);
  if (!c) throw new Error("Project not found.");
  return c;
}

export async function loadCardAction(projectId: string): Promise<Res<CardData>> {
  return safe(async () => {
    const u = await currentUser();
    if (!u) throw new Error("Please sign in.");
    return card(projectId, u.name);
  });
}

export interface HoursForm { project_id: string; phase: string; member_id: string; work_date: string; hours: string | number; notes?: string | null }
const toInput = (f: HoursForm): LogInput => {
  const h = parseHours(f.hours);
  if (h === null) throw new Error("Enter the hours worked.");
  return { project_id: f.project_id, phase: f.phase, member_id: f.member_id, work_date: f.work_date, hours: h, notes: f.notes ?? null };
};

export async function logHoursAction(f: HoursForm): Promise<Res<CardData>> {
  return safe(async () => { const { db, actor } = await ctx(); await logHours(db, toInput(f), actor); refresh(); return card(f.project_id, actor); });
}
export async function updateEntryAction(projectId: string, id: string, f: Partial<HoursForm>): Promise<Res<CardData>> {
  return safe(async () => {
    const { db, actor } = await ctx();
    const h = f.hours === undefined ? undefined : parseHours(f.hours);
    if (h === null) throw new Error("Enter the hours worked.");
    await updateEntry(db, id, { phase: f.phase, member_id: f.member_id, work_date: f.work_date, hours: h, notes: f.notes }, actor);
    refresh(); return card(projectId, actor);
  });
}
export async function deleteEntryAction(projectId: string, id: string): Promise<Res<CardData>> {
  return safe(async () => { const { db, actor } = await ctx(); await deleteEntry(db, id, actor); refresh(); return card(projectId, actor); });
}

export async function saveAssignmentAction(a: { project_id: string; phase: string; member_id: string; mode: "auto" | "hours" | "pct"; value?: string | number | null }): Promise<Res<CardData>> {
  return safe(async () => {
    const { db, actor } = await ctx();
    const v = a.value === null || a.value === undefined || a.value === "" ? null : Number(String(a.value).replace(/[%\s]/g, ""));
    if (a.mode !== "auto" && (v === null || !Number.isFinite(v))) throw new Error(a.mode === "hours" ? "Enter hours a week." : "Enter a percentage.");
    await saveAssignment(db, { project_id: a.project_id, phase: a.phase, member_id: a.member_id, hours_per_week: a.mode === "hours" ? v : null, allocation_pct: a.mode === "pct" ? v! / 100 : null }, actor);
    refresh(); return card(a.project_id, actor);
  });
}
export async function removeAssignmentAction(projectId: string, id: string): Promise<Res<CardData>> {
  return safe(async () => { const { db, actor } = await ctx(); await removeAssignment(db, id, actor); refresh(); return card(projectId, actor); });
}
export async function setPhaseDatesAction(projectId: string, phase: string, d: { start_date?: string | null; target_date?: string | null }): Promise<Res<CardData>> {
  return safe(async () => { const { db, actor } = await ctx(); await setPhaseDates(db, projectId, phase, d, actor); refresh(); return card(projectId, actor); });
}
/** Gantt drag: same as above but without rebuilding the card. */
export async function moveBarAction(projectId: string, phase: string, d: { start_date?: string | null; target_date?: string | null }): Promise<Res> {
  return safe(async () => { const { db, actor } = await ctx(); await setPhaseDates(db, projectId, phase, d, actor); refresh(); });
}
export async function addProjectTaskAction(projectId: string, t: { title: string; due_day?: string | null; owner_id?: string | null }): Promise<Res<CardData>> {
  return safe(async () => { const { db, actor } = await ctx(); await createTask(db, { title: t.title, due_day: t.due_day || null, owner_id: t.owner_id || null, project_id: projectId }, actor); refresh(); return card(projectId, actor); });
}
export async function setCellAction(c: { member_id: string; project_id: string; phase: string; work_date: string; hours: string }): Promise<Res> {
  return safe(async () => {
    const { db, actor } = await ctx();
    const h = c.hours.trim() === "" ? 0 : parseHours(c.hours);
    if (h === null || h < 0) throw new Error("Enter hours like 1.5 or 1:30.");
    await setCell(db, { member_id: c.member_id, project_id: c.project_id, phase: c.phase, work_date: c.work_date, hours: h }, actor);
    refresh();
  });
}
export async function seedScheduleAction(): Promise<Res<{ seeded: number }>> {
  return safe(async () => { const { db, actor } = await ctx(); const r = await seedSchedule(db, actor, { force: true }); refresh(); return { seeded: r.seeded }; });
}

"use server";
import { revalidatePath } from "next/cache";
import { ctx, str, num } from "@/lib/server";
import { setSetting, getSettings } from "@/lib/repo/settings";
import { audit } from "@/lib/repo/audit";
import { STAGES } from "@/lib/calc/sales";
import { saveMemberHours, setReminder } from "@/lib/repo/team";

export async function saveSettingsAction(f: FormData) {
  const { db, actor, user } = await ctx();
  if (user.role !== "owner" && user.role !== "admin") throw new Error("Only an admin can change settings.");
  const cur = await getSettings(db);
  const likelihood = { ...cur.stageLikelihood };
  for (const st of STAGES) { const v = num(f, `stage_${st.key}`); if (v !== null) likelihood[st.key] = Math.min(1, Math.max(0, v / 100)); }
  await setSetting(db, "firmName", str(f, "firmName") ?? cur.firmName);
  await setSetting(db, "firmPhone", str(f, "firmPhone") ?? "");
  await setSetting(db, "firmAddress", str(f, "firmAddress") ?? "");
  await setSetting(db, "firmEmail", str(f, "firmEmail") ?? "");
  await setSetting(db, "proposalValidDays", num(f, "proposalValidDays") ?? cur.proposalValidDays);
  await setSetting(db, "defaultTerms", str(f, "defaultTerms") ?? "");
  await setSetting(db, "whyFrame", (str(f, "whyFrame") ?? "").split("\n").map((x) => x.trim()).filter(Boolean));
  await setSetting(db, "stageLikelihood", likelihood);
  const pp = num(f, "profitPct"); if (pp !== null) await setSetting(db, "profitPct", pp / 100);
  const br = num(f, "burdenRate"); if (br !== null) await setSetting(db, "burdenRate", br);
  await audit(db, { actor, entity: "settings", id: "00000000-0000-0000-0000-000000000000", action: "update", summary: "Settings changed" });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- hours & reminders
type R = { ok: true } | { ok: false; error: string };
const safeR = async (fn: () => Promise<void>): Promise<R> => { try { await fn(); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message || "Something went wrong." }; } };

export async function saveMemberHoursAction(id: string, h: { hours_per_day: string; work_days: number[]; track_hours: boolean; remind_enabled: boolean; remind_time: string }): Promise<R> {
  return safeR(async () => {
    const { db, actor } = await ctx();
    const hpd = Number(h.hours_per_day);
    await saveMemberHours(db, id, { hours_per_day: hpd, work_days: h.work_days, track_hours: h.track_hours });
    await setReminder(db, id, { enabled: h.remind_enabled, time: h.remind_time || null });
    await audit(db, { actor, entity: "settings", id: "00000000-0000-0000-0000-000000000000", action: "update", summary: `Hours for team member changed (${hpd} h/day, days ${h.work_days.join(",")}, reminder ${h.remind_enabled ? h.remind_time : "off"})` });
    revalidatePath("/", "layout");
  });
}

export async function setReminderAction(id: string, enabled: boolean, time: string): Promise<R> {
  return safeR(async () => { const { db } = await ctx(); await setReminder(db, id, { enabled, time: time || null }); revalidatePath("/", "layout"); });
}

export async function saveHoursSettingsAction(f: FormData) {
  const { db, actor, user } = await ctx();
  if (user.role !== "owner" && user.role !== "admin") throw new Error("Only an admin can change settings.");
  const start = str(f, "hoursTrackingStart");
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) await setSetting(db, "hoursTrackingStart", start);
  const hol = (str(f, "firmHolidays") ?? "").split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  await setSetting(db, "firmHolidays", [...new Set(hol)].sort());
  await db.query(`update team_members set remind_seq = remind_seq + 1`); // holidays changed → calendars re-read the reminder
  await audit(db, { actor, entity: "settings", id: "00000000-0000-0000-0000-000000000000", action: "update", summary: `Hours settings: tracking from ${start}, ${hol.length} holidays` });
  revalidatePath("/", "layout");
}

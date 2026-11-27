"use server";
import { revalidatePath } from "next/cache";
import { ctx, str, num } from "@/lib/server";
import { setSetting, getSettings } from "@/lib/repo/settings";
import { audit } from "@/lib/repo/audit";
import { STAGES } from "@/lib/calc/sales";

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

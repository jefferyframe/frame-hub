"use server";
import { revalidatePath } from "next/cache";
import { ctx, str, num } from "@/lib/server";

export async function saveTemplateAction(id: string | null, f: FormData) {
  const { db } = await ctx();
  const pctIn = num(f, "default_pct");
  const vals = [str(f, "label"), str(f, "description"), pctIn === null ? null : pctIn / 100, f.get("active") === "on"];
  if (id) await db.query(`update line_item_templates set label = $2, description = $3, default_pct = $4, active = $5 where id = $1`, [id, ...vals]);
  else await db.query(`insert into line_item_templates (kind, label, description, default_pct, active, sort) values ($1,$2,$3,$4,$5, 999) on conflict (kind, label) do nothing`, [str(f, "kind"), ...vals]);
  revalidatePath("/proposals/library");
}

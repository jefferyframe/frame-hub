import "server-only";
import { getDb } from "./db";
import { requireWriter } from "./auth";

/** Every server action: signed-in writer + shared database connection. */
export async function ctx() {
  const user = await requireWriter();
  const db = await getDb();
  return { db, actor: user.name, user };
}
export const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
export const num = (f: FormData, k: string) => { const v = str(f, k); if (v === null) return null; const n = Number(v.replace(/[$,%\s]/g, "")); return Number.isFinite(n) ? n : null; };

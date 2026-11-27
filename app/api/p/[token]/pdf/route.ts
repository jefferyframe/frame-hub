import { getDb } from "@/lib/db";
import { one } from "@/lib/db/types";
import { isFinal } from "@/lib/repo/proposals";
import { proposalPdf, pdfResponse } from "@/lib/pdf/render";

export const runtime = "nodejs";

/** Client download from their link — only for approved-or-later current proposals. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const p = await one<{ id: string; status: string; is_current: boolean }>(db, `select id, status, is_current from proposals where public_token = $1`, [token]);
  if (!p || !p.is_current || !isFinal(p.status)) return new Response("Not found", { status: 404 });
  const out = await proposalPdf(db, p.id);
  return out ? pdfResponse(out.buf, out.name) : new Response("Not found", { status: 404 });
}

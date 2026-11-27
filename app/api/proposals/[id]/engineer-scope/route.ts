import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { engineerPdf, pdfResponse } from "@/lib/pdf/render";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Sign in", { status: 401 });
  const { id } = await params;
  const discipline = new URL(req.url).searchParams.get("discipline") ?? "";
  const out = await engineerPdf(await getDb(), id, discipline);
  if (!out) return new Response("Not found", { status: 404 });
  return pdfResponse(out.buf, out.name);
}

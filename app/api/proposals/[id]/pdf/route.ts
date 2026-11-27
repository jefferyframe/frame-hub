import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { proposalPdf, pdfResponse } from "@/lib/pdf/render";

export const runtime = "nodejs";

/** Staff download. Drafts get a PDF too (watermarked by status in the file name) so they can be reviewed. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Sign in", { status: 401 });
  const { id } = await params;
  const out = await proposalPdf(await getDb(), id);
  if (!out) return new Response("Not found", { status: 404 });
  const draft = !["approved", "sent", "viewed", "accepted"].includes(out.proposal.status);
  return pdfResponse(out.buf, draft ? out.name.replace(/\.pdf$/, "-DRAFT.pdf") : out.name, new URL(req.url).searchParams.has("inline"));
}

import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getProposalByToken, isFinal } from "@/lib/repo/proposals";
import { getSettings } from "@/lib/repo/settings";
import { libraryItems } from "@/lib/repo/library";
import { audit } from "@/lib/repo/audit";
import { ProposalDocument } from "@/components/ProposalDocument";
import { acceptAction } from "./actions";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fee proposal", robots: { index: false } };

/** The client's link. Shows only approved-or-later, current proposals; first open marks it viewed. */
export default async function ClientProposal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const db = await getDb();
  const data = await getProposalByToken(db, token);
  if (!data || !isFinal(data.proposal.status) || !data.proposal.is_current) notFound();
  const p = data.proposal;
  if (p.status === "sent") {
    await db.query(`update proposals set status = 'viewed', viewed_at = now() where id = $1 and status = 'sent'`, [p.id]);
    await audit(db, { actor: "client", entity: "proposal", id: p.id, action: "status", summary: "sent → viewed (client opened the link)" });
  }
  const [settings, library] = await Promise.all([getSettings(db), libraryItems(db)]);
  const footer = p.status === "accepted"
    ? <p className="notice ok">Accepted by {p.accepted_by_name ?? "the client"} on {dateTime(p.accepted_at)}. Thank you — we’ll send the AIA agreement shortly.</p>
    : (p.status === "sent" || p.status === "viewed")
      ? (
        <form action={acceptAction} className="pdoc-accept stack noprint">
          <input type="hidden" name="token" value={token} />
          <b>Accept this proposal</b>
          <label className="f"><span>Your name</span><input name="name" required autoComplete="name" /></label>
          <label className="row small"><input type="checkbox" name="agree" required /> I accept this fee proposal on behalf of {p.client?.name || "the client"}.</label>
          <div><button className="btn primary">Accept proposal</button></div>
        </form>)
      : null;
  return (
    <main style={{ padding: "28px 12px 60px", background: "var(--bg)", minHeight: "100vh" }}>
      {done && <p className="notice ok" style={{ maxWidth: 820, margin: "0 auto 16px" }}>Thank you — your acceptance has been recorded.</p>}
      <ProposalDocument p={p} items={data.items} settings={settings} library={library} footer={footer} />
      <p className="small faint" style={{ textAlign: "center", marginTop: 16 }}><a href={`/api/p/${token}/pdf`}>Download PDF</a></p>
    </main>
  );
}

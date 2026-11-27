import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getProposal } from "@/lib/repo/proposals";
import { getSettings } from "@/lib/repo/settings";
import { libraryItems } from "@/lib/repo/library";
import { ProposalDocument } from "@/components/ProposalDocument";

export const dynamic = "force-dynamic";

export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const data = await getProposal(db, id);
  if (!data) notFound();
  const [settings, library] = await Promise.all([getSettings(db), libraryItems(db)]);
  return (
    <div className="stack">
      <div className="row noprint"><Link href={`/proposals/${id}`}>← Back to the editor</Link><span className="spacer" /><a className="btn" href={`/api/proposals/${id}/pdf`}>Download PDF</a></div>
      <ProposalDocument p={data.proposal} items={data.items} settings={settings} library={library} />
    </div>
  );
}

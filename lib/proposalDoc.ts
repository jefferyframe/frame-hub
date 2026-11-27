const TEAM: Record<string, string> = { Landscape: "Landscape Architecture", Survey: "Land Surveying", GeoTech: "Geotechnical Engineering", "Fire Protection": "Fire Protection Engineering" };
/** How a carried discipline is named on the proposal ("Structural" → "Structural Engineering"). */
export const teamLabel = (d: string) => TEAM[d] ?? (/engineer|architect|survey/i.test(d) ? d : `${d} Engineering`);

/** Everything the client-facing proposal shows, computed once and shared by the web view and the PDF. */
import type { Proposal, ProposalItem } from "./repo/types";
import type { FirmSettings } from "./repo/settings";
import { computeProposal } from "./calc/proposal";

export function proposalDoc(p: Proposal, items: ProposalItem[], s: FirmSettings, library: { kind: string; label: string; description: string | null }[] = []) {
  const t = computeProposal(p, items, { profitPct: s.profitPct, burdenRate: s.burdenRate });
  const live = items.filter((i) => i.included);
  const desc = (label: string) => library.find((l) => l.kind === "phase" && l.label === label)?.description ?? "";
  const phases = live.filter((i) => i.kind === "phase").map((i, k) => ({ label: i.label, amount: t.phases[k]?.amount ?? 0, narrative: p.phase_narrative?.[i.label] || desc(i.label) }));
  const engineers = live.filter((i) => i.kind === "consultant" && !i.optional);
  const feeRows = [{ label: "Architecture (Frame)", amount: t.archFee }, ...engineers.map((e) => ({ label: `${teamLabel(e.label)}${e.description ? ` (${e.description})` : ""}`, amount: Number(e.amount) || 0 }))];
  const additional = live.filter((i) => i.kind === "additional_service" && !i.optional);
  const options = live.filter((i) => i.optional && i.kind !== "phase");
  const reimb = live.filter((i) => i.kind === "reimbursable" && !i.optional);
  const exclusions = [
    ...(p.exclusions ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
    ...live.filter((i) => i.kind === "exclusion").map((i) => i.label),
  ];
  return {
    totals: t, phases, engineers, feeRows, additional, options, reimb, exclusions,
    paragraphs: (p.scope_text || p.scope_text_raw || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean),
    preparedFor: [p.client?.contact_name || null, p.client?.contact_title || null].filter(Boolean).join(", ") + (p.client?.name ? `${p.client?.contact_name ? ", " : ""}${p.client.name}` : ""),
    firmLines: [s.firmName, ...s.firmAddress.split("\n"), s.firmPhone, s.firmEmail].filter(Boolean),
    why: s.whyFrame,
  };
}

export const NEXT_STEPS = "Notify us that you are ready to move forward and we will prepare the AIA Contract document. Once you receive it, please sign and return at your convenience.";
export const THANKS = "Thank you for giving us the opportunity to offer you this proposal. We are excited by the possibility of working with you!";
export const NAC_NOTICE = "Per NAC 623.780: Drawings and specifications remain the property of the design professional. Copies retained by the client may be used only for occupying the project for which they were prepared, and not for the construction of any other project.";

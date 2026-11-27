/** The first quoting tool's Supabase export (quotes.csv, archive_index.csv) → proposals and fee precedents. */
import { parseJsonish } from "./csv";
import { section, note, type SectionReport } from "./report";
import { DISCIPLINES, LEGACY_PHASES, computeSuggested, type ProposalItemInput } from "../calc/proposal";
import { normalizeJobNumber } from "../calc/jobNumber";
import type { NewProposal } from "../repo/proposals";

/** Map free-text building types ("Multifamily (Townhomes)", "Restaurant (TI, ~2,250 sf)") to the
 *  old tool's categories so precedents can be matched to a new proposal. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/roof/i, "roofing"],
  [/multi-?family|apartment|townhom|condo|housing|duplex|plex|lihtc|hud\b|student housing|micro apartment/i, "multifamily"],
  [/medical|health|clinic|hospital|oncology|aba therapy|dental|surgery/i, "medical"],
  [/restaurant|cafe|coffee|food service|dining|bar\b|butcher|kitchen/i, "restaurant"],
  [/school|educat|college|universit|campus|academy|preschool|early learning|observatory/i, "educational"],
  [/church|religious|worship/i, "religious"],
  [/hotel|hospitality|resort|casino|gaming/i, "hospitality"],
  [/retail|shopping|bank|financial|medspa|storefront/i, "retail"],
  [/industrial|warehouse|manufactur|cold storage|pemb|pre-engineered|hangar|dairy|laboratory|storage/i, "industrial"],
  [/office/i, "office"],
  [/mixed-?use/i, "mixed_use"],
  [/government|municipal|city hall|civic|public|fire station|military|institution|fairground|event|venue|shelter|recreation|sports|arts/i, "institutional"],
  [/residen|single-?family|home|adu\b|house/i, "residential"],
];
export function classifyBuilding(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const exact = t.toLowerCase().replace(/[\s-]+/g, "_");
  const known = ["medical", "restaurant", "multifamily", "office", "retail", "industrial", "residential", "institutional", "educational", "hospitality", "mixed_use", "roofing", "religious", "other"];
  if (known.includes(exact)) return exact;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(t)) return cat;
  return "other";
}

export interface PrecedentRecord {
  legacy_id: string; file: string; is_frame_proposal: boolean; project_number: string | null; project_name: string | null;
  building_type: string | null; delivery_type: string | null; category: string | null; disciplines: string[]; construction_cost: number | null;
  total_fee: number | null; fee_range_low: number | null; fee_range_high: number | null; fee_pct_of_construction: number | null; fee_pct_derived: boolean;
  discipline_fees: Record<string, number> | null; phases: string[]; notable_scope_language: string | null; notes: string | null;
}

const n = (v: string | undefined) => { const t = (v ?? "").replace(/[$,]/g, "").trim(); if (!t) return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
const s = (v: string | undefined) => { const t = (v ?? "").trim(); return t ? t : null; };

export function parseArchive(rows: Record<string, string>[]): { rows: PrecedentRecord[]; report: SectionReport } {
  const report = section();
  const out: PrecedentRecord[] = [];
  let derived = 0;
  for (const r of rows) {
    report.read++;
    if (!r.id || !r.file) { report.skipped++; note(report, `Row without id/file skipped.`); continue; }
    const cc = n(r.construction_cost), fee = n(r.total_fee);
    let pct = n(r.fee_pct_of_construction);
    let isDerived = false;
    if (pct !== null && pct > 1) pct = pct / 100; // stored as 6.5 instead of 0.065
    if (pct === null && cc && fee && cc > 0) { pct = fee / cc; isDerived = true; derived++; }
    const rawNo = s(r.project_number);
    out.push({
      legacy_id: r.id, file: r.file, is_frame_proposal: r.is_frame_proposal !== "false", project_number: normalizeJobNumber(rawNo) ?? rawNo,
      project_name: s(r.project_name), building_type: s(r.building_type), delivery_type: s(r.delivery_type), category: classifyBuilding(r.building_type),
      disciplines: (parseJsonish<string[]>(r.disciplines) ?? []).map(String), construction_cost: cc, total_fee: fee,
      fee_range_low: n(r.fee_range_low), fee_range_high: n(r.fee_range_high), fee_pct_of_construction: pct, fee_pct_derived: isDerived,
      discipline_fees: parseJsonish<Record<string, number>>(r.discipline_fees), phases: (parseJsonish<string[]>(r.phases) ?? []).map(String),
      notable_scope_language: s(r.notable_scope_language), notes: s(r.notes),
    });
  }
  if (derived) note(report, `${derived} precedents had no fee % but had construction cost and total fee — fee % computed (marked “derived”).`);
  const noBuilding = out.filter((p) => !p.building_type).length;
  if (noBuilding) note(report, `${noBuilding} precedents have no building type — kept, category blank.`);
  return { rows: out, report };
}

const STATUS: Record<string, string> = { intake: "draft", scope: "draft", fee: "draft", review: "in_review", approved: "approved" };

/** The old tool sometimes saved Claude's raw tool-call text into scope_text_polished
 *  ("…</polished_scope>\n<parameter name="phase_narrative">{…}"). Split it back apart. */
export function cleanPolishedScope(text: string | null): { scope: string | null; narrative: Record<string, string> | null; leaked: boolean } {
  if (!text) return { scope: null, narrative: null, leaked: false };
  const cut = text.search(/<\/polished_scope>|<parameter name=/);
  if (cut === -1) return { scope: text, narrative: null, leaked: false };
  const scope = text.slice(0, cut).trim();
  const m = text.match(/<parameter name="phase_narrative">\s*(\{[\s\S]*\})/);
  let narrative: Record<string, string> | null = null;
  if (m) { try { narrative = JSON.parse(m[1]); } catch { narrative = null; } }
  return { scope, narrative, leaked: true };
}

export interface LegacyQuote extends NewProposal { legacy_quote_id: string; created_at: string | null }

/** quotes.csv row → NewProposal. Uses the old tool's own math (computeSuggested) for any fee it
 *  never stored, and the old SD/DD/CD/BN/CA split it priced with. */
export function parseLegacyQuotes(rows: Record<string, string>[]): { rows: LegacyQuote[]; report: SectionReport } {
  const report = section();
  const out: LegacyQuote[] = [];
  for (const r of rows) {
    report.read++;
    const client = parseJsonish<Record<string, string>>(r.client) ?? {};
    const project = s(r.project_name);
    const hasContent = project || client.name || s(r.scope_text_raw) || n(r.construction_cost);
    if (!hasContent) { report.skipped++; continue; }
    const disciplinesObj = parseJsonish<Record<string, boolean>>(r.disciplines) ?? {};
    const fees = parseJsonish<Record<string, number | string>>(r.fees) ?? {};
    const carried = DISCIPLINES.filter((d) => disciplinesObj[d.key]);
    const pct = n(r.arch_target_pct) ?? 0.05;
    const cc = n(r.construction_cost);
    const suggested = computeSuggested({ construction_cost: cc, arch_target_pct: pct, disciplines: carried.map((d) => d.label) });
    const archTyped = fees.arch !== undefined && fees.arch !== "" ? Number(fees.arch) : null;
    const cleaned = cleanPolishedScope(s(r.scope_text_polished));
    const narrative = { ...(cleaned.narrative ?? {}), ...(parseJsonish<Record<string, string>>(r.phase_narrative) ?? {}) };
    const items: ProposalItemInput[] = [
      ...LEGACY_PHASES.map((p) => ({ kind: "phase" as const, label: p.label, pct: p.pct, included: true })),
      ...carried.map((d) => {
        const typed = fees[d.key] !== undefined && fees[d.key] !== "" ? Number(fees[d.key]) : null;
        return { kind: "consultant" as const, label: d.label, amount: typed ?? suggested[d.label] ?? null, included: true };
      }),
    ];
    const phaseNarrative: Record<string, string> = {};
    for (const p of LEGACY_PHASES) if (narrative[p.key]) phaseNarrative[p.label] = narrative[p.key];
    const title = project ?? client.name ?? "Untitled quote";
    if (cleaned.leaked) note(report, `“${title}”: the old tool had saved raw AI tool-call text inside the polished scope — cleaned up on import.`);
    if (!cc && archTyped === null) note(report, `“${title}”: no construction cost and no fee yet — imported as a draft with no fee.`);
    if (carried.some((d) => fees[d.key] === undefined)) note(report, `“${title}”: engineer fees not entered in the old tool — filled with its suggested amounts.`);
    out.push({
      legacy_quote_id: r.id, created_at: s(r.created_at), title,
      client: { name: client.name ?? "", contact_name: client.contact_name ?? "", contact_title: client.contact_title ?? "", email: client.email ?? "", phone: client.phone ?? "" },
      project_name: project, address: s(r.address), construction_cost: cc,
      fee_basis: archTyped !== null ? "fixed" : "pct_construction", arch_fee: archTyped, arch_target_pct: pct,
      scope_text_raw: s(r.scope_text_raw), scope_text: cleaned.scope, building_type: s(r.building_type), delivery_type: s(r.delivery_type),
      phase_narrative: phaseNarrative, precedents_used: parseJsonish(r.precedents_used) ?? undefined,
      status: r.approved === "true" ? "approved" : STATUS[r.status] ?? "draft", items, valid_until: null,
    });
  }
  if (report.skipped) note(report, `${report.skipped} empty “intake” drafts (no client, project, scope or cost) were left out.`);
  return { rows: out, report };
}

import type { Db } from "../db/types";
import { PHASES, CONSULTANT_DISCIPLINES } from "../calc/jobCost";
import { DISCIPLINE_MID_PCT } from "../calc/proposal";

/** Reusable proposal line items, seeded once. Jeff edits them under Proposals → Library. */
const LIBRARY: { kind: string; label: string; description?: string; pct?: number; amount?: number; unit?: string }[] = [
  ...PHASES.map((p) => ({
    kind: "phase", label: p.key, pct: p.feePct || undefined,
    description: ({
      "Pre Design": "Programming, site and code research, existing-conditions review, and owner goals workshop.",
      "Schematic Design": "Concept options, site plan, floor plans and massing to establish the design direction and budget check.",
      "Design Development": "Refined plans, elevations, sections, systems coordination with consultants and outline specifications.",
      "Construction Documents": "Permit and construction drawings and specifications coordinated across all disciplines.",
      "Bidding & Permitting": "Permit submittal and plan-review responses; bidding or negotiation support and addenda.",
      "Construction Administration": "Site visits, submittal and RFI review, pay-application review, punch list and closeout.",
      "Master Planning": "Campus or site master plan with phasing, program and conceptual cost framework.",
      "Feasability": "Feasibility study: zoning and code analysis, yield studies and order-of-magnitude budget.",
      "Interior Design": "Finishes, furniture and fixtures selection, interior elevations and specifications.",
    } as Record<string, string>)[p.key],
  })),
  ...CONSULTANT_DISCIPLINES.filter((d) => !d.startsWith("Other")).map((d) => ({ kind: "consultant", label: d, pct: DISCIPLINE_MID_PCT[d] })),
  { kind: "additional_service", label: "3D renderings", description: "Photo-realistic exterior/interior renderings for marketing or approvals." },
  { kind: "additional_service", label: "LEED / energy modeling", description: "Sustainability documentation and energy model." },
  { kind: "additional_service", label: "As-built survey of existing building", description: "Field measure and document existing conditions." },
  { kind: "additional_service", label: "Entitlement / planning commission support", description: "Applications, hearings and conditions of approval." },
  { kind: "reimbursable", label: "Printing, plotting and delivery" },
  { kind: "reimbursable", label: "Permit and plan-review fees (at cost)" },
  { kind: "exclusion", label: "Hazardous material surveys or abatement design" },
  { kind: "exclusion", label: "Geotechnical investigation unless listed above" },
  { kind: "exclusion", label: "Off-site improvements beyond the property line" },
];

export async function seedDefaults(db: Db) {
  const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from line_item_templates`);
  if (n === 0) {
    let sort = 0;
    for (const it of LIBRARY) {
      await db.query(
        `insert into line_item_templates (kind, label, description, default_pct, default_amount, unit, sort) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (kind, label) do nothing`,
        [it.kind, it.label, it.description ?? null, it.pct ?? null, it.amount ?? null, it.unit ?? null, sort++],
      );
    }
  }
}

/** Parsers for "Tracking Sales Sheet" (pure: Grid in, records + report out). */
import { type Grid, cell, str, numOrNull, dateOrNull, col } from "./workbook";
import { PIPELINE_STATUSES, PROJECT_TYPES, stageBucket } from "../calc/sales";
import { normalizeJobNumber } from "../calc/jobNumber";
import { section, note, type SectionReport } from "./report";

export interface PipelineRecord {
  source_key: string; row: number; job_number: string | null; name: string; status: string;
  contact_text: string | null; best_contact_method: string | null; project_type: string | null; project_detail: string | null;
  date_received: string | null; construction_start: string | null; date_presented: string | null;
  follow_up_1_date: string | null; follow_up_1_by: string | null; follow_up_1_result: string | null;
  follow_up_2_date: string | null; follow_up_2_by: string | null; follow_up_2_result: string | null;
  subs_cost: number | null; design_fee: number | null; total_bid_override: number | null; projected_arch_hours: number | null;
}

const C = { J: col("J"), K: col("K"), L: col("L"), M: col("M"), N: col("N"), O: col("O"), P: col("P"), Q: col("Q"), R: col("R"), S: col("S"), T: col("T"), U: col("U"), V: col("V"), W: col("W"), X: col("X"), Y: col("Y"), Z: col("Z"), AA: col("AA"), AB: col("AB"), AC: col("AC") };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Data rows start at 7 (the macro's FIRST_DATA_ROW); rows 1–6 hold the totals block. */
export function parsePipeline(g: Grid): { rows: PipelineRecord[]; report: SectionReport; sheetTotals: Record<string, number | null> } {
  const report = section();
  const rows: PipelineRecord[] = [];
  const seen = new Map<string, number>();
  const yearTypos: number[] = [];
  for (let r = 7; r <= g.length; r++) {
    const name = str(cell(g, r, C.L));
    if (!name) continue;
    report.read++;
    let status = str(cell(g, r, C.M)) ?? "";
    if (status === "Follow Up Completed") status = "Follow Up 1 Completed";
    if (!PIPELINE_STATUSES.includes(status as never)) {
      note(report, `Row ${r} “${name}”: status “${status || "(blank)"}” isn't one of the sheet's statuses — imported as Proposal Needed.`);
      status = "Proposal Needed";
    }
    const rawJob = str(cell(g, r, C.J));
    const job = normalizeJobNumber(rawJob);
    if (rawJob && !job) note(report, `Row ${r} “${name}”: job # “${rawJob}” isn't in NN-NN form — kept blank.`);
    let type = str(cell(g, r, C.P));
    if (type && !PROJECT_TYPES.includes(type as never)) {
      const fixed = PROJECT_TYPES.find((t) => t.toLowerCase() === type!.toLowerCase());
      if (fixed) type = fixed;
      else note(report, `Row ${r} “${name}”: project type “${type}” isn't on the dropdown — kept as typed.`);
    }
    const subs = numOrNull(cell(g, r, C.Z));
    const design = numOrNull(cell(g, r, C.AA));
    const abRaw = cell(g, r, C.AB);
    const ab = numOrNull(abRaw);
    if (abRaw !== null && ab === null && str(abRaw)) note(report, `Row ${r} “${name}”: Total Bid is “${str(abRaw)}”, not a number — counted as Subs + Design Fee (${(numOrNull(cell(g, r, C.Z)) ?? 0) + (numOrNull(cell(g, r, C.AA)) ?? 0)}).`);
    const computed = (subs ?? 0) + (design ?? 0);
    const override = ab !== null && Math.abs(ab - computed) > 0.005 ? ab : null;
    const fu1 = cell(g, r, C.T), fu2 = cell(g, r, C.W);
    for (const [label, v] of [["First Follow Up Date", fu1], ["Second Follow Up Date", fu2], ["Date Presented", cell(g, r, C.S)]] as const)
      if (v !== null && !dateOrNull(v)) note(report, `Row ${r} “${name}”: ${label} “${v}” isn't a date — skipped.`);
    // The sheet's bucket columns (AD..AJ) are filled by a macro; when it didn't run, the sheet's totals miss the row.
    const bucketCol = ({ inquiry: "AD", triaged: "AE", qualify: "AF", presented: "AG", rejected: "AI", sold: "AJ" } as Record<string, string>)[stageBucket(status) ?? ""];
    const bid = override ?? computed;
    if (bucketCol && bid > 0 && numOrNull(cell(g, r, col(bucketCol))) === null)
      note(report, `Row ${r} “${name}” (${status}, ${bid.toLocaleString("en-US")}) has Subs/Design Fee filled in but an empty ${abRaw === null ? "Total Bid and " : ""}${bucketCol} cell — the sheet's formula/macro never ran for it, so the sheet's totals leave it out; the app includes it.`);
    const t1 = dateOrNull(fu1), t2 = dateOrNull(fu2);
    if (t1 && t2 && t2 < t1) yearTypos.push(r);
    const date = dateOrNull(cell(g, r, C.K));
    let key = `sales:pipeline:${job ?? ""}:${slug(name)}:${date ?? ""}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) { key += `:${n}`; note(report, `Row ${r} “${name}” appears ${n} times with the same job # and date — kept each.`); }
    rows.push({
      source_key: key, row: r, job_number: job, name, status,
      contact_text: str(cell(g, r, C.N)), best_contact_method: str(cell(g, r, C.O)), project_type: type, project_detail: str(cell(g, r, C.Q)),
      date_received: date, construction_start: dateOrNull(cell(g, r, C.R)), date_presented: dateOrNull(cell(g, r, C.S)),
      follow_up_1_date: t1, follow_up_1_by: str(cell(g, r, C.U)), follow_up_1_result: str(cell(g, r, C.V)),
      follow_up_2_date: t2, follow_up_2_by: str(cell(g, r, C.X)), follow_up_2_result: str(cell(g, r, C.Y)),
      subs_cost: subs, design_fee: design, total_bid_override: override, projected_arch_hours: numOrNull(cell(g, r, C.AC)),
    });
  }
  if (yearTypos.length) note(report, `${yearTypos.length} rows have a Second Follow Up Date earlier than the First (e.g. 1/21/2025 after 10/17/2025 — looks like the year wasn't rolled to 2026). Imported as written; rows ${yearTypos.join(", ")}.`);
  // The sheet's own cached totals, for cross-checking the app's math after import.
  const sheetTotals = {
    totalBidAll: numOrNull(cell(g, 1, C.AB)),
    weightedTotal: numOrNull(cell(g, 6, col("AH"))),
    presentedSum: numOrNull(cell(g, 5, col("AG"))),
    rejectedTotal: numOrNull(cell(g, 6, col("AI"))),
    soldTotal: numOrNull(cell(g, 6, col("AJ"))),
  };
  return { rows, report, sheetTotals };
}

export interface LeadRecord { day: string; connection_requests: number; responses: number; conversations: number; opportunities: number; proposals: number; yes: number; no: number }

/** Lead Measures: row 3 headers, row 4 totals, daily rows from 5. Columns B,D,F,H,J,L,M are counts. */
export function parseLeadMeasures(g: Grid): { rows: LeadRecord[]; report: SectionReport } {
  const report = section();
  const rows: LeadRecord[] = [];
  let blankDays = 0;
  for (let r = 5; r <= g.length; r++) {
    const day = dateOrNull(cell(g, r, 1));
    if (!day) continue;
    const vals = [2, 4, 6, 8, 10, 12, 13].map((c) => numOrNull(cell(g, r, c)));
    if (vals.every((v) => v === null)) { blankDays++; continue; }
    report.read++;
    const [connection_requests, responses, conversations, opportunities, proposals, yes, no] = vals.map((v) => v ?? 0);
    rows.push({ day, connection_requests, responses, conversations, opportunities, proposals, yes, no });
  }
  if (blankDays) note(report, `${blankDays} pre-filled dates with no numbers were left out.`);
  return { rows, report };
}

export interface LagRecord { source_key: string; day: string | null; project_number: string | null; opportunity: string; status: string; notes: string | null }
export function parseLagMeasures(g: Grid): { rows: LagRecord[]; report: SectionReport } {
  const report = section();
  const rows: LagRecord[] = [];
  let lastDay: string | null = null;
  for (let r = 6; r <= g.length; r++) {
    const opp = str(cell(g, r, 3));
    if (!opp) continue;
    report.read++;
    const day = dateOrNull(cell(g, r, 1));
    if (day) lastDay = day;
    const status = str(cell(g, r, 4)) ?? "Opportunity";
    if (!["Opportunity", "Investigation", "Pitching", "Won", "Lost"].includes(status)) { note(report, `Row ${r}: status “${status}” unknown — skipped.`); report.skipped++; continue; }
    if (!day) note(report, `Row ${r} “${opp}”: no date — left blank (the sheet only dated the first row of the group${lastDay ? `, ${lastDay}` : ""}).`);
    rows.push({ source_key: `sales:lag:${r}:${slug(opp)}`, day, project_number: str(cell(g, r, 2)), opportunity: opp, status, notes: str(cell(g, r, 5)) });
  }
  return { rows, report };
}

export interface PersonRecord {
  source_key: string; email: string | null; first_name: string | null; last_name: string | null; address: string | null; phone: string | null;
  birthday: string | null; company: string | null; title: string | null;
}
export interface PastClientRecord extends PersonRecord { date_added: string | null; followUps: { cadence: string; date: string | null; text: string | null }[] }
export interface ProspectRecord extends PersonRecord { met_on: string | null; linkedin: string | null; card_sent: string | null; email_due: string | null; email_sent: string | null; notes: string | null }

function person(g: Grid, r: number, sheet: string): PersonRecord {
  const email = str(cell(g, r, 1))?.toLowerCase() ?? null;
  const first = str(cell(g, r, 2)), last = str(cell(g, r, 3));
  return {
    source_key: `sales:${sheet}:${email ?? slug(`${first ?? ""}-${last ?? ""}-${str(cell(g, r, 7)) ?? ""}`)}`,
    email, first_name: first, last_name: last, address: str(cell(g, r, 4)), phone: str(cell(g, r, 5)),
    birthday: dateOrNull(cell(g, r, 6)), company: str(cell(g, r, 7)), title: str(cell(g, r, 8)),
  };
}

/** Past Clients: header row 2, data from row 3. J/K/L hold either a date or a note of what was done. */
export function parsePastClients(g: Grid): { rows: PastClientRecord[]; report: SectionReport } {
  const report = section();
  const rows: PastClientRecord[] = [];
  for (let r = 3; r <= g.length; r++) {
    const p = person(g, r, "past-client");
    if (!p.email && !p.first_name && !p.last_name) continue;
    report.read++;
    const date_added = dateOrNull(cell(g, r, 9));
    const followUps = ([["past_client_1m", 10], ["past_client_2m", 11], ["past_client_6m", 12]] as const).map(([cadence, c]) => {
      const v = cell(g, r, c);
      return { cadence, date: dateOrNull(v), text: dateOrNull(v) ? null : str(v) };
    });
    if (!date_added) note(report, `${[p.first_name, p.last_name].filter(Boolean).join(" ")}${p.company ? ` (${p.company})` : ""}: no “Date Added to List” — the 1/2/6-month cadence starts from the import date instead.`);
    rows.push({ ...p, date_added, followUps });
  }
  return { rows, report };
}

/** Prospects Met: header row 1, data from row 2. */
export function parseProspects(g: Grid): { rows: ProspectRecord[]; report: SectionReport } {
  const report = section();
  const rows: ProspectRecord[] = [];
  for (let r = 2; r <= g.length; r++) {
    const p = person(g, r, "prospect");
    if (!p.email && !p.first_name && !p.last_name) continue;
    report.read++;
    rows.push({ ...p, met_on: dateOrNull(cell(g, r, 9)), linkedin: str(cell(g, r, 10)), card_sent: str(cell(g, r, 11)),
      email_due: dateOrNull(cell(g, r, 12)), email_sent: str(cell(g, r, 13)), notes: str(cell(g, r, 14)) });
  }
  return { rows, report };
}

export interface OutreachRecord { source_key: string; kind: "cre_firm" | "bagels" | "direct_sales" | "biz_dev"; label: string; day: string | null; period: string | null; status: string | null; phone: string | null; address: string | null; notes: string | null; author: string | null; contact?: string | null; email?: string | null }

export function parseBizDevNotes(g: Grid, author: string): { rows: OutreachRecord[]; report: SectionReport } {
  const report = section();
  const rows: OutreachRecord[] = [];
  let period: string | null = null;
  for (let r = 1; r <= g.length; r++) {
    const t = str(cell(g, r, 1));
    if (!t) continue;
    const m = t.match(/^([A-Z][a-z]+ \d{4}) Biz Dev Notes$/i);
    if (m) { period = m[1]; continue; }
    report.read++;
    rows.push({ source_key: `sales:bizdev:${slug(author)}:${slug(period ?? "")}:${slug(t).slice(0, 80)}`, kind: "biz_dev", label: t.slice(0, 120), day: null, period, status: null, phone: null, address: null, notes: t, author });
  }
  return { rows, report };
}

export function parseBagels(g: Grid): { rows: OutreachRecord[]; report: SectionReport } {
  const report = section();
  const rows: OutreachRecord[] = [];
  for (let r = 2; r <= g.length; r++) {
    const label = str(cell(g, r, 1));
    if (!label) continue;
    report.read++;
    const raw = cell(g, r, 2);
    const day = dateOrNull(raw);
    const notes = [str(cell(g, r, 3)), raw !== null && !day ? `Date: ${raw}` : null].filter(Boolean).join(" · ") || null;
    rows.push({ source_key: `sales:bagels:${slug(label)}:${day ?? r}`, kind: "bagels", label, day, period: null, status: str(cell(g, r, 3)), phone: null, address: null, notes, author: null });
  }
  return { rows, report };
}

export function parseCreFirms(g: Grid): { rows: OutreachRecord[]; report: SectionReport } {
  const report = section();
  const rows: OutreachRecord[] = [];
  for (let r = 2; r <= g.length; r++) {
    const label = str(cell(g, r, 1));
    if (!label) continue;
    report.read++;
    const booked = cell(g, r, 4);
    rows.push({ source_key: `sales:cre:${slug(label)}`, kind: "cre_firm", label, day: dateOrNull(booked), period: null,
      status: dateOrNull(booked) ? "Booked" : str(booked), phone: str(cell(g, r, 2)), address: str(cell(g, r, 3)), notes: str(booked), author: null });
  }
  return { rows, report };
}

export function parseDirectSales(g: Grid): { rows: OutreachRecord[]; report: SectionReport } {
  const report = section();
  const rows: OutreachRecord[] = [];
  for (let r = 2; r <= g.length; r++) {
    const company = str(cell(g, r, 3)), name = str(cell(g, r, 4)), address = str(cell(g, r, 1));
    if (!company && !name && !address) continue;
    report.read++;
    rows.push({ source_key: `sales:direct:${slug(`${company ?? ""}-${name ?? ""}-${address ?? ""}`)}`, kind: "direct_sales", label: company ?? name ?? address!, day: dateOrNull(cell(g, r, 2)),
      period: null, status: null, phone: str(cell(g, r, 5)), address, notes: str(cell(g, r, 7)), author: null, contact: name, email: str(cell(g, r, 6)) });
  }
  return { rows, report };
}

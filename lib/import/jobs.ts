/** Parsers for the "Job List" workbook: the Job List dashboard sheet plus one job-cost sheet per job. */
import { type Grid, cell, str, numOrNull, dateOrNull } from "./workbook";
import { PHASES, CONSULTANT_DISCIPLINES, UNPHASED } from "../calc/jobCost";
import { normalizeJobNumber } from "../calc/jobNumber";
import { section, note, type SectionReport } from "./report";

/** Each phase block starts at L, Q, V, AA, AF, AK, AP, AU, AZ (macro GetAllPhasesInfo). */
export const PHASE_START_COLS = [12, 17, 22, 27, 32, 37, 42, 47, 52];

export interface JobListRow {
  job_number: string; name: string | null; lead: string | null; team: string | null; contract_date: string | null; phase: string | null;
  target_date: string | null; hours_assigned: number | null; hours_worked: number | null; hours_remaining: number | null;
  consultant_status: string | null; notes: string | null; additional_notes: string | null;
}

export function parseJobList(g: Grid): { rows: JobListRow[]; report: SectionReport } {
  const report = section();
  const rows: JobListRow[] = [];
  for (let r = 3; r <= g.length; r++) {
    const raw = str(cell(g, r, 1));
    if (!raw) continue;
    report.read++;
    const job = normalizeJobNumber(raw);
    if (!job) { note(report, `Job List row ${r}: “${raw}” isn't a job number — skipped.`); report.skipped++; continue; }
    rows.push({
      job_number: job, name: str(cell(g, r, 2)), lead: str(cell(g, r, 3)), team: str(cell(g, r, 4)), contract_date: dateOrNull(cell(g, r, 5)),
      phase: str(cell(g, r, 6)), target_date: dateOrNull(cell(g, r, 7)), hours_assigned: numOrNull(cell(g, r, 8)), hours_worked: numOrNull(cell(g, r, 9)),
      hours_remaining: numOrNull(cell(g, r, 10)), consultant_status: str(cell(g, r, 11)), notes: str(cell(g, r, 12)), additional_notes: str(cell(g, r, 13)),
    });
  }
  return { rows, report };
}

export interface JobSheet {
  sheet: string; job_number: string; name: string | null; lead: string | null; team: string | null; contract_date: string | null;
  client: string | null; client_contact: string | null; client_contact_2: string | null; contractor: string | null; contractor_contact: string | null;
  arch_fee: number | null; profit_pct: number | null; burden_rate: number | null;
  phases: { phase: string; sort: number; fee_pct: number | null; hours_pct: number | null; hours_assigned: number | null; target_date: string | null }[];
  consultants: { discipline: string; firm: string | null; phase: string; fee: number; status: string | null }[];
  entries: { phase: string; row: number; week_label: string | null; week_ending: string | null; person: string | null; hours: number; notes: string | null }[];
}

/** "Structural - Acme" → discipline Structural, firm Acme; "Other 1 - Sample Co" → Other 1 / Sample Co. */
export function splitConsultant(label: string): { discipline: string; firm: string | null } {
  const [head, ...rest] = label.split(/\s+[-–]\s*|\s*[-–]\s+/);
  const d = CONSULTANT_DISCIPLINES.find((x) => x.toLowerCase() === head.trim().toLowerCase()) ?? head.trim();
  return { discipline: d, firm: rest.join(" - ").trim() || null };
}

/** "Thru 1/5/26" → 2026-01-05 (week ending). */
export function weekEnding(label: string | null): string | null {
  const m = (label ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mm = Number(m[1]), dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function parseJobSheet(sheet: string, g: Grid, report: SectionReport): JobSheet | null {
  const job = normalizeJobNumber(str(cell(g, 2, 13)) ?? sheet);
  if (!job) { note(report, `Sheet “${sheet}”: no job number in M2 — skipped.`); report.skipped++; return null; }
  if (normalizeJobNumber(sheet) && normalizeJobNumber(sheet) !== job) note(report, `Sheet “${sheet}” says job ${job} in M2 — used M2.`);
  const phases: JobSheet["phases"] = [];
  const consultants: JobSheet["consultants"] = [];
  const entries: JobSheet["entries"] = [];
  PHASES.forEach((p, i) => {
    const sc = PHASE_START_COLS[i];
    const hoursRaw = cell(g, 10, sc + 1);
    const hours = numOrNull(hoursRaw);
    if (hoursRaw !== null && hours === null && str(hoursRaw)) note(report, `${job} ${p.key}: Hours Assigned is “${str(hoursRaw)}”, not a number — left blank.`);
    phases.push({ phase: p.key, sort: i, fee_pct: numOrNull(cell(g, 12, 3 + i)), hours_pct: numOrNull(cell(g, 7, sc)), hours_assigned: hours, target_date: dateOrNull(cell(g, 10, sc + 4)) });
    // consultant fees for this phase (C13:K26) and status (status col = start+1, rows 13–26)
    for (let r = 13; r <= 26; r++) {
      const label = str(cell(g, r, 1));
      if (!label) continue;
      const fee = numOrNull(cell(g, r, 3 + i));
      const status = str(cell(g, r, sc + 1));
      if ((fee && fee > 0) || (status && status !== "Consultant Status")) {
        const { discipline, firm } = splitConsultant(label);
        consultants.push({ discipline, firm, phase: p.key, fee: fee ?? 0, status: status && ["On Task", "Off Task", "Complete"].includes(status) ? status : null });
      }
    }
    // weekly log rows 31+
    for (let r = 31; r <= g.length; r++) {
      const hrsCell = cell(g, r, sc + 2);
      const hrs = numOrNull(hrsCell);
      const person = str(cell(g, r, sc + 1));
      const notes = str(cell(g, r, sc + 3));
      const label = str(cell(g, r, sc));
      if (hrsCell !== null && hrs === null && str(hrsCell)) note(report, `${job} ${p.key} row ${r}: hours “${str(hrsCell)}” isn't a number — skipped.`);
      if ((hrs === null || hrs === 0) && !(person && notes)) continue;
      entries.push({ phase: p.key, row: r, week_label: label, week_ending: weekEnding(label), person, hours: hrs ?? 0, notes });
    }
  });
  // consultant total typed in column B only (not split by phase)
  for (let r = 13; r <= 26; r++) {
    const label = str(cell(g, r, 1));
    const total = numOrNull(cell(g, r, 2));
    if (!label || !total) continue;
    const { discipline, firm } = splitConsultant(label);
    const phased = consultants.filter((c) => c.discipline === discipline).reduce((s, c) => s + c.fee, 0);
    if (phased === 0) consultants.push({ discipline, firm, phase: UNPHASED, fee: total, status: null });
    else if (Math.abs(phased - total) > 0.5) note(report, `${job} ${discipline}: total fee ${total} ≠ sum by phase ${phased} — kept the by-phase figures.`);
  }
  const archRaw = cell(g, 10, 2);
  return {
    sheet, job_number: job, name: str(cell(g, 4, 13)), lead: str(cell(g, 2, 10)), team: str(cell(g, 3, 10)), contract_date: dateOrNull(cell(g, 2, 19)),
    client: str(cell(g, 2, 16)), client_contact: str(cell(g, 4, 16)), client_contact_2: str(cell(g, 4, 19)), contractor: str(cell(g, 2, 22)), contractor_contact: str(cell(g, 4, 22)),
    arch_fee: numOrNull(archRaw), profit_pct: numOrNull(cell(g, 30, 5)), burden_rate: numOrNull(cell(g, 33, 5)),
    phases, consultants, entries,
  };
}

export function parseJobWorkbook(book: Record<string, Grid>) {
  const listReport = section();
  const sheetReport = section();
  const list = book["Job List"] ? parseJobList(book["Job List"]) : { rows: [], report: listReport };
  const sheets: JobSheet[] = [];
  for (const [name, g] of Object.entries(book)) {
    if (name === "Job List" || name.startsWith("Job Cost Template")) continue;
    sheetReport.read++;
    const s = parseJobSheet(name.trim(), g, sheetReport);
    if (s) sheets.push(s);
  }
  const inList = new Set(list.rows.map((r) => r.job_number));
  const inSheets = new Set(sheets.map((s) => s.job_number));
  for (const j of inList) if (!inSheets.has(j)) note(sheetReport, `${j} is on the Job List but has no job-cost sheet.`);
  for (const j of inSheets) if (!inList.has(j)) note(sheetReport, `${j} has a job-cost sheet but isn't on the Job List.`);
  return { list: list.rows, listReport: list.report, sheets, sheetReport };
}

/**
 * Import Frame's real data from a local, git-ignored folder (default ./data):
 *   data/sales.xlsm          Tracking Sales Sheet
 *   data/jobs.xlsm           Job List
 *   data/quotes.csv          old quoting tool: quotes table export
 *   data/archive_index.csv   old quoting tool: archive_index export
 * Re-running is safe: records are matched on stable keys and updated in place.
 * Usage: npm run import -- [--dir data] [--only sales,jobs,quotes,archive]
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../lib/db";
import { readWorkbook } from "../lib/import/workbook";
import * as S from "../lib/import/sales";
import { parseJobWorkbook } from "../lib/import/jobs";
import { parseCsv } from "../lib/import/csv";
import { parseArchive, parseLegacyQuotes } from "../lib/import/legacy";
import * as L from "../lib/import/load";
import { section, type ImportReport } from "../lib/import/report";
import { pipelineSummary } from "../lib/calc/sales";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(opt("dir", "data"));
const only = new Set(opt("only", "sales,jobs,quotes,archive").split(","));
const file = (n: string) => { const p = path.join(dir, n); return fs.existsSync(p) ? p : null; };

async function main() {
  const db = await openDb();
  const report: ImportReport = {};
  const t0 = Date.now();

  const salesPath = file("sales.xlsm") ?? file("sales.xlsx");
  if (only.has("sales") && salesPath) {
    console.log(`Reading ${path.basename(salesPath)} …`);
    const wb = await readWorkbook(salesPath, 52);
    const pipe = S.parsePipeline(wb["Pipeline Tracking"] ?? []);
    const lead = S.parseLeadMeasures(wb["Lead Measures"] ?? []);
    const lag = S.parseLagMeasures(wb["Lag Measures"] ?? []);
    const past = S.parsePastClients(wb["Past Clients"] ?? []);
    const pros = S.parseProspects(wb["Prospects Met"] ?? []);
    const becky = S.parseBizDevNotes(wb["Becky"] ?? [], "Becky");
    const bagels = S.parseBagels(wb[Object.keys(wb).find((k) => k.trim() === "Bagels Delivered") ?? ""] ?? []);
    const cre = S.parseCreFirms(wb["CRE Firms"] ?? []);
    const direct = S.parseDirectSales(wb[Object.keys(wb).find((k) => k.trim() === "Direct Sales") ?? ""] ?? []);
    await db.tx(async (t) => {
      await L.loadPipeline(t, pipe.rows, pipe.report);
      await L.loadLeadMeasures(t, lead.rows, lead.report);
      await L.loadLag(t, lag.rows, lag.report);
      await L.loadPastClients(t, past.rows, past.report);
      await L.loadProspects(t, pros.rows, pros.report);
      await L.loadOutreach(t, becky.rows, becky.report);
      await L.loadOutreach(t, bagels.rows, bagels.report);
      await L.loadOutreach(t, cre.rows, cre.report);
      await L.loadOutreach(t, direct.rows, direct.report);
    });
    // Cross-check: the app's pipeline math against the sheet's own cached totals.
    const s = pipelineSummary(pipe.rows);
    const chk = (label: string, app: number, sheet: number | null) =>
      pipe.report.notes.push(`Check ${label}: app ${app.toFixed(2)} vs sheet ${sheet === null ? "(no cached value)" : sheet.toFixed(2)}${sheet !== null && Math.abs(app - sheet) > 0.01 ? " ← differs: see the rows noted above (empty bucket cells, text in Total Bid, and SUM ranges that start at row 9)" : " ✓"}`);
    chk("Total Bid (AB1)", s.totalBidAll, pipe.sheetTotals.totalBidAll);
    chk("Presented bucket sum (AG5)", s.stages[3].sum, pipe.sheetTotals.presentedSum);
    chk("Weighted pipeline (AH6)", s.weightedTotal, pipe.sheetTotals.weightedTotal);
    chk("Rejected (AI6)", s.rejectedTotal, pipe.sheetTotals.rejectedTotal);
    chk("Sold (AJ6)", s.soldTotal, pipe.sheetTotals.soldTotal);
    Object.assign(report, { pipeline: pipe.report, leadMeasures: lead.report, lagMeasures: lag.report, pastClients: past.report, prospectsMet: pros.report,
      bizDevNotes: becky.report, bagels: bagels.report, creFirms: cre.report, directSales: direct.report });
  } else if (only.has("sales")) console.log("No data/sales.xlsm — sales skipped.");

  const jobsPath = file("jobs.xlsm") ?? file("jobs.xlsx");
  if (only.has("jobs") && jobsPath) {
    console.log(`Reading ${path.basename(jobsPath)} (large; ~1 min) …`);
    const wb = await readWorkbook(jobsPath, 60);
    const parsed = parseJobWorkbook(wb);
    const projects = section();
    projects.read = new Set([...parsed.list.map((l) => l.job_number), ...parsed.sheets.map((s) => s.job_number)]).size;
    const links = section();
    await db.tx(async (t) => {
      await L.loadJobs(t, parsed.list, parsed.sheets, projects);
      await L.linkPipelineToProjects(t, links);
    });
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int n from time_entries where source_key like 'xlsx:%'`);
    projects.notes.push(`${n} weekly hour entries loaded from the job sheets.`);
    Object.assign(report, { jobList: parsed.listReport, jobSheets: parsed.sheetReport, projects, pipelineLinks: links });
  } else if (only.has("jobs")) console.log("No data/jobs.xlsm — jobs skipped.");

  const archivePath = file("archive_index.csv");
  if (only.has("archive") && archivePath) {
    const a = parseArchive(parseCsv(fs.readFileSync(archivePath, "utf8")));
    await db.tx((t) => L.loadPrecedents(t, a.rows, a.report));
    report.precedents = a.report;
  }
  const quotesPath = file("quotes.csv");
  if (only.has("quotes") && quotesPath) {
    const q = parseLegacyQuotes(parseCsv(fs.readFileSync(quotesPath, "utf8")));
    await db.tx((t) => L.loadLegacyQuotes(t, q.rows, q.report));
    report.legacyQuotes = q.report;
  }

  await db.query(`insert into import_runs (source, report) values ($1, $2)`, [dir, JSON.stringify(report)]);
  const reportPath = path.join(dir, "import-report.json");
  const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : {};
  fs.writeFileSync(reportPath, JSON.stringify({ ...previous, ...report, _lastRun: new Date().toISOString() }, null, 2));
  console.log(`\nImport finished in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  for (const [k, v] of Object.entries(report)) {
    console.log(`${k.padEnd(14)} read ${String(v.read).padStart(4)}  new ${String(v.imported).padStart(4)}  updated ${String(v.updated).padStart(4)}  skipped ${String(v.skipped).padStart(3)}`);
    for (const n of v.notes) console.log(`   · ${n}`);
  }
  console.log(`\nFull report: ${path.join(dir, "import-report.json")}`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

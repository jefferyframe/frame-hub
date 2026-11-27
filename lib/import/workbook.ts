/** Workbook → plain 2-D arrays (cached formula results, dates as 'YYYY-MM-DD'), so the
 *  parsers are pure functions over arrays and can be unit-tested without Excel files. */
export type Cell = string | number | boolean | null;
export type Grid = Cell[][]; // grid[row-1][col-1], 1-based like Excel

export const cell = (g: Grid, row: number, col: number): Cell => g[row - 1]?.[col - 1] ?? null;
export const str = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
export const numOrNull = (v: Cell): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.replace(/[$,\s]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
export const isDate = (v: Cell): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const dateOrNull = (v: Cell): string | null => (isDate(v) ? v : null);

/** Column letters → number (A=1, AA=27). */
export const col = (letters: string) => letters.toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export async function readWorkbook(path: string, maxCol = 60): Promise<Record<string, Grid>> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: Record<string, Grid> = {};
  for (const ws of wb.worksheets) {
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const line: Cell[] = [];
      for (let c = 1; c <= Math.min(maxCol, ws.columnCount); c++) line.push(toCell(row.getCell(c).value));
      grid[r - 1] = line;
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    out[ws.name] = grid;
  }
  return out;
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10); // Excel dates are zone-less; exceljs gives UTC midnight
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if ("result" in o) return o.result === undefined ? null : toCell(o.result as never);
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text; // hyperlink
    if (o.error) return null;
    return null;
  }
  return v as Cell;
}

/** Frame job numbers: "YY-N" with at least two digits (26-02, 26-117); sub-jobs add ".N" (24-17.3). */
export interface JobNo { year: number; seq: number; sub: number | null }

export function parseJobNumber(raw: string | null | undefined): JobNo | null {
  const m = (raw ?? "").trim().match(/^(\d{2})-(\d{1,4})(?:\.(\d+))?$/);
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]), sub: m[3] ? Number(m[3]) : null };
}

export const formatJobNumber = (j: JobNo) =>
  `${String(j.year).padStart(2, "0")}-${String(j.seq).padStart(2, "0")}${j.sub !== null ? "." + j.sub : ""}`;

export const normalizeJobNumber = (raw: string | null | undefined): string | null => {
  const j = parseJobNumber(raw);
  return j ? formatJobNumber(j) : null;
};

/** Next number for the year of `onDate`: highest sequence already used that year (projects
 *  *and* pipeline rows, since the sales sheet hands out job numbers too) + 1. */
export function nextJobNumber(existing: (string | null | undefined)[], onDate: string): string {
  const year = Number(onDate.slice(2, 4));
  let max = 0;
  for (const e of existing) {
    const j = parseJobNumber(e);
    if (j && j.year === year) max = Math.max(max, j.seq);
  }
  return formatJobNumber({ year, seq: max + 1, sub: null });
}

/** Next sub-job under a parent (24-17 → 24-17.6 when .1–.5 exist). */
export function nextSubJobNumber(existing: (string | null | undefined)[], parent: string): string {
  const p = parseJobNumber(parent);
  if (!p) throw new Error(`Not a job number: ${parent}`);
  let max = 0;
  for (const e of existing) {
    const j = parseJobNumber(e);
    if (j && j.year === p.year && j.seq === p.seq && j.sub !== null) max = Math.max(max, j.sub);
  }
  return formatJobNumber({ year: p.year, seq: p.seq, sub: max + 1 });
}

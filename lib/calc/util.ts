/** Shared numeric/date helpers for the calculation modules (pure, no I/O). */
export const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const sum = (xs: Iterable<unknown>): number => {
  let s = 0;
  for (const x of xs) s += num(x);
  return s;
};
/** Excel IFERROR(a/b,""): null instead of a division error. */
export const ratio = (a: number, b: number): number | null => (b ? a / b : null);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 'YYYY-MM-DD' → whole days since epoch (UTC), so date math has no timezone drift. */
export const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};
export const addDays = (iso: string, days: number): string =>
  new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);
export const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};
export const todayISO = (tz = "America/Los_Angeles"): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const money = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const compactMoney = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return money(n);
};
export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);
export const hrs = (n: number | null | undefined) => (n === null || n === undefined ? "—" : (Math.round(n * 100) / 100).toLocaleString("en-US"));
export function date(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return "—";
  const x = typeof d === "string" && d.length === 10 ? new Date(d + "T12:00:00Z") : new Date(d);
  return x.toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}
export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

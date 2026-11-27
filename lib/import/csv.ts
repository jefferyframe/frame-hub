/** RFC 4180 CSV → array of objects keyed by the header row (quoted fields, "" escapes, newlines in quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** JSON column exported as text; also accepts Postgres array literals like {a,"b c"}. */
export function parseJsonish<T = unknown>(v: string | null | undefined): T | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  try { return JSON.parse(t) as T; } catch { /* fall through */ }
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1);
    if (!inner) return [] as unknown as T;
    return inner.match(/("([^"\\]|\\.)*"|[^,]+)/g)!.map((x) => x.replace(/^"|"$/g, "").replace(/\\"/g, '"')) as unknown as T;
  }
  return null;
}

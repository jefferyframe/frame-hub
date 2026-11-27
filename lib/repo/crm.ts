import type { Db } from "../db/types";
import { one } from "../db/types";
import type { Company, Contact } from "./types";

/** Find a company by name (case-insensitive) or create it. */
export async function ensureCompany(db: Db, name: string, kind = "client", extra: Partial<Company> & { source_key?: string } = {}): Promise<Company> {
  const clean = name.trim();
  const found = await one<Company>(db, `select * from companies where lower(name) = lower($1) limit 1`, [clean]);
  if (found) return found;
  const [c] = await db.query<Company>(
    `insert into companies (name, kind, phone, address, notes, source_key) values ($1,$2,$3,$4,$5,$6)
     on conflict (source_key) do update set name = excluded.name returning *`,
    [clean, kind, extra.phone ?? null, extra.address ?? null, extra.notes ?? null, extra.source_key ?? null],
  );
  return c;
}

export async function ensureContact(db: Db, c: { first_name?: string | null; last_name?: string | null; email?: string | null; company_id?: string | null; title?: string | null; phone?: string | null }): Promise<Contact> {
  if (c.email) {
    const found = await one<Contact>(db, `select * from contacts where lower(email) = lower($1) limit 1`, [c.email]);
    if (found) return found;
  } else if (c.first_name || c.last_name) {
    const found = await one<Contact>(db,
      `select * from contacts where lower(coalesce(first_name,'')) = lower($1) and lower(coalesce(last_name,'')) = lower($2) and company_id is not distinct from $3 limit 1`,
      [c.first_name ?? "", c.last_name ?? "", c.company_id ?? null]);
    if (found) return found;
  }
  const [row] = await db.query<Contact>(
    `insert into contacts (first_name, last_name, email, company_id, title, phone) values ($1,$2,$3,$4,$5,$6) returning *`,
    [c.first_name ?? null, c.last_name ?? null, c.email ?? null, c.company_id ?? null, c.title ?? null, c.phone ?? null],
  );
  return row;
}

export function splitName(full: string | null | undefined): { first_name: string | null; last_name: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") || null };
}

export async function addTask(db: Db, t: { title: string; due_on?: string | null; cadence?: string | null; contact_id?: string | null; opportunity_id?: string | null; project_id?: string | null; assignee?: string | null; notes?: string | null; source_key?: string | null }) {
  const [row] = await db.query<{ id: string }>(
    `insert into tasks (title, due_on, cadence, contact_id, opportunity_id, project_id, assignee, notes, source_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (source_key) do nothing returning id`,
    [t.title, t.due_on ?? null, t.cadence ?? null, t.contact_id ?? null, t.opportunity_id ?? null, t.project_id ?? null, t.assignee ?? null, t.notes ?? null, t.source_key ?? null],
  );
  return row?.id ?? null;
}

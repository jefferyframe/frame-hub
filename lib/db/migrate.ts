import fs from "node:fs";
import path from "node:path";
import type { Db } from "./types";

const ROOT = path.resolve(process.cwd(), "supabase");

/** Apply supabase/migrations/*.sql in order, once each. Local databases first get
 *  supabase/local-shim.sql (roles + auth.jwt()) so RLS migrations apply unchanged. */
export async function migrate(db: Db, opts: { local: boolean; root?: string }): Promise<string[]> {
  const root = opts.root ?? ROOT;
  if (opts.local) await db.exec(fs.readFileSync(path.join(root, "local-shim.sql"), "utf8"));
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const files = fs.readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(root, "migrations", f), "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query(`insert into schema_migrations (name) values ($1)`, [f]);
    });
    applied.push(f);
  }
  return applied;
}

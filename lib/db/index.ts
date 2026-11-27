import path from "node:path";
import type { Db } from "./types";
import { migrate } from "./migrate";
import { seedDefaults } from "../repo/defaults";

export type { Db } from "./types";
export { one } from "./types";

/** DATABASE_URL set → Supabase/Postgres. Otherwise a local PGlite database in
 *  .data/pglite (git-ignored), migrated on first use. */
export async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { openPostgres } = await import("./postgres");
    return openPostgres(url);
  }
  const { openPglite } = await import("./pglite");
  const dir = process.env.PGLITE_DIR || path.resolve(process.cwd(), ".data/pglite");
  const db = await openPglite(dir);
  await migrate(db, { local: true });
  await seedDefaults(db);
  return db;
}

const g = globalThis as unknown as { __frameDb?: Promise<Db> };

/** One shared connection per server process. */
export function getDb(): Promise<Db> {
  if (!g.__frameDb) g.__frameDb = openDb();
  return g.__frameDb;
}

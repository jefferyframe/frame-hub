/** Minimal database interface so the app runs on Supabase Postgres in production
 *  and on an in-process PGlite database locally / in tests, with the same SQL. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "pglite" | "postgres";
}

export async function one<T>(db: Db, sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

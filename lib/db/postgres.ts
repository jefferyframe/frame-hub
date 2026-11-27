import postgres from "postgres";
import type { Db } from "./types";

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, root: postgres.Sql | null): Db {
  return {
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (!root) return fn(wrap(sql, null));
      return (await root.begin((t) => fn(wrap(t, null)))) as T;
    },
    async close() {
      if (root) await root.end();
    },
  };
}

/** Supabase: use the pooled connection string (Settings → Database). Server-side only. */
export function openPostgres(url: string): Db {
  const sql = postgres(url, {
    max: 5,
    prepare: false, // required by Supabase's transaction pooler
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
  return wrap(sql, sql);
}

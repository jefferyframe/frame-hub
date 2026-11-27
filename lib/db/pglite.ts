import fs from "node:fs";
import { PGlite, types } from "@electric-sql/pglite";
import type { Db } from "./types";

const parsers = {
  [types.DATE]: (v: string) => v, // keep 'YYYY-MM-DD' strings — no timezone drift
  [types.NUMERIC]: (v: string) => Number(v),
  [types.INT8]: (v: string) => Number(v),
};

type PgLike = Pick<PGlite, "query" | "exec">;

function wrap(pg: PgLike, root: PGlite | null): Db {
  return {
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<T>(sql, params as never[]);
      return r.rows;
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (!root) return fn(wrap(pg, null)); // already inside a transaction
      return root.transaction(async (t) => fn(wrap(t as unknown as PgLike, null)));
    },
    async close() {
      if (root) await root.close();
    },
  };
}

/** dataDir: a folder path for a persistent local database, or undefined for in-memory. */
export async function openPglite(dataDir?: string): Promise<Db> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = await PGlite.create(dataDir, { parsers });
  return wrap(pg, pg);
}

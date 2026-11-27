import { describe, it, expect } from "vitest";
import { testDb } from "./helpers";

describe("database", () => {
  it("applies all migrations, including RLS, on a local database", async () => {
    const db = await testDb();
    const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`);
    const names = tables.map((t) => t.tablename);
    for (const t of ["proposals", "opportunities", "projects", "audit_log", "time_entries", "lead_measures"]) expect(names).toContain(t);
    expect(tables.filter((t) => t.tablename !== "schema_migrations").every((t) => t.rowsecurity)).toBe(true);
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int n from line_item_templates`);
    expect(n).toBeGreaterThan(10);
    await db.close();
  });

  it("re-running migrations is a no-op", async () => {
    const db = await testDb();
    const { migrate } = await import("@/lib/db/migrate");
    expect(await migrate(db, { local: true })).toEqual([]);
    await db.close();
  });
});

import { openPglite } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/repo/defaults";

/** A fresh in-memory database with every migration applied. */
export async function testDb() {
  const db = await openPglite();
  await migrate(db, { local: true });
  await seedDefaults(db);
  return db;
}

/** npm run db:migrate   — apply migrations (DATABASE_URL, or the local PGlite database)
 *  npm run db:reset     — delete the local PGlite database and start fresh (local only) */
import fs from "node:fs";
import path from "node:path";
import { openPglite } from "../lib/db/pglite";
import { openPostgres } from "../lib/db/postgres";
import { migrate } from "../lib/db/migrate";
import { seedDefaults } from "../lib/repo/defaults";

async function main() {
  const url = process.env.DATABASE_URL;
  if (process.argv.includes("--reset")) {
    if (url) throw new Error("--reset only works on the local database. Reset Supabase from its dashboard.");
    fs.rmSync(path.resolve(process.env.PGLITE_DIR || ".data/pglite"), { recursive: true, force: true });
    console.log("Local database removed.");
  }
  const db = url ? openPostgres(url) : await openPglite(path.resolve(process.env.PGLITE_DIR || ".data/pglite"));
  const applied = await migrate(db, { local: !url });
  await seedDefaults(db);
  // APP_USERS="email:Name:role,…" adds/updates who may sign in (roles: owner, admin, staff, viewer)
  for (const entry of (process.env.APP_USERS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [email, name, role = "staff"] = entry.split(":").map((x) => x.trim());
    await db.query(
      `insert into app_users (email, name, role, active) values (lower($1), $2, $3, true)
       on conflict (email) do update set name = excluded.name, role = excluded.role, active = true`,
      [email, name || email, role]);
    console.log(`App user: ${email.toLowerCase()} (${role})`);
  }
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  await db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

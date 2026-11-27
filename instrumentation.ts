/** Open (and migrate) the database once at server start, outside any request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    await getDb();
  }
}

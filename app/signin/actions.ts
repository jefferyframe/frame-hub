"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, SESSION_DAYS, cookieOpts, gateConfigured, passwordMatches, signSession } from "@/lib/auth/token";

const PER_IP = 5;     // wrong tries per address per window
const GLOBAL = 30;    // wrong tries across everyone per window
const WINDOW = "15 minutes";

const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");
const back = (q: Record<string, string>) => redirect(`/signin?${new URLSearchParams(q)}`);

export async function signInAction(f: FormData) {
  const name = String(f.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const password = String(f.get("password") ?? "");
  const next = safeNext(String(f.get("next") ?? "/"));
  if (!gateConfigured()) back({ error: "config", next });
  if (!name) back({ error: "name", next });

  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const db = await getDb();
  const [{ mine, total }] = await db.query<{ mine: number; total: number }>(
    `select count(*) filter (where ip = $1)::int as mine, count(*)::int as total from login_attempts where at > now() - interval '${WINDOW}'`, [ip]);
  if (mine >= PER_IP || total >= GLOBAL) back({ error: "locked", next, name });

  if (!(await passwordMatches(password))) {
    await db.query(`insert into login_attempts (ip) values ($1)`, [ip]);
    await db.query(`delete from login_attempts where at < now() - interval '1 day'`);
    await new Promise((r) => setTimeout(r, 400));
    back({ error: "password", next, name });
  }
  await db.query(`delete from login_attempts where ip = $1`, [ip]);
  (await cookies()).set(SESSION_COOKIE, await signSession(name), cookieOpts(SESSION_DAYS * 86400));
  redirect(next);
}

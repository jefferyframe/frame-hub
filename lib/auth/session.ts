import "server-only";
import { cookies, headers } from "next/headers";
import { REFRESH_COOKIE, SESSION_COOKIE, VERIFIER_COOKIE, cookieOpts, exchangePkce, logout, type GoTrueSession } from "./gotrue";
import { appUserFor } from "./index";

export const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");

export async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Store a Supabase session — only if its email is an allowed, active app user. */
export async function startSession(s: GoTrueSession): Promise<boolean> {
  const email = s.user?.email;
  if (!email || !(await appUserFor(email))) { await logout(s.access_token).catch(() => {}); return false; }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, s.access_token, cookieOpts(60 * 60 * 24 * 30));
  jar.set(REFRESH_COOKIE, s.refresh_token, cookieOpts(60 * 60 * 24 * 30));
  jar.delete(VERIFIER_COOKIE);
  return true;
}

export async function endSession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await logout(t).catch(() => {});
  jar.delete(SESSION_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** Used by /auth/callback: the magic link lands there with ?code=… (PKCE). */
export async function exchangeCode(code: string) {
  const verifier = (await cookies()).get(VERIFIER_COOKIE)?.value;
  if (!verifier) return "browser" as const;
  const r = await exchangePkce(code, verifier);
  if (!r.ok) return "expired" as const;
  return (await startSession(r.data)) ? "ok" as const : "notallowed" as const;
}

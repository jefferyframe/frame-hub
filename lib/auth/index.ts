import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, allowedByEnv, getAuthUser, supabaseConfigured } from "./gotrue";
/**
 * Sign-in is behind this one interface so Microsoft 365 or Google can be plugged in later
 * (e.g. Supabase Auth's Azure / Google providers) without touching any page.
 *
 *   AUTH_PROVIDER=supabase   Supabase Auth email sign-in (magic link / one-time code, or password),
 *                            limited to ALLOWED_EMAILS that are also active in app_users. Production default.
 *   AUTH_PROVIDER=dev        local stub: everyone is DEV_USER_EMAIL (refused in production unless ALLOW_DEV_AUTH=1)
 */
export interface SessionUser { email: string; name: string; role: "owner" | "admin" | "staff" | "viewer" }

export interface AuthProvider {
  readonly id: string;
  getUser(): Promise<SessionUser | null>;
  signInUrl(next?: string): string;
}

const signInUrl = (next?: string) => `/signin${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

const devProvider: AuthProvider = {
  id: "dev",
  async getUser() {
    return {
      email: process.env.DEV_USER_EMAIL || "jframe@framearchitecture.com",
      name: process.env.DEV_USER_NAME || "Jeff Frame",
      role: "owner",
    };
  },
  signInUrl,
};

/** An email may use the app only if it's in ALLOWED_EMAILS and active in app_users; returns its app user. */
export async function appUserFor(email: string): Promise<SessionUser | null> {
  if (!allowedByEnv(email)) return null;
  const { getDb } = await import("../db");
  const db = await getDb();
  const rows = await db.query<SessionUser>(
    `select email, name, role from app_users where active and lower(email) = lower($1) limit 1`, [email.trim()]);
  return rows[0] ?? null;
}

const supabaseUser = cache(async (): Promise<SessionUser | null> => {
  if (!supabaseConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const r = await getAuthUser(token);
  if (!r.ok || !r.data.email) return null;
  return appUserFor(r.data.email);
});

const supabaseProvider: AuthProvider = { id: "supabase", getUser: () => supabaseUser(), signInUrl };

const nobody: AuthProvider = { id: "none", async getUser() { return null; }, signInUrl };

export function authProvider(): AuthProvider {
  const id = process.env.AUTH_PROVIDER || (process.env.NODE_ENV === "production" ? "supabase" : "dev");
  if (id === "supabase") return supabaseProvider;
  if (id === "dev") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") return nobody;
    return devProvider;
  }
  return nobody;
}

export async function currentUser(): Promise<SessionUser | null> {
  return authProvider().getUser();
}

/** For server actions: the signed-in user or an error; viewers can't write. */
export async function requireWriter(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new Error("Please sign in.");
  if (u.role === "viewer") throw new Error("You have read-only access.");
  return u;
}

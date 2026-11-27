import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, providerId, verifySession } from "./token";
/**
 * Sign-in is behind this one interface so Microsoft Entra ID (or Google) can replace it later
 * without touching any page: implement AuthProvider and return it from authProvider().
 *
 *   password  (production default) shared-password gate: first name + SITE_PASSWORD, signed cookie (SESSION_SECRET)
 *   dev       local stub: everyone is DEV_USER_EMAIL (AUTH_PROVIDER=dev; refused in production unless ALLOW_DEV_AUTH=1)
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

/** Everyone who knows the shared password is a full user; the first name labels their changes. */
const passwordProvider: AuthProvider = {
  id: "password",
  async getUser() {
    const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    return s ? { email: "", name: s.n, role: "admin" } : null;
  },
  signInUrl,
};

export function authProvider(): AuthProvider {
  return providerId() === "dev" ? devProvider : passwordProvider;
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

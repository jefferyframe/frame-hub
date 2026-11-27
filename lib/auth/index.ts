import "server-only";
/**
 * Sign-in is behind this one interface so Microsoft 365 or Google can be plugged in later
 * (e.g. Auth.js with the Entra ID or Google provider) without touching any page.
 *
 *   AUTH_PROVIDER=dev        local stub: everyone is DEV_USER_EMAIL (default; refused in production)
 *   AUTH_PROVIDER=microsoft  not wired yet — see README "Sign-in"
 *   AUTH_PROVIDER=google     not wired yet
 */
export interface SessionUser { email: string; name: string; role: "owner" | "admin" | "staff" | "viewer" }

export interface AuthProvider {
  readonly id: string;
  getUser(): Promise<SessionUser | null>;
  signInUrl(next?: string): string;
}

const devProvider: AuthProvider = {
  id: "dev",
  async getUser() {
    return {
      email: process.env.DEV_USER_EMAIL || "jframe@framearchitecture.com",
      name: process.env.DEV_USER_NAME || "Jeff Frame",
      role: "owner",
    };
  },
  signInUrl: () => "/signin",
};

const notConfigured = (id: string): AuthProvider => ({
  id,
  async getUser() { return null; },
  signInUrl: (next) => `/signin?provider=${id}${next ? `&next=${encodeURIComponent(next)}` : ""}`,
});

export function authProvider(): AuthProvider {
  const id = process.env.AUTH_PROVIDER || "dev";
  if (id === "dev") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") return notConfigured("dev");
    return devProvider;
  }
  return notConfigured(id);
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

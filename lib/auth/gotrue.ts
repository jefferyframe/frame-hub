/**
 * Minimal Supabase Auth (GoTrue) client over REST — no browser SDK, server-only use.
 * Works in both the Node and Edge runtimes (used by middleware too).
 */
export const SESSION_COOKIE = "fh_at";
export const REFRESH_COOKIE = "fh_rt";
export const VERIFIER_COOKIE = "fh_pkce";

export function supabaseUrl() { return (process.env.SUPABASE_URL || "").replace(/\/$/, ""); }
/** The project's publishable (anon) key — public by design. */
function anonKey() { return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || ""; }
export function supabaseConfigured() { return Boolean(supabaseUrl() && anonKey()); }

export interface GoTrueSession { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user?: { email?: string } }
export interface GoTrueError { status: number; code?: string; message: string }

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ ok: true; data: T } | { ok: false; error: GoTrueError }> {
  const res = await fetch(`${supabaseUrl()}/auth/v1${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      apikey: anonKey(),
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    return { ok: false, error: { status: res.status, code: (json.error_code || json.code || json.error) as string | undefined, message: String(json.msg || json.message || json.error_description || json.error || res.statusText) } };
  }
  return { ok: true, data: json as T };
}

/** Sends the magic-link / one-time-code email. Never creates a user. */
export function sendEmailOtp(email: string, redirectTo: string, codeChallenge: string) {
  return call<unknown>(`/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
    body: { email, create_user: false, code_challenge: codeChallenge, code_challenge_method: "s256" },
  });
}
export function verifyEmailCode(email: string, token: string) {
  return call<GoTrueSession>(`/verify`, { body: { type: "email", email, token } });
}
export function exchangePkce(authCode: string, verifier: string) {
  return call<GoTrueSession>(`/token?grant_type=pkce`, { body: { auth_code: authCode, code_verifier: verifier } });
}
export function passwordSignIn(email: string, password: string) {
  return call<GoTrueSession>(`/token?grant_type=password`, { body: { email, password } });
}
export function refreshSession(refreshToken: string) {
  return call<GoTrueSession>(`/token?grant_type=refresh_token`, { body: { refresh_token: refreshToken } });
}
export function getAuthUser(accessToken: string) {
  return call<{ id: string; email?: string }>(`/user`, { token: accessToken });
}
export function logout(accessToken: string) {
  return call<unknown>(`/logout`, { method: "POST", token: accessToken });
}

/** exp claim of a JWT (seconds), without verifying it — only to decide when to refresh. */
export function jwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)));
    return typeof json.exp === "number" ? json.exp : null;
  } catch { return null; }
}

function b64url(bytes: Uint8Array) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function newPkcePair() {
  const v = new Uint8Array(32); crypto.getRandomValues(v);
  const verifier = b64url(v);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest) };
}

export const cookieOpts = (maxAge: number) => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge,
});

/** Comma-separated ALLOWED_EMAILS — a hard cap on who may sign in, on top of the app_users table. */
export function allowedByEnv(email: string): boolean {
  const list = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length > 0 && list.includes(email.trim().toLowerCase());
}

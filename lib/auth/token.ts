/**
 * Shared-password gate: signed session cookie + constant-time password check.
 * Web Crypto only, so it runs in middleware (Edge) and in Node alike. No secrets live in code:
 *   SITE_PASSWORD   the shared password (Vercel env, sensitive)
 *   SESSION_SECRET  random string, 32+ chars, signs the cookie (Vercel env, sensitive)
 * Changing either one signs everybody out.
 */
export const SESSION_COOKIE = "fh_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

/** "dev" only outside production (or with ALLOW_DEV_AUTH=1); everything else is the password gate. */
export function providerId(): "dev" | "password" {
  const id = process.env.AUTH_PROVIDER || (process.env.NODE_ENV === "production" ? "password" : "dev");
  if (id === "dev" && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_AUTH === "1")) return "dev";
  return "password";
}

export function gateConfigured(): boolean {
  return !!process.env.SITE_PASSWORD && (process.env.SESSION_SECRET ?? "").length >= 32;
}

export const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Compare two byte strings without an early exit. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function hmac(data: string): Promise<Uint8Array> {
  // the key covers the password too, so a password change invalidates every session
  const key = await crypto.subtle.importKey("raw", enc.encode(`${process.env.SESSION_SECRET}\u0000${process.env.SITE_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time check of a typed password against SITE_PASSWORD (both hashed first, so lengths don't leak). */
export async function passwordMatches(typed: string): Promise<boolean> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected || !gateConfigured()) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(typed)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export interface Session { n: string; iat: number; exp: number }

export async function signSession(name: string, days = SESSION_DAYS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(enc.encode(JSON.stringify({ n: name, iat: now, exp: now + days * 86400 } satisfies Session)));
  return `${body}.${b64u(await hmac(body))}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token || !gateConfigured()) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!timingSafeEqual(fromB64u(sig), await hmac(body))) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64u(body))) as Session;
    if (typeof s.n !== "string" || !s.n || typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

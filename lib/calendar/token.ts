/**
 * Calendar feed tokens. Each team member gets a long random token (256 bits) in their feed URL.
 * The database keeps only its SHA-256 (for lookup) and an AES-GCM-encrypted copy (so Settings can
 * show the link again). The encryption key comes from SESSION_SECRET; rotating it means links
 * must be regenerated (the old ones keep working until then, because lookup is by hash).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export { FEED_PATH_RE } from "./path";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newFeedToken = () => randomBytes(32).toString("base64url"); // 43 chars
export const isTokenShaped = (t: string | null | undefined): t is string => !!t && TOKEN_RE.test(t);
export const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

/** Constant-time compare of a presented token against a stored hash. */
export function tokenMatches(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !isTokenShaped(token)) return false;
  const a = Buffer.from(hashToken(token), "hex"), b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV !== "production" ? "frame-hub-local-dev-only" : "");
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(`frame-hub calendar feed\u0000${secret}`).digest();
}

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

/** The token back, or null if it can't be opened (e.g. SESSION_SECRET changed). */
export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [v, iv, body, tag] = sealed.split(".");
    if (v !== "v1" || !iv || !body || !tag) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    const t = Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
    return isTokenShaped(t) ? t : null;
  } catch {
    return null;
  }
}

/** The token out of the last path segment "<token>.ics" (or null if it isn't token-shaped). */
export function tokenFromSegment(seg: string | null | undefined): string | null {
  const t = (seg ?? "").replace(/\.ics$/i, "");
  return isTokenShaped(t) ? t : null;
}

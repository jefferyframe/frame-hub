import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { passwordMatches, signSession, verifySession, timingSafeEqual, providerId } from "../lib/auth/token";

const keep = { ...process.env };
// test-only values, unrelated to any real deployment
beforeEach(() => {
  process.env.SITE_PASSWORD = "test-only-password";
  process.env.SESSION_SECRET = "x".repeat(40);
});
afterEach(() => { process.env = { ...keep }; });

describe("shared-password gate", () => {
  it("accepts only the exact password", async () => {
    expect(await passwordMatches("test-only-password")).toBe(true);
    expect(await passwordMatches("test-only-passwor")).toBe(false);
    expect(await passwordMatches("Test-only-password")).toBe(false);
    expect(await passwordMatches("")).toBe(false);
  });

  it("refuses everything when not configured", async () => {
    delete process.env.SITE_PASSWORD;
    expect(await passwordMatches("")).toBe(false);
    process.env.SITE_PASSWORD = "p";
    process.env.SESSION_SECRET = "short";
    expect(await passwordMatches("p")).toBe(false);
  });

  it("round-trips a signed session and rejects tampering", async () => {
    const t = await signSession("Jeff");
    expect((await verifySession(t))?.n).toBe("Jeff");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ n: "Eve", iat: 0, exp: 9e9 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
    expect(await verifySession(`${body}.${sig}x`)).toBeNull();
    expect(await verifySession("junk")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });

  it("expires sessions and drops them when the secret or password changes", async () => {
    expect(await verifySession(await signSession("Jeff", -1))).toBeNull();
    const t = await signSession("Jeff");
    process.env.SITE_PASSWORD = "rotated";
    expect(await verifySession(t)).toBeNull();
  });

  it("compares in constant time, including different lengths", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });

  it("never uses the dev stand-in in production unless explicitly allowed", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.AUTH_PROVIDER = "dev";
    delete process.env.ALLOW_DEV_AUTH;
    expect(providerId()).toBe("password");
    delete process.env.AUTH_PROVIDER;
    expect(providerId()).toBe("password");
  });
});

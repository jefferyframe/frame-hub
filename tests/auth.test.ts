import { describe, it, expect, afterEach } from "vitest";
import { allowedByEnv, jwtExp, newPkcePair } from "../lib/auth/gotrue";

describe("sign-in helpers", () => {
  const prev = process.env.ALLOWED_EMAILS;
  afterEach(() => { process.env.ALLOWED_EMAILS = prev; });

  it("allows only listed emails, case-insensitively; nobody when the list is empty", () => {
    process.env.ALLOWED_EMAILS = "a@x.com, B@y.com";
    expect(allowedByEnv("A@X.com")).toBe(true);
    expect(allowedByEnv("b@y.com ")).toBe(true);
    expect(allowedByEnv("c@z.com")).toBe(false);
    process.env.ALLOWED_EMAILS = "";
    expect(allowedByEnv("a@x.com")).toBe(false);
  });

  it("reads a JWT's exp without verifying it, and rejects junk", () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(jwtExp(`${b({ alg: "none" })}.${b({ exp: 1234 })}.sig`)).toBe(1234);
    expect(jwtExp("nope")).toBeNull();
  });

  it("makes an S256 PKCE pair", async () => {
    const { verifier, challenge } = await newPkcePair();
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });
});

"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VERIFIER_COOKIE, cookieOpts, newPkcePair, passwordSignIn, sendEmailOtp, verifyEmailCode, supabaseConfigured } from "@/lib/auth/gotrue";
import { appUserFor } from "@/lib/auth";
import { appOrigin, safeNext, startSession } from "@/lib/auth/session";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (q: Record<string, string>) => redirect(`/signin?${new URLSearchParams(q)}`);

export async function sendLinkAction(f: FormData) {
  const email = s(f, "email").toLowerCase();
  const next = safeNext(s(f, "next"));
  if (!supabaseConfigured()) back({ error: "config", next });
  if (!email || !(await appUserFor(email))) back({ error: "notallowed", next });
  const { verifier, challenge } = await newPkcePair();
  (await cookies()).set(VERIFIER_COOKIE, verifier, cookieOpts(60 * 60));
  const r = await sendEmailOtp(email, `${await appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`, challenge);
  if (!r.ok) {
    const code = r.error.code || "";
    const err = code.includes("not_authorized") ? "mailer" : code.includes("rate_limit") || r.error.status === 429 ? "rate" : "send";
    back({ error: err, email, next });
  }
  back({ sent: "1", email, next });
}

export async function verifyCodeAction(f: FormData) {
  const email = s(f, "email").toLowerCase();
  const code = s(f, "code").replace(/\s+/g, "");
  const next = safeNext(s(f, "next"));
  if (!(await appUserFor(email))) back({ error: "notallowed", next });
  const r = await verifyEmailCode(email, code);
  if (!r.ok) back({ error: "code", sent: "1", email, next });
  if (r.ok && !(await startSession(r.data))) back({ error: "notallowed", next });
  redirect(next);
}

export async function passwordAction(f: FormData) {
  const email = s(f, "email").toLowerCase();
  const next = safeNext(s(f, "next"));
  if (!(await appUserFor(email))) back({ error: "notallowed", next, mode: "password" });
  const r = await passwordSignIn(email, s(f, "password"));
  if (!r.ok) back({ error: "password", email, next, mode: "password" });
  if (r.ok && !(await startSession(r.data))) back({ error: "notallowed", next });
  redirect(next);
}


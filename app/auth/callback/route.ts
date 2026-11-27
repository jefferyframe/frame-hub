import { NextResponse } from "next/server";

import { exchangeCode, safeNext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Magic-link landing: exchange the one-time code for a session, then go where the user was headed. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_code") || url.searchParams.get("error");
  if (!code) return NextResponse.redirect(new URL(`/signin?error=${err ? "expired" : "link"}&next=${encodeURIComponent(next)}`, url));
  const out = await exchangeCode(code);
  if (out === "ok") return NextResponse.redirect(new URL(next, url));
  return NextResponse.redirect(new URL(`/signin?error=${out}&next=${encodeURIComponent(next)}`, url));
}

import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/signin?out=1", req.url), 303);
}

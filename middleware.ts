import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, providerId, verifySession } from "@/lib/auth/token";

/**
 * Gatekeeper for every page and API route: signed-out requests never reach code that reads data.
 * Pages redirect to /signin, API routes get 401. The layout, API routes and server actions check again.
 * Public on purpose: /signin, /auth/signout, and client proposal links /p/<token>, /api/p/<token>/… (approved proposals only).
 */
const PUBLIC = [/^\/signin\/?$/, /^\/auth\/signout\/?$/, /^\/p\/[^/]+/, /^\/api\/p\/[^/]+/];

function pass(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return pass(req);
  if (providerId() === "dev") return pass(req);
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return pass(req);

  const res = path.startsWith("/api/")
    ? NextResponse.json({ error: "Sign in required" }, { status: 401 })
    : NextResponse.redirect(new URL(`/signin${path !== "/" ? `?next=${encodeURIComponent(path + req.nextUrl.search)}` : ""}`, req.url));
  if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|robots.txt).*)"] };

import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE, SESSION_COOKIE, allowedByEnv, cookieOpts, getAuthUser, jwtExp, refreshSession, supabaseConfigured } from "@/lib/auth/gotrue";

/**
 * Gatekeeper for every page and API route. Signed-out requests never reach a page or route that reads data:
 * pages redirect to /signin, API routes get 401. The session token is verified with Supabase Auth here,
 * and again (plus the app_users check) in the layout, API routes and server actions.
 * Public on purpose: /signin, /auth/* (sign-in callbacks), and client proposal links /p/<token>, /api/p/<token>/…
 */
const PUBLIC = [/^\/signin(\/|$)/, /^\/auth\//, /^\/p\/[^/]+/, /^\/api\/p\/[^/]+/];

function pass(req: NextRequest, token?: string) {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  if (token) {
    // make a freshly refreshed token visible to this same request's server code
    const rest = (req.headers.get("cookie") || "").split(/;\s*/).filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`));
    h.set("cookie", [...rest, `${SESSION_COOKIE}=${token}`].join("; "));
  }
  return NextResponse.next({ request: { headers: h } });
}

function deny(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const res = isApi
    ? NextResponse.json({ error: "Sign in required" }, { status: 401 })
    : NextResponse.redirect(new URL(`/signin${req.nextUrl.pathname !== "/" ? `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}` : ""}`, req.url));
  if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  if (req.cookies.has(REFRESH_COOKIE)) res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((r) => r.test(path))) return pass(req);

  const provider = process.env.AUTH_PROVIDER || (process.env.NODE_ENV === "production" ? "supabase" : "dev");
  if (provider === "dev") {
    if (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_AUTH === "1") return pass(req);
    return deny(req);
  }
  if (provider !== "supabase" || !supabaseConfigured()) return deny(req);

  let token = req.cookies.get(SESSION_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let refreshed: { access_token: string; refresh_token: string } | null = null;
  const exp = token ? jwtExp(token) : null;
  if ((!token || !exp || exp - 60 < Date.now() / 1000) && refresh) {
    const r = await refreshSession(refresh);
    if (r.ok) { refreshed = r.data; token = r.data.access_token; } else token = undefined;
  }
  if (!token) return deny(req);
  const u = await getAuthUser(token);
  if (!u.ok || !u.data.email || !allowedByEnv(u.data.email)) return deny(req);

  const res = pass(req, refreshed ? token : undefined);
  if (refreshed) {
    res.cookies.set(SESSION_COOKIE, refreshed.access_token, cookieOpts(60 * 60 * 24 * 30));
    res.cookies.set(REFRESH_COOKIE, refreshed.refresh_token, cookieOpts(60 * 60 * 24 * 30));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|robots.txt).*)"] };

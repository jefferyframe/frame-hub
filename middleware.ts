import { NextResponse, type NextRequest } from "next/server";
/** Passes the path to the layout so client-facing pages (/p/…) render without the app shell. */
export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}
export const config = { matcher: ["/((?!_next/|favicon.ico|api/).*)"] };

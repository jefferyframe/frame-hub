import { getDb } from "@/lib/db";
import { renderFeed } from "@/lib/calendar/feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Private calendar feed: /api/cal/<token>.ics. The sign-in gate lets only token-shaped paths through;
 *  an unknown or revoked token gets a bare 404, so the URL itself is the only key. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(req.url).origin;
  let r;
  try {
    r = await renderFeed(await getDb(), token, origin);
  } catch {
    return new Response("Calendar unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
  }
  if (r.status !== 200) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
  return new Response(r.body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="frame-hub.ics"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { getTask } from "@/lib/repo/tasks";
import { taskToEvent } from "@/lib/calendar";
import { buildCalendar } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Add to calendar" for one task: a single-event .ics file (signed-in users only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const t = await getTask(await getDb(), id);
  const ev = t ? taskToEvent(t, new URL(req.url).origin) : null;
  if (!t || !ev) return new Response(t ? "This task has no due date." : "Not found", { status: t ? 422 : 404 });
  const slug = t.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
  return new Response(buildCalendar([ev], { name: t.title }), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}.ics"`, "Cache-Control": "private, no-store" },
  });
}

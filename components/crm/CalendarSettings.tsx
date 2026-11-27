"use client";
import { useState } from "react";
import { rotateFeedAction, revokeFeedAction, setIncludeUnassignedAction } from "@/app/crm/actions";
import { useRun, ToastProvider } from "./ui";

/** One person's private calendar link, with Add-to buttons and step-by-step instructions. */
function Feed({ memberId, name, origin, token: initial, includeUnassigned, hasFeed }: { memberId: string; name: string; origin: string; token: string | null; includeUnassigned: boolean; hasFeed: boolean }) {
  const { run, busy } = useRun();
  const [token, setToken] = useState(initial);
  const [copied, setCopied] = useState(false);
  const https = token ? `${origin}/api/cal/${token}.ics` : null;
  const webcal = https?.replace(/^https?:/, "webcal:") ?? null;
  const google = webcal ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` : null;
  const outlook = https ? `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(`Frame Hub – ${name}`)}` : null;

  async function rotate() {
    if (token && !confirm("Make a new link? The current link stops working, so calendars subscribed to it need the new one.")) return;
    const r = await run("rotate", () => rotateFeedAction(memberId), token ? "New link made. The old one no longer works." : "Calendar link ready.");
    const t = (r?.data as { token?: string } | undefined)?.token;
    if (t) setToken(t);
  }
  if (!token) return (
    <div className="stack" style={{ gap: 8 }}>
      {hasFeed
        ? <p className="notice small">{name} has a calendar link, but it can’t be shown here any more (the server’s secret key changed). It still works where it’s already subscribed. To see a link again, make a new one and re-subscribe.</p>
        : <p className="small muted">No calendar link yet for {name}.</p>}
      <div><button className="btn primary" onClick={async () => { if (hasFeed && !confirm("Make a new link? The current link stops working.")) return; const r = await run("rotate", () => rotateFeedAction(memberId), "Calendar link ready."); const t = (r?.data as { token?: string } | undefined)?.token; if (t) setToken(t); }} disabled={busy === "rotate"}>{hasFeed ? "Make a new link" : `Create ${name.split(" ")[0]}’s calendar link`}</button></div>
    </div>
  );
  return (
    <div className="stack calfeed" style={{ gap: 10 }}>
      <div className="feedurl"><code>{https}</code><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(https!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy link"}</button></div>
      <div className="row">
        <a className="btn" href={outlook!} target="_blank" rel="noopener noreferrer">Add to Outlook</a>
        <a className="btn" href={google!} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
        <a className="btn" href={webcal!}>Add to Apple Calendar</a>
      </div>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" defaultChecked={includeUnassigned} onChange={(e) => run("unassigned", () => setIncludeUnassignedAction(memberId, e.target.checked), e.target.checked ? "Unassigned follow-ups will show too." : "Only tasks assigned to this person now.")} /> Also show follow-ups nobody owns yet</label>
      <details className="howto">
        <summary>Step by step</summary>
        <ol className="small">
          <li><b>Outlook (Microsoft 365, web):</b> click <i>Add to Outlook</i>, or in Outlook go to Calendar → <i>Add calendar</i> → <i>Subscribe from web</i>, paste the link, name it “Frame Hub”, Import. Outlook on Windows/Mac picks it up from the same account.</li>
          <li><b>Google Calendar:</b> click <i>Add to Google Calendar</i>, or on calendar.google.com open <i>Other calendars +</i> → <i>From URL</i>, paste the link, <i>Add calendar</i>. It then shows on Android and the Google Calendar app.</li>
          <li><b>iPhone / iPad:</b> tap <i>Add to Apple Calendar</i> and confirm Subscribe, or Settings → Calendar → Accounts → Add Account → Other → <i>Add Subscribed Calendar</i>, paste the link. <b>Mac:</b> Calendar → File → New Calendar Subscription, paste the link, set Auto-refresh to “Every 5 minutes” or “Every hour”, and keep Alerts on.</li>
        </ol>
        <p className="small muted">The calendar shows open tasks with a due date. Done tasks drop off; changes appear the next time your calendar app re-reads the link — Apple Calendar as often as you set (every 5 minutes to an hour), Outlook every few hours (Microsoft says it can take up to a day), Google up to a day. For something due soon, use the calendar button on the task to add it right away. Reminders pop up in Apple Calendar; Outlook and Google use their own default reminders for subscribed calendars. Keep the link private — anyone with it can see these tasks. If it leaks, make a new one.</p>
      </details>
      <div className="row"><button className="btn sm" onClick={rotate} disabled={busy === "rotate"}>Make a new link</button><button className="btn sm ghost danger" disabled={busy === "revoke"} onClick={async () => { if (confirm("Turn off this calendar link? Calendars subscribed to it stop updating.")) { if (await run("revoke", () => revokeFeedAction(memberId), "Calendar link turned off.")) setToken(null); } }}>Turn off</button></div>
    </div>
  );
}

export function CalendarSettings(p: { memberId: string; name: string; origin: string; token: string | null; includeUnassigned: boolean; hasFeed: boolean }) {
  return <ToastProvider><Feed {...p} /></ToastProvider>;
}

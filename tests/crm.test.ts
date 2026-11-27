import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/db/types";
import { testDb } from "./helpers";
import { buildCalendar, icsEscape, icsFold, type CalEvent } from "@/lib/calendar/ics";
import { newFeedToken, hashToken, tokenMatches, sealToken, openToken, tokenFromSegment, FEED_PATH_RE } from "@/lib/calendar/token";
import { taskToEvent } from "@/lib/calendar";
import { renderFeed } from "@/lib/calendar/feed";
import { zonedToUtc, utcToZoned } from "@/lib/calc/time";
import { taskBucket, snoozeTarget, matchMember, canEditActivity, daysOut, firstNameKey } from "@/lib/crm/logic";
import { listTeam, rotateFeedToken, revokeFeedToken, currentFeedToken, saveMember, memberByToken } from "@/lib/repo/team";
import { createTask, updateTask, completeTask, snoozeTask, reopenTask, openTasks, feedTasks } from "@/lib/repo/tasks";
import { logActivity, editActivity, deleteActivity, timeline } from "@/lib/repo/activities";
import { createOpportunity, setOpportunityStatus } from "@/lib/repo/opportunities";
import { createProposal, setProposalStatus } from "@/lib/repo/proposals";
import { proposalSent } from "@/lib/flow";
import { boardDeals } from "@/lib/repo/deals";
import { LEGACY_PHASES } from "@/lib/calc/proposal";
import { middleware } from "../middleware";

const unfold = (s: string) => s.replace(/\r\n /g, "");

// ---------------------------------------------------------------- iCalendar
describe("iCalendar writer", () => {
  const timed: CalEvent = { uid: "task-1@frame-hub", sequence: 3, title: "Call Pat, re: fee; revise", description: "Line 1\nLine 2", start: { at: new Date("2026-12-01T17:30:00Z") }, durationMin: 15, alarmMinutesBefore: 15, updatedAt: new Date("2026-11-27T10:00:00Z"), priority: "high" };
  const ics = buildCalendar([timed, { uid: "task-2@frame-hub", sequence: 0, title: "All day", start: { day: "2026-12-31" }, alarmMinutesBefore: null }],
    { name: "Frame Hub – Jeff", feed: true, stamp: new Date("2026-11-27T12:00:00Z") });

  it("is CRLF, wrapped in VCALENDAR, and names the feed", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(unfold(ics)).toContain("X-WR-CALNAME:Frame Hub – Jeff");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
  });
  it("writes timed events in UTC with a reminder, sequence and escaped text", () => {
    const u = unfold(ics);
    expect(u).toContain("UID:task-1@frame-hub");
    expect(u).toContain("SEQUENCE:3");
    expect(u).toContain("DTSTART:20261201T173000Z");
    expect(u).toContain("DTEND:20261201T174500Z");
    expect(u).toContain("SUMMARY:Call Pat\\, re: fee\\; revise");
    expect(u).toContain("DESCRIPTION:Line 1\\nLine 2");
    expect(u).toContain("BEGIN:VALARM\r\nACTION:DISPLAY");
    expect(u).toContain("TRIGGER:-PT15M");
    expect(u).toContain("PRIORITY:1");
    expect(u).toContain("DTSTAMP:20261127T120000Z");
  });
  it("writes all-day events as dates ending the next day, without an alarm when none is set", () => {
    const ev = unfold(ics).split("BEGIN:VEVENT")[2];
    expect(ev).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ev).toContain("DTEND;VALUE=DATE:20270101");
    expect(ev).not.toContain("VALARM");
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const long = "SUMMARY:" + "Ünïcödé ".repeat(30);
    const folded = icsFold(long);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
  it("escapes backslashes, commas, semicolons and newlines", () => {
    expect(icsEscape("a\\b,c;d\r\ne")).toBe("a\\\\b\\,c\\;d\\ne");
  });
  it("maps a task to an event: time or all-day, owner and deep link in the description", () => {
    const base = { id: "11111111-1111-1111-1111-111111111111", title: "Follow up", due_on: "2026-12-02", due_at: null, notes: "bring fee", kind: "call", priority: "normal" as const, reminder_minutes: 30, sequence: 2, updated_at: new Date(), opportunity_id: "22222222-2222-2222-2222-222222222222", opportunity_name: "Clinic – MOB", owner_name: "Bella" };
    const e1 = taskToEvent(base, "https://hub.example")!;
    expect(e1.start).toEqual({ day: "2026-12-02" });
    expect(e1.title).toBe("Call: Follow up");
    expect(e1.description).toContain("Owner: Bella");
    expect(e1.url).toBe("https://hub.example/sales/22222222-2222-2222-2222-222222222222");
    const e2 = taskToEvent({ ...base, title: "Call Pat", due_at: new Date("2026-12-02T17:00:00Z") }, "https://hub.example")!;
    expect(e2.start).toEqual({ at: new Date("2026-12-02T17:00:00Z") });
    expect(e2.title).toBe("Call Pat");
    expect(taskToEvent({ ...base, due_on: null }, "x")).toBeNull();
  });
});

// ---------------------------------------------------------------- tokens & the gate
describe("calendar feed tokens", () => {
  const keep = { ...process.env };
  beforeEach(() => { process.env.SESSION_SECRET = "y".repeat(40); });
  afterEach(() => { process.env = { ...keep }; });

  it("are 256-bit, URL-safe, and checked by hash in constant time", () => {
    const t = newFeedToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newFeedToken()).not.toBe(t);
    expect(tokenMatches(t, hashToken(t))).toBe(true);
    expect(tokenMatches(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), hashToken(t))).toBe(false);
    expect(tokenMatches(t, null)).toBe(false);
    expect(tokenMatches("short", hashToken("short"))).toBe(false);
  });
  it("seal/open round-trips, and tampering or a new secret fails closed", () => {
    const t = newFeedToken();
    const sealed = sealToken(t);
    expect(sealed).not.toContain(t);
    expect(openToken(sealed)).toBe(t);
    const parts = sealed.split(".");
    expect(openToken([parts[0], parts[1], parts[2].slice(0, -2) + "AA", parts[3]].join("."))).toBeNull();
    process.env.SESSION_SECRET = "z".repeat(40);
    expect(openToken(sealed)).toBeNull();
    expect(openToken(null)).toBeNull();
  });
  it("only token-shaped .ics paths get past the sign-in gate", () => {
    const t = newFeedToken();
    expect(tokenFromSegment(`${t}.ics`)).toBe(t);
    expect(tokenFromSegment("abc.ics")).toBeNull();
    expect(FEED_PATH_RE.test(`/api/cal/${t}.ics`)).toBe(true);
    for (const p of ["/api/cal/", "/api/cal/x.ics", `/api/cal/${t}`, `/api/cal/${t}.ics/x`, `/api/cal/${t}x.ics`, `/api/cal/../crm`]) expect(FEED_PATH_RE.test(p)).toBe(false);
  });
  it("middleware: feed path passes, everything else needs a session", async () => {
    process.env.AUTH_PROVIDER = "password";
    process.env.SITE_PASSWORD = "test-only-password";
    const t = newFeedToken();
    const feed = await middleware(new NextRequest(`https://hub.example/api/cal/${t}.ics`));
    expect(feed.status).toBe(200); // passed through to the handler
    expect(feed.headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(new NextRequest("https://hub.example/api/cal/nope.ics"))).status).toBe(401);
    expect((await middleware(new NextRequest(`https://hub.example/api/tasks/${"0".repeat(8)}-0000-0000-0000-000000000000/ics`))).status).toBe(401);
    const page = await middleware(new NextRequest("https://hub.example/crm"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/signin");
  });
});

// ---------------------------------------------------------------- pure task logic
describe("task timing", () => {
  it("converts Pacific wall time to the instant and back, across DST", () => {
    expect(zonedToUtc("2026-12-01", "09:30").toISOString()).toBe("2026-12-01T17:30:00.000Z"); // PST
    expect(zonedToUtc("2026-07-01", "09:30").toISOString()).toBe("2026-07-01T16:30:00.000Z"); // PDT
    expect(utcToZoned("2026-12-01T07:30:00Z")).toEqual({ day: "2026-11-30", time: "23:30" });
  });
  it("buckets tasks: overdue / today / this week / later", () => {
    const now = new Date("2026-11-27T19:00:00Z"); // 11:00 Pacific, Friday
    expect(taskBucket({ due_on: "2026-11-26", due_at: null }, now)).toBe("overdue");
    expect(taskBucket({ due_on: "2026-11-27", due_at: null }, now)).toBe("today");
    expect(taskBucket({ due_on: "2026-11-27", due_at: zonedToUtc("2026-11-27", "09:00") }, now)).toBe("overdue");
    expect(taskBucket({ due_on: "2026-11-27", due_at: zonedToUtc("2026-11-27", "15:00") }, now)).toBe("today");
    expect(taskBucket({ due_on: "2026-12-04", due_at: null }, now)).toBe("week");
    expect(taskBucket({ due_on: "2026-12-05", due_at: null }, now)).toBe("later");
    expect(taskBucket({ due_on: null, due_at: null }, now)).toBe("later");
  });
  it("snoozes keep the time of day and count from today when overdue", () => {
    const now = new Date("2026-11-27T19:00:00Z"); // Fri 11:00 PT
    const t = { due_on: "2026-11-20", due_at: zonedToUtc("2026-11-20", "14:15") };
    const tm = snoozeTarget(t, "tomorrow", now);
    expect(tm.due_on).toBe("2026-11-28");
    expect(utcToZoned(tm.due_at!).time).toBe("14:15");
    expect(snoozeTarget(t, "3d", now).due_on).toBe("2026-11-30");
    expect(snoozeTarget({ due_on: "2026-11-20", due_at: null }, "week", now)).toEqual({ due_on: "2026-11-30", due_at: null }); // next Monday
    expect(snoozeTarget({ due_on: "2026-12-10", due_at: null }, "3d", now).due_on).toBe("2026-12-13");
    expect(snoozeTarget(t, "1h", now).due_at!.toISOString()).toBe("2026-11-27T20:00:00.000Z");
  });
  it("maps the signed-in first name to a team member, and only authors edit their entries", () => {
    const team = [{ id: "a", first_name: "Jeff", active: true }, { id: "b", first_name: "Bella", active: true }, { id: "c", first_name: "Roy", active: false }];
    expect(matchMember(team, "jeff frame")?.id).toBe("a");
    expect(matchMember(team, " Bella ")?.id).toBe("b");
    expect(matchMember(team, "Roy")).toBeNull();
    expect(matchMember(team, "Kyle")).toBeNull();
    expect(firstNameKey("  June  Smith")).toBe("june");
    expect(canEditActivity({ author: "Jeff", kind: "note" }, "jeff")).toBe(true);
    expect(canEditActivity({ author: "Jeff", kind: "note" }, "Bella")).toBe(false);
    expect(canEditActivity({ author: "Jeff", kind: "stage" }, "Jeff")).toBe(false);
    expect(daysOut("2026-11-20", "2026-11-27")).toBe(7);
    expect(daysOut(null, "2026-11-27")).toBeNull();
  });
});

// ---------------------------------------------------------------- database
describe("CRM on the database", () => {
  let db: Db;
  const keep = { ...process.env };
  beforeAll(async () => { db = await testDb(); process.env.SESSION_SECRET = "y".repeat(40); });
  afterEach(() => { process.env = { ...keep, SESSION_SECRET: "y".repeat(40) }; });
  const member = async (first: string) => (await listTeam(db)).find((m) => m.first_name === first)!;

  it("seeds the team from the Job List", async () => {
    const names = (await listTeam(db)).map((m) => m.first_name);
    expect(names).toEqual(["Jeff", "Bella", "June", "Roy", "Troy", "Brandon", "Jaden", "Emily", "Mathew"]);
    await expect(saveMember(db, { name: "Bella Two" })).rejects.toThrow(/already a team member called Bella/);
  });

  it("tasks: create with time, edit, snooze, complete — sequence bumps and done tasks leave the feed", async () => {
    const bella = await member("Bella");
    const o = await createOpportunity(db, { name: "Example Co – Office TI" }, "Jeff");
    const t = await createTask(db, { title: "Call about fee", due_day: "2026-12-03", due_time: "10:00", owner_id: bella.id, kind: "call", priority: "high", opportunity_id: o.id }, "Jeff");
    expect(new Date(t.due_at!).toISOString()).toBe("2026-12-03T18:00:00.000Z");
    expect(t.assignee).toBe("Bella");
    const t2 = await updateTask(db, t.id, { title: "Call about the fee" }, "Jeff");
    expect(t2.sequence).toBe(1);
    const t3 = await snoozeTask(db, t.id, "3d", "Jeff", new Date("2026-11-27T19:00:00Z"));
    expect(t3.due_on).toBe("2026-12-06");
    expect(utcToZoned(t3.due_at!).time).toBe("10:00");
    expect(t3.sequence).toBe(2);
    expect((await feedTasks(db, bella.id, false)).map((x) => x.id)).toContain(t.id);
    expect((await openTasks(db, { owner: bella.id })).map((x) => x.id)).toContain(t.id);
    await completeTask(db, t.id, "Bella");
    expect((await feedTasks(db, bella.id, false)).map((x) => x.id)).not.toContain(t.id);
    await reopenTask(db, t.id, "Bella");
    expect((await feedTasks(db, bella.id, false)).map((x) => x.id)).toContain(t.id);
    const tl = await timeline(db, "opportunity", o.id);
    expect(tl.map((a) => a.subject)).toEqual(expect.arrayContaining(["Task added: Call about fee", "Task done: Call about the fee"]));
    await expect(createTask(db, { title: "  " }, "Jeff")).rejects.toThrow();
  });

  it("feed: valid token → that person's open tasks only; unknown, revoked or old tokens → 404", async () => {
    const june = await member("June"), troy = await member("Troy");
    await createTask(db, { title: "June's reminder", due_day: "2026-12-10", owner_id: june.id }, "Jeff");
    await createTask(db, { title: "Troy's reminder", due_day: "2026-12-10", owner_id: troy.id }, "Jeff");
    const unassigned = await createTask(db, { title: "Nobody's yet", due_day: "2026-12-11" }, "Jeff");
    await createTask(db, { title: "No date for June", owner_id: june.id }, "Jeff");

    const token = await rotateFeedToken(db, june.id);
    expect(await currentFeedToken(db, june.id)).toBe(token);
    const r = await renderFeed(db, `${token}.ics`, "https://hub.example");
    expect(r.status).toBe(200);
    expect(r.body).toContain("SUMMARY:June's reminder");
    expect(r.body).not.toContain("Troy's reminder");
    expect(r.body).not.toContain("Nobody's yet");
    expect(r.body).not.toContain("No date for June");

    await db.query(`update team_members set cal_include_unassigned = true where id = $1`, [june.id]);
    expect((await renderFeed(db, `${token}.ics`, "https://hub.example")).body).toContain(`task-${unassigned.id}@frame-hub`);

    for (const bad of ["", "x.ics", `${token}`, `${token}.ics.ics`, `${newFeedToken()}.ics`]) {
      const b = await renderFeed(db, bad, "https://hub.example");
      expect(b.status).toBe(404);
      expect(b.body).toBe("Not found");
    }
    const fresh = await rotateFeedToken(db, june.id);
    expect((await renderFeed(db, `${token}.ics`, "x")).status).toBe(404);
    expect((await renderFeed(db, `${fresh}.ics`, "x")).status).toBe(200);
    await revokeFeedToken(db, june.id);
    expect((await renderFeed(db, `${fresh}.ics`, "x")).status).toBe(404);
    expect(await currentFeedToken(db, june.id)).toBeNull();
    // inactive people's links stop too
    const t2 = await rotateFeedToken(db, troy.id);
    await db.query(`update team_members set active = false where id = $1`, [troy.id]);
    expect(await memberByToken(db, t2)).toBeNull();
    const [{ hash }] = await db.query<{ hash: string | null }>(`select cal_token_hash as hash from team_members where id = $1`, [troy.id]);
    expect(hash).toBe(hashToken(t2)); // the token itself is never stored in the clear
    expect(JSON.stringify(await db.query(`select * from team_members where id = $1`, [troy.id]))).not.toContain(t2);
  });

  it("activities: logged on the deal, shown on its company, editable and deletable only by the author", async () => {
    const o = await createOpportunity(db, { name: "Timeline Test – Clinic" }, "Jeff");
    const co = (await db.query<{ id: string }>(`insert into companies (name) values ('Timeline Test Co') returning id`))[0].id;
    await db.query(`update opportunities set company_id = $2 where id = $1`, [o.id, co]);
    const a = await logActivity(db, { kind: "call", author: "Bella", subject: "Call with Pat", body: "Wants a revised fee", outcome: "Connected", opportunity_id: o.id });
    expect(a.company_id).toBe(co);
    expect((await timeline(db, "company", co)).map((x) => x.id)).toContain(a.id);
    await expect(editActivity(db, a.id, "Jeff", { body: "x" })).rejects.toThrow(/Only Bella/);
    const e = await editActivity(db, a.id, "bella", { body: "Wants a revised fee by Friday" });
    expect(e.body).toBe("Wants a revised fee by Friday");
    expect(e.edited_at).not.toBeNull();
    await expect(deleteActivity(db, a.id, "Jeff")).rejects.toThrow();
    await deleteActivity(db, a.id, "Bella");
    expect((await timeline(db, "opportunity", o.id)).map((x) => x.id)).not.toContain(a.id);
    await expect(logActivity(db, { kind: "note", author: "Jeff", body: "", opportunity_id: o.id })).rejects.toThrow();
    await expect(logActivity(db, { kind: "note", author: "Jeff", body: "floating" })).rejects.toThrow(/who this is about/);
  });

  it("stage moves write to the timeline and the automatic follow-up task belongs to the deal owner", async () => {
    const roy = await member("Roy");
    const o = await createOpportunity(db, { name: "Stage Test – Warehouse", owner_member_id: roy.id, date_presented: "2026-11-20" }, "Jeff");
    await setOpportunityStatus(db, o.id, "Presented", "Jeff", "2026-11-27");
    const tl = await timeline(db, "opportunity", o.id);
    expect(tl[0].kind).toBe("stage");
    expect(tl[0].subject).toBe("Proposal Needed → Presented");
    expect(tl[0].author).toBe("Jeff");
    const tasks = await db.query<{ owner_id: string; due_on: string; kind: string }>(`select owner_id, due_on, kind from tasks where opportunity_id = $1`, [o.id]);
    expect(tasks).toEqual([{ owner_id: roy.id, due_on: "2026-11-24", kind: "call" }]);
  });

  it("sending a proposal creates its deal (Presented) with a follow-up owned by the sender — once", async () => {
    const jeff = await member("Jeff");
    const p = await createProposal(db, {
      title: "Sample Dental Office", project_name: "Sample Dental Office",
      client: { name: "Sample Dental Group", contact_name: "Sam Lee", contact_title: "Owner", email: "sam@example.com", phone: "" },
      fee_basis: "fixed", arch_fee: 40000, items: [...LEGACY_PHASES.map((x) => ({ kind: "phase" as const, label: x.label, pct: x.pct })), { kind: "consultant", label: "Structural", amount: 5000 }],
    }, "Jeff Frame", "2026-11-20");
    await setProposalStatus(db, p.id, "approved", "Jeff Frame");
    await setProposalStatus(db, p.id, "sent", "Jeff Frame");
    const o = await proposalSent(db, p.id, "Jeff Frame");
    expect(o.status).toBe("Presented");
    expect(o.owner_member_id).toBe(jeff.id);
    expect(Number(o.subs_cost)).toBe(5000);
    expect(o.date_presented).toBeTruthy();
    const again = await proposalSent(db, p.id, "Jeff Frame");
    expect(again.id).toBe(o.id);
    const tasks = await db.query<{ owner_id: string; cadence: string }>(`select owner_id, cadence from tasks where opportunity_id = $1`, [o.id]);
    expect(tasks).toEqual([{ owner_id: jeff.id, cadence: "opp_follow_up_1" }]);
    const deals = await boardDeals(db, "deals", "2026-11-27");
    const row = deals.find((d) => d.id === o.id)!;
    expect(row.total).toBe(45000);
    expect(row.owner).toBe("Jeff Frame");
    expect(row.next?.day).toBeTruthy();
    expect(row.proposal).toMatch(/^P-26-\d{3} v1$/);
    expect((await boardDeals(db, "leads", "2026-11-27")).some((d) => d.id === o.id)).toBe(false);
    expect((await timeline(db, "opportunity", o.id)).some((a) => a.subject?.includes("sent to the client"))).toBe(true);
  });

  it("sending a proposal for an existing lead moves that lead to Presented", async () => {
    const lead = await createOpportunity(db, { name: "Lead – Library Remodel" }, "Bella");
    const p = await createProposal(db, { title: "Library Remodel", client: { name: "Example Library" }, fee_basis: "fixed", arch_fee: 10000, opportunity_id: lead.id }, "Bella", "2026-11-21");
    await setProposalStatus(db, p.id, "approved", "Bella");
    await setProposalStatus(db, p.id, "sent", "Bella");
    const o = await proposalSent(db, p.id, "Bella");
    expect(o.id).toBe(lead.id);
    expect(o.status).toBe("Presented");
    expect(o.owner_member_id).toBe((await member("Bella")).id);
    const t = await db.query<{ owner_id: string }>(`select owner_id from tasks where opportunity_id = $1 and done_at is null`, [o.id]);
    expect(t.length).toBe(1);
    expect(t[0].owner_id).toBe((await member("Bella")).id);
  });
});

describe("task events on the timeline", () => {
  it("are 'task' entries even when the task itself is a call", async () => {
    const db = await testDb();
    const o = await createOpportunity(db, { name: "Kind Test" }, "Jeff");
    await createTask(db, { title: "Ring them", kind: "call", due_day: "2026-12-01", opportunity_id: o.id }, "Jeff");
    const tl = await timeline(db, "opportunity", o.id);
    expect(tl.find((a) => a.subject === "Task added: Ring them")?.kind).toBe("task");
  });
});

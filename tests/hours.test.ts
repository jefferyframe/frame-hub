import { describe, it, expect, beforeAll } from "vitest";
import type { Db } from "@/lib/db/types";
import { testDb } from "./helpers";
import {
  weekStart, weekEnding, weekLabel, isoDow, parseHours, hoursError, dayTotalError, phaseHours, hoursByPhase, hoursByDay,
  missingDays, expectedInWeek, canEditEntry,
} from "@/lib/calc/hours";
import {
  weeklyCapacity, addWorkdays, workdaysIn, estimateFinish, resolveAllocations, buildSchedule, workload, plannedOnDay, seedPeople,
  type Person, type PlanPhase, type PlanProject, type PlanAssignment,
} from "@/lib/calc/schedule";
import { logHoursReminder } from "@/lib/calendar/reminder";
import { buildCalendar } from "@/lib/calendar/ics";
import { renderFeed } from "@/lib/calendar/feed";
import { listTeam, rotateFeedToken, setReminder, saveMemberHours } from "@/lib/repo/team";
import { logHours, updateEntry, deleteEntry, setCell, missingHoursReport, memberEntries } from "@/lib/repo/time";
import { getProject } from "@/lib/repo/projects";
import { saveAssignment, loadSchedule, seedSchedule, setPhaseDates } from "@/lib/repo/schedule";
import { setSetting } from "@/lib/repo/settings";
import { computeJobCost } from "@/lib/calc/jobCost";

const unfold = (s: string) => s.replace(/\r\n /g, "");

// ---------------------------------------------------------------- hour math
describe("hour math", () => {
  it("weeks run Monday–Sunday and end on the workbook's Friday 'Thru' date", () => {
    expect(isoDow("2026-11-27")).toBe(5); // Friday
    expect(weekStart("2026-11-27")).toBe("2026-11-23");
    expect(weekEnding("2026-11-23")).toBe("2026-11-27");
    expect(weekEnding("2026-11-29")).toBe("2026-11-27"); // Sunday → same week's Friday
    expect(weekEnding("2026-11-30")).toBe("2026-12-04");
    expect(weekLabel("2026-11-11")).toBe("Thru 11/13/26"); // same label the Job List import uses
  });

  it("parses typed hours and enforces quarter-hour steps up to 24", () => {
    expect(parseHours("1.5")).toBe(1.5);
    expect(parseHours("1:45")).toBe(1.75);
    expect(parseHours("2h 15m")).toBe(2.25);
    expect(parseHours("45m")).toBe(0.75);
    expect(parseHours("")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(hoursError(0.25)).toBeNull();
    expect(hoursError(7.75)).toBeNull();
    expect(hoursError(0.3)).toMatch(/quarter/);
    expect(hoursError(0)).toMatch(/more than zero/);
    expect(hoursError(25)).toMatch(/24/);
    expect(dayTotalError(20, 4)).toBeNull();
    expect(dayTotalError(20, 4.25)).toMatch(/24.25/);
  });

  it("replacing an entry counts only the difference", () => {
    expect(dayTotalError(20, 6, 3)).toBeNull();
  });

  it("assigned − worked = remaining (negative when over), burn = worked ÷ assigned", () => {
    expect(phaseHours(40, 30)).toEqual({ assigned: 40, worked: 30, remaining: 10, burn: 0.75, over: false });
    expect(phaseHours(40, 42.5)).toMatchObject({ remaining: -2.5, over: true });
    expect(phaseHours(null, 3)).toMatchObject({ assigned: 0, remaining: -3, burn: null, over: false });
  });

  it("daily app entries and weekly spreadsheet rows add up the same way (template N10)", () => {
    const entries = [
      { phase: "Schematic Design", hours: 6.5, week_ending: "2026-11-13" },            // imported weekly row
      { phase: "Schematic Design", hours: 2.25, work_date: "2026-11-23", week_ending: "2026-11-27" }, // app daily entries
      { phase: "Schematic Design", hours: 1.75, work_date: "2026-11-24", week_ending: "2026-11-27" },
      { phase: "Design Development", hours: 4, work_date: "2026-11-24", week_ending: "2026-11-27" },
    ];
    expect(hoursByPhase(entries)).toEqual({ "Schematic Design": 10.5, "Design Development": 4 });
    expect([...hoursByDay(entries)]).toEqual([["2026-11-23", 2.25], ["2026-11-24", 5.75]]);
    const jc = computeJobCost({ arch_fee: 100000 }, [{ phase: "Schematic Design", hours_assigned: 20 }], [], entries);
    expect(jc.phases.find((p) => p.phase === "Schematic Design")).toMatchObject({ hoursCompleted: 10.5, hoursRemaining: 9.5 });
    expect(jc.hoursCompleted).toBe(14.5);
  });

  it("only the person who typed an entry (or the person it's for) can change it; spreadsheet rows never", () => {
    expect(canEditEntry({ entered_by: "Bella", person: "Bella" }, "bella smith")).toBe(true);
    expect(canEditEntry({ entered_by: "Jeff", person: "Roy" }, "Roy")).toBe(true);
    expect(canEditEntry({ entered_by: "Jeff", person: "Roy" }, "June")).toBe(false);
    expect(canEditEntry({ entered_by: null, person: "Roy", source_key: "xlsx:24-11:31" }, "Roy")).toBe(false);
    expect(canEditEntry({ entered_by: "Roy" }, "")).toBe(false);
  });
});

// ---------------------------------------------------------------- missing hours
describe("missing-hours detection", () => {
  const base = { hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], from: "2026-11-30", to: "2026-12-06" };
  it("flags working days under the expected hours, through today", () => {
    const logged = new Map([["2026-11-30", 8], ["2026-12-01", 6.5]]);
    const r = missingDays({ ...base, today: "2026-12-03", nowTime: "10:00", logged });
    expect(r.map((d) => [d.day, d.short])).toEqual([["2026-12-01", 1.5], ["2026-12-02", 8]]); // today (Thu) not yet: before 4:30 PM
  });
  it("counts today once the reminder time has passed", () => {
    const r = missingDays({ ...base, today: "2026-12-03", nowTime: "16:30", remindTime: "16:30", logged: new Map() });
    expect(r.map((d) => d.day)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(r[3].isToday).toBe(true);
  });
  it("skips weekends, holidays, days off and days before tracking started", () => {
    const r = missingDays({ ...base, workDays: [1, 2, 3, 4], from: "2026-12-21", to: "2026-12-27", today: "2026-12-31", holidays: ["2026-12-24"], trackingStart: "2026-12-22", logged: new Map([["2026-12-22", 8]]) });
    expect(r.map((d) => d.day)).toEqual(["2026-12-23"]); // Mon before tracking, Tue logged, Thu holiday, Fri not a work day
  });
  it("part-timers: expected hours come from their own day length and days", () => {
    const r = missingDays({ hoursPerDay: 4, workDays: [2, 4], from: "2026-11-30", to: "2026-12-06", today: "2026-12-06", logged: new Map([["2026-12-01", 4], ["2026-12-03", 3]]) });
    expect(r).toEqual([{ day: "2026-12-03", expected: 4, logged: 3, short: 1, isToday: false }]);
    expect(expectedInWeek({ hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] }, "2026-12-23", ["2026-12-24", "2026-12-25"])).toBe(24);
  });
  it("nobody tracked → nothing missing", () => {
    expect(missingDays({ ...base, hoursPerDay: 0, today: "2026-12-06", logged: new Map() })).toEqual([]);
  });
});

// ---------------------------------------------------------------- capacity & duration
describe("capacity and duration estimation", () => {
  const roy: Person = { id: "roy", name: "Roy", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] };
  const bella: Person = { id: "bella", name: "Bella", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] };
  const pt: Person = { id: "pt", name: "Part", hoursPerDay: 6, workDays: [1, 3, 5] };

  it("capacity = hours/day × working days", () => {
    expect(weeklyCapacity(roy)).toBe(40);
    expect(weeklyCapacity(pt)).toBe(18);
  });

  it("counts working days and skips weekends", () => {
    expect(addWorkdays("2026-11-27", 0)).toBe("2026-11-27");
    expect(addWorkdays("2026-11-27", 1)).toBe("2026-11-30"); // Fri + 1 → Mon
    expect(addWorkdays("2026-11-28", 0)).toBe("2026-11-30"); // Sat → Mon
    expect(workdaysIn("2026-11-23", "2026-12-06")).toBe(10);
  });

  it("duration = remaining ÷ hours a week, in working days", () => {
    expect(estimateFinish(80, 20, "2026-11-30")).toEqual({ workdays: 20, weeks: 4, finish: "2026-12-25" });
    expect(estimateFinish(10, 40, "2026-11-30")).toEqual({ workdays: 2, weeks: 0.4, finish: "2026-12-01" });
    expect(estimateFinish(0, 0, "2026-11-30")?.finish).toBe("2026-11-30");
    expect(estimateFinish(10, 0, "2026-11-30")).toBeNull();
  });

  it("allocations: fixed hours, % of capacity, and auto = even share of what's left", () => {
    const as: PlanAssignment[] = [
      { id: "a1", projectId: "p1", phase: "CD", memberId: "roy", hoursPerWeek: 10 },
      { id: "a2", projectId: "p2", phase: "SD", memberId: "roy", allocationPct: 0.25 },
      { id: "a3", projectId: "p3", phase: "DD", memberId: "roy" },
      { id: "a4", projectId: "p4", phase: "DD", memberId: "roy" },
      { id: "a5", projectId: "p5", phase: "CA", memberId: "roy" },          // later phase, not running now
    ];
    const m = resolveAllocations(as, [roy], new Set(["a1", "a2", "a3", "a4"]));
    expect(m.get("a1")).toBe(10);
    expect(m.get("a2")).toBe(10);           // 25 % of 40
    expect(m.get("a3")).toBe(10);           // (40 − 20) ÷ 2
    expect(m.get("a4")).toBe(10);
    expect(m.get("a5")).toBe(10);           // a later phase gets the same auto share
  });

  it("over-booked fixed allocations leave auto ones nothing (and the workload shows it)", () => {
    const m = resolveAllocations([{ id: "x", projectId: "p", phase: "CD", memberId: "pt", hoursPerWeek: 20 }, { id: "y", projectId: "q", phase: "CD", memberId: "pt" }], [pt], new Set(["x", "y"]));
    expect(m.get("y")).toBe(0);
  });

  const projects: PlanProject[] = [
    { id: "p1", jobNumber: "26-01", name: "Clinic", status: "active" },
    { id: "p2", jobNumber: "26-02", name: "Office", status: "active" },
    { id: "p3", jobNumber: "26-03", name: "School", status: "active" },
    { id: "p4", jobNumber: "26-04", name: "Shop", status: "active" },
    { id: "p5", jobNumber: "26-05", name: "Hold", status: "on_hold" },
  ];
  const phases: PlanPhase[] = [
    { projectId: "p1", phase: "Schematic Design", sort: 2, assigned: 100, worked: 100, done: true },
    { projectId: "p1", phase: "Design Development", sort: 3, assigned: 120, worked: 40, targetDate: "2027-01-29" }, // 80 h left
    { projectId: "p1", phase: "Construction Documents", sort: 4, assigned: 200, worked: 0, targetDate: "2027-02-12" },
    { projectId: "p2", phase: "Construction Documents", sort: 4, assigned: 50, worked: 60 },                          // over
    { projectId: "p3", phase: "Schematic Design", sort: 2, assigned: 40, worked: 0, targetDate: "2027-03-01" },        // nobody on it
    { projectId: "p4", phase: "Design Development", sort: 3, assigned: 0, worked: 3, suggested: 43 },                 // allowance hours
    { projectId: "p5", phase: "Design Development", sort: 3, assigned: 10, worked: 0 },
  ];
  const assignments: PlanAssignment[] = [
    { id: "a1", projectId: "p1", phase: "Design Development", memberId: "roy", hoursPerWeek: 10 },
    { id: "a2", projectId: "p1", phase: "Design Development", memberId: "bella", hoursPerWeek: 10 },
    { id: "a3", projectId: "p1", phase: "Construction Documents", memberId: "roy", hoursPerWeek: 20 },
    { id: "a4", projectId: "p2", phase: "Construction Documents", memberId: "bella" },
    { id: "a5", projectId: "p4", phase: "Design Development", memberId: "bella", hoursPerWeek: 8 },
  ];
  const sched = buildSchedule({ projects, phases, assignments, people: [roy, bella] }, "2026-11-30");
  const get = (id: string) => sched.find((s) => s.project.id === id)!;

  it("estimates each phase in sequence and flags ones that can't make their target", () => {
    const p1 = get("p1");
    expect(p1.phases.map((p) => p.phase)).toEqual(["Design Development", "Construction Documents"]); // SD done
    const dd = p1.phases[0];
    expect(dd).toMatchObject({ remaining: 80, rate: 20, weeks: 4, start: "2026-11-30", estFinish: "2026-12-25", status: "on_track" });
    const cd = p1.phases[1];
    expect(cd.start).toBe("2026-12-28");                         // the working day after DD ends
    expect(cd).toMatchObject({ remaining: 200, rate: 20, estFinish: "2027-03-05", status: "at_risk" }); // 10 weeks; target Feb 12
    expect(cd.slipDays).toBe(21);
    expect(p1.status).toBe("at_risk");
  });

  it("over hours beats everything; no people on the running phase = needs plan; allowance hours are used when none assigned", () => {
    expect(get("p2").status).toBe("over_hours");
    expect(get("p3").status).toBe("needs_plan");
    expect(get("p4").phases[0]).toMatchObject({ remaining: 40, hoursSource: "allowance", rate: 8, estFinish: "2027-01-01", status: "no_target" });
    expect(get("p5").status).toBe("paused");
  });

  it("a planned start date moves the phase; a passed target with hours left is at risk", () => {
    const s = buildSchedule({ projects: [projects[0]], phases: [{ ...phases[1], startDate: "2027-01-04", targetDate: "2026-11-01" }], assignments: assignments.slice(0, 2), people: [roy, bella] }, "2026-11-30");
    expect(s[0].phases[0]).toMatchObject({ start: "2027-01-04", estFinish: "2027-01-29", status: "at_risk" });
  });

  it("workload: planned hours per week vs capacity, over/full/under", () => {
    const wk = workload(sched, bella, ["2026-11-30", "2027-01-04"]);
    // Bella: 10 h/wk on 26-01 DD + auto share on 26-02 (over hours → 0 h left, not planned) + 8 h/wk on 26-04
    expect(wk[0]).toMatchObject({ week: "2026-11-30", planned: 18, capacity: 40, state: "under" });
    expect(wk[0].items.map((i) => i.jobNumber)).toEqual(["26-01", "26-04"]);
    const roysWeek = workload(sched, roy, ["2026-11-30", "2027-01-04"]);
    expect(roysWeek[0].planned).toBe(10);
    expect(roysWeek[1].planned).toBe(20);                          // CD phase from Dec 28
    const busy = workload(buildSchedule({ projects, phases, assignments: [...assignments, { id: "z", projectId: "p3", phase: "Schematic Design", memberId: "roy", hoursPerWeek: 35 }], people: [roy, bella] }, "2026-11-30"), roy, ["2026-11-30"]);
    expect(busy[0]).toMatchObject({ planned: 45, state: "over" });
    expect(plannedOnDay(sched, roy, "2026-12-05")).toEqual([]);   // Saturday
    expect(plannedOnDay(sched, roy, "2026-12-01")).toEqual([{ projectId: "p1", jobNumber: "26-01", phase: "Design Development", hours: 2 }]);
  });

  it("seeds people from the Job List lead and team text", () => {
    const team = [{ id: "1", first_name: "Troy" }, { id: "2", first_name: "Brandon" }, { id: "3", first_name: "Jaden" }];
    expect(seedPeople("Troy", "Brandon, Jaden", team)).toEqual(["1", "2", "3"]);
    expect(seedPeople("troy", "Brandon & troy / Zoe", team)).toEqual(["1", "2"]);
    expect(seedPeople(null, null, team)).toEqual([]);
  });
});

// ---------------------------------------------------------------- calendar reminder
describe("'Log your hours' calendar reminder", () => {
  const m = { id: "m1", name: "June", work_days: [1, 2, 3, 4, 5], remind_enabled: true, remind_time: "16:30", remind_seq: 3, track_hours: true, hours_per_day: 8 };
  it("is one weekly repeating event at 4:30 PM Pacific with an alarm, skipping holidays", () => {
    const e = logHoursReminder(m, { baseUrl: "https://hub.example", startFrom: "2026-11-28", holidays: ["2026-11-26", "2026-12-25", "2026-12-26"] })!;
    const ics = unfold(buildCalendar([e], { name: "Frame Hub – June", feed: true, stamp: new Date(Date.UTC(2026, 10, 27)) }));
    expect(ics).toContain("UID:log-hours-m1@frame-hub");
    expect(ics).toContain("SEQUENCE:3");
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261130T163000"); // first working day on/after the start (Sat → Mon)
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261130T164500");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(ics).toContain("EXDATE;TZID=America/Los_Angeles:20261225T163000"); // Saturday Dec 26 and past Nov 26 aren't listed
    expect(ics).not.toContain("20261226T163000");
    expect(ics).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Log your hours — Frame Hub\r\nTRIGGER:PT0M/);
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"); // DST rules, so it stays at 4:30 PM all year
    expect(ics).toContain("URL:https://hub.example/timesheet");
    expect(ics.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(ics.indexOf("BEGIN:VEVENT"));
  });
  it("follows the person's own days and time; off or not tracked → no event", () => {
    const e = logHoursReminder({ ...m, work_days: [2, 4], remind_time: "09:05" }, { baseUrl: "x", startFrom: "2026-11-30" })!;
    expect(e.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(e.start).toEqual({ local: { day: "2026-12-01", time: "09:05" }, tz: "America/Los_Angeles" });
    expect(logHoursReminder({ ...m, remind_enabled: false }, { baseUrl: "x", startFrom: "2026-11-30" })).toBeNull();
    expect(logHoursReminder({ ...m, track_hours: false }, { baseUrl: "x", startFrom: "2026-11-30" })).toBeNull();
    expect(logHoursReminder({ ...m, remind_time: "4:30pm" }, { baseUrl: "x", startFrom: "2026-11-30" })).toBeNull();
  });
  it("task-only calendars are unchanged (no VTIMEZONE when nothing repeats)", () => {
    expect(buildCalendar([{ uid: "t", sequence: 0, title: "x", start: { day: "2026-12-01" } }], { name: "n" })).not.toContain("VTIMEZONE");
  });
});

// ---------------------------------------------------------------- on the database
describe("hours and schedule on the database", () => {
  let db: Db;
  let pid: string;
  let june: { id: string }, roy: { id: string };
  beforeAll(async () => {
    db = await testDb();
    const [p] = await db.query<{ id: string }>(`insert into projects (job_number, name, arch_fee, lead, team, current_phase) values ('26-90', 'Test clinic', 100000, 'June', 'Roy', 'Schematic Design') returning id`);
    pid = p.id;
    const phases = ["Pre Design", "Schematic Design", "Design Development"];
    for (const [i, ph] of phases.entries()) await db.query(`insert into project_phases (project_id, phase, sort, fee_pct, hours_assigned, target_date, status) values ($1,$2,$3,0.1,$4,$5,$6)`, [pid, ph, i + 1, ph === "Schematic Design" ? 40 : null, ph === "Schematic Design" ? "2027-06-30" : null, ph === "Schematic Design" ? "active" : "not_started"]);
    await db.query(`insert into time_entries (project_id, phase, week_label, week_ending, person, hours, source_key) values ($1, 'Schematic Design', 'Thru 11/13/26', '2026-11-13', 'June', 6, 'xlsx:26-90:31')`, [pid]);
    const team = await listTeam(db);
    june = team.find((m) => m.first_name === "June")!;
    roy = team.find((m) => m.first_name === "Roy")!;
  });

  it("logging hours stamps the week's Friday and updates worked / remaining at once", async () => {
    const id = await logHours(db, { project_id: pid, phase: "Schematic Design", member_id: june.id, work_date: "2026-11-24", hours: 2.5, notes: "Plan options" }, "June");
    const [e] = await db.query<{ week_ending: string; week_label: string; person: string; entered_by: string }>(`select week_ending::text, week_label, person, entered_by from time_entries where id = $1`, [id]);
    expect(e).toEqual({ week_ending: "2026-11-27", week_label: "Thru 11/27/26", person: "June", entered_by: "June" });
    const p = (await getProject(db, pid))!;
    expect(p.cost.current).toMatchObject({ hoursCompleted: 8.5, hoursRemaining: 31.5 }); // 6 imported + 2.5 logged
  });

  it("rejects bad hours, other people's edits, spreadsheet rows and more than 24 h a day", async () => {
    await expect(logHours(db, { project_id: pid, phase: "Schematic Design", member_id: june.id, work_date: "2026-11-24", hours: 0.3 }, "June")).rejects.toThrow(/quarter/);
    await expect(logHours(db, { project_id: pid, phase: "Nope", member_id: june.id, work_date: "2026-11-24", hours: 1 }, "June")).rejects.toThrow(/phases/);
    await expect(logHours(db, { project_id: pid, phase: "Schematic Design", member_id: june.id, work_date: "2026-11-24", hours: 22 }, "June")).rejects.toThrow(/24/);
    const id = await logHours(db, { project_id: pid, phase: "Pre Design", member_id: june.id, work_date: "2026-11-25", hours: 1 }, "June");
    await expect(updateEntry(db, id, { hours: 2 }, "Roy")).rejects.toThrow(/Only the person/);
    await expect(deleteEntry(db, id, "Roy")).rejects.toThrow(/Only the person/);
    await updateEntry(db, id, { hours: 1.25, notes: "Site visit" }, "June");
    expect(Number((await db.query<{ hours: number }>(`select hours from time_entries where id = $1`, [id]))[0].hours)).toBe(1.25);
    const [sheet] = await db.query<{ id: string }>(`select id from time_entries where source_key is not null and project_id = $1`, [pid]);
    await expect(deleteEntry(db, sheet.id, "June")).rejects.toThrow(/spreadsheet/);
    await deleteEntry(db, id, "June");
    expect(await db.query(`select 1 from time_entries where id = $1`, [id])).toHaveLength(0);
  });

  it("timesheet cells set the person's total for that job/phase/day", async () => {
    await setCell(db, { member_id: roy.id, project_id: pid, phase: "Schematic Design", work_date: "2026-11-23", hours: 3 }, "Roy");
    await setCell(db, { member_id: roy.id, project_id: pid, phase: "Schematic Design", work_date: "2026-11-23", hours: 4.5 }, "Roy");
    let rows = await memberEntries(db, roy.id, "2026-11-23", "2026-11-29");
    expect(rows.map((r) => Number(r.hours))).toEqual([4.5]);
    await setCell(db, { member_id: roy.id, project_id: pid, phase: "Schematic Design", work_date: "2026-11-23", hours: 0 }, "Roy");
    rows = await memberEntries(db, roy.id, "2026-11-23", "2026-11-29");
    expect(rows).toHaveLength(0);
  });

  it("missing-hours report: who is short on which days (after tracking start, through today after reminder time)", async () => {
    await setSetting(db, "hoursTrackingStart", "2026-11-23");
    await setSetting(db, "firmHolidays", ["2026-11-26", "2026-11-27"]);
    await logHours(db, { project_id: pid, phase: "Schematic Design", member_id: roy.id, work_date: "2026-11-23", hours: 8 }, "Roy");
    await logHours(db, { project_id: pid, phase: "Schematic Design", member_id: roy.id, work_date: "2026-11-24", hours: 8 }, "Roy");
    const now = new Date(Date.UTC(2026, 10, 26, 1, 0)); // Wed Nov 25, 5:00 PM Pacific
    const r = await missingHoursReport(db, { now });
    const byName = new Map(r.map((x) => [x.member.first_name, x]));
    expect(byName.get("Roy")!.missing.map((d) => d.day)).toEqual(["2026-11-25"]);
    expect(byName.get("June")!.missing.map((d) => [d.day, d.short])).toEqual([["2026-11-23", 8], ["2026-11-24", 5.5], ["2026-11-25", 8]]);
    await saveMemberHours(db, june.id, { hours_per_day: 8, work_days: [1, 2, 3, 4, 5], track_hours: false });
    expect((await missingHoursReport(db, { now })).some((x) => x.member.id === june.id)).toBe(false);
    await saveMemberHours(db, june.id, { hours_per_day: 8, work_days: [1, 2, 3, 4, 5], track_hours: true });
  });

  it("the calendar feed carries the reminder; turning it off removes it and changes bump SEQUENCE", async () => {
    const token = await rotateFeedToken(db, june.id);
    let body = unfold((await renderFeed(db, `${token}.ics`, "https://hub.example")).body);
    expect(body).toContain(`UID:log-hours-${june.id}@frame-hub`);
    expect(body).toContain("DTSTART;TZID=America/Los_Angeles:20261123T163000");
    const seq = Number(body.match(new RegExp(`UID:log-hours-${june.id}@frame-hub\\r\\nDTSTAMP:[^\\r]+\\r\\nSEQUENCE:(\\d+)`))![1]);
    await setReminder(db, june.id, { enabled: true, time: "17:15" });
    body = unfold((await renderFeed(db, `${token}.ics`, "https://hub.example")).body);
    expect(body).toContain("DTSTART;TZID=America/Los_Angeles:20261123T171500");
    expect(body).toContain(`SEQUENCE:${seq + 1}`);
    await setReminder(db, june.id, { enabled: false });
    body = (await renderFeed(db, `${token}.ics`, "https://hub.example")).body;
    expect(body).not.toContain("log-hours-");
    await expect(setReminder(db, june.id, { enabled: true, time: "25:00" })).rejects.toThrow(/time/);
  });

  it("seeds a plan from the Job List once, then the schedule estimates from it", async () => {
    const r = await seedSchedule(db);
    expect(r.seeded).toBe(1);
    expect((await seedSchedule(db)).skipped).toBe(true);
    const people = await db.query<{ first_name: string }>(`select m.first_name from project_assignments a join team_members m on m.id = a.member_id where a.project_id = $1 order by m.first_name`, [pid]);
    expect(people.map((p) => p.first_name)).toEqual(["June", "Roy"]);
    await saveAssignment(db, { project_id: pid, phase: "Schematic Design", member_id: roy.id, hours_per_week: 10 }, "Jeff");
    await saveAssignment(db, { project_id: pid, phase: "Schematic Design", member_id: june.id, allocation_pct: 0.25 }, "Jeff");
    const { schedule } = await loadSchedule(db, "2026-11-30");
    const sd = schedule.find((s) => s.project.id === pid)!.phases.find((p) => p.phase === "Schematic Design")!;
    // 40 assigned − (6 + 2.5 + 16) worked = 15.5 h left at 20 h/wk → 4 working days
    expect(sd).toMatchObject({ remaining: 15.5, rate: 20, estFinish: "2026-12-03", status: "on_track" });
    await setPhaseDates(db, pid, "Schematic Design", { target_date: "2026-12-01" }, "Jeff");
    const again = await loadSchedule(db, "2026-11-30");
    expect(again.schedule.find((s) => s.project.id === pid)!.status).toBe("at_risk");
    await expect(setPhaseDates(db, pid, "Schematic Design", { start_date: "2026-12-05" }, "Jeff")).rejects.toThrow(/before the start/);
  });
});

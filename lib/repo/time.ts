/** Hour logging: daily entries (project card + timesheet), own-entry edits, and the missing-hours report. */
import type { Db } from "../db/types";
import { one } from "../db/types";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { listTeam, type TeamMember } from "./team";
import { matchMember } from "../crm/logic";
import { canEditEntry, dayTotalError, hoursError, missingDays, weekEnding, weekLabel, weekStart, type MissingDay } from "../calc/hours";
import { addDays, round2, todayISO } from "../calc/util";
import { utcToZoned } from "../calc/time";

export interface EntryRow {
  id: string; project_id: string; phase: string; person: string | null; member_id: string | null; hours: number;
  work_date: string | null; week_ending: string | null; week_label: string | null; notes: string | null;
  entered_by: string | null; source_key: string | null; created_at: Date; updated_at: Date;
  job_number?: string; project_name?: string;
}
const SEL = `select e.id, e.project_id, e.phase, e.person, e.member_id, e.hours, e.work_date, e.week_ending, e.week_label, e.notes, e.entered_by, e.source_key, e.created_at, e.updated_at, p.job_number, p.name as project_name
  from time_entries e join projects p on p.id = e.project_id`;

export interface LogInput { project_id: string; phase: string; member_id: string; work_date: string; hours: number; notes?: string | null }

async function check(db: Db, i: LogInput, replacingId?: string) {
  const err = hoursError(i.hours);
  if (err) throw new Error(err);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.work_date)) throw new Error("Pick the day you worked.");
  if (i.work_date > addDays(todayISO(), 14)) throw new Error("That day is more than two weeks ahead.");
  const p = await one<{ status: string; job_number: string }>(db, `select status, job_number from projects where id = $1`, [i.project_id]);
  if (!p) throw new Error("Project not found.");
  if (p.status === "archived") throw new Error(`Job ${p.job_number} is archived — reopen it to log hours.`);
  const ph = await one<{ phase: string }>(db, `select phase from project_phases where project_id = $1 and phase = $2`, [i.project_id, i.phase]);
  if (!ph) throw new Error("Pick one of this job’s phases.");
  const m = await one<TeamMember>(db, `select id, first_name, active from team_members where id = $1`, [i.member_id]);
  if (!m) throw new Error("Pick who worked.");
  const [{ total, mine }] = await db.query<{ total: number; mine: number }>(
    `select coalesce(sum(hours),0)::float8 total, coalesce(sum(hours) filter (where id = $3),0)::float8 mine from time_entries where member_id = $1 and work_date = $2`,
    [i.member_id, i.work_date, replacingId ?? null]);
  const dayErr = dayTotalError(Number(total), i.hours, Number(mine));
  if (dayErr) throw new Error(dayErr);
  return { member: m, job: p.job_number };
}

/** Log hours for one person on one day. Stamped with the week's Friday + "Thru" label like the spreadsheet log. */
export async function logHours(db: Db, i: LogInput, actor: string): Promise<string> {
  return db.tx(async (t) => {
    const { member } = await check(t, i);
    const [row] = await t.query<{ id: string }>(
      `insert into time_entries (project_id, phase, person, member_id, hours, work_date, week_ending, week_label, notes, entered_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [i.project_id, i.phase, member.first_name, member.id, i.hours, i.work_date, weekEnding(i.work_date), weekLabel(i.work_date), i.notes?.trim() || null, actor.trim().split(/\s+/)[0] || actor]);
    await audit(t, { actor, entity: "project", id: i.project_id, action: "hours", summary: `${i.hours} h on ${i.work_date} to ${i.phase} by ${member.first_name}${i.notes ? ` — ${i.notes.trim().slice(0, 80)}` : ""}` });
    return row.id;
  });
}

export const getEntry = (db: Db, id: string) => one<EntryRow>(db, `${SEL} where e.id = $1`, [id]);

export async function updateEntry(db: Db, id: string, patch: Partial<LogInput>, actor: string) {
  return db.tx(async (t) => {
    const e = await getEntry(t, id);
    if (!e) throw new Error("That entry is gone.");
    if (!canEditEntry(e, actor)) throw new Error(e.source_key ? "Entries from the Job List spreadsheet can’t be changed here." : "Only the person who logged it can change it.");
    const next: LogInput = { project_id: e.project_id, phase: patch.phase ?? e.phase, member_id: patch.member_id ?? e.member_id ?? "", work_date: patch.work_date ?? e.work_date ?? "", hours: patch.hours ?? Number(e.hours), notes: patch.notes !== undefined ? patch.notes : e.notes };
    const { member } = await check(t, next, id);
    await t.query(`update time_entries set phase = $2, member_id = $3, person = $4, hours = $5, work_date = $6, week_ending = $7, week_label = $8, notes = $9 where id = $1`,
      [id, next.phase, member.id, member.first_name, next.hours, next.work_date, weekEnding(next.work_date), weekLabel(next.work_date), next.notes?.trim() || null]);
    await audit(t, { actor, entity: "project", id: e.project_id, action: "hours", summary: `Hours entry changed: ${e.hours} h ${e.work_date} → ${next.hours} h ${next.work_date} (${next.phase})` });
  });
}

export async function deleteEntry(db: Db, id: string, actor: string) {
  return db.tx(async (t) => {
    const e = await getEntry(t, id);
    if (!e) return;
    if (!canEditEntry(e, actor)) throw new Error(e.source_key ? "Entries from the Job List spreadsheet can’t be deleted here." : "Only the person who logged it can delete it.");
    await t.query(`delete from time_entries where id = $1`, [id]);
    await audit(t, { actor, entity: "project", id: e.project_id, action: "hours", summary: `Hours entry deleted: ${e.hours} h ${e.work_date ?? e.week_label ?? ""} (${e.phase})` });
  });
}

export const projectEntries = (db: Db, projectId: string, limit = 60) =>
  db.query<EntryRow>(`${SEL} where e.project_id = $1 order by coalesce(e.work_date, e.week_ending) desc nulls last, e.created_at desc limit $2`, [projectId, limit]);

export const memberEntries = (db: Db, memberId: string, from: string, to: string) =>
  db.query<EntryRow>(`${SEL} where e.member_id = $1 and e.work_date between $2 and $3 order by e.work_date, p.job_number, e.created_at`, [memberId, from, to]);

/**
 * Timesheet grid cell: make `member`'s hours on project/phase/day equal `hours`.
 * Their own app entries in that cell are replaced by one entry (keeping the first note); entries others typed stay.
 */
export async function setCell(db: Db, c: { member_id: string; project_id: string; phase: string; work_date: string; hours: number; notes?: string | null }, actor: string) {
  return db.tx(async (t) => {
    const cell = await t.query<EntryRow>(`${SEL} where e.member_id = $1 and e.project_id = $2 and e.phase = $3 and e.work_date = $4 order by e.created_at`, [c.member_id, c.project_id, c.phase, c.work_date]);
    const mine = cell.filter((e) => canEditEntry(e, actor));
    const others = round2(cell.filter((e) => !canEditEntry(e, actor)).reduce((s, e) => s + Number(e.hours), 0));
    const want = round2(c.hours - others);
    if (want < 0) throw new Error(`Someone else logged ${others} h here; you can’t go below that.`);
    const have = round2(mine.reduce((s, e) => s + Number(e.hours), 0));
    if (want === have && c.notes === undefined) return;
    const note = c.notes !== undefined ? c.notes : mine.find((e) => e.notes)?.notes ?? null;
    if (want > 0) {
      const err = hoursError(want); if (err) throw new Error(err);
      const [{ total }] = await t.query<{ total: number }>(`select coalesce(sum(hours),0)::float8 total from time_entries where member_id = $1 and work_date = $2`, [c.member_id, c.work_date]);
      const dayErr = dayTotalError(Number(total), want, have); if (dayErr) throw new Error(dayErr);
    }
    for (const e of mine) await t.query(`delete from time_entries where id = $1`, [e.id]);
    if (want > 0) {
      const m = await one<{ first_name: string }>(t, `select first_name from team_members where id = $1`, [c.member_id]);
      await t.query(`insert into time_entries (project_id, phase, person, member_id, hours, work_date, week_ending, week_label, notes, entered_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [c.project_id, c.phase, m?.first_name ?? null, c.member_id, want, c.work_date, weekEnding(c.work_date), weekLabel(c.work_date), note?.trim() || null, actor.trim().split(/\s+/)[0] || actor]);
    }
    await audit(t, { actor, entity: "project", id: c.project_id, action: "hours", summary: `Timesheet: ${c.phase} ${c.work_date} ${have} → ${want} h` });
  });
}

/** Hours per member per day in [from, to] (app entries with a day). */
export async function loggedByMemberDay(db: Db, from: string, to: string) {
  const rows = await db.query<{ member_id: string; work_date: string; h: number }>(
    `select member_id, work_date, sum(hours)::float8 h from time_entries where member_id is not null and work_date between $1 and $2 group by 1, 2`, [from, to]);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) { if (!out.has(r.member_id)) out.set(r.member_id, new Map()); out.get(r.member_id)!.set(r.work_date, Number(r.h)); }
  return out;
}

export interface MissingRow { member: TeamMember & { hours_per_day: number; work_days: number[]; remind_time: string; track_hours: boolean }; logged: Map<string, number>; missing: MissingDay[]; shortHours: number }

/** Who hasn't logged their expected hours on which days, for the week containing `day` (default: this week through today). */
export async function missingHoursReport(db: Db, o: { now?: Date; from?: string; to?: string; memberId?: string } = {}): Promise<MissingRow[]> {
  const now = o.now ?? new Date();
  const z = utcToZoned(now);
  const from = o.from ?? weekStart(z.day), to = o.to ?? addDays(from, 6);
  const [team, settings] = await Promise.all([listTeam(db) as Promise<MissingRow["member"][]>, getSettings(db)]);
  const logged = await loggedByMemberDay(db, from, to);
  return team.filter((m) => m.track_hours && (!o.memberId || m.id === o.memberId)).map((m) => {
    const l = logged.get(m.id) ?? new Map<string, number>();
    const missing = missingDays({ hoursPerDay: Number(m.hours_per_day), workDays: m.work_days, from, to, today: z.day, nowTime: z.time, remindTime: m.remind_time, trackingStart: settings.hoursTrackingStart, holidays: settings.firmHolidays, logged: l });
    return { member: m, logged: l, missing, shortHours: round2(missing.reduce((s, d) => s + d.short, 0)) };
  });
}

/** The signed-in person's missing days this week (for the banner and the nav badge). Null when they aren't on the team. */
export async function myMissing(db: Db, signedInName: string | null | undefined, now = new Date()) {
  const team = await listTeam(db);
  const me = matchMember(team, signedInName);
  if (!me) return null;
  const [r] = await missingHoursReport(db, { now, memberId: me.id });
  return r ? { memberId: me.id, name: me.name, missing: r.missing, shortHours: r.shortHours } : { memberId: me.id, name: me.name, missing: [], shortHours: 0 };
}

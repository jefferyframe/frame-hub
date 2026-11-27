import type { Db } from "../db/types";
import { one } from "../db/types";
import { matchMember } from "../crm/logic";
import { hashToken, newFeedToken, openToken, sealToken } from "../calendar/token";

export interface TeamMember {
  id: string; name: string; first_name: string; email: string | null; role: string; active: boolean; sort: number;
  cal_token_created_at: Date | null; cal_include_unassigned: boolean; has_feed?: boolean;
  hours_per_day: number; work_days: number[]; track_hours: boolean; remind_enabled: boolean; remind_time: string; remind_seq: number; updated_at?: Date;
}
const COLS = `id, name, first_name, email, role, active, sort, cal_token_created_at, cal_include_unassigned, (cal_token_hash is not null) as has_feed,
  hours_per_day::float8 as hours_per_day, work_days, track_hours, remind_enabled, remind_time, remind_seq, updated_at`;

export const listTeam = (db: Db, opts: { all?: boolean } = {}) =>
  db.query<TeamMember>(`select ${COLS} from team_members ${opts.all ? "" : "where active"} order by sort, lower(name)`);

export const getMember = (db: Db, id: string) => one<TeamMember>(db, `select ${COLS} from team_members where id = $1`, [id]);

/** The team member for a signed-in first name, if any. */
export async function memberForUser(db: Db, signedInName: string | null | undefined) {
  return matchMember(await listTeam(db), signedInName);
}

export async function saveMember(db: Db, m: { id?: string | null; name: string; email?: string | null; role?: string | null; active?: boolean }) {
  const name = m.name.trim();
  if (!name) throw new Error("Name is required.");
  const first = name.split(/\s+/)[0];
  const dup = await one<{ id: string }>(db, `select id from team_members where lower(first_name) = lower($1) and id is distinct from $2`, [first, m.id ?? null]);
  if (dup) throw new Error(`There's already a team member called ${first}. First names sign people in, so they need to be different (use "${first} B." in the name and a different first word, or edit the existing one).`);
  if (m.id) {
    const [r] = await db.query<TeamMember>(`update team_members set name = $2, first_name = $3, email = $4, role = coalesce($5, role), active = coalesce($6, active) where id = $1 returning ${COLS}`,
      [m.id, name, first, m.email ?? null, m.role ?? null, m.active ?? null]);
    return r;
  }
  const [r] = await db.query<TeamMember>(`insert into team_members (name, first_name, email, role, sort) values ($1,$2,$3,coalesce($4,'Staff'), (select coalesce(max(sort),0)+1 from team_members)) returning ${COLS}`,
    [name, first, m.email ?? null, m.role ?? null]);
  return r;
}

/** New calendar link for a member; any earlier link stops working at once. Returns the token (show it, don't log it). */
export async function rotateFeedToken(db: Db, memberId: string): Promise<string> {
  const token = newFeedToken();
  await db.query(`update team_members set cal_token_hash = $2, cal_token_enc = $3, cal_token_created_at = now() where id = $1`, [memberId, hashToken(token), sealToken(token)]);
  return token;
}

export async function revokeFeedToken(db: Db, memberId: string) {
  await db.query(`update team_members set cal_token_hash = null, cal_token_enc = null, cal_token_created_at = null where id = $1`, [memberId]);
}

/** The member's current token, for showing their link again (null if none or it can't be opened). */
export async function currentFeedToken(db: Db, memberId: string): Promise<string | null> {
  const r = await one<{ cal_token_enc: string | null }>(db, `select cal_token_enc from team_members where id = $1 and cal_token_hash is not null`, [memberId]);
  return openToken(r?.cal_token_enc);
}

/** Who a presented token belongs to (active members only). Lookup by hash; nothing else is compared. */
export async function memberByToken(db: Db, token: string) {
  return one<TeamMember>(db, `select ${COLS} from team_members where cal_token_hash = $1 and active`, [hashToken(token)]);
}

/** Expected hours and working days for one person (Settings → Team hours). */
export async function saveMemberHours(db: Db, id: string, h: { hours_per_day: number; work_days: number[]; track_hours: boolean }) {
  if (!(h.hours_per_day >= 0 && h.hours_per_day <= 24)) throw new Error("Hours per day must be between 0 and 24.");
  const days = [...new Set(h.work_days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  await db.query(`update team_members set hours_per_day = $2, work_days = $3::int[], track_hours = $4,
      remind_seq = remind_seq + case when work_days is distinct from $3::int[] then 1 else 0 end where id = $1`, [id, h.hours_per_day, `{${days.join(",")}}`, h.track_hours]);
}

/** The "Log your hours" calendar reminder: on/off and time (HH:MM Pacific). Bumps SEQUENCE so calendars update it. */
export async function setReminder(db: Db, id: string, r: { enabled: boolean; time?: string | null }) {
  const time = r.time ?? null;
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Pick a time like 16:30.");
  await db.query(`update team_members set remind_enabled = $2, remind_time = coalesce($3, remind_time), remind_seq = remind_seq + 1 where id = $1`, [id, r.enabled, time]);
}

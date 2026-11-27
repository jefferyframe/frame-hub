/** Writes parsed spreadsheet / CSV records into the database. Every write is keyed (source_key,
 *  job number, day, legacy id) so running the import again updates rather than duplicates. */
import type { Db } from "../db/types";
import { one } from "../db/types";
import { audit } from "../repo/audit";
import { ensureCompany, addTask } from "../repo/crm";
import { createProposal } from "../repo/proposals";
import { pastClientCadence, prospectCadence } from "../calc/cadence";
import { PHASES, PHASE_NAMES } from "../calc/jobCost";
import { todayISO } from "../calc/util";
import type { PipelineRecord, LeadRecord, LagRecord, PastClientRecord, ProspectRecord, OutreachRecord } from "./sales";
import type { JobListRow, JobSheet } from "./jobs";
import type { PrecedentRecord, LegacyQuote } from "./legacy";
import { note, type SectionReport } from "./report";

const ACTOR = "import";

async function upsert(db: Db, table: string, key: { col: string; val: unknown }, data: Record<string, unknown>): Promise<{ id: string; inserted: boolean }> {
  const cols = Object.keys(data);
  const existing = await one<{ id: string }>(db, `select id from ${table} where ${key.col} = $1`, [key.val]);
  if (existing) {
    if (cols.length) await db.query(`update ${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [existing.id, ...cols.map((c) => data[c])]);
    return { id: existing.id, inserted: false };
  }
  const all = [key.col, ...cols];
  const [row] = await db.query<{ id: string }>(`insert into ${table} (${all.join(",")}) values (${all.map((_, i) => `$${i + 1}`).join(",")}) returning id`, [key.val, ...cols.map((c) => data[c])]);
  return { id: row.id, inserted: true };
}
const count = (r: SectionReport, inserted: boolean) => (inserted ? r.imported++ : r.updated++);

export async function loadPipeline(db: Db, rows: PipelineRecord[], r: SectionReport) {
  for (const p of rows) {
    const { source_key, row, ...data } = p;
    void row;
    const res = await upsert(db, "opportunities", { col: "source_key", val: source_key }, data);
    count(r, res.inserted);
    if (res.inserted) await audit(db, { actor: ACTOR, entity: "opportunity", id: res.id, action: "import", summary: `Imported from Pipeline Tracking row ${p.row}` });
  }
}

export async function loadLeadMeasures(db: Db, rows: LeadRecord[], r: SectionReport) {
  for (const l of rows) {
    const existed = await one(db, `select 1 from lead_measures where day = $1`, [l.day]);
    await db.query(
      `insert into lead_measures (day, connection_requests, responses, conversations, opportunities, proposals, yes, no) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (day) do update set connection_requests = excluded.connection_requests, responses = excluded.responses, conversations = excluded.conversations,
         opportunities = excluded.opportunities, proposals = excluded.proposals, yes = excluded.yes, no = excluded.no, updated_at = now()`,
      [l.day, l.connection_requests, l.responses, l.conversations, l.opportunities, l.proposals, l.yes, l.no]);
    count(r, !existed);
  }
}

export async function loadLag(db: Db, rows: LagRecord[], r: SectionReport) {
  for (const l of rows) {
    const { source_key, ...data } = l;
    count(r, (await upsert(db, "lag_measures", { col: "source_key", val: source_key }, data)).inserted);
  }
}

async function loadPerson(db: Db, p: PastClientRecord | ProspectRecord, kind: string, extra: Record<string, unknown>) {
  const company = p.company ? await ensureCompany(db, p.company, kind) : null;
  return upsert(db, "contacts", { col: "source_key", val: p.source_key }, {
    email: p.email, first_name: p.first_name, last_name: p.last_name, address: p.address, phone: p.phone, birthday: p.birthday,
    title: p.title, company_id: company?.id ?? null, ...extra,
  });
}

export async function loadPastClients(db: Db, rows: PastClientRecord[], r: SectionReport, today = todayISO()) {
  for (const p of rows) {
    const since = p.date_added ?? today;
    const res = await loadPerson(db, p, "client", { is_past_client: true, past_client_since: since });
    count(r, res.inserted);
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "past client";
    const cadence = pastClientCadence(since, name);
    for (const t of cadence) {
      const f = p.followUps.find((x) => x.cadence === t.cadence);
      const due = f?.date ?? t.due;
      const id = await addTask(db, { title: t.title, due_on: due, cadence: t.cadence, contact_id: res.id, notes: f?.text ?? null, source_key: `${p.source_key}:${t.cadence}` });
      // A note typed in the follow-up column ("Sent email … 9/24/25") means it was done.
      if (id && f?.text && !/^need to/i.test(f.text)) await db.query(`update tasks set done_at = now() where id = $1`, [id]);
    }
  }
}

const yes = (v: string | null) => !!v && /^y/i.test(v);

export async function loadProspects(db: Db, rows: ProspectRecord[], r: SectionReport) {
  for (const p of rows) {
    const res = await loadPerson(db, p, "prospect", { met_on: p.met_on, linkedin_connected: p.linkedin, card_sent: p.card_sent, notes: p.notes });
    count(r, res.inserted);
    if (!p.met_on) continue;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const tasks = prospectCadence(p.met_on, name, { linkedinDone: yes(p.linkedin) || /doesn/i.test(p.linkedin ?? ""), cardDone: yes(p.card_sent), emailDone: yes(p.email_sent) });
    for (const t of tasks) await addTask(db, { title: t.title, due_on: t.cadence === "prospect_email_1m" ? p.email_due ?? t.due : t.due, cadence: t.cadence, contact_id: res.id, source_key: `${p.source_key}:${t.cadence}` });
  }
}

export async function loadOutreach(db: Db, rows: OutreachRecord[], r: SectionReport) {
  for (const o of rows) {
    const companyKind = o.kind === "cre_firm" ? "cre_firm" : o.kind === "biz_dev" ? null : "prospect";
    const company = companyKind ? await ensureCompany(db, o.label, companyKind, { phone: o.phone, address: o.address }) : null;
    const { source_key, contact, email, ...data } = o;
    void contact; void email;
    count(r, (await upsert(db, "outreach", { col: "source_key", val: source_key }, { ...data, company_id: company?.id ?? null })).inserted);
  }
}

/** Job List row + job-cost sheet → project, phases, consultants, hours (hours replaced wholesale). */
export async function loadJobs(db: Db, list: JobListRow[], sheets: JobSheet[], r: SectionReport) {
  const byJob = new Map(sheets.map((s) => [s.job_number, s]));
  const jobs = new Set([...list.map((l) => l.job_number), ...sheets.map((s) => s.job_number)]);
  for (const job of [...jobs].sort()) {
    const l = list.find((x) => x.job_number === job);
    const s = byJob.get(job);
    const listPhase = l?.phase ?? null;
    const status = listPhase === "Project Complete" ? "closeout" : listPhase === "Phase Complete" ? "phase_complete" : "active";
    const current = listPhase && PHASE_NAMES.includes(listPhase as never) ? listPhase : null;
    if (listPhase && !current && status === "active") note(r, `${job}: Job List phase “${listPhase}” isn't a template phase.`);
    const res = await upsert(db, "projects", { col: "job_number", val: job }, {
      name: l?.name ?? s?.name ?? job, lead: l?.lead ?? s?.lead ?? null, team: l?.team ?? s?.team ?? null,
      contract_date: l?.contract_date ?? s?.contract_date ?? null, current_phase: current, status,
      client_text: s?.client ?? null, client_contact: s?.client_contact ?? null, client_contact_2: s?.client_contact_2 ?? null,
      contractor: s?.contractor ?? null, contractor_contact: s?.contractor_contact ?? null,
      arch_fee: s?.arch_fee ?? null, profit_pct: s?.profit_pct ?? 0.85, burden_rate: s?.burden_rate ?? 180,
      billing_notes: l?.notes ?? null, notes: l?.additional_notes ?? null, source_key: `jobs:${job}`,
    });
    count(r, res.inserted);
    if (res.inserted) await audit(db, { actor: ACTOR, entity: "project", id: res.id, action: "import", summary: `Imported from the Job List${s ? ` and sheet “${s.sheet}”` : ""}` });
    const currentIdx = current ? PHASE_NAMES.indexOf(current as never) : -1;
    for (const [i, def] of PHASES.entries()) {
      const ph = s?.phases.find((p) => p.phase === def.key);
      const hoursAssigned = ph?.hours_assigned ?? (def.key === current ? l?.hours_assigned ?? null : null);
      const target = ph?.target_date ?? (def.key === current ? l?.target_date ?? null : null);
      const logged = s?.entries.some((e) => e.phase === def.key && e.hours) ?? false;
      const phStatus = def.key === current ? "active" : currentIdx >= 0 && i < currentIdx && (logged || (hoursAssigned ?? 0) > 0) ? "complete" : "not_started";
      await db.query(
        `insert into project_phases (project_id, phase, sort, fee_pct, hours_pct, hours_assigned, target_date, status) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (project_id, phase) do update set fee_pct = excluded.fee_pct, hours_pct = excluded.hours_pct, hours_assigned = excluded.hours_assigned,
           target_date = excluded.target_date, status = excluded.status`,
        [res.id, def.key, i, ph?.fee_pct ?? null, ph?.hours_pct ?? def.hoursPct, hoursAssigned, target, phStatus]);
    }
    if (s) {
      await db.query(`delete from project_consultants where project_id = $1`, [res.id]);
      for (const c of s.consultants)
        await db.query(
          `insert into project_consultants (project_id, discipline, firm, phase, fee, status) values ($1,$2,$3,$4,$5,$6)
           on conflict (project_id, discipline, phase) do update set fee = excluded.fee, status = excluded.status, firm = excluded.firm`,
          [res.id, c.discipline, c.firm, c.phase, c.fee, c.status]);
      await db.query(`delete from time_entries where project_id = $1 and source_key like 'xlsx:%'`, [res.id]);
      for (const e of s.entries)
        await db.query(`insert into time_entries (project_id, phase, week_label, week_ending, person, hours, notes, source_key) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [res.id, e.phase, e.week_label, e.week_ending, e.person, e.hours, e.notes, `xlsx:${job}:${e.phase}:${e.row}`]);
    }
  }
}

/** Pipeline rows that carry a job number matching a project become that project's opportunity. */
export async function linkPipelineToProjects(db: Db, r: SectionReport) {
  const rows = await db.query<{ pid: string; oid: string; job: string }>(
    `select p.id as pid, o.id as oid, p.job_number as job from projects p
     join lateral (select id from opportunities o where o.job_number = p.job_number order by (o.status = 'Sold') desc, o.date_received desc nulls last limit 1) o on true
     where p.opportunity_id is null`);
  for (const x of rows) {
    await db.query(`update projects set opportunity_id = $2 where id = $1`, [x.pid, x.oid]);
    await audit(db, { actor: ACTOR, entity: "project", id: x.pid, action: "link", summary: `Linked to its pipeline row by job number ${x.job}`, related: { entity: "opportunity", id: x.oid } });
    r.imported++;
  }
}

export async function loadPrecedents(db: Db, rows: PrecedentRecord[], r: SectionReport) {
  for (const p of rows) {
    const { legacy_id, ...data } = p;
    count(r, (await upsert(db, "fee_precedents", { col: "legacy_id", val: legacy_id }, {
      ...data, discipline_fees: data.discipline_fees ? JSON.stringify(data.discipline_fees) : null,
    })).inserted);
  }
  const [{ n }] = await db.query<{ n: number }>(
    `select count(distinct f.id)::int n from fee_precedents f join projects p on p.job_number = f.project_number`);
  note(r, `${n} precedents match a job on the Job List by project number (linked on the project page).`);
}

export async function loadLegacyQuotes(db: Db, rows: LegacyQuote[], r: SectionReport) {
  let already = 0;
  for (const q of rows) {
    const existing = await one<{ id: string }>(db, `select id from proposals where legacy_quote_id = $1`, [q.legacy_quote_id]);
    if (existing) { already++; continue; } // imported before; edits made in the hub since are kept
    const day = (q.created_at ?? todayISO()).slice(0, 10);
    const p = await createProposal(db, q, ACTOR, day);
    if (q.created_at) await db.query(`update proposals set created_at = $2 where id = $1`, [p.id, q.created_at]);
    await audit(db, { actor: ACTOR, entity: "proposal", id: p.id, action: "import", summary: `Imported from the first quoting tool (quote ${q.legacy_quote_id.slice(0, 8)})` });
    r.imported++;
  }
  if (already) note(r, `${already} quotes were already imported earlier — left as they are (edits made in the hub are kept).`);
}

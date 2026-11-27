import type { Db } from "../db/types";
import { one } from "../db/types";
import type { Opportunity } from "./types";
import { audit } from "./audit";
import { addTask } from "./crm";
import { PIPELINE_STATUSES, autoAdvance, nextFollowUpDue, statusSortOrder } from "../calc/sales";
import { todayISO } from "../calc/util";
import { normalizeJobNumber } from "../calc/jobNumber";

const SELECT = `select o.*, c.name as company_name, ct.full_name as contact_name, pr.id as project_id, pr.job_number as project_job_number
  from opportunities o left join companies c on c.id = o.company_id left join contacts ct on ct.id = o.contact_id
  left join projects pr on pr.opportunity_id = o.id`;

export async function listOpportunities(db: Db): Promise<Opportunity[]> {
  const rows = await db.query<Opportunity>(`${SELECT} order by o.date_received desc nulls last, o.created_at desc`);
  return rows.sort((a, b) => statusSortOrder(a.status) - statusSortOrder(b.status));
}

export const getOpportunity = (db: Db, id: string) => one<Opportunity>(db, `${SELECT} where o.id = $1`, [id]);

const EDITABLE = ["job_number", "name", "company_id", "contact_id", "contact_text", "best_contact_method", "project_type", "project_detail",
  "date_received", "construction_start", "date_presented", "follow_up_1_date", "follow_up_1_by", "follow_up_1_result",
  "follow_up_2_date", "follow_up_2_by", "follow_up_2_result", "subs_cost", "design_fee", "total_bid_override", "projected_arch_hours"] as const;
export type OpportunityPatch = Partial<Pick<Opportunity, (typeof EDITABLE)[number]>>;

export async function createOpportunity(db: Db, input: OpportunityPatch & { name: string; status?: string }, actor: string) {
  const status = input.status ?? "Proposal Needed";
  if (!PIPELINE_STATUSES.includes(status as never)) throw new Error(`Unknown status ${status}`);
  const keys = EDITABLE.filter((k) => k in input && k !== "name");
  const cols = ["name", "status", ...keys];
  const vals = [input.name, status, ...keys.map((k) => (k === "job_number" ? normalizeJobNumber(input[k] as string) ?? input[k] : input[k]))];
  const [o] = await db.query<Opportunity>(
    `insert into opportunities (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`, vals);
  await audit(db, { actor, entity: "opportunity", id: o.id, action: "create", summary: `Opportunity “${o.name}” added (${status})` });
  return o;
}

export async function updateOpportunity(db: Db, id: string, patch: OpportunityPatch, actor: string) {
  const keys = EDITABLE.filter((k) => k in patch);
  if (!keys.length) return;
  await db.query(`update opportunities set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [id, ...keys.map((k) => patch[k])]);
  await audit(db, { actor, entity: "opportunity", id, action: "update", summary: `Edited ${keys.join(", ")}` });
}

/** Change pipeline status. Records the closing time for Sold/Rejected and schedules the
 *  next follow-up task when the sheet's 3-day / 7-day rules apply. */
export async function setOpportunityStatus(db: Db, id: string, status: string, actor: string, today = todayISO()) {
  if (!PIPELINE_STATUSES.includes(status as never)) throw new Error(`Unknown status ${status}`);
  return db.tx(async (t) => {
    const cur = await one<Opportunity>(t, `select * from opportunities where id = $1 for update`, [id]);
    if (!cur) throw new Error("Opportunity not found");
    if (cur.status === status) return cur;
    const presented = status === "Presented" && !cur.date_presented ? today : cur.date_presented;
    const fu1 = status === "Follow Up 1 Completed" && !cur.follow_up_1_date ? today : cur.follow_up_1_date;
    const fu2 = status === "Follow Up 2 Completed" && !cur.follow_up_2_date ? today : cur.follow_up_2_date;
    const [o] = await t.query<Opportunity>(
      `update opportunities set status = $2, date_presented = $3, follow_up_1_date = $4, follow_up_2_date = $5,
         closed_at = case when $2 in ('Sold','Rejected') then coalesce(closed_at, now()) when $2 = 'Project Completed' then closed_at else null end
       where id = $1 returning *`, [id, status, presented, fu1, fu2]);
    await audit(t, { actor, entity: "opportunity", id, action: "status", summary: `${cur.status} → ${status}` });
    const next = nextFollowUpDue(o);
    if (next) await addTask(t, { title: `Follow up: ${o.name}`, due_on: next.due, cadence: next.cadence, opportunity_id: o.id, source_key: `opp:${o.id}:${next.cadence}` });
    return o;
  });
}

/** Apply the sheet macro's date-based auto-advance to every open row (run on page load / daily). */
export async function applyAutoAdvance(db: Db, actor = "system", today = todayISO()) {
  const rows = await db.query<Opportunity>(`select * from opportunities where status in ('Presented','Follow Up 1 Completed')`);
  let changed = 0;
  for (const o of rows) {
    const s = autoAdvance(o, today);
    if (s !== o.status) {
      await db.query(`update opportunities set status = $2 where id = $1`, [o.id, s]);
      await audit(db, { actor, entity: "opportunity", id: o.id, action: "status", summary: `${o.status} → ${s} (automatic: follow-up due)` });
      changed++;
    }
  }
  return changed;
}

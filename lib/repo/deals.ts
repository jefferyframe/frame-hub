import type { Db } from "../db/types";
import { listOpportunities } from "./opportunities";
import { totalBid, followUpAlert, stageBucket, overallLikelihoods, type StageKey } from "../calc/sales";
import { DEAL_STAGES, LEAD_STAGES, daysOut, taskBucket } from "../crm/logic";

export interface BoardDeal {
  id: string; name: string; status: string; company: string | null; contact: string | null; total: number; sent: string | null; daysOut: number | null;
  next: { day: string; at: string | null; overdue: boolean } | null; owner_id: string | null; owner: string | null; job: string | null; flag: "due" | "cold" | null; proposal: string | null;
}

/** Rows for the Deals (proposals out) or Leads board, with each one's next open follow-up. */
export async function boardDeals(db: Db, mode: "deals" | "leads", today: string, now = new Date()): Promise<BoardDeal[]> {
  const statuses: readonly string[] = mode === "deals" ? DEAL_STAGES : LEAD_STAGES;
  const [opps, next, owners, props] = await Promise.all([
    listOpportunities(db),
    db.query<{ opportunity_id: string; due_on: string | null; due_at: Date | null }>(
      `select distinct on (opportunity_id) opportunity_id, due_on, due_at from tasks where done_at is null and opportunity_id is not null and due_on is not null
       order by opportunity_id, coalesce(due_at, (due_on::timestamp + interval '23 hours') at time zone 'America/Los_Angeles')`),
    db.query<{ id: string; name: string }>(`select id, name from team_members`),
    db.query<{ opportunity_id: string; number: string; version: number }>(`select opportunity_id, number, version from proposals where is_current and opportunity_id is not null`),
  ]);
  const nx = new Map(next.map((n) => [n.opportunity_id, n]));
  const ow = new Map(owners.map((o) => [o.id, o.name]));
  const pr = new Map(props.map((p) => [p.opportunity_id, `${p.number} v${p.version}`]));
  return opps.filter((o) => statuses.includes(o.status)).map((o) => {
    const n = nx.get(o.id);
    return {
      id: o.id, name: o.name, status: o.status, company: o.company_name ?? null, contact: o.contact_name ?? o.contact_text ?? null, total: totalBid(o),
      sent: mode === "deals" ? o.date_presented : o.date_received, daysOut: daysOut(mode === "deals" ? o.date_presented : o.date_received, today),
      next: n ? { day: n.due_on!, at: n.due_at ? new Date(n.due_at).toISOString() : null, overdue: taskBucket(n, now) === "overdue" } : null,
      owner_id: o.owner_member_id ?? null, owner: o.owner_member_id ? ow.get(o.owner_member_id) ?? null : null, job: o.job_number, flag: followUpAlert(o, today), proposal: pr.get(o.id) ?? null,
    };
  });
}

/** Chance a row in this status ends Sold (overall likelihood of its bucket, from Settings). */
export function stageProbability(status: string, likelihood: Record<StageKey, number>): number | null {
  const b = stageBucket(status);
  if (!b || b === "sold" || b === "rejected") return null;
  return overallLikelihoods(likelihood)[b];
}

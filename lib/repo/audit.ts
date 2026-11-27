import type { Db } from "../db/types";

export type Entity = "proposal" | "opportunity" | "project" | "company" | "contact" | "task" | "lead_measure" | "outreach" | "settings";

export async function audit(db: Db, a: {
  actor: string; entity: Entity; id: string; action: string; summary?: string;
  data?: unknown; related?: { entity: Entity; id: string };
}) {
  await db.query(
    `insert into audit_log (actor, entity, entity_id, action, summary, data, related_entity, related_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.actor, a.entity, a.id, a.action, a.summary ?? null, a.data === undefined ? null : JSON.stringify(a.data), a.related?.entity ?? null, a.related?.id ?? null],
  );
}

export interface AuditRow {
  id: number; at: Date; actor: string; entity: string; entity_id: string; action: string;
  summary: string | null; related_entity: string | null; related_id: string | null;
}

/** Everything that happened to a record, including events on records linked to it. */
export function history(db: Db, entity: Entity, id: string) {
  return db.query<AuditRow>(
    `select id, at, actor, entity, entity_id, action, summary, related_entity, related_id from audit_log
     where (entity = $1 and entity_id = $2) or (related_entity = $1 and related_id = $2)
     order by at desc, id desc limit 200`,
    [entity, id],
  );
}

import type { Db } from "../db/types";
export const libraryItems = (db: Db) =>
  db.query<{ kind: string; label: string; description: string | null }>(`select kind, label, description from line_item_templates where active order by sort`);

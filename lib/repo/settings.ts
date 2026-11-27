import type { Db } from "../db/types";
import { DEFAULT_STAGE_LIKELIHOOD, type StageKey } from "../calc/sales";
import { DEFAULT_BURDEN_RATE, DEFAULT_PROFIT_PCT } from "../calc/jobCost";

export interface FirmSettings {
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  stageLikelihood: Record<StageKey, number>;
  burdenRate: number;
  profitPct: number;
  proposalValidDays: number;
  defaultTerms: string;
  whyFrame: string[];
  /** Missing-hours checks start on this day (nobody is flagged for days before daily logging existed). */
  hoursTrackingStart: string;
  /** Days nobody is expected to log hours; the calendar reminder skips them too. */
  firmHolidays: string[];
  /** Set once the schedule has been seeded from the Job List (so deleting a seeded plan doesn't bring it back). */
  scheduleSeededAt: string | null;
}

export const DEFAULT_SETTINGS: FirmSettings = {
  firmName: "Frame Architecture, Inc",
  firmAddress: "4090 S. McCarran Blvd, Suite E\nReno, NV 89502",
  firmPhone: "775.827.9977",
  firmEmail: "",
  stageLikelihood: DEFAULT_STAGE_LIKELIHOOD,
  burdenRate: DEFAULT_BURDEN_RATE,
  profitPct: DEFAULT_PROFIT_PCT,
  proposalValidDays: 30,
  defaultTerms:
    "Fees are invoiced monthly in proportion to the work completed in each phase and are due within 30 days. " +
    "Additional services beyond the scope described are billed hourly or by separate agreement, with written approval before work begins. " +
    "Reimbursable expenses (printing, permit and plan-review fees paid on the client's behalf, travel beyond 50 miles) are billed at cost.",
  whyFrame: [
    "A single, coordinated design team across every discipline carried on this project",
    "Direct experience with projects of comparable scope and complexity",
    "A realistic, sequenced path from scope to a permitted, buildable design",
  ],
  hoursTrackingStart: "2026-11-30",
  firmHolidays: ["2026-12-24", "2026-12-25", "2027-01-01", "2027-05-31", "2027-07-05", "2027-09-06", "2027-11-25", "2027-11-26", "2027-12-24"],
  scheduleSeededAt: null,
};

export async function getSettings(db: Db): Promise<FirmSettings> {
  const rows = await db.query<{ key: string; value: unknown }>(`select key, value from settings`);
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as FirmSettings;
}

export async function setSetting<K extends keyof FirmSettings>(db: Db, key: K, value: FirmSettings[K]) {
  await db.query(
    `insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

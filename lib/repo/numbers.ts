import type { Db } from "../db/types";
import { nextJobNumber } from "../calc/jobNumber";

/** Every job number in use: projects plus pipeline rows (the sales sheet issues them too). */
export async function allJobNumbers(db: Db): Promise<string[]> {
  const rows = await db.query<{ n: string }>(
    `select job_number as n from projects union select job_number from opportunities where job_number is not null`);
  return rows.map((r) => r.n);
}

export async function issueJobNumber(db: Db, onDate: string): Promise<string> {
  return nextJobNumber(await allJobNumbers(db), onDate);
}

/** Proposal numbers: P-YY-NNN, sequential per year. */
export async function issueProposalNumber(db: Db, onDate: string): Promise<string> {
  const yy = onDate.slice(2, 4);
  const rows = await db.query<{ number: string }>(`select distinct number from proposals where number like $1`, [`P-${yy}-%`]);
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.split("-")[2]) || 0), 0);
  return `P-${yy}-${String(max + 1).padStart(3, "0")}`;
}

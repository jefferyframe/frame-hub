export interface SectionReport { read: number; imported: number; updated: number; skipped: number; notes: string[] }
export type ImportReport = Record<string, SectionReport>;
export const section = (): SectionReport => ({ read: 0, imported: 0, updated: 0, skipped: 0, notes: [] });
export function note(r: SectionReport, msg: string, max = 40) {
  if (r.notes.length < max) r.notes.push(msg);
  else if (r.notes.length === max) r.notes.push("… more not listed");
}

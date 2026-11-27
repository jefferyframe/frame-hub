/** Follow-up cadences from the sales workbook.
 *  Past Clients: "1 month followup date", "2 month folowup date", "6 month followup date"
 *  counted from "Date Added to List". Prospects Met: LinkedIn request + card right after the
 *  meeting, then "Email 1 Month Later" (I + 1 month, as the sheet's dates show). */
import { addMonths, addDays } from "./util";

export interface CadenceTask { cadence: string; title: string; due: string }

export function pastClientCadence(dateAdded: string, name: string): CadenceTask[] {
  return [
    { cadence: "past_client_1m", title: `1-month check-in: ${name}`, due: addMonths(dateAdded, 1) },
    { cadence: "past_client_2m", title: `2-month check-in: ${name}`, due: addMonths(dateAdded, 2) },
    { cadence: "past_client_6m", title: `6-month check-in: ${name}`, due: addMonths(dateAdded, 6) },
  ];
}

export function prospectCadence(metOn: string, name: string, opts: { linkedinDone?: boolean; cardDone?: boolean; emailDone?: boolean } = {}): CadenceTask[] {
  const out: CadenceTask[] = [];
  if (!opts.linkedinDone) out.push({ cadence: "prospect_linkedin", title: `Connect on LinkedIn: ${name}`, due: addDays(metOn, 1) });
  if (!opts.cardDone) out.push({ cadence: "prospect_card", title: `Send a card: ${name}`, due: addDays(metOn, 2) });
  if (!opts.emailDone) out.push({ cadence: "prospect_email_1m", title: `1-month email: ${name}`, due: addMonths(metOn, 1) });
  return out;
}

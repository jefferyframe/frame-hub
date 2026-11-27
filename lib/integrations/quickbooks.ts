/**
 * QuickBooks Online seam — NOT implemented yet. Pages and flows call these functions; today
 * they report "not connected". When Jeff connects QuickBooks, implement QuickBooksClient
 * with the QBO REST API (OAuth 2, realmId) and set QBO_CLIENT_ID / QBO_CLIENT_SECRET.
 *
 * Mapping (Frame Hub → QBO):
 *   companies            → Customer            (companies.qb_customer_id)
 *   projects             → Customer:Job / Project (sub-customer, projects.qb_project_id),
 *                          DisplayName "<job number> <project name>"
 *   project phase billing→ Invoice lines: one line per phase, Description "<phase> — <percent complete>% of
 *                          <phase fee>", Amount = fee × percent complete − already billed
 *   consultants          → Invoice lines (reimbursable consultant fees), or Bills against the job
 *   time_entries         → TimeActivity (optional), EmployeeRef by person, CustomerRef = the job
 */
export interface QbCustomer { id?: string; displayName: string; companyName?: string; email?: string; phone?: string; parentId?: string }
export interface QbInvoiceLine { description: string; amount: number; itemRef?: string }
export interface QbInvoice { customerId: string; txnDate: string; lines: QbInvoiceLine[]; memo?: string }

export interface QuickBooksClient {
  connected(): Promise<boolean>;
  upsertCustomer(c: QbCustomer): Promise<string>;
  createInvoice(inv: QbInvoice): Promise<string>;
}

export const qbNotConnected: QuickBooksClient = {
  async connected() { return false; },
  async upsertCustomer() { throw new Error("QuickBooks is not connected yet."); },
  async createInvoice() { throw new Error("QuickBooks is not connected yet."); },
};

export function quickbooks(): QuickBooksClient {
  return qbNotConnected;
}

/** Pure mapping helpers — tested now, used once the client exists. */
export function projectToQbCustomer(p: { job_number: string; name: string }, parentCustomerId?: string): QbCustomer {
  return { displayName: `${p.job_number} ${p.name}`.slice(0, 100), parentId: parentCustomerId };
}

export function phaseBillingLines(phases: { phase: string; fee: number; percentComplete: number; billedToDate: number }[]): QbInvoiceLine[] {
  return phases
    .map((p) => ({ p, amount: Math.round((p.fee * Math.min(Math.max(p.percentComplete, 0), 1) - p.billedToDate) * 100) / 100 }))
    .filter((x) => x.amount > 0)
    .map(({ p, amount }) => ({ description: `${p.phase} — ${(p.percentComplete * 100).toFixed(2)}% of ${p.fee.toFixed(2)}`, amount }));
}

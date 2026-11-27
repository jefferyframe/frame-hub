import { describe, it, expect } from "vitest";
import { projectToQbCustomer, phaseBillingLines, quickbooks } from "@/lib/integrations/quickbooks";

describe("QuickBooks seam", () => {
  it("maps a project to a sub-customer named by job number", () => {
    expect(projectToQbCustomer({ job_number: "21-07", name: "Example Apartments" }, "C1")).toEqual({ displayName: "21-07 Example Apartments", parentId: "C1" });
  });
  it("bills each phase by percent complete less what was billed", () => {
    expect(phaseBillingLines([
      { phase: "Construction Administration", fee: 20000, percentComplete: 0.75, billedToDate: 12000 },
      { phase: "Construction Documents", fee: 40000, percentComplete: 1, billedToDate: 40000 },
    ])).toEqual([{ description: "Construction Administration — 75.00% of 20000.00", amount: 3000 }]);
  });
  it("is not connected yet", async () => {
    expect(await quickbooks().connected()).toBe(false);
    await expect(quickbooks().createInvoice({ customerId: "1", txnDate: "2026-11-27", lines: [] })).rejects.toThrow(/not connected/);
  });
});

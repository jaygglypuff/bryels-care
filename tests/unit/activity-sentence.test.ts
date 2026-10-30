import { describe, expect, it } from "vitest";
import { activitySentence } from "@/app/(app)/dashboard/activity-sentence";

describe("activitySentence (Home recent activity in plain words)", () => {
  it("names who did what to which record", () => {
    expect(activitySentence({ action: "quality.disposition.released", entityType: "batch", entityNumber: "B-26-0004", actorName: "Ana Villanueva" })).toEqual({
      who: "Ana Villanueva",
      text: "released batch",
      number: "B-26-0004",
    });
    expect(activitySentence({ action: "sales.sales_order.created", entityType: "sales_order", entityNumber: "SO-26-00012", actorName: "Lia" }).text).toBe("created customer order");
  });

  it("uses plain verbs for receipts and credit changes", () => {
    expect(activitySentence({ action: "inventory.goods_receipt.posted", entityType: "goods_receipt", entityNumber: "GR-1", actorName: "Ben" }).text).toBe("received delivery");
    expect(activitySentence({ action: "sales.customer.credit_terms_changed", entityType: "customer", entityNumber: "CUS-001", actorName: "Fe" }).text).toBe("changed the credit terms of customer");
  });

  it("falls back to the event words and to 'The system' (never a code)", () => {
    const s = activitySentence({ action: "maintenance.work_request.escalated_twice", entityType: "work_request", entityNumber: null, actorName: null });
    expect(s).toEqual({ who: "The system", text: "escalated twice work request", number: null });
  });
});

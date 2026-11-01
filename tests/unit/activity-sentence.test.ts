import { describe, expect, it } from "vitest";
import { activitySentence } from "@/app/(app)/dashboard/activity-sentence";

describe("activitySentence (Home recent activity in plain words, names before codes)", () => {
  it("names who did what to which record, with the record's name in the sentence and the number apart", () => {
    expect(activitySentence({ action: "quality.disposition.released", entityType: "batch", entityNumber: "B-26-0004", actorName: "Ana Villanueva", entityName: "Acapulco Soap 135 g" })).toEqual({
      who: "Ana Villanueva",
      text: "said OK to the batch of Acapulco Soap 135 g",
      number: "B-26-0004",
    });
    expect(activitySentence({ action: "sales.sales_order.created", entityType: "sales_order", entityNumber: "SO-26-00012", actorName: "Lia", entityName: "Isla Spa Supplies" }).text).toBe("made the customer order for Isla Spa Supplies");
  });

  it("uses plain verbs for receipts and credit changes", () => {
    expect(activitySentence({ action: "inventory.goods_receipt.posted", entityType: "goods_receipt", entityNumber: "GR-1", actorName: "Ben", entityName: "Laguna Oleo Supply" }).text).toBe("received the delivery from Laguna Oleo Supply");
    expect(activitySentence({ action: "sales.customer.credit_terms_changed", entityType: "customer", entityNumber: "CUS-001", actorName: "Fe", entityName: "Sari Glow" }).text).toBe("changed the days to pay of the customer Sari Glow");
  });

  it("never says 'generated generated document': a paper is called by its kind", () => {
    const s = activitySentence({ action: "documents.generated_document.generated", entityType: "generated_document", entityNumber: "DOC-26-0000004", actorName: "Ana Villanueva", entityName: "delivery receipt" });
    expect(s.text).toBe("made the delivery receipt");
    expect(s.text).not.toMatch(/generated/);
    expect(activitySentence({ action: "documents.generated_document.generated", entityType: "generated_document", entityNumber: "DOC-1", actorName: "Ana" }).text).toBe("made the paper");
    expect(activitySentence({ action: "quality.disposition.expired", entityType: "inventory_lot", entityNumber: "LM-2610-0008", actorName: null, entityName: "Coconut Oil" })).toEqual({ who: "The system", text: "marked out of date the lot of Coconut Oil", number: "LM-2610-0008" });
  });

  it("falls back to the event words and to 'The system' (never a code)", () => {
    const s = activitySentence({ action: "maintenance.work_request.escalated_twice", entityType: "work_request", entityNumber: null, actorName: null });
    expect(s).toEqual({ who: "The system", text: "escalated twice the work request", number: null });
  });

  it("problems and alerts carry their own sentence (round 4, re-audit C N1), the record number apart", () => {
    expect(activitySentence({ action: "platform.action_item.escalated", entityType: "action_item", entityNumber: "SO-26-00012", actorName: null, entityName: "Order for Mabuhay Pharmacy Group is not sent out yet; they wanted it on 30 Oct 2026" })).toEqual({
      who: "The system",
      text: "raised a problem: Order for Mabuhay Pharmacy Group is not sent out yet; they wanted it on 30 Oct 2026",
      number: "SO-26-00012",
    });
    expect(activitySentence({ action: "platform.action_item.resolved", entityType: "action_item", entityNumber: "L-1", actorName: null, entityName: "Coconut Oil goes out of date in 3 days" }).text).toBe("closed the problem: Coconut Oil goes out of date in 3 days");
    expect(activitySentence({ action: "platform.action_item.acknowledged", entityType: "action_item", entityNumber: null, actorName: "Dino Reyes", entityName: "Stock check found 1 difference" }).text).toBe("is dealing with the problem: Stock check found 1 difference");
    // Without a title (an old item): still words, never "escalated the problem".
    const bare = activitySentence({ action: "platform.action_item.escalated", entityType: "action_item", entityNumber: "SO-1", actorName: null });
    expect(bare.text).toBe("raised a problem");
    expect(bare.text).not.toMatch(/escalat/);
  });
});

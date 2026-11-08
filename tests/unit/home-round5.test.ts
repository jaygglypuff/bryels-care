/**
 * Round 5 Homes (ADR-129; B report #14 and bug B5): recent activity on Home is business events in plain words; the
 * owner's own technical actions (break glass, owner's override, site assignments, rule checks, stock moves, documents)
 * never show there.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_EVENTS, activitySentence, businessActivity } from "@/app/(app)/dashboard/activity-sentence";

describe("Home activity", () => {
  const rows = [
    { action: "identity.user_site_assignment.break_glass", entityType: "user_site_assignment" },
    { action: "governance.owner_override.used", entityType: "purchase_order" },
    { action: "platform.approval_rule.evaluated", entityType: "sales_order" },
    { action: "inventory.stock_movement.posted", entityType: "stock_movement" },
    { action: "documents.generated_document.generated", entityType: "generated_document" },
    { action: "sales.sales_order.confirmed", entityType: "sales_order" },
    { action: "procurement.goods_receipt.posted", entityType: "goods_receipt" },
    { action: "quality.disposition.released", entityType: "inventory_lot" },
    { action: "procurement.purchase_order.sent", entityType: "purchase_order" },
    { action: "production.batch.finished", entityType: "batch" },
    { action: "finance.invoice.posted", entityType: "invoice" },
  ];

  it("keeps business events only, at most five", () => {
    const kept = businessActivity(rows);
    expect(kept.map((r) => r.action)).toEqual(["sales.sales_order.confirmed", "procurement.goods_receipt.posted", "quality.disposition.released", "procurement.purchase_order.sent", "production.batch.finished"]);
  });

  it("no business event reads like an audit log", () => {
    for (const action of BUSINESS_EVENTS) {
      const s = activitySentence({ action, entityType: action.split(".")[1], entityNumber: "X-1", actorName: "Ana Villanueva", entityName: "Luntian Wellness Stores" });
      expect(s.text, action).not.toMatch(/break glass|override|evaluated|status changed|_/i);
    }
  });

  it("a received delivery reads 'received', a finished batch 'finished making'", () => {
    expect(activitySentence({ action: "procurement.goods_receipt.posted", entityType: "goods_receipt", entityNumber: "GR-1", actorName: "Lito Pascual", entityName: "Laguna Oleo Supply" }).text).toBe("received the delivery from Laguna Oleo Supply");
    expect(activitySentence({ action: "production.batch.finished", entityType: "batch", entityNumber: "B-1", actorName: "Rhea Mendoza", entityName: "Aloe Hand Lotion" }).text).toBe("finished making the batch of Aloe Hand Lotion");
  });
});

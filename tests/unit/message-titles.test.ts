/**
 * ADR-132 §3 (round 5 leftovers, B report #9): message titles lead with names and places, not codes.
 */
import { describe, expect, it } from "vitest";
import { codeLast } from "@/lib/code-last";
import { MessageTitle, itemWithLot, shortNo } from "@/lib/message-titles";

const RECORD_NO = /\b[A-Z]{1,5}-\d{2,4}-\d{2,7}\b/;

describe("message titles", () => {
  it("short record numbers keep the last four digits", () => {
    expect(shortNo("L-2611-00017")).toBe("…0017");
    expect(shortNo("B-26-0004")).toBe("…0004");
    expect(itemWithLot("Coconut Oil", "L-2611-00017")).toBe("Coconut Oil (lot …0017)");
    expect(itemWithLot("Coconut Oil", null)).toBe("Coconut Oil");
  });

  it("put away names the item and the shelf", () => {
    expect(MessageTitle.putAway("Coconut Oil", "L-2611-00017", "A-01")).toBe("Put the Coconut Oil (lot …0017) on shelf A-01");
    expect(MessageTitle.putAway("Coconut Oil", "L-2611-00017", null)).toBe("Put the Coconut Oil (lot …0017) on a shelf");
  });

  it("the common kinds never start with or carry a full record number", () => {
    const titles = [
      MessageTitle.putAway("Coconut Oil", "L-2611-00017", "A-01"),
      MessageTitle.lotToCheck("Coconut Oil", "L-2611-00017", "Laguna Oleo Supply"),
      MessageTitle.productionOrderToApprove("Aloe Hand Lotion"),
      MessageTitle.batchToDecide("Aloe Hand Lotion", "B-26-0004"),
      MessageTitle.weighingToCheck("Aloe Hand Lotion", "Rhea"),
      MessageTitle.stepToCheck("Mixing", "Aloe Hand Lotion"),
      MessageTitle.orderToSetAside("Luntian Wellness Stores"),
      MessageTitle.orderToPick("Luntian Wellness Stores"),
      MessageTitle.boxesToCheck("Luntian Wellness Stores"),
      MessageTitle.deliveryToSend("Luntian Wellness Stores"),
      MessageTitle.purchaseOrderToApprove("Laguna Oleo Supply"),
      MessageTitle.purchaseOrderToSend("Laguna Oleo Supply"),
    ];
    for (const t of titles) {
      expect(t, t).not.toMatch(RECORD_NO);
      expect(t.charAt(0), t).toMatch(/[A-Z]/);
    }
    expect(MessageTitle.lotToCheck("Coconut Oil", "L-2611-00017", "Laguna Oleo Supply")).toBe("Check the Coconut Oil (lot …0017) from Laguna Oleo Supply");
    expect(MessageTitle.weighingToCheck("Aloe Hand Lotion", "Rhea")).toBe("Check Rhea's weighing: Aloe Hand Lotion");
  });

  it("the Messages list keeps a shelf code in the sentence (it is a place, not a record number)", () => {
    expect(codeLast("Put the Coconut Oil (lot …0017) on shelf A-01")).toEqual({ text: "Put the Coconut Oil (lot …0017) on shelf A-01", codes: [] });
    expect(codeLast("Order SO-26-00012 confirmed").codes).toEqual(["SO-26-00012"]);
  });
});

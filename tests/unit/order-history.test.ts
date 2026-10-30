import { describe, expect, it } from "vitest";
import { orderHistory } from "@/app/(app)/sales/orders/order-history";

const at = (h: number) => new Date(Date.UTC(2026, 9, 30, h));

describe("orderHistory (customer order page)", () => {
  it("lists the recorded changes with names, oldest first", () => {
    const h = orderHistory(
      [
        { id: "2", fromState: "draft", toState: "confirmed", occurredAt: at(2), actorName: "Lia", reason: null },
        { id: "1", fromState: null, toState: "draft", occurredAt: at(1), actorName: "Lia", reason: null },
        { id: "3", fromState: "confirmed", toState: "allocated", occurredAt: at(3), actorName: "Ben", reason: null },
      ],
      { at: at(1), byName: "Lia" },
    );
    expect(h.map((e) => e.label)).toEqual(["Created as draft", "Confirmed", "Stock reserved"]);
    expect(h.map((e) => e.who)).toEqual(["Lia", "Lia", "Ben"]);
  });

  it("is never empty: an order without recorded changes shows who entered it and when", () => {
    expect(orderHistory([], { at: at(5), byName: "Ana" })).toEqual([{ key: "created", label: "Order entered", who: "Ana", at: at(5), reason: null }]);
  });

  it("adds the entry row before later moves when the creation was not recorded", () => {
    const h = orderHistory([{ id: "9", fromState: "confirmed", toState: "allocated", occurredAt: at(8), actorName: "Ben", reason: null }], { at: at(1), byName: "Ana" });
    expect(h.map((e) => e.label)).toEqual(["Order entered", "Stock reserved"]);
  });
});

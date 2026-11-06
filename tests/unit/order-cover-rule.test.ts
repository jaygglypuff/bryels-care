/**
 * Live check 2026-11-06 finding 1: ONE rule for "is this customer order short?" (order-cover-rule.ts), shared by
 * How work flows, the planner's Home and the order's shortage card. Stock waiting for QA or being made counts as
 * coming; a production order promised to another open order never does.
 */
import { describe, expect, it } from "vitest";
import { comingWords, coverOrders, type ComingSource } from "@/modules/production/order-cover-rule";

const P = "lotion";
const S = "soap";
const src = (id: string, kind: ComingSource["kind"], qty: string, salesOrderId: string | null = null, productId = P): ComingSource => ({ id, ref: id, productId, kind, qty, salesOrderId });

describe("coverOrders", () => {
  it("the Isla Spa case: 48 ordered, nothing free, 94 waiting for QA → coming, not short", () => {
    const [o] = coverOrders([{ orderId: "SO-2", lines: [{ lineId: "l1", productId: P, need: "48" }] }], new Map(), [src("B-2", "waiting_qa", "94"), src("B-4", "being_made", "96")]);
    expect(o.state).toBe("coming");
    expect(o.lines[0].missing.toString()).toBe("0");
    expect(o.lines[0].comingTotal.toString()).toBe("48");
    expect(comingWords(o.lines[0].coming)).toBe("coming: 48 waiting for QA");
  });

  it("free stock first: an order fully covered by free stock can be set aside and takes it", () => {
    const r = coverOrders(
      [
        { orderId: "A", lines: [{ lineId: "a", productId: S, need: "48" }] },
        { orderId: "B", lines: [{ lineId: "b", productId: S, need: "100" }] },
      ],
      new Map([[S, "118"]]),
      [],
    );
    expect(r[0].state).toBe("can_set_aside");
    expect(r[1].state).toBe("short");
    expect(r[1].lines[0].fromFree.toString()).toBe("70");
    expect(r[1].lines[0].missing.toString()).toBe("30");
  });

  it("closest first: waiting for QA, then being made; the rest needs making", () => {
    const [o] = coverOrders([{ orderId: "A", lines: [{ lineId: "a", productId: P, need: "200" }] }], new Map([[P, "10"]]), [src("WO-9", "being_made", "96"), src("B-1", "waiting_qa", "50")]);
    expect(o.state).toBe("short");
    expect(o.lines[0].coming.map((c) => [c.ref, c.qty.toString()])).toEqual([["B-1", "50"], ["WO-9", "96"]]);
    expect(o.lines[0].missing.toString()).toBe("44");
    expect(comingWords(o.lines[0].coming)).toBe("coming: 50 waiting for QA, 96 being made");
  });

  it("a production order made for another open order is never counted; made for this order it is used first", () => {
    const orders = [
      { orderId: "A", lines: [{ lineId: "a", productId: P, need: "40" }] },
      { orderId: "B", lines: [{ lineId: "b", productId: P, need: "40" }] },
    ];
    const r = coverOrders(orders, new Map(), [src("WO-B", "being_made", "40", "B"), src("WO-A", "planned", "40", "A")]);
    expect(r[0].lines[0].coming.map((c) => c.ref)).toEqual(["WO-A"]);
    expect(r[1].lines[0].coming.map((c) => c.ref)).toEqual(["WO-B"]);
    expect(r.map((o) => o.state)).toEqual(["coming", "coming"]);
    // Without A's own order, B's production order does not cover A.
    const r2 = coverOrders(orders, new Map(), [src("WO-B", "being_made", "40", "B")]);
    expect(r2[0].state).toBe("short");
    expect(r2[0].lines[0].missing.toString()).toBe("40");
  });

  it("an unapproved production order counts only for the order it was made for; one promised to a closed order is for anyone", () => {
    const [o] = coverOrders([{ orderId: "A", lines: [{ lineId: "a", productId: P, need: "10" }] }], new Map(), [src("WO-X", "being_made", "10", "OLD-CLOSED")]);
    expect(o.state).toBe("coming");
  });

  it("stock coming is shared out once, in priority order", () => {
    const r = coverOrders(
      [
        { orderId: "A", lines: [{ lineId: "a", productId: P, need: "60" }] },
        { orderId: "B", lines: [{ lineId: "b", productId: P, need: "60" }] },
      ],
      new Map(),
      [src("B-1", "waiting_qa", "94")],
    );
    expect(r[0].state).toBe("coming");
    expect(r[1].state).toBe("short");
    expect(r[1].lines[0].missing.toString()).toBe("26");
  });

  it("an order with everything set aside needs nothing", () => {
    const [o] = coverOrders([{ orderId: "A", lines: [{ lineId: "a", productId: P, need: "0" }] }], new Map(), []);
    expect(o.state).toBe("nothing_needed");
  });
});

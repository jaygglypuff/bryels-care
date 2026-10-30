/** Slice R3 (UX-21): the record header's progress strip follows the real state machines. */
import { describe, expect, it } from "vitest";
import { PO_TRANSITIONS } from "@/modules/procurement/state";
import { RECEIPT_TRANSITIONS } from "@/modules/inventory/receiving-state";
import { ORDER_TRANSITIONS } from "@/modules/sales/orders";
import { SHIPMENT_STATUSES, shipmentMachine } from "@/modules/sales/fulfilment-state";
import { goodsReceiptSteps, purchaseOrderSteps, salesOrderSteps, shipmentSteps, type RecordStep } from "@/ui/record-steps";

/** Every status a transition table names, as a source or a target. */
function statusesOf(table: Record<string, readonly string[]>): string[] {
  return [...new Set([...Object.keys(table), ...Object.values(table).flat()])].sort();
}

const RECEIPT_STATUSES = [...new Set(Object.values(RECEIPT_TRANSITIONS).flatMap((t) => [...t.from, t.to]))].sort();

const MACHINES: { name: string; statuses: string[]; steps: (s: string) => RecordStep[]; stopped: string[] }[] = [
  { name: "purchase order", statuses: statusesOf(PO_TRANSITIONS), steps: purchaseOrderSteps, stopped: ["cancelled"] },
  { name: "goods receipt", statuses: RECEIPT_STATUSES, steps: goodsReceiptSteps, stopped: ["cancelled", "reversed"] },
  { name: "sales order", statuses: statusesOf(ORDER_TRANSITIONS), steps: salesOrderSteps, stopped: ["cancelled"] },
  { name: "shipment", statuses: statusesOf(shipmentMachine.transitions), steps: shipmentSteps, stopped: ["cancelled", "reversed", "returned"] },
];

const count = (steps: RecordStep[], state: RecordStep["state"]) => steps.filter((s) => s.state === state).length;

describe("record progress strip", () => {
  it("covers the expected status sets", () => {
    expect(RECEIPT_STATUSES).toEqual(["cancelled", "draft", "posted", "reversed"]);
    expect(statusesOf(shipmentMachine.transitions)).toEqual([...SHIPMENT_STATUSES].sort());
    expect(statusesOf(PO_TRANSITIONS)).toHaveLength(8);
    expect(statusesOf(ORDER_TRANSITIONS)).toHaveLength(12);
  });

  for (const m of MACHINES) {
    describe(m.name, () => {
      for (const status of m.statuses) {
        it(`${status}: exactly one current step, or one blocked step at the end`, () => {
          const steps = m.steps(status);
          expect(steps.length).toBeGreaterThanOrEqual(2);
          for (const s of steps) expect(s.label.trim()).not.toBe("");
          if (m.stopped.includes(status)) {
            expect(count(steps, "blocked")).toBe(1);
            expect(count(steps, "current")).toBe(0);
            expect(count(steps, "upcoming")).toBe(0); // no pretend progress after a stop
            expect(steps[steps.length - 1].state).toBe("blocked");
            expect(steps.slice(0, -1).every((s) => s.state === "done")).toBe(true);
          } else {
            expect(count(steps, "current")).toBe(1);
            expect(count(steps, "blocked")).toBe(0);
            // done … current … upcoming, in that order
            const at = steps.findIndex((s) => s.state === "current");
            expect(steps.slice(0, at).every((s) => s.state === "done")).toBe(true);
            expect(steps.slice(at + 1).every((s) => s.state === "upcoming")).toBe(true);
          }
        });
      }

      it("an unknown status does not throw and claims no progress", () => {
        const steps = m.steps("no_such_status");
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.every((s) => s.state === "upcoming")).toBe(true);
      });
    });
  }

  it("moves forward along each happy path", () => {
    const pos = (steps: RecordStep[]) => steps.findIndex((s) => s.state === "current");
    const paths: [typeof purchaseOrderSteps | typeof salesOrderSteps, string[]][] = [
      [purchaseOrderSteps, ["draft", "submitted", "approved", "sent", "received", "closed"]],
      [salesOrderSteps, ["draft", "submitted", "confirmed", "allocated", "picking", "shipped", "invoiced", "closed"]],
      [shipmentSteps, ["draft", "picked", "packed", "dispatched", "delivered"]],
      [goodsReceiptSteps, ["draft", "posted"]],
    ];
    for (const [fn, path] of paths) {
      const idx = path.map((s) => pos(fn(s)));
      for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
      expect(idx[idx.length - 1]).toBe(fn(path[path.length - 1]).length - 1); // final status sits on the last stage
    }
  });

  it("names the stopped state and keeps what really happened", () => {
    expect(purchaseOrderSteps("cancelled")).toEqual([
      { label: "Created", state: "done" },
      { label: "Cancelled", state: "blocked" },
    ]);
    expect(goodsReceiptSteps("reversed").map((s) => s.label)).toEqual(["Draft", "Posted", "Reversed"]);
    expect(shipmentSteps("returned").at(-1)).toEqual({ label: "Returned", state: "blocked" });
    expect(shipmentSteps("reversed").map((s) => s.label)).toEqual(["Picking", "Picked", "Packed", "Dispatched", "Reversed"]);
  });

  it("uses the specific word for in-between statuses", () => {
    expect(purchaseOrderSteps("partially_received").find((s) => s.state === "current")?.label).toBe("Partly received");
    expect(salesOrderSteps("partially_shipped").find((s) => s.state === "current")?.label).toBe("Partly shipped");
    expect(salesOrderSteps("packed").find((s) => s.state === "current")?.label).toBe("Packed");
    expect(salesOrderSteps("pending_approval").find((s) => s.state === "current")?.label).toBe("Approval");
  });

  it("an after-the-fact purchase order never shows a Sent stage", () => {
    const steps = purchaseOrderSteps("received", { afterTheFact: true });
    expect(steps.map((s) => s.label)).not.toContain("Sent");
    expect(steps.find((s) => s.state === "current")?.label).toBe("Received");
    expect(purchaseOrderSteps("approved").map((s) => s.label)).toContain("Sent");
  });
});

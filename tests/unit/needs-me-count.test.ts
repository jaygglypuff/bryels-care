/**
 * Round 5 leftovers (ADR-132 §1): "Needs me" in the menu and "Needs you" on Home are one number with one definition —
 * approvals this person can decide + checks waiting for them + open messages that ask them to act (not FYI). Messages
 * about a record already counted as an approval or a check are not counted twice.
 */
import { describe, expect, it } from "vitest";
import { countNeedsMe, needsMeBreakdown } from "@/modules/analytics/needs-me-count";

const approval = (entityId: string, canDecide = true) => ({ entityId, canDecide });
const msg = (kind: string, entityId: string | null = null, entityType: string | null = null) => ({ kind, entityId, entityType });

describe("countNeedsMe", () => {
  it("adds approvals I can decide, checks and action messages", () => {
    const n = countNeedsMe({ approvals: [approval("a"), approval("b", false)], checks: [{ key: "c1" }], messages: [msg("inventory.lot.ready_to_put_away", "lot1"), msg("handoff.pick", "so1")] });
    expect(n).toEqual({ approvals: 1, checks: 1, messages: 2, total: 4 });
  });

  it("does not count FYI messages (kinds that never ask for work)", () => {
    const n = countNeedsMe({ approvals: [], checks: [], messages: [msg("document.generated", "d1"), msg("alert.low_stock", "m1")] });
    expect(n.total).toBe(0);
  });

  it("a message about a record in my approvals is not counted again, nor one waiting for someone else's decision", () => {
    const n = countNeedsMe({ approvals: [approval("po1"), approval("po2", false)], checks: [], messages: [msg("purchase_order_submitted", "po1"), msg("handoff.purchase_order", "po2")] });
    expect(n).toEqual({ approvals: 1, checks: 0, messages: 0, total: 1 });
  });

  it("weighing, step and start checks are counted once, as checks (the checker list), not as messages", () => {
    const n = countNeedsMe({ approvals: [], checks: [{ key: "w:b1" }], messages: [msg("handoff.weighing_check"), msg("handoff.weighing_check"), msg("handoff.step_check"), msg("handoff.start_check"), msg("handoff.pack_check", "s1", "shipment")] });
    expect(n).toEqual({ approvals: 0, checks: 1, messages: 0, total: 1 });
  });

  it("a box check on a pack (not a delivery) is a message", () => {
    expect(countNeedsMe({ approvals: [], checks: [], messages: [msg("handoff.pack_check", "p1", "pack")] }).messages).toBe(1);
  });

  it("two messages about the same record count once", () => {
    expect(countNeedsMe({ approvals: [], checks: [], messages: [msg("sales_order_confirmed", "so1"), msg("handoff.set_aside", "so1")] }).messages).toBe(1);
  });
});

describe("needsMeBreakdown", () => {
  it("reads '1 approval · 4 messages' and says nothing waits at zero", () => {
    expect(needsMeBreakdown({ approvals: 1, checks: 0, messages: 4, total: 5 })).toBe("1 approval · 4 messages");
    expect(needsMeBreakdown({ approvals: 2, checks: 1, messages: 1, total: 4 })).toBe("2 approvals · 1 check · 1 message");
    expect(needsMeBreakdown({ approvals: 0, checks: 0, messages: 0, total: 0 })).toBe("Nothing waits for you");
  });
});

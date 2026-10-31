/** One order history entry in plain words, e.g. draft → submitted becomes "Submitted". */
export function historyLabel(from: string | null, to: string): string {
  if (to === "confirmed" && from === "pending_approval") return "Approved and confirmed";
  if (to === "confirmed" && from && ["allocated", "picking", "packed"].includes(from)) return "Set-aside stock let go";
  if (to === "draft" && from === "pending_approval") return "Sent back to draft";
  if (to === "draft" && !from) return "Created as draft";
  if (to === "allocated" && from && ["picking", "packed"].includes(from)) return "Getting from shelf stopped, stock still set aside";
  const plain: Record<string, string> = {
    draft: "Back to draft",
    submitted: "Submitted",
    pending_approval: "Sent for approval",
    confirmed: "Confirmed",
    allocated: "Set aside",
    picking: "Getting from shelf started",
    packed: "Box checked a second time",
    partially_shipped: "Partly sent out",
    shipped: "Sent out",
    invoiced: "Billed",
    closed: "Done",
    cancelled: "Cancelled",
  };
  return plain[to] ?? to.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type OrderHistoryEntry = { key: string; label: string; who: string | null; at: Date; reason: string | null };

/**
 * The order's history, oldest first: every recorded status change (sales_order_state_transitions, with
 * the person's name) — created, submitted, approved and confirmed, stock reserved, picking, packed,
 * shipped, cancelled. Orders entered before transitions were recorded have no creation row; for them the
 * order's own created-by and created-at stand in, so the history is never empty.
 */
export function orderHistory(
  transitions: { id: string; fromState: string | null; toState: string; occurredAt: Date | string; actorName: string | null; reason: string | null }[],
  created: { at: Date | string; byName: string | null },
): OrderHistoryEntry[] {
  const rows: OrderHistoryEntry[] = transitions.map((t) => ({ key: t.id, label: historyLabel(t.fromState, t.toState), who: t.actorName, at: new Date(t.occurredAt), reason: t.reason }));
  if (!transitions.some((t) => t.fromState === null)) rows.unshift({ key: "created", label: "Order entered", who: created.byName, at: new Date(created.at), reason: null });
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

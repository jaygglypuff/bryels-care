/**
 * Customer return rules without database access (US-4-16, W09-11, W07-09): state machine and labels.
 */
import type { CUSTOMER_RETURN_STATUSES, RETURN_LINE_CONDITIONS } from "@/db/schema/complaints";

export type CustomerReturnStatus = (typeof CUSTOMER_RETURN_STATUSES)[number];
export type ReturnLineCondition = (typeof RETURN_LINE_CONDITIONS)[number];

/**
 * draft → submitted → approved → received (posted into quarantine) → inspected (every return lot has a
 * QA disposition) → closed. submitted → draft when the approver sends it back. draft, submitted and
 * approved may be cancelled with a reason; nothing posted is ever cancelled (a posted return is
 * corrected by reversal of its movements, ADR-006).
 */
export const RETURN_TRANSITIONS: Record<CustomerReturnStatus, readonly CustomerReturnStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["received", "cancelled"],
  received: ["inspected"],
  inspected: ["closed"],
  closed: [],
  cancelled: [],
};

export const RETURN_STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved, to receive",
  received: "Received in quarantine",
  inspected: "Dispositioned by QA",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RETURN_CONDITION_LABEL: Record<ReturnLineCondition, string> = {
  sellable: "Looks sellable",
  damaged: "Damaged",
  expired: "Expired",
  unknown: "Not assessed",
};

export function canMoveReturn(from: string, to: CustomerReturnStatus): boolean {
  return (RETURN_TRANSITIONS[from as CustomerReturnStatus] ?? []).includes(to);
}

/** Statuses whose lines count against the shipped quantity (V-OVER across returns of one shipment). */
export const RETURN_COUNTING_STATUSES: readonly CustomerReturnStatus[] = ["draft", "submitted", "approved", "received", "inspected", "closed"];

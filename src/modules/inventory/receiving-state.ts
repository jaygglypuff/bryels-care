/**
 * Goods receipt state machine and receiving configuration (pure, no I/O; US-2-07).
 *
 *   draft ──post──▶ posted ──reverse──▶ reversed
 *     └───cancel──▶ cancelled
 *
 * Stock, lots and numbers exist only from `posted`. A reversed receipt keeps its lots (zero balance)
 * and ledger rows; history is never edited (ADR-006).
 */
import Decimal from "decimal.js";
import { DomainError } from "@/lib/errors";

export type ReceiptStatus = "draft" | "posted" | "cancelled" | "reversed";
export type ReceiptAction = "edit" | "post" | "cancel" | "reverse";

export const RECEIPT_TRANSITIONS: Record<ReceiptAction, { from: readonly ReceiptStatus[]; to: ReceiptStatus; label: string }> = {
  edit: { from: ["draft"], to: "draft", label: "Edit" },
  post: { from: ["draft"], to: "posted", label: "Post" },
  cancel: { from: ["draft"], to: "cancelled", label: "Cancel draft" },
  reverse: { from: ["posted"], to: "reversed", label: "Reverse receipt" },
};

const STATUS_WORDS: Record<string, string> = { draft: "a draft", posted: "posted", cancelled: "cancelled", reversed: "reversed" };

/** Throws a 409 `state` error unless the action is allowed from the current status. */
export function assertReceiptTransition(action: ReceiptAction, status: string, label: string): ReceiptStatus {
  const t = RECEIPT_TRANSITIONS[action];
  if (!(t.from as readonly string[]).includes(status)) {
    throw new DomainError("state", `${t.label} is not possible: receipt ${label} is ${STATUS_WORDS[status] ?? status}.`, { status });
  }
  return t.to;
}

export const DISCREPANCY_KINDS = ["short", "over", "damaged", "wrong_item", "missing_documents"] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];
export const DISCREPANCY_LABELS: Record<DiscrepancyKind, string> = {
  short: "Short delivery",
  over: "Over-delivery",
  damaged: "Damaged",
  wrong_item: "Wrong item",
  missing_documents: "Missing documents",
};
/**
 * Kinds that stop posting until procurement approves them (data-model §3.4: "posting with an unapproved
 * over or wrong_item line is refused"). Every unapproved kind blocks QA release of the lot (W01-04, AC2).
 * Over-delivery tolerance against a PO (A-PROC-11, default 0 %) applies once purchase orders exist (Phase 6).
 */
export const DISCREPANCY_BLOCKS_POSTING: readonly DiscrepancyKind[] = ["over", "wrong_item"];

/** Unplanned-receipt reasons are shared reason codes (category `receipt`, US-1-24, A-PROC-26); this is the default code. */
export const DEFAULT_UNPLANNED_REASON = "no_purchase_order";

/* Units and conversions come from the UOM service (src/modules/masterdata uom.ts, W2G): no factors in code. */

/** Location kinds a receipt line may be put into for the lot's initial status (V-LOC at receipt). */
export function receiptLocationKinds(initialStatus: "quarantine" | "released"): string[] {
  return initialStatus === "released" ? ["receiving", "quarantine", "storage"] : ["receiving", "quarantine", "hold"];
}

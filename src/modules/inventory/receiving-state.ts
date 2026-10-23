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

/**
 * Reason codes for an unplanned receipt (A-PROC-26). Assumption A-W1B-01: the reason-code catalogue
 * (data-model reason_codes) is not built yet; these defaults are vocabulary for the owner to confirm.
 */
export const UNPLANNED_REASON_CODES = [
  { code: "no_purchase_order", label: "No purchase order in the system (purchasing not yet live)" },
  { code: "urgent_purchase", label: "Urgent purchase, PO to follow" },
  { code: "replacement_delivery", label: "Replacement for a rejected delivery" },
  { code: "sample_or_free_goods", label: "Sample or free goods" },
  { code: "other", label: "Other (explain in notes)" },
] as const;
export const UNPLANNED_REASON_CODE_VALUES = UNPLANNED_REASON_CODES.map((r) => r.code) as readonly string[];
export const DEFAULT_UNPLANNED_REASON = "no_purchase_order";

/**
 * Units an operator may enter per base unit (V-UOM). These are SI conversions, not business rules;
 * material-specific pack units (drum, sack) arrive with the UOM tables (ADR-010).
 */
export const UOM_FACTORS: Record<string, Record<string, string>> = {
  g: { g: "1", kg: "1000", mg: "0.001" },
  mL: { mL: "1", L: "1000" },
  pcs: { pcs: "1" },
};

export function unitsFor(baseUom: string): string[] {
  return Object.keys(UOM_FACTORS[baseUom] ?? { [baseUom]: "1" });
}

/** Converts an entered quantity to the base unit; null when the unit cannot be converted (V-UOM). */
export function toBaseQty(qty: Decimal.Value, uom: string, baseUom: string): Decimal | null {
  const factor = (UOM_FACTORS[baseUom] ?? { [baseUom]: "1" })[uom];
  if (!factor) return null;
  return new Decimal(qty).mul(factor);
}

/** Location kinds a receipt line may be put into for the lot's initial status (V-LOC at receipt). */
export function receiptLocationKinds(initialStatus: "quarantine" | "released"): string[] {
  return initialStatus === "released" ? ["receiving", "quarantine", "storage"] : ["receiving", "quarantine", "hold"];
}

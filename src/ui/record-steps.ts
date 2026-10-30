/**
 * Progress-strip steps for the shared record header (slice R3, UX-21; docs/WORKFLOW_ARCHITECTURE.md §5).
 *
 * Pure display mapping from a record's status to a short list of stages. No I/O and no JSX so it can
 * be unit tested (tests/unit/record-steps.test.ts). The stages follow the real state machines:
 *   purchase order  PO_TRANSITIONS        src/modules/procurement/state.ts
 *   goods receipt   RECEIPT_TRANSITIONS   src/modules/inventory/receiving-state.ts
 *   sales order     ORDER_TRANSITIONS     src/modules/sales/orders.ts
 *   shipment        shipmentMachine       src/modules/sales/fulfilment-state.ts
 * This file only reads status strings; it never decides what may happen next (that is the service's job).
 *
 * Rules:
 * - "current" marks the stage the record is in now; earlier stages are "done", later ones "upcoming".
 *   A record in its final successful status has its last stage "current" (it is there).
 * - Cancelled, reversed and returned records never pretend progress: the strip shows what really
 *   happened ("Created", plus the stages a reversed/returned record certainly passed) and ends in one
 *   "blocked" step naming the end state.
 * - An unknown status never throws: every stage is shown "upcoming" (no progress is claimed).
 */

export type StepState = "done" | "current" | "blocked" | "upcoming";
export type RecordStep = { label: string; state: StepState };

type Stage = { label: string; statuses: readonly string[]; currentLabel?: Partial<Record<string, string>> };

function strip(stages: readonly Stage[], status: string): RecordStep[] {
  const at = stages.findIndex((s) => s.statuses.includes(status));
  if (at < 0) return stages.map((s) => ({ label: s.label, state: "upcoming" }));
  return stages.map((s, i) => ({
    label: i === at ? (s.currentLabel?.[status] ?? s.label) : s.label,
    state: i < at ? "done" : i === at ? "current" : "upcoming",
  }));
}

/** End state reached from an unknown point: only "Created" is certain. */
const stopped = (label: string): RecordStep[] => [
  { label: "Created", state: "done" },
  { label, state: "blocked" },
];

/** End state reached after a known stage: those stages are done, then the blocked step. */
const stoppedAfter = (stages: readonly Stage[], lastDone: number, label: string): RecordStep[] => [
  ...stages.slice(0, lastDone + 1).map((s): RecordStep => ({ label: s.label, state: "done" })),
  { label, state: "blocked" },
];

/* ── Purchase order ───────────────────────────────────────────────────────────────────────────
 * draft → submitted → approved → sent → partially_received → received → closed; cancelled from
 * draft|submitted|approved|sent. An after-the-fact PO (ADR-077 S6: made from a posted receipt) goes
 * approved → received and is never sent, so its strip has no "Sent" stage. */
const PO_STAGES: readonly Stage[] = [
  { label: "Draft", statuses: ["draft"] },
  { label: "Approval", statuses: ["submitted"] },
  { label: "Approved", statuses: ["approved"] },
  { label: "Sent", statuses: ["sent"] },
  { label: "Received", statuses: ["partially_received", "received"], currentLabel: { partially_received: "Partly received" } },
  { label: "Closed", statuses: ["closed"] },
];

export function purchaseOrderSteps(status: string, opts: { afterTheFact?: boolean } = {}): RecordStep[] {
  if (status === "cancelled") return stopped("Cancelled");
  return strip(opts.afterTheFact ? PO_STAGES.filter((s) => s.label !== "Sent") : PO_STAGES, status);
}

/* ── Goods receipt ────────────────────────────────────────────────────────────────────────────
 * draft → posted → reversed; draft → cancelled. Labels, put-away and QA release are separate records
 * and are not inferred from the receipt status. */
const GR_STAGES: readonly Stage[] = [
  { label: "Draft", statuses: ["draft"] },
  { label: "Posted", statuses: ["posted"] },
];

export function goodsReceiptSteps(status: string): RecordStep[] {
  // Only drafts can be cancelled, so "Draft" is the one certain stage.
  if (status === "cancelled") return stoppedAfter(GR_STAGES, 0, "Cancelled");
  if (status === "reversed") return stoppedAfter(GR_STAGES, 1, "Reversed");
  return strip(GR_STAGES, status);
}

/* ── Sales order ──────────────────────────────────────────────────────────────────────────────
 * draft → submitted → (pending_approval) → confirmed → allocated → picking → packed →
 * (partially_shipped) → shipped → invoiced → closed; cancelled from any open status before shipping. */
const SO_STAGES: readonly Stage[] = [
  { label: "Draft", statuses: ["draft"] },
  { label: "Approval", statuses: ["submitted", "pending_approval"] },
  { label: "Confirmed", statuses: ["confirmed"] },
  { label: "Allocated", statuses: ["allocated"] },
  { label: "Pick & pack", statuses: ["picking", "packed"], currentLabel: { picking: "Picking", packed: "Packed" } },
  { label: "Shipped", statuses: ["partially_shipped", "shipped"], currentLabel: { partially_shipped: "Partly shipped" } },
  { label: "Invoiced", statuses: ["invoiced"] },
  { label: "Closed", statuses: ["closed"] },
];

export function salesOrderSteps(status: string): RecordStep[] {
  if (status === "cancelled") return stopped("Cancelled");
  return strip(SO_STAGES, status);
}

/* ── Shipment ─────────────────────────────────────────────────────────────────────────────────
 * draft (picking) → picked → packed → dispatched → delivered; cancelled from draft|picked|packed;
 * reversed from dispatched (goods never left); returned from dispatched|delivered. */
const SHIPMENT_STAGES: readonly Stage[] = [
  { label: "Picking", statuses: ["draft"] },
  { label: "Picked", statuses: ["picked"] },
  { label: "Packed", statuses: ["packed"] },
  { label: "Dispatched", statuses: ["dispatched"] },
  { label: "Delivered", statuses: ["delivered"] },
];

export function shipmentSteps(status: string): RecordStep[] {
  if (status === "cancelled") return stopped("Cancelled");
  if (status === "reversed") return stoppedAfter(SHIPMENT_STAGES, 3, "Reversed");
  if (status === "returned") return stoppedAfter(SHIPMENT_STAGES, 3, "Returned");
  return strip(SHIPMENT_STAGES, status);
}

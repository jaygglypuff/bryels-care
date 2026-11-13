import type { EnqueueInput } from "./outbox";

/**
 * The Weigh card's no-signal path (ADR-130 §3, A-OFF-WGH-01; tested by ADR-133 item 4): when Save finds no signal,
 * the weighing is queued on the phone as the offline command `production.dispense_record.create` and replayed when
 * the signal is back (`replaySyncBatch` → `recordDispense`). Pure, so the queue path is tested end to end.
 *
 * - `lotRef` is the scanned or typed label (`BC:LOT:<number>`), else the lot shown on the card.
 * - `lotVia` says how the lot was confirmed on the card ("scan" or "typed"); the server records it as the lot
 *   confirmation and refuses `typed` while `scan.typed_code_counts_as_check` is off (ADR-125, ADR-126). A tap never
 *   confirms a lot, so it is not sent (the server then records the lot as given, as for older queued commands).
 * - The scale goes only when the step needs one.
 */
export type QueuedWeighInput = {
  siteId: string;
  batchId: string;
  batchMaterialId: string;
  materialName: string;
  /** As typed, in the card's unit. */
  qty: string;
  unit: string;
  /** "BC:LOT:<number>" after a scan or a typed number; "" when the lot was not confirmed on the card. */
  lotCode: string;
  /** The lot shown on the card. */
  lotNumber: string | null;
  lotVia: "scan" | "typed" | "tap" | null;
  locationId: string | null;
  requiresScale: boolean;
  scale: string | null;
};

export function queuedWeighCommand(i: QueuedWeighInput): EnqueueInput<"production.dispense_record.create"> {
  return {
    type: "production.dispense_record.create",
    siteId: i.siteId,
    summary: `${i.materialName} ${i.qty} ${i.unit}`,
    payload: {
      batchId: i.batchId,
      batchMaterialId: i.batchMaterialId,
      lotRef: i.lotCode || `BC:LOT:${i.lotNumber ?? ""}`,
      lotVia: i.lotVia === "tap" ? undefined : (i.lotVia ?? undefined),
      locationRef: i.locationId ?? null,
      qty: i.qty,
      uom: i.unit,
      equipmentRef: i.requiresScale ? i.scale || null : null,
    },
  };
}

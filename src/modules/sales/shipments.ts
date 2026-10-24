import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { acknowledgeDeliveryReceipt } from "./delivery-receipts";

/**
 * Compatibility entry points of the MVP shipment API (pre Wave 3). Dispatch now runs through pick →
 * pack verification → `dispatchShipment` (src/modules/sales/dispatch.ts); `dispatchOrder` stays there,
 * switched off by default (A-W3E-02). Recording a delivery is a name-only DR acknowledgment.
 */
export async function recordDelivery(ctx: AuthContext, shipmentId: string, input: { receivedByName: string; deliveredAt: Date }) {
  if (input.deliveredAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError("validation", "Delivery time cannot be in the future.");
  return acknowledgeDeliveryReceipt(ctx, shipmentId, {
    receivedByName: input.receivedByName,
    receivedAt: input.deliveredAt,
    kind: "name_only",
    idempotencyKey: `record-delivery:${shipmentId}:${input.deliveredAt.getTime()}:${input.receivedByName.trim()}`,
  });
}

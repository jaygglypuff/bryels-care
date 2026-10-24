import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { completePacking, completePick, dispatchShipment, getPick, scanPackVerification, scanPick, startPick } from "@/modules/sales";

/**
 * Wave 3 W3E helpers: drive an allocated order through pick → pack verification → dispatch with
 * the real services (picker ≠ checker). Other streams that need a dispatched shipment use this
 * instead of the MVP `dispatchOrder` (switched off by default, A-W3E-02).
 */
export const key = () => uuidv7();

export async function pickAll(picker: AuthContext, orderId: string) {
  const { pickId, shipmentId } = await startPick(picker, orderId, { idempotencyKey: key() });
  const view = await getPick(picker, pickId);
  for (const r of view.rows) {
    if (r.boxNumber) await scanPick(picker, pickId, { payload: `BC:BOX:${r.boxNumber}`, idempotencyKey: key() });
    else await scanPick(picker, pickId, { payload: `BC:LOT:${r.lotNumber}`, qty: String(Number(r.qty)), idempotencyKey: key() });
  }
  await completePick(picker, pickId, {});
  return { pickId, shipmentId };
}

export async function verifyAll(checker: AuthContext, picker: AuthContext, pickId: string, shipmentId: string) {
  const view = await getPick(picker, pickId);
  const done = new Set<string>();
  for (const l of view.lines.filter((x) => !x.voidedAt)) {
    if (l.boxNumber) await scanPackVerification(checker, shipmentId, { payload: `BC:BOX:${l.boxNumber}`, idempotencyKey: key() });
    else if (!done.has(l.lotNumber)) {
      const qty = view.lines.filter((x) => !x.voidedAt && !x.boxNumber && x.lotNumber === l.lotNumber).reduce((a, x) => a + Number(x.qtyBase), 0);
      await scanPackVerification(checker, shipmentId, { payload: `BC:LOT:${l.lotNumber}`, qty: String(qty), idempotencyKey: key() });
      done.add(l.lotNumber);
    }
  }
  return completePacking(checker, shipmentId, { carrierName: "Own truck", packageCount: 2, idempotencyKey: key() });
}

/** Allocated order → dispatched shipment. Returns the shipment row. */
export async function shipOrder(a: { picker: AuthContext; checker: AuthContext; dispatcher: AuthContext }, orderId: string) {
  const { pickId, shipmentId } = await pickAll(a.picker, orderId);
  await verifyAll(a.checker, a.picker, pickId, shipmentId);
  await dispatchShipment(a.dispatcher, shipmentId, { driverName: "Jun Dela Cruz", vehiclePlate: "NFD 2468", idempotencyKey: key() });
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  return s;
}

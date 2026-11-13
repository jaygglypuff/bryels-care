import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers, salesOrders, shipments } from "@/db/schema";

/**
 * Customer names for message titles (ADR-132 §3: names before codes, B report #9). "the customer" when it cannot be
 * read, so a message is never lost for a name.
 */
export async function customerOfOrder(q: DbOrTx, salesOrderId: string): Promise<string> {
  const [r] = await q.select({ name: customers.name }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(eq(salesOrders.id, salesOrderId)).limit(1);
  return r?.name ?? "the customer";
}

export async function customerOfShipment(q: DbOrTx, shipmentId: string): Promise<string> {
  const [r] = await q
    .select({ name: customers.name })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  return r?.name ?? "the customer";
}

/**
 * ADR-124 item 3 (demo rehearsal 2026-11-07): the forward trace of a lot that is only set aside for an order, or taken
 * off the shelf for it, said "No customer has received this" without naming the order. The trace now lists, apart
 * from the customers who got it: "Set aside for order SO-… (Customer)" and "Taken off the shelf for order SO-…",
 * then "Sent to <customer> on <date>" once it leaves. Site-scoped like the rest of the trace.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots, salesOrderLines, stockAllocations } from "@/db/schema";
import { traceGenealogy } from "@/modules/quality";
import { allocateOrder, confirmOrder, createOrder, dispatchShipment, manilaToday } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { pickAll, verifyAll } from "../../support/w3e";
import { bundle, customerByCode, loadW4b, productBySku, stockUp, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;
let orderId: string;
let orderNumber: string;
let lotNumber: string;
let customerName: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  await stockUp(w, ["ACS-135"]);
  const c = await customerByCode("CUS-001");
  customerName = c.name;
  const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: d < manilaToday() ? manilaToday() : d, lines: [{ productId: (await productBySku("ACS-135")).id, qtyUnits: "12", unitPrice: "68" }] });
  orderId = o.id;
  orderNumber = o.orderNumber;
  await confirmOrder(w.sales, o.id);
  await allocateOrder(w.warehouse, o.id);
  const [a] = await db
    .select({ lotNumber: inventoryLots.lotNumber })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
    .where(and(eq(salesOrderLines.salesOrderId, o.id), eq(stockAllocations.status, "open")));
  lotNumber = a.lotNumber;
}, 180_000);

const mine = async (ctx = w.qa) => (await traceGenealogy(ctx, { lotNumber })).pendingOrders.filter((p) => p.orderId === orderId);

describe("trace names the order a lot waits for", () => {
  let pickId: string;
  let shipmentId: string;

  it("set aside: 'Set aside for order SO-… (Customer)', and no customer has it yet", async () => {
    const t = await traceGenealogy(w.qa, { lotNumber });
    expect(t.affectedCustomers.filter((c) => c.orderId === orderId)).toHaveLength(0);
    const p = t.pendingOrders.filter((x) => x.orderId === orderId);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ stage: "set_aside", orderNumber, customerName, qty: "12.000000" });
    expect(p[0].words).toBe(`Set aside for order ${orderNumber} (${customerName})`);
  });

  it("taken off the shelf: 'Taken off the shelf for order …', not also set aside", async () => {
    ({ pickId, shipmentId } = await pickAll(w.warehouse, orderId));
    const p = await mine();
    expect(p.map((x) => x.stage)).toEqual(["picked"]);
    expect(p[0].words).toBe(`Taken off the shelf for order ${orderNumber} (${customerName})`);
    expect(p[0].shipmentId).toBe(shipmentId);
    // Still taken off the shelf after the second check of the box, until it is sent out.
    await verifyAll(w.manager, w.warehouse, pickId, shipmentId);
    expect((await mine()).map((x) => x.stage)).toEqual(["picked"]);
  });

  it("sent out: the customer and the date, nothing waiting any more", async () => {
    await dispatchShipment(w.warehouse, shipmentId, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: randomUUID() });
    const t = await traceGenealogy(w.qa, { lotNumber });
    expect(t.pendingOrders.filter((x) => x.orderId === orderId)).toHaveLength(0);
    const sent = t.affectedCustomers.filter((c) => c.orderId === orderId);
    expect(sent).toHaveLength(1);
    expect(sent[0].customerName).toBe(customerName);
  });

  it("another site's people never see the lot or its orders; trace permission is needed", async () => {
    const rvsQa = withPermissions(w.qa, bundle("qa_qc"), w.qa.roleCodes, [w.rvs]);
    const t = await traceGenealogy(rvsQa, { lotNumber });
    expect(t.root).toBeNull();
    expect(t.pendingOrders).toHaveLength(0);
    const noTrace = withPermissions(w.qa, ["inventory.lot.view"], w.qa.roleCodes, [w.nfd]);
    await expect(traceGenealogy(noTrace, { lotNumber })).rejects.toMatchObject({ code: "forbidden" });
  });
});

/**
 * Wave 3 integration: W2A planning reads W3E allocations by status. A released allocation (W3E never
 * deletes allocations) neither covers the order's demand nor reduces available stock; open allocations
 * of orders in any fulfilment state do.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { demandSnapshot } from "@/modules/production";
import { allocateOrder, createOrder, releaseAllocations, submitOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";

let w: W3d;
let acs: string;
const row = async () => (await demandSnapshot(db, w.manager, w.nfd.id, inDays(60))).find((r) => r.productId === acs);

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  acs = await productId("ACS-135");
}, 180_000);

describe("planning demand and availability with W3E allocations", () => {
  it("counts a released allocation neither as cover nor as held stock", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: "7", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    const before = (await row())!;
    expect(before.salesOrderIds.has(o.id)).toBe(true);
    await allocateOrder(w.warehouse, o.id);
    const allocated = (await row())!;
    expect(allocated.salesOrderIds.has(o.id)).toBe(false); // allocated: no longer open demand
    expect(allocated.available.toString()).toBe(before.available.minus(7).toString()); // the open allocation holds the stock
    await releaseAllocations(w.warehouse, o.id, { reason: "Customer postponed (test)" });
    const released = (await row())!;
    expect(released.salesOrderIds.has(o.id)).toBe(true);
    expect(released.soDemand.toString()).toBe(before.soDemand.toString());
    expect(released.available.toString()).toBe(before.available.toString());
  });
});

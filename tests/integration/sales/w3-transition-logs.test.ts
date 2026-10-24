/**
 * Wave 3 integration: the state-transition logs of sales orders, shipments (W3D/W3E), complaints and
 * customer returns (W3F) are append-only by trigger (src/db/sql/w3i.sql, w3f.sql), like W2C's; the
 * custom migrations are verbatim copies of the canonical SQL (drift tests). Every fulfilment move of an
 * order goes through W3D's transitionOrder and lands in sales_order_state_transitions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { complaintStateTransitions, customerReturnStateTransitions, salesOrderStateTransitions, shipmentStateTransitions } from "@/db/schema";
import { allocateOrder, createOrder, submitOrder } from "@/modules/sales";
import { customMigration } from "../../support/custom-sql";
import { resetTestDatabase } from "../../support/db";
import { inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";
import { shipOrder } from "../../support/w3e";

let w: W3d;
/** The trigger's message arrives as the cause of drizzle's "Failed query" error. */
async function refused(p: Promise<unknown>) {
  const e = (await p.then(() => null).catch((x) => x)) as { message?: string; cause?: { message?: string } } | null;
  expect(e, "the statement must fail").toBeTruthy();
  expect(`${e?.message} ${e?.cause?.message ?? ""}`).toMatch(/append-only/);
}
let orderId: string;
let shipmentId: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "6", unitPrice: "70" }] });
  orderId = o.id;
  await submitOrder(w.sales, o.id);
  await allocateOrder(w.warehouse, o.id);
  shipmentId = (await shipOrder({ picker: w.warehouse, checker: w.manager, dispatcher: w.warehouse }, o.id)).id;
}, 180_000);

describe("one sales order machine across W3D and W3E", () => {
  it("records every move from draft to shipped in sales_order_state_transitions, in order", async () => {
    const rows = await db.select().from(salesOrderStateTransitions).where(eq(salesOrderStateTransitions.salesOrderId, orderId)).orderBy(asc(salesOrderStateTransitions.occurredAt), asc(salesOrderStateTransitions.id));
    expect(rows.map((r) => `${r.fromState}>${r.toState}`)).toEqual(["null>draft", "draft>submitted", "submitted>confirmed", "confirmed>allocated", "allocated>picking", "picking>packed", "packed>shipped"]);
    expect(rows.every((r) => r.actorId && r.correlationId)).toBe(true);
    const ship = await db.select().from(shipmentStateTransitions).where(eq(shipmentStateTransitions.shipmentId, shipmentId));
    expect(ship.map((r) => r.toState)).toEqual(expect.arrayContaining(["picked", "packed", "dispatched"]));
  });
});

describe("append-only transition logs (custom SQL w3i, w3f)", () => {
  it("the custom migrations are verbatim copies of src/db/sql/w3i.sql and w3f.sql", () => {
    for (const stream of ["w3i", "w3f"]) {
      const { migration, canonical } = customMigration(stream);
      expect(migration.endsWith(canonical)).toBe(true);
    }
  });

  it("refuses UPDATE and DELETE on the four Wave 3 transition tables", async () => {
    const tables = [
      ["sales_order_state_transitions", salesOrderStateTransitions],
      ["shipment_state_transitions", shipmentStateTransitions],
      ["complaint_state_transitions", complaintStateTransitions],
      ["customer_return_state_transitions", customerReturnStateTransitions],
    ] as const;
    for (const [name, table] of tables) {
      const [row] = await db.select({ id: table.id }).from(table).limit(1);
      expect(row, `${name} has a row (seed or this test)`).toBeTruthy();
      await refused(db.execute(sql`update ${sql.identifier(name)} set reason = 'changed' where id = ${row.id}`));
      await refused(db.execute(sql`delete from ${sql.identifier(name)} where id = ${row.id}`));
    }
  });
});

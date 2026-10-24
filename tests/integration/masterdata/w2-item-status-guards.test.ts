import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, locations, materials, products, suppliers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createReceiptDraft } from "@/modules/inventory/receiving";
import { createBatch } from "@/modules/production";
import { createOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { acapulcoRevisionId, allowDirectBatches, manilaDay } from "../../support/w2b";

/**
 * Wave 2 integration: receiving, batch creation and sales orders refuse items that master data
 * (W2G, US-1-22/23) has not released for use — draft, blocked or discontinued materials and products.
 */

let kit: Kit;
let wh: AuthContext;
let manager: AuthContext;
let sales: AuthContext;

const setMaterial = (code: string, status: string) => db.update(materials).set({ status }).where(eq(materials.code, code));
const setProduct = (sku: string, status: string) => db.update(products).set({ status }).where(eq(products.skuCode, sku));

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  await allowDirectBatches(kit);
}, 180_000);

afterEach(async () => {
  await setMaterial("MAT-0012", "active");
  await setProduct("ACS-135", "active");
});

async function receiptOf(code: string) {
  const [m] = await db.select().from(materials).where(eq(materials.code, code));
  const [q] = await db.select().from(locations).where(eq(locations.code, "QUA-01"));
  const [s] = await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply"));
  return createReceiptDraft(wh, {
    idempotencyKey: randomUUID(),
    supplierId: s.id,
    supplierDocumentNumber: "DR-STATUS-1",
    lines: [{ materialId: m.id, qty: "25", uom: "kg", supplierLotNumber: "LOS-ST1", expiresOn: manilaDay(365), locationId: q.id }],
  });
}

describe("item status guards (W2G master data in the operational modules)", () => {
  it("receiving refuses a blocked or draft material and accepts it again when active", async () => {
    for (const status of ["blocked", "draft", "discontinued"]) {
      await setMaterial("MAT-0012", status);
      const e = await expectCode(receiptOf("MAT-0012"), "validation");
      expect(e.message).toMatch(new RegExp(status));
    }
    await setMaterial("MAT-0012", "active");
    expect((await receiptOf("MAT-0012")).receiptId).toBeTruthy();
  });

  it("a batch is refused for a discontinued product or a blocked ingredient", async () => {
    const input = { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "8.8", plannedStartOn: manilaDay(0) };
    await setProduct("ACS-135", "discontinued");
    expect((await expectCode(createBatch(manager, input), "validation")).message).toMatch(/discontinued/);
    await setProduct("ACS-135", "active");
    await setMaterial("MAT-0012", "blocked");
    expect((await expectCode(createBatch(manager, input), "validation")).message).toMatch(/blocked/);
  });

  it("a sales order line is refused for a product that is not active", async () => {
    const [c] = await db.select().from(customers).limit(1);
    const [p] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    await setProduct("ACS-135", "draft");
    const e = await expectCode(createOrder(sales, { customerId: c.id, requestedDeliveryOn: manilaDay(7), lines: [{ productId: p.id, qtyUnits: "24", unitPrice: "70" }] }), "validation");
    expect(e.message).toMatch(/draft/);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, purchaseOrderLines, purchaseOrders, supplierReturns } from "@/db/schema";
import { createSupplierBill, getSupplierBill, purchaseOrderMatchSource, resolveBillDispute, submitSupplierBill } from "@/modules/finance";
import { receiveAgainstPurchaseOrder } from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { loadKit, loc, type Kit } from "../../support/kit";
import { today } from "../../support/w4b";
import { sentPo, w4aUsers, type W4aUsers } from "../procurement/w4a-fixtures";

/**
 * Wave 4 integration (W4A ↔ W4B): the supplier bill's three-way match reads W4A's purchase orders through
 * `registerPurchaseOrderMatchSource` (src/modules/wiring.ts). The bill quantity is in the material's base unit
 * (A-W4B-05) while the PO price is per purchase unit, so the source reports the PO price per base unit.
 */
let kit: Kit;
let u: W4aUsers;
let po: typeof purchaseOrders.$inferSelect;
let poLine: typeof purchaseOrderLines.$inferSelect;
let grLineId: string;
let ref = 0;
const nextRef = () => `SI-W4I-${++ref}`;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
  po = await sentPo(u, [{ code: "MAT-0012", qty: "100" }]);
  [poLine] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const r = await receiveAgainstPurchaseOrder(u.warehouse, {
    purchaseOrderId: po.id,
    supplierDocumentNumber: "LOS-DR-W4I-1",
    lines: [{ purchaseOrderLineId: poLine.id, materialId: poLine.materialId, qty: "40", uom: "kg", supplierLotNumber: "LOS-W4I-1", expiresOn: exp, locationId: (await loc(kit.nfd.id, "QUA-01")).id, storageConditionsConfirmed: true }],
    idempotencyKey: crypto.randomUUID(),
    intent: "post",
  });
  const [grl] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  grLineId = grl.id;
  receiptId = r.receiptId;
});
let receiptId: string;

/** PO price per base unit (the PO line price is per purchase unit, e.g. per kg; the bill counts grams). */
const basePrice = () => (Number(poLine.lineAmount) / Number(poLine.qtyBase)).toFixed(4);

async function billOf(qtyBase: string, unitAmount: string) {
  return createSupplierBill(u.finance, { supplierId: po.supplierId, supplierReference: nextRef(), billDate: today(), goodsReceiptId: receiptId, lines: [{ goodsReceiptLineId: grLineId, qty: qtyBase, unitAmount }] });
}

describe("W4A ↔ W4B: three-way match against real purchase orders", () => {
  it("the purchase-order source is registered by the app hooks and reports the PO price per base unit", async () => {
    const source = purchaseOrderMatchSource();
    expect(source).not.toBeNull();
    const [l] = await source!.linesById(db, kit.orgId, [poLine.id]);
    expect(l).toMatchObject({ purchaseOrderLineId: poLine.id, purchaseOrderId: po.id, poNumber: po.poNumber, supplierId: po.supplierId, materialId: poLine.materialId, currency: poLine.currency });
    expect(Number(l.qtyOrderedBase)).toBe(100000);
    expect(Number(l.unitAmount)).toBeCloseTo(Number(poLine.lineAmount) / Number(poLine.qtyBase), 8);
    // Organization-scoped: another organization's id sees nothing.
    expect(await source!.linesById(db, "00000000-0000-7000-8000-000000000000", [poLine.id])).toEqual([]);
    const map = await source!.poLineOfReceiptLine!(db, [grLineId]);
    expect(map.get(grLineId)).toBe(poLine.id);
  });

  it("a bill at the PO price for the received quantity matches on quantity and price (PO found through the receipt line)", async () => {
    expect(Number(poLine.unitAmount)).toBeGreaterThan(0);
    const b = await billOf("40000", basePrice());
    const r = await submitSupplierBill(u.finance, b.billId);
    expect(r.match[0].result).toBe("matched");
    expect(r.match[0].detail.poNumber).toBe(po.poNumber);
    expect(r.status).not.toBe("disputed");
  });

  it("billing more than was received (partial receipt) is a quantity variance", async () => {
    const b = await billOf("60000", basePrice());
    const r = await submitSupplierBill(u.finance, b.billId);
    expect(r.status).toBe("disputed");
    expect(r.match[0].result).toBe("qty_variance");
  });

  it("a price above the PO price beyond tolerance is a price variance; the dispute shows the supplier's expected credits", async () => {
    // Another receipt so the first bill's quantity does not collide.
    const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const r2 = await receiveAgainstPurchaseOrder(u.warehouse, {
      purchaseOrderId: po.id,
      supplierDocumentNumber: "LOS-DR-W4I-2",
      lines: [{ purchaseOrderLineId: poLine.id, materialId: poLine.materialId, qty: "20", uom: "kg", supplierLotNumber: "LOS-W4I-2", expiresOn: exp, locationId: (await loc(kit.nfd.id, "QUA-01")).id, storageConditionsConfirmed: true }],
      idempotencyKey: crypto.randomUUID(),
      intent: "post",
    });
    const [grl2] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r2.receiptId));
    const high = (Number(basePrice()) * 1.5).toFixed(4);
    const b = await createSupplierBill(u.finance, { supplierId: po.supplierId, supplierReference: nextRef(), billDate: today(), goodsReceiptId: r2.receiptId, lines: [{ goodsReceiptLineId: grl2.id, qty: "20000", unitAmount: high }] });
    const r = await submitSupplierBill(u.finance, b.billId);
    expect(r.status).toBe("disputed");
    expect(r.match[0].result).toBe("price_variance");
    expect(Number(r.match[0].detail.poUnitAmount)).toBeCloseTo(Number(basePrice()), 4);
    // Re-match keeps the dispute while the PO price is unchanged.
    expect((await resolveBillDispute(u.finance, b.billId, { action: "rematch" })).status).toBe("disputed");

    // A posted supplier return of the same supplier with an expected credit is listed on the disputed bill.
    const [srt] = await db
      .insert(supplierReturns)
      .values({ organizationId: kit.orgId, siteId: po.siteId, returnNumber: "SRT-W4I-0001", status: "posted", supplierId: po.supplierId, reasonCode: "rejected_at_inspection", creditExpectedAmount: "1234.5000", currency: "PHP", createdBy: u.proc.userId, submittedBy: u.proc.userId, submittedAt: new Date(), approvedBy: u.manager.userId, approvedAt: new Date(), postedBy: u.warehouse.userId, postedAt: new Date() })
      .returning();
    const view = await getSupplierBill(u.finance, b.billId);
    expect(view.expectedSupplierCredits.map((c) => c.returnNumber)).toContain(srt.returnNumber);
    expect(view.expectedSupplierCredits.find((c) => c.returnNumber === srt.returnNumber)?.creditExpectedAmount).toBe("1234.5000");
  });
});

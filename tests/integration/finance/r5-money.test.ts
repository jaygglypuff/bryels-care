/**
 * Round 5 office fixes, money (docs/ux-audit/round5/C-office.md problems 7, 9, 2 and 14; bugs B12, B13). ADR-131.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, purchaseOrderLines, purchaseOrders, supplierBillLines, supplierBills } from "@/db/schema";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import {
  billableReceipts,
  changeSupplierBillLines,
  createSupplierBill,
  decideSupplierBill,
  fixPostedSupplierBill,
  lockPeriod,
  monthEndChecklist,
  postSupplierBill,
  submitSupplierBill,
} from "@/modules/finance";
import { receiveAgainstPurchaseOrder } from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { PW, today } from "../../support/w4b";
import { setOrgSetting } from "../production/w2a-fixtures";
import { sentPo, w4aUsers, type W4aUsers } from "../procurement/w4a-fixtures";

let kit: Kit;
let u: W4aUsers;
let po: typeof purchaseOrders.$inferSelect;
let poLine: typeof purchaseOrderLines.$inferSelect;
let grLineId: string;
let receiptId: string;
let ref = 0;
const nextRef = () => `SI-R5-${++ref}`;

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
    supplierDocumentNumber: "LOS-DR-R5-1",
    lines: [{ purchaseOrderLineId: poLine.id, materialId: poLine.materialId, qty: "25", uom: "kg", supplierLotNumber: "LOS-R5-1", expiresOn: exp, locationId: (await loc(kit.nfd.id, "QUA-01")).id, storageConditionsConfirmed: true }],
    idempotencyKey: randomUUID(),
    intent: "post",
  });
  receiptId = r.receiptId;
  [{ id: grLineId }] = await db.select({ id: goodsReceiptLines.id }).from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, receiptId));
}, 180_000);

describe("supplier bill per kg, prefilled from the order (C-office problem 7)", () => {
  it("the delivery offers the order's unit and price", async () => {
    const r = (await billableReceipts(u.finance)).find((x) => x.id === receiptId)!;
    expect(r.poNumber).toBe(po.poNumber);
    expect(r.lines[0]).toMatchObject({ poUom: poLine.uomEntered, poNumber: po.poNumber });
    expect(Number(r.lines[0].poUnitAmount)).toBe(Number(poLine.unitAmount));
  });

  it("10 kg at the per-kg price is stored as 10,000 g and matches the order exactly", async () => {
    const b = await createSupplierBill(u.finance, { supplierId: po.supplierId, supplierReference: nextRef(), billDate: today(), goodsReceiptId: receiptId, lines: [{ goodsReceiptLineId: grLineId, qty: "10", uom: "kg", unitAmount: String(Number(poLine.unitAmount)) }] });
    const [l] = await db.select().from(supplierBillLines).where(eq(supplierBillLines.supplierBillId, b.billId));
    expect(Number(l.qty)).toBe(10000);
    expect(Number(l.lineAmount)).toBe(10 * Number(poLine.unitAmount));
    const r = await submitSupplierBill(u.finance, b.billId);
    expect(r.match[0].result).toBe("matched");
  });

  it("a typo (the per-kg price typed for each gram) is caught, then fixed with Change the bill, which re-checks it", async () => {
    const b = await createSupplierBill(u.finance, { supplierId: po.supplierId, supplierReference: nextRef(), billDate: today(), goodsReceiptId: receiptId, lines: [{ goodsReceiptLineId: grLineId, qty: "5000", unitAmount: String(Number(poLine.unitAmount)) }] });
    expect((await submitSupplierBill(u.finance, b.billId)).status).toBe("disputed");
    await changeSupplierBillLines(u.finance, b.billId, { reason: "I typed the price per gram", lines: [{ goodsReceiptLineId: grLineId, qty: "5", uom: "kg", unitAmount: String(Number(poLine.unitAmount)) }], idempotencyKey: randomUUID() });
    const [row] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId));
    expect(row.status).toBe("draft");
    expect(Number(row.subtotalAmount)).toBe(5 * Number(poLine.unitAmount));
    expect((await submitSupplierBill(u.finance, b.billId)).status).not.toBe("disputed");
    await expectCode(changeSupplierBillLines(u.warehouse, b.billId, { reason: "warehouse tries", lines: [] }), "forbidden");
  });

  it("Fix a mistake on a bill in the books: the old one is undone (kept) and a draft copy with the same number is made, in one step", async () => {
    await setOrgSetting(kit.orgId, "finance.match.price_tolerance_pct", 100);
    const reference = nextRef();
    const b = await createSupplierBill(u.finance, { supplierId: po.supplierId, supplierReference: reference, billDate: today(), goodsReceiptId: receiptId, lines: [{ goodsReceiptLineId: grLineId, qty: "1", uom: "kg", unitAmount: String(Number(poLine.unitAmount)) }] });
    const s = await submitSupplierBill(u.finance, b.billId);
    const finance2 = await asUser(kit, "auditor@bryels-care.test", "finance", [kit.nfd, kit.rvs]);
    if (s.status === "submitted") await decideSupplierBill(finance2, b.billId, { decision: "approved" });
    await postSupplierBill(finance2, b.billId, { password: PW });
    const fixed = await fixPostedSupplierBill(u.finance, b.billId, { reason: "Wrong quantity typed", password: PW, idempotencyKey: randomUUID() });
    const [old] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId));
    const [copy] = await db.select().from(supplierBills).where(eq(supplierBills.id, fixed.billId));
    expect(old.status).toBe("voided");
    expect(copy).toMatchObject({ status: "draft", supplierReference: reference, goodsReceiptId: receiptId });
    await expectCode(fixPostedSupplierBill(u.warehouse, fixed.billId, { reason: "warehouse tries", password: PW }), "forbidden");
    await setOrgSetting(kit.orgId, "finance.match.price_tolerance_pct", 2);
  });
});

describe("month end (C-office problem 14)", () => {
  it("the checklist counts what is not finished, with links; the current month is refused unless closed anyway with a reason", async () => {
    const month = today().slice(0, 7);
    const items = await monthEndChecklist(u.finance, month);
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(["not_billed", "no_bill", "payments"]));
    for (const i of items) expect(i.href).toMatch(/^\/finance\//);
    await expectCode(lockPeriod(u.finance, month, { reason: "Month end", acknowledge: true, acknowledgementNote: "Open papers carried over", password: PW }), "state");
    const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
    await expectCode(lockPeriod(u.finance, next, { reason: "Too early", acknowledge: true, acknowledgementNote: "x", password: PW, closeEarly: true }), "state");
    await expectCode(monthEndChecklist(u.warehouse, month), "forbidden");
  });
});

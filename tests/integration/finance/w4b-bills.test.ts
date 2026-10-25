import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { financialPostings, goodsReceiptLines, goodsReceipts, supplierBillLines, supplierBills } from "@/db/schema";
import {
  billableReceipts,
  cancelSupplierBill,
  createPayment,
  createSupplierBill,
  decidePayment,
  decideSupplierBill,
  disputedBills,
  editSupplierBill,
  getSupplierBill,
  listSupplierBills,
  postSupplierBill,
  recordPayment,
  registerPurchaseOrderMatchSource,
  resolveBillDispute,
  submitPayment,
  submitSupplierBill,
  voidSupplierBill,
} from "@/modules/finance";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, approvedTax, bundle, loadW4b, today, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;
let gr: typeof goodsReceipts.$inferSelect;
let grLine: typeof goodsReceiptLines.$inferSelect;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  // A posted MVP receipt of a known supplier at NFD (fictional seed).
  const rows = await db
    .select({ g: goodsReceipts, l: goodsReceiptLines })
    .from(goodsReceipts)
    .innerJoin(goodsReceiptLines, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
    .where(and(eq(goodsReceipts.siteId, w.nfd.id), eq(goodsReceipts.status, "posted"), sql`${goodsReceipts.supplierId} is not null`))
    .limit(1);
  gr = rows[0].g;
  grLine = rows[0].l;
});

afterAll(() => registerPurchaseOrderMatchSource({ linesById: async () => [] }));

let ref = 0;
const nextRef = () => `SI-TEST-${++ref}`;

async function bill(qty: string, unit: string, extra: Partial<Parameters<typeof createSupplierBill>[1]> = {}) {
  return createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), goodsReceiptId: gr.id, lines: [{ goodsReceiptLineId: grLine.id, qty, unitAmount: unit }], ...extra });
}

describe("US-6-11 supplier bills with three-way match", () => {
  it("lists posted receipts with what is still unbilled", async () => {
    const rs = await billableReceipts(w.finance);
    const r = rs.find((x) => x.id === gr.id);
    expect(r?.lines.find((l) => l.id === grLine.id)?.qtyUnbilled).toBe(Number(grLine.qtyBase).toFixed(4));
    await expectCode(billableReceipts(w.sales), "forbidden");
  });

  it("bill.three_way_match_variance: billing more than received parks the bill in dispute until a different person approves the variance", async () => {
    const over = (Number(grLine.qtyBase) * 1.1).toFixed(0);
    const b = await bill(over, "0.2");
    const r = await submitSupplierBill(w.finance, b.billId);
    expect(r.status).toBe("disputed");
    expect(r.match[0].result).toBe("qty_variance");
    expect((await disputedBills(w.orgId)).map((c) => c.entityId)).toContain(b.billId);
    await expectCode(resolveBillDispute(w.finance, b.billId, { action: "approve_variance", reason: "Supplier delivered the extra later" }), "separation_of_duties");
    await expectCode(resolveBillDispute(w.finance2, b.billId, { action: "approve_variance", reason: "" }), "validation");
    const ok = await resolveBillDispute(w.finance2, b.billId, { action: "approve_variance", reason: "Extra quantity accepted by procurement (fictional)" });
    expect(ok.status).toBe("submitted");
    expect((await disputedBills(w.orgId)).map((c) => c.entityId)).not.toContain(b.billId);
    // Clean up so later bills of this receipt line match again.
    await cancelSupplierBill(w.finance, b.billId, "Test cleanup");
  });

  it("within tolerance: matched, approved by another finance person, posted on the bill date; due date from the supplier terms", async () => {
    const b = await bill(String(Number(grLine.qtyBase)), "0.15");
    const r = await submitSupplierBill(w.procurement, b.billId);
    expect(r.status).toBe("submitted");
    expect(r.match[0].result).toBe("no_po"); // receipt matched; no PO data connected yet
    await expectCode(decideSupplierBill(w.finance, b.billId, { decision: "approved" }), "separation_of_duties");
    await decideSupplierBill(w.finance2, b.billId, { decision: "approved" });
    await expectCode(postSupplierBill(w.procurement, b.billId, { password: PW }), "forbidden");
    await postSupplierBill(w.finance2, b.billId, { password: PW });
    const [row] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId));
    expect(row.status).toBe("posted");
    expect(row.dueDate).toBeTruthy();
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, b.billId));
    expect(posts[0]).toMatchObject({ postingType: "bill_post", direction: "credit", postingDate: today() });
    // A second bill for the same receipt line is now over-billed (already billed elsewhere).
    const again = await bill("1", "0.15");
    expect((await submitSupplierBill(w.finance, again.billId)).status).toBe("disputed");
    await cancelSupplierBill(w.finance, again.billId, "Duplicate");
    // Outbound payment settles the bill.
    const p = await createPayment(w.finance, { direction: "outbound", supplierId: gr.supplierId!, method: "bank_transfer", bankReference: "DEMO-OUT-1", paidOn: today(), amount: row.totalAmount });
    await submitPayment(w.finance, p.paymentId);
    await decidePayment(w.finance2, p.paymentId, { decision: "approved" });
    await recordPayment(w.finance, p.paymentId, { password: PW });
    expect((await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId)))[0].status).toBe("paid");
    await expectCode(voidSupplierBill(w.finance, b.billId, { reason: "Paid", password: PW }), "state");
  });

  it("price leg: with W4A's purchase order source registered, a price beyond ±2 % / PHP 100 is a price variance", async () => {
    const poLineId = "01a00000-0000-7000-8000-00000000a001";
    registerPurchaseOrderMatchSource({
      linesById: async (_q, _org, ids) => ids.filter((x) => x === poLineId).map((x) => ({ purchaseOrderLineId: x, purchaseOrderId: x, poNumber: "PO-26-00001", supplierId: gr.supplierId!, materialId: grLine.materialId, qtyOrderedBase: "100000", unitAmount: "0.10", currency: "PHP" })),
    });
    try {
      const fresh = await db
        .select({ l: goodsReceiptLines })
        .from(goodsReceiptLines)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
        .where(and(eq(goodsReceipts.id, gr.id), sql`${goodsReceiptLines.id} <> ${grLine.id}`))
        .limit(1);
      const line = fresh[0]?.l ?? grLine;
      const qty = "1000";
      const okBill = await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), lines: [{ purchaseOrderLineId: poLineId, materialId: line.materialId, description: "PO line goods", qty, unitAmount: "0.101" }], goodsReceiptId: null, categoryCode: null, purchaseOrderId: poLineId });
      expect((await submitSupplierBill(w.finance, okBill.billId)).match[0].result).toBe("matched");
      const bad = await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), lines: [{ purchaseOrderLineId: poLineId, materialId: line.materialId, description: "PO line goods", qty: "10000", unitAmount: "0.13" }], purchaseOrderId: poLineId });
      const r = await submitSupplierBill(w.finance, bad.billId);
      expect(r.status).toBe("disputed");
      expect(r.match[0].result).toBe("price_variance");
      expect(r.match[0].detail.poNumber).toBe("PO-26-00001");
      // After a PO amendment (the source now returns the new price) a re-match clears the dispute.
      registerPurchaseOrderMatchSource({ linesById: async (_q, _o, ids) => ids.map((x) => ({ purchaseOrderLineId: x, purchaseOrderId: x, poNumber: "PO-26-00001", supplierId: gr.supplierId!, materialId: line.materialId, qtyOrderedBase: "100000", unitAmount: "0.13", currency: "PHP" })) });
      expect((await resolveBillDispute(w.finance, bad.billId, { action: "rematch" })).status).toBe("submitted");
    } finally {
      registerPurchaseOrderMatchSource({ linesById: async () => [] });
    }
  });

  it("A-FIN-09: without a receipt or PO only configured non-stock categories are allowed, and only finance approves them", async () => {
    await expectCode(createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), lines: [{ chargeKind: "other", description: "Office rent", qty: "1", unitAmount: "1000" }] }), "validation");
    await expectCode(createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "travel", lines: [{ chargeKind: "other", description: "Office rent", qty: "1", unitAmount: "1000" }] }), "validation");
    const b = await createSupplierBill(w.procurement, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "utilities", lines: [{ chargeKind: "other", description: "Water bill (fictional)", qty: "1", unitAmount: "1500" }] });
    expect((await submitSupplierBill(w.procurement, b.billId)).status).toBe("submitted");
    const notFinance = withPermissions(w.owner, [...bundle("owner_director"), "finance.supplier_bill.approve"], ["owner_director", "site_manager"]);
    await expectCode(decideSupplierBill(notFinance, b.billId, { decision: "approved" }), "forbidden");
    await decideSupplierBill(w.finance, b.billId, { decision: "approved" });
    await postSupplierBill(w.finance, b.billId, { password: PW });
    await expectCode(voidSupplierBill(w.finance, b.billId, { reason: "", password: PW }), "validation");
    await voidSupplierBill(w.finance, b.billId, { reason: "Entered against the wrong supplier", password: PW });
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, b.billId));
    expect(posts.map((p) => p.postingType).sort()).toEqual(["bill_post", "reversal"]);
  });

  it("V-FIN-DUP: the supplier's bill number is entered once per supplier", async () => {
    const r = nextRef();
    await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: r, billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "Service", qty: "1", unitAmount: "10" }] });
    const e = await expectCode(createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: r.toLowerCase(), billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "Service", qty: "1", unitAmount: "10" }] }), "conflict");
    expect(e.details?.code).toBe("DUPLICATE_DOCUMENT");
  });

  it("supplier credit reduces the open amount of its bill; input tax comes from the reviewed configuration", async () => {
    await approvedTax(w, "TST-IN12", "12", { appliesTo: "purchases" });
    const b = await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "Calibration service", qty: "1", unitAmount: "1000", taxCode: "TST-IN12" }] });
    const [row] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId));
    expect(row).toMatchObject({ subtotalAmount: "1000.0000", taxAmount: "120.0000", totalAmount: "1120.0000" });
    await submitSupplierBill(w.finance, b.billId);
    await decideSupplierBill(w.finance2, b.billId, { decision: "approved" });
    await postSupplierBill(w.finance, b.billId, { password: PW });
    const credit = await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), billKind: "credit", creditForBillId: b.billId, lines: [{ chargeKind: "other", description: "Credit for a late visit", qty: "1", unitAmount: "120" }] });
    await submitSupplierBill(w.finance, credit.billId);
    await decideSupplierBill(w.finance2, credit.billId, { decision: "approved" });
    await postSupplierBill(w.finance, credit.billId, { password: PW });
    const [after] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.billId));
    expect(after).toMatchObject({ status: "partially_paid", paidAmount: "120.0000" });
    await expectCode(createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "x", qty: "1", unitAmount: "1", taxCode: "NOPE" }] }), "validation");
  });

  it("edits, scope and roles", async () => {
    const b = await createSupplierBill(w.finance, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "Service", qty: "1", unitAmount: "10" }] });
    await editSupplierBill(w.finance, b.billId, { notes: "Checked with the supplier" });
    await expectCode(editSupplierBill(w.procurement, b.billId, { notes: "x" }), "forbidden");
    const rvsOnly = withPermissions(w.finance, bundle("finance"), ["finance"], [w.rvs]);
    await expectCode(getSupplierBill(rvsOnly, b.billId), "not_found");
    await expectCode(postSupplierBill(rvsOnly, b.billId, { password: PW }), "not_found");
    for (const ctx of [w.warehouse, w.sales, w.qa, w.admin]) await expectCode(listSupplierBills(ctx), "forbidden");
    expect((await listSupplierBills(w.manager)).length).toBeGreaterThan(0);
    await expectCode(createSupplierBill(w.manager, { supplierId: gr.supplierId!, supplierReference: nextRef(), billDate: today(), categoryCode: "services", lines: [{ chargeKind: "other", description: "Service", qty: "1", unitAmount: "10" }] }), "forbidden");
    const lines = await db.select().from(supplierBillLines).where(eq(supplierBillLines.supplierBillId, b.billId));
    expect(lines).toHaveLength(1);
  });
});

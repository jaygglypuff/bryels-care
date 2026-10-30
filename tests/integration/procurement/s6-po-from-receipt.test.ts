import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrderStateTransitions, purchaseOrders } from "@/db/schema";
import { receiveAndPost, reverseReceipt, createReceiptDraft } from "@/modules/inventory";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPoFromReceipt,
  decidePurchaseOrder,
  expectedReceipts,
  getPurchaseOrder,
  poFromReceiptOptions,
  receiveAgainstPurchaseOrder,
  sendPurchaseOrder,
  submitPurchaseOrder,
  updatePurchaseOrder,
} from "@/modules/procurement";
import { purchaseOrderLineOfReceiptLines } from "@/modules/procurement/finance-match";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { materialByCode, sentPo, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

/**
 * S6 (ADR-077): an urgent delivery is received without a PO, then the buyer creates the PO afterwards from
 * the receipt. The PO is marked after-the-fact, linked to the receipt, already received (nothing expected)
 * and goes through the normal approval; it is never sent or received twice.
 */

let kit: Kit;
let u: W4aUsers;
let quaId: string;
const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

async function urgentReceipt(doc: string, qty = "5") {
  const coconut = await materialByCode("MAT-0012");
  const r = await receiveAndPost(u.warehouse, {
    supplierName: "Laguna Oleo Supply",
    supplierDocumentNumber: doc,
    unplannedReasonCode: "no_purchase_order",
    idempotencyKey: crypto.randomUUID(),
    lines: [{ materialId: coconut.id, qty, uom: "kg", supplierLotNumber: `${doc}-L1`, expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }],
  });
  const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  return { receiptId: r.receiptId, lines };
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
  quaId = (await loc(kit.nfd.id, "QUA-01")).id;
});

describe("S6 receive without a PO, then create the PO from the receipt", () => {
  it("receiving without a PO already works and the receipt offers 'Create PO'", async () => {
    const { receiptId } = await urgentReceipt("URG-DR-1");
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, receiptId));
    expect(gr).toMatchObject({ receiptKind: "unplanned", status: "posted", purchaseOrderId: null });
    const opts = await poFromReceiptOptions(u.proc, receiptId);
    expect(opts).toMatchObject({ canCreate: true, purchaseOrder: null, blockedReason: null });
    expect(opts.lines).toHaveLength(1);
    // The warehouse operator sees the receipt but may not create purchase orders.
    expect((await poFromReceiptOptions(u.warehouse, receiptId)).canCreate).toBe(false);
  });

  it("creates a draft after-the-fact PO pre-filled from the received lines, already received, nothing expected", async () => {
    const { receiptId, lines } = await urgentReceipt("URG-DR-2", "5");
    const key = crypto.randomUUID();
    const r = await createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent buy for the soap run, ordered by phone.", lines: [{ receiptLineId: lines[0].id, unitAmount: "120" }], idempotencyKey: key });
    expect(r.replayed).toBe(false);
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.purchaseOrderId));
    const supplier = await supplierByName("Laguna Oleo Supply");
    expect(po).toMatchObject({ status: "draft", afterTheFact: true, sourceGoodsReceiptId: receiptId, supplierId: supplier.id, afterTheFactReason: "Urgent buy for the soap run, ordered by phone." });
    expect(Number(po.totalAmount)).toBe(600);
    const [pl] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    expect(pl).toMatchObject({ lineStatus: "received", sourceGoodsReceiptLineId: lines[0].id, uomEntered: "kg" });
    expect(Number(pl.qtyBase)).toBe(Number(lines[0].qtyBase));
    expect(Number(pl.qtyReceivedBase)).toBe(Number(lines[0].qtyBase));
    const v = await getPurchaseOrder(u.proc, po.id);
    expect(v.lines[0].remainingBase).toBe("0");
    expect(v.sourceReceipt?.id).toBe(receiptId);
    expect(v.can.edit).toBe(false);
    // Audit on the PO and on the receipt, with the reason.
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, po.id), eq(auditEvents.action, "procurement.purchase_order.created_after_receipt")));
    expect(ev).toHaveLength(1);
    expect(ev[0].reason).toContain("Urgent buy");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, receiptId), eq(auditEvents.action, "procurement.goods_receipt.po_created_after")))).toHaveLength(1);

    // Same key: same PO (replay). New key: refused, the receipt already has a PO (no double PO).
    const again = await createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent buy for the soap run, ordered by phone.", lines: [{ receiptLineId: lines[0].id, unitAmount: "120" }], idempotencyKey: key });
    expect(again).toMatchObject({ purchaseOrderId: po.id, replayed: true });
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Second try at the same PO", lines: [{ receiptLineId: lines[0].id, unitAmount: "120" }], idempotencyKey: crypto.randomUUID() }), "conflict");
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.sourceGoodsReceiptId, receiptId))).toHaveLength(1);
    expect((await poFromReceiptOptions(u.proc, receiptId)).purchaseOrder?.id).toBe(po.id);

    // The lines of a PO made from a receipt cannot be edited in place.
    await expectCode(updatePurchaseOrder(u.proc, po.id, { supplierId: supplier.id, lines: [{ materialId: pl.materialId, qty: "9", uom: "kg", unitAmount: "1" }] }), "state");

    // Reversing the source receipt is refused while the PO exists.
    await expectCode(reverseReceipt(u.manager, { receiptId, reason: "Testing the guard" }), "state");

    // Normal approval: the creator cannot approve; the site manager approves → received (never sent).
    await submitPurchaseOrder(u.proc, { purchaseOrderId: po.id });
    await expectCode(decidePurchaseOrder(u.proc, { purchaseOrderId: po.id, decision: "approve" }), "forbidden");
    const d = await decidePurchaseOrder(u.manager, { purchaseOrderId: po.id, decision: "approve" });
    expect(d.final).toBe(true);
    const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
    expect(after.status).toBe("received");
    expect(after.sentAt).toBeNull();
    const steps = await db.select().from(purchaseOrderStateTransitions).where(eq(purchaseOrderStateTransitions.purchaseOrderId, po.id));
    expect(steps.map((t) => t.toState)).toEqual(["draft", "submitted", "approved", "received"]);

    // Nothing is expected: not in expected receipts, not receivable, not sendable.
    expect((await expectedReceipts(u.proc)).some((x) => (x as { purchaseOrderId?: string }).purchaseOrderId === po.id || JSON.stringify(x).includes(po.poNumber))).toBe(false);
    await expectCode(receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "URG-DR-2B", lines: [{ purchaseOrderLineId: pl.id, materialId: pl.materialId, qty: "1", uom: "kg", supplierLotNumber: "X", expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }], idempotencyKey: crypto.randomUUID(), intent: "post" }), "state");
    await expectCode(sendPurchaseOrder(u.proc, { purchaseOrderId: po.id, email: false }), "state");

    // Supplier bills match the receipt line to the PO line.
    const map = await purchaseOrderLineOfReceiptLines(db, [lines[0].id]);
    expect(map.get(lines[0].id)).toBe(pl.id);

    // Procurement closes it as usual.
    await closePurchaseOrder(u.proc, { purchaseOrderId: po.id });
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)))[0].status).toBe("closed");
  });

  it("a cancelled after-the-fact draft frees the receipt for a new PO", async () => {
    const { receiptId, lines } = await urgentReceipt("URG-DR-3");
    const first = await createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent: ran out of oil", lines: [{ receiptLineId: lines[0].id, unitAmount: "100" }], idempotencyKey: crypto.randomUUID() });
    await cancelPurchaseOrder(u.proc, { purchaseOrderId: first.purchaseOrderId, reason: "Wrong price entered" });
    const second = await createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent: ran out of oil", lines: [{ receiptLineId: lines[0].id, unitAmount: "110" }], idempotencyKey: crypto.randomUUID() });
    expect(second.purchaseOrderId).not.toBe(first.purchaseOrderId);
    // With the PO cancelled first, the receipt could be reversed again (guard only for live POs).
    await cancelPurchaseOrder(u.proc, { purchaseOrderId: second.purchaseOrderId, reason: "Supplier will invoice later" });
    await reverseReceipt(u.manager, { receiptId, reason: "Delivery sent back to the supplier" });
  });

  it("validates the input: reason, lines, receipt state and kind", async () => {
    const { receiptId, lines } = await urgentReceipt("URG-DR-4");
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }] }), "validation");
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent buy", lines: [] }), "validation");
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent buy", lines: [{ receiptLineId: crypto.randomUUID(), unitAmount: "1" }] }), "validation");
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: receiptId, reason: "Urgent buy", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }, { receiptLineId: lines[0].id, unitAmount: "1" }] }), "validation");
    // A draft receipt: post it first.
    const coconut = await materialByCode("MAT-0012");
    const draft = await createReceiptDraft(u.warehouse, { supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "URG-DR-5", unplannedReasonCode: "no_purchase_order", idempotencyKey: crypto.randomUUID(), lines: [{ materialId: coconut.id, qty: "1", uom: "kg", supplierLotNumber: "D1", expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }] });
    const dl = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, draft.receiptId));
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: draft.receiptId, reason: "Urgent buy", lines: [{ receiptLineId: dl[0].id, unitAmount: "1" }] }), "state");
    // A receipt made against a PO already has its PO.
    const po = await sentPo(u, [{ code: "MAT-0012", qty: "10" }]);
    const [poLine] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const pr = await receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "URG-DR-6", lines: [{ purchaseOrderLineId: poLine.id, materialId: poLine.materialId, qty: "10", uom: "kg", supplierLotNumber: "P1", expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }], idempotencyKey: crypto.randomUUID(), intent: "post" });
    const pl = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, pr.receiptId));
    await expectCode(createPoFromReceipt(u.proc, { goodsReceiptId: pr.receiptId, reason: "Urgent buy", lines: [{ receiptLineId: pl[0].id, unitAmount: "1" }] }), "state");
  });

  it("permissions and sites: no create permission is refused; a buyer of another site gets not found", async () => {
    const { receiptId, lines } = await urgentReceipt("URG-DR-7");
    await expectCode(createPoFromReceipt(u.warehouse, { goodsReceiptId: receiptId, reason: "Trying to buy", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }] }), "forbidden");
    await expectCode(createPoFromReceipt(u.qa, { goodsReceiptId: receiptId, reason: "Trying to buy", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }] }), "forbidden");
    const rvsBuyer = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
    await expectCode(createPoFromReceipt(rvsBuyer, { goodsReceiptId: receiptId, reason: "Cross-site try", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }] }), "not_found");
    await expectCode(poFromReceiptOptions(rvsBuyer, receiptId), "not_found");
    // Read-only (sandbox/demo viewer) sessions cannot write.
    const ro = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd], { readOnly: true });
    await expectCode(createPoFromReceipt(ro, { goodsReceiptId: receiptId, reason: "Read only try", lines: [{ receiptLineId: lines[0].id, unitAmount: "1" }] }), "read_only");
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.sourceGoodsReceiptId, receiptId))).toHaveLength(0);
  });
});

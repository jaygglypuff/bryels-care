import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, goodsReceipts, inventoryBalances, inventoryLots, purchaseOrderLines, purchaseOrders, stockMovements, supplierReturnStateTransitions, supplierReturns } from "@/db/schema";
import { approveLineDiscrepancy, postReceipt, receiveAndPost, recordLineDiscrepancy, reverseReceipt } from "@/modules/inventory";
import {
  SR_TRANSITIONS,
  addSupplierReturnLine,
  canMove,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createSupplierReturn,
  decideSupplierReturn,
  expectedReceipts,
  getSupplierReturn,
  listSupplierReturns,
  postSupplierReturn,
  receiveAgainstPurchaseOrder,
  submitSupplierReturn,
} from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { setOrgSetting } from "../sales/w3f-fixtures";
import { materialByCode, sentPo, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;
let quaId: string;
let rejId: string;
let po: typeof purchaseOrders.$inferSelect;
let poLine: typeof purchaseOrderLines.$inferSelect;
const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

const line = (over: Partial<Parameters<typeof receiveAgainstPurchaseOrder>[1]["lines"][number]> = {}) => ({
  purchaseOrderLineId: poLine.id,
  materialId: poLine.materialId,
  qty: "40",
  uom: "kg",
  supplierLotNumber: "LOS-PO-1",
  expiresOn: exp,
  locationId: quaId,
  storageConditionsConfirmed: true,
  ...over,
});

async function poState() {
  const [p] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
  const [l] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, poLine.id));
  return { status: p.status, received: String(Number(l.qtyReceivedBase)), lineStatus: l.lineStatus };
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
  quaId = (await loc(kit.nfd.id, "QUA-01")).id;
  rejId = (await loc(kit.nfd.id, "REJ")).id;
  po = await sentPo(u, [{ code: "MAT-0012", qty: "100" }]);
  [poLine] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
});

describe("US-6-03 expected receipts and PO-based goods receipts", () => {
  it("the sent PO is an expected receipt for warehouse (no prices) and not for another site", async () => {
    const rows = await expectedReceipts(u.warehouse);
    const r = rows.find((x) => x.lineId === poLine.id)!;
    expect(r.remainingBase).toBe("100000");
    expect(Object.keys(r)).not.toContain("unitAmount");
    expect((await expectedReceipts(u.warehouseRvs)).find((x) => x.lineId === poLine.id)).toBeUndefined();
    await expectCode(receiveAgainstPurchaseOrder(u.warehouseRvs, { purchaseOrderId: po.id, supplierDocumentNumber: "X", lines: [line()], idempotencyKey: crypto.randomUUID(), intent: "post" }), "not_found");
  });

  it("a partial receipt moves qty_received_base and the PO to partially_received; a repeat key does not double", async () => {
    const key = crypto.randomUUID();
    const r = await receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9001", lines: [line()], idempotencyKey: key, intent: "post" });
    expect(r.receiptNumber).toMatch(/^GR-/);
    const again = await receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9001", lines: [line()], idempotencyKey: key, intent: "post" });
    expect(again.receiptId).toBe(r.receiptId);
    expect(await poState()).toEqual({ status: "partially_received", received: "40000", lineStatus: "open" });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, r.receiptId));
    expect(gr.receiptKind).toBe("purchase_order");
    expect(gr.purchaseOrderId).toBe(po.id);
    expect(gr.unplannedReasonCode).toBeNull();
    const [grl] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, gr.id));
    expect(grl.purchaseOrderLineId).toBe(poLine.id);
    expect((await expectedReceipts(u.warehouse)).find((x) => x.lineId === poLine.id)?.remainingBase).toBe("60000");
  });

  it("V-OVER: more than the open quantity + tolerance is refused; within tolerance it posts", async () => {
    await setOrgSetting(kit.orgId, "procurement.receipt.over_delivery_tolerance_pct", 5);
    const e = await expectCode(receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9002", lines: [line({ qty: "70", supplierLotNumber: "LOS-PO-2" })], idempotencyKey: crypto.randomUUID(), intent: "post" }), "conflict");
    expect(e.details?.rule).toBe("V-OVER");
    expect(await poState()).toEqual({ status: "partially_received", received: "40000", lineStatus: "open" });
  });

  it("an over-delivery is saved with an 'over' discrepancy, approved by procurement (not the receiver), then posts: PO received", async () => {
    const d = await receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9003", lines: [line({ qty: "70", supplierLotNumber: "LOS-PO-3", discrepancyKind: "over", discrepancyNote: "Supplier sent a full pallet." })], idempotencyKey: crypto.randomUUID(), intent: "draft" });
    expect(d.posted).toBe(false);
    await expectCode(postReceipt(u.warehouse, { receiptId: d.receiptId }), "conflict"); // CX-QTY: unapproved over line
    const [grl] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, d.receiptId));
    await expectCode(approveLineDiscrepancy(u.warehouse, { lineId: grl.id, note: "Accept surplus" }), "forbidden");
    await approveLineDiscrepancy(u.proc, { lineId: grl.id, note: "Accept the surplus at PO price (fictional)." });
    await postReceipt(u.warehouse, { receiptId: d.receiptId });
    expect(await poState()).toEqual({ status: "received", received: "110000", lineStatus: "received" });
    expect((await expectedReceipts(u.warehouse)).find((x) => x.lineId === poLine.id)).toBeUndefined();
  });

  it("reversing a PO receipt moves the PO back (received → partially_received) with the reversal reason", async () => {
    const [last] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId, po.id), eq(goodsReceipts.supplierDocumentNumber, "LOS-DR-9003")));
    await reverseReceipt(u.manager, { receiptId: last.id, reason: "Booked against the wrong delivery note." });
    expect(await poState()).toEqual({ status: "partially_received", received: "40000", lineStatus: "open" });
  });

  it("a line that is not on the PO needs an approved discrepancy before posting (CX-QTY)", async () => {
    const glycerin = await materialByCode("MAT-0061");
    const d = await receiveAgainstPurchaseOrder(u.warehouse, {
      purchaseOrderId: po.id,
      supplierDocumentNumber: "LOS-DR-9004",
      lines: [line({ qty: "10", supplierLotNumber: "LOS-PO-4" }), { materialId: glycerin.id, qty: "5", uom: "kg", supplierLotNumber: "LOS-X-1", expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }],
      idempotencyKey: crypto.randomUUID(),
      intent: "draft",
    });
    const e = await expectCode(postReceipt(u.warehouse, { receiptId: d.receiptId }), "conflict");
    expect(e.details?.rule).toBe("CX-QTY");
    const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, d.receiptId));
    const extra = lines.find((l) => l.purchaseOrderLineId === null)!;
    await recordLineDiscrepancy(u.warehouse, { lineId: extra.id, kind: "wrong_item", note: "Glycerin sent with the oil; not on the PO." });
    await approveLineDiscrepancy(u.proc, { lineId: extra.id, note: "Keep it; a PO amendment follows (fictional)." });
    await postReceipt(u.warehouse, { receiptId: d.receiptId });
    expect(await poState()).toEqual({ status: "partially_received", received: "50000", lineStatus: "open" });
  });

  it("a V-MAT mismatch on a PO line is refused at drafting", async () => {
    const glycerin = await materialByCode("MAT-0061");
    const e = await expectCode(receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9005", lines: [line({ materialId: glycerin.id })], idempotencyKey: crypto.randomUUID(), intent: "post" }), "validation");
    expect(e.details?.rule).toBe("V-MAT");
  });

  it("a PO receipt fails closed (setup_required) when the procurement hooks are not registered", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = g.__bc_receiving_po_hooks__;
    g.__bc_receiving_po_hooks__ = undefined;
    try {
      await expectCode(receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-HOOK", lines: [line({ qty: "1" })], idempotencyKey: crypto.randomUUID(), intent: "post" }), "setup_required");
    } finally {
      g.__bc_receiving_po_hooks__ = saved;
    }
  });

  it("unplanned receipts keep working without a PO", async () => {
    const coconut = await materialByCode("MAT-0012");
    const r = await receiveAndPost(u.warehouse, { supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "LOS-DR-UNPL", unplannedReasonCode: "no_purchase_order", idempotencyKey: crypto.randomUUID(), lines: [{ materialId: coconut.id, qty: "5", uom: "kg", supplierLotNumber: "LOS-U1", expiresOn: exp, locationId: quaId, storageConditionsConfirmed: true }] });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, r.receiptId));
    expect(gr.receiptKind).toBe("unplanned");
    expect(gr.purchaseOrderId).toBeNull();
  });

  it("closing short-closes the open remainder with a reason; a closed PO's receipts cannot be reversed; cancel needs nothing received", async () => {
    await expectCode(cancelPurchaseOrder(u.proc, { purchaseOrderId: po.id, reason: "Not needed" }), "state");
    await expectCode(closePurchaseOrder(u.proc, { purchaseOrderId: po.id }), "validation");
    await closePurchaseOrder(u.proc, { purchaseOrderId: po.id, reason: "Supplier cannot deliver the rest this month." });
    expect(await poState()).toEqual({ status: "closed", received: "50000", lineStatus: "short_closed" });
    const [first] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId, po.id), eq(goodsReceipts.supplierDocumentNumber, "LOS-DR-9001")));
    await expectCode(reverseReceipt(u.manager, { receiptId: first.id, reason: "Try after close" }), "state");
    await expectCode(receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "LOS-DR-9006", lines: [line()], idempotencyKey: crypto.randomUUID(), intent: "post" }), "state");
  });
});

describe("US-6-21 supplier returns: draft, approve, post", () => {
  let rejectedLot: typeof inventoryLots.$inferSelect;
  let returnId: string;

  it("statemachine.supplier_return: the transition table", () => {
    expect(canMove(SR_TRANSITIONS, "draft", "submitted")).toBe(true);
    expect(canMove(SR_TRANSITIONS, "draft", "posted")).toBe(false);
    expect(canMove(SR_TRANSITIONS, "posted", "cancelled")).toBe(false);
    expect(canMove(SR_TRANSITIONS, "approved", "posted")).toBe(true);
  });

  it("a line naming a lot that is not rejected is refused; a lot of another supplier too", async () => {
    const lb = await supplierByName("Laguna Botanicals");
    const r = await createSupplierReturn(u.proc, { supplierId: lb.id, reasonCode: "rejected_at_inspection", idempotencyKey: "w4a-srt-1" });
    expect(r.returnNumber).toMatch(/^SRT-\d{2}-\d{4}$/);
    returnId = r.returnId;
    [rejectedLot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.supplierLotNumber, "LB-GLX-0912")));
    // the quarantine lot from the PO receipt above belongs to Laguna Oleo, not Laguna Botanicals
    const [oleoLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.supplierLotNumber, "LOS-PO-1"));
    const e1 = await expectCode(addSupplierReturnLine(u.proc, { returnId, lotId: oleoLot.id, locationId: quaId, qty: "1", uom: "kg" }), "blocked_lot");
    expect(e1.details?.rule).toBe("V-QA");
    await db.update(inventoryLots).set({ qualityStatus: "rejected" }).where(eq(inventoryLots.id, oleoLot.id));
    await expectCode(addSupplierReturnLine(u.proc, { returnId, lotId: oleoLot.id, locationId: quaId, qty: "1", uom: "kg" }), "validation");
    await db.update(inventoryLots).set({ qualityStatus: "quarantine" }).where(eq(inventoryLots.id, oleoLot.id));
    // more than on hand at the location
    await expectCode(addSupplierReturnLine(u.proc, { returnId, lotCode: `BC:LOT:${rejectedLot.lotNumber}`, locationId: rejId, qty: "9", uom: "kg" }), "insufficient_stock");
    const l = await addSupplierReturnLine(u.proc, { returnId, lotCode: `BC:LOT:${rejectedLot.lotNumber}`, locationId: rejId, qty: "3", uom: "kg", creditExpectedAmount: "3300" });
    expect(l.qty).toBe("3000");
  });

  it("authz.sod.approve_own (supplier_return): creator cannot approve; warehouse cannot approve; another site manager can", async () => {
    await submitSupplierReturn(u.proc, { returnId });
    const procAndManager = await (await import("../../support/kit")).asUser(kit, "procurement@bryels-care.test", ["procurement", "site_manager"], [kit.nfd]);
    await expectCode(decideSupplierReturn(procAndManager, { returnId, decision: "approve" }), "separation_of_duties");
    await expectCode(decideSupplierReturn(u.warehouse, { returnId, decision: "approve" }), "forbidden");
    await expectCode(postSupplierReturn(u.warehouse, { returnId, idempotencyKey: "w4a-srt-post-early" }), "state");
    const r = await decideSupplierReturn(u.manager, { returnId, decision: "approve" });
    expect(r.final).toBe(true); // PHP 3,300 ≤ 50,000: one step
  });

  it("posting: the approver cannot post; the warehouse posts one issue movement per line; a repeat key replays", async () => {
    await expectCode(postSupplierReturn(u.manager, { returnId, idempotencyKey: "w4a-srt-post-1" }), "forbidden"); // SM holds approve, not post
    const managerWhoAlsoPosts = await (await import("../../support/kit")).asUser(kit, "manager.nfd@bryels-care.test", ["site_manager", "warehouse_operator"], [kit.nfd]);
    await expectCode(postSupplierReturn(managerWhoAlsoPosts, { returnId, idempotencyKey: "w4a-srt-post-1" }), "separation_of_duties");
    const before = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, rejectedLot.id), eq(inventoryBalances.locationId, rejId)));
    const p = await postSupplierReturn(u.warehouse, { returnId, idempotencyKey: "w4a-srt-post-1" });
    expect(p.movements).toBe(1);
    const again = await postSupplierReturn(u.warehouse, { returnId, idempotencyKey: "w4a-srt-post-1" });
    expect(again.replayed).toBe(true);
    const after = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, rejectedLot.id), eq(inventoryBalances.locationId, rejId)));
    expect(Number(before[0].qtyBase) - Number(after[0].qtyBase)).toBe(3000);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "supplier_return"), eq(stockMovements.sourceDocumentId, returnId)));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("issue");
    expect(mv[0].fromLocationId).toBe(rejId);
    const [sr] = await db.select().from(supplierReturns).where(eq(supplierReturns.id, returnId));
    expect(sr.status).toBe("posted");
    expect(sr.creditExpectedAmount).toBe("3300.0000");
    const tr = await db.select().from(supplierReturnStateTransitions).where(eq(supplierReturnStateTransitions.supplierReturnId, returnId));
    expect(tr.map((t) => t.toState)).toEqual(["draft", "submitted", "approved", "posted"]);
    await expectCode(postSupplierReturn(u.warehouse, { returnId, idempotencyKey: "w4a-srt-post-2" }), "state");
  });

  it("an unknown credit counts as above the threshold (owner step), and view is site-scoped", async () => {
    const lb = await supplierByName("Laguna Botanicals");
    const r = await createSupplierReturn(u.warehouse, { supplierId: lb.id, reasonCode: "rejected_at_inspection" });
    await addSupplierReturnLine(u.warehouse, { returnId: r.returnId, lotId: rejectedLot.id, locationId: rejId, qty: "1", uom: "kg", creditExpectedAmount: "999" });
    const d = await getSupplierReturn(u.proc, r.returnId);
    expect(d.sr.creditExpectedAmount).toBeNull(); // warehouse cannot enter prices: no credit recorded
    expect(d.progress.steps.map((s) => s.step)).toEqual([1, 2]);
    await expectCode(getSupplierReturn(u.warehouseRvs, r.returnId), "not_found");
    expect((await listSupplierReturns(u.warehouseRvs, { status: "all" })).length).toBe(0);
    await expectCode(listSupplierReturns(u.admin, {}), "forbidden");
  });
});

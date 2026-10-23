import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, dispositions, goodsReceiptLines, goodsReceipts, inventoryLots, materials, stockMovements, suppliers } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import {
  approveLineDiscrepancy,
  cancelReceiptDraft,
  createReceiptDraft,
  linkReceiptSupplier,
  postReceipt,
  receiveAndPost,
  recordLineDiscrepancy,
  reverseReceipt,
  updateReceiptDraft,
  type ReceiptLineInput,
} from "@/modules/inventory/receiving";
import { getReceiptDocument, listReceipts, lotReleaseBlockers } from "@/modules/inventory/receiving-queries";
import { transferStock } from "@/modules/inventory/movements";
import { decideLot } from "@/modules/quality/dispositions";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, expectDomain, future, loadSites, loc, mat, onHand } from "../../support/w1b";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let whRvs: AuthContext;
let manager: AuthContext;
let procurement: AuthContext;
let qa: AuthContext;
let auditor: AuthContext;
let operator: AuthContext;
let lagunaId: string;

async function line(over: Partial<ReceiptLineInput> = {}): Promise<ReceiptLineInput> {
  return { materialId: (await mat("MAT-0012")).id, qty: "25", uom: "kg", supplierLotNumber: "LOS-T1", expiresOn: future(365), locationId: (await loc(nfd.id, "QUA-01")).id, ...over };
}
async function draft(lines?: ReceiptLineInput[], extra: Record<string, unknown> = {}) {
  return createReceiptDraft(wh, { idempotencyKey: randomUUID(), supplierId: lagunaId, supplierDocumentNumber: "DR-T-1", lines: lines ?? [await line()], ...extra });
}
const linesOf = (receiptId: string) => db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, receiptId)).orderBy(goodsReceiptLines.lineNo);

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  manager = await ctxFor(orgId, "manager.nfd@bryels-care.test", ROLE_BUNDLES.site_manager.permissions, [nfd]);
  procurement = await ctxFor(orgId, "procurement@bryels-care.test", ROLE_BUNDLES.procurement.permissions, [nfd, rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  auditor = await ctxFor(orgId, "auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
  operator = await ctxFor(orgId, "operator.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [nfd]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
});

describe("goods receipt draft → post (US-2-07)", () => {
  it("procurement.receipt_creates_lot_only_on_post: a draft has no number, lot or movement", async () => {
    const before = (await db.select().from(inventoryLots)).length;
    const d = await draft();
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, d.receiptId));
    expect(gr).toMatchObject({ status: "draft", receiptNumber: null, supplierId: lagunaId, unplannedReasonCode: "no_purchase_order" });
    const [l] = await linesOf(d.receiptId);
    expect(l).toMatchObject({ lotId: null, qtyEntered: "25.000000", uomEntered: "kg", qtyBase: "25000.000000", lineNo: 1 });
    expect((await db.select().from(inventoryLots)).length).toBe(before);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, d.receiptId))).toHaveLength(0);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, d.receiptId), eq(auditEvents.action, "procurement.goods_receipt.created")));
    expect(ev).toHaveLength(1);
  });

  it("posts: quarantined lot per line, receipt movement in base units, GR number, audit events", async () => {
    const d = await draft([await line(), await line({ materialId: (await mat("PKG-0101")).id, qty: "500", uom: "pcs", supplierLotNumber: "MPP-1", locationId: (await loc(nfd.id, "RCV")).id })]);
    const r = await postReceipt(wh, { receiptId: d.receiptId });
    expect(r.replayed).toBe(false);
    expect(r.receiptNumber).toMatch(/^GR-\d{2}-\d{5}$/);
    const lines = await linesOf(d.receiptId);
    for (const l of lines) {
      const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
      expect(lot.qualityStatus).toBe("quarantine");
      expect(await onHand(lot.id, l.locationId)).toBe(l.qtyBase);
      expect(l.stockMovementId).toBeTruthy();
    }
    const [m] = await db.select().from(stockMovements).where(eq(stockMovements.id, lines[0].stockMovementId!));
    expect(m).toMatchObject({ movementType: "receipt", qtyBase: "25000.000000", baseUom: "g", sourceDocumentNumber: r.receiptNumber });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, d.receiptId), eq(auditEvents.action, "procurement.goods_receipt.posted")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, lines[0].lotId!), eq(auditEvents.action, "inventory.inventory_lot.created")))).toHaveLength(1);
  });

  it("idempotency: concurrent double tap and reload-and-repost return the original; nothing doubles", async () => {
    const d = await draft();
    const [a, b] = await Promise.all([postReceipt(wh, { receiptId: d.receiptId }), postReceipt(wh, { receiptId: d.receiptId })]);
    expect(a.receiptNumber).toBe(b.receiptNumber);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const c = await postReceipt(wh, { receiptId: d.receiptId });
    expect(c).toMatchObject({ replayed: true, receiptNumber: a.receiptNumber });
    expect(await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, d.receiptId))).toHaveLength(1);
    // Same create key twice returns the same draft.
    const key = randomUUID();
    const input = { idempotencyKey: key, supplierId: lagunaId, supplierDocumentNumber: "DR-T-2", lines: [await line()] };
    const [x, y] = await Promise.all([createReceiptDraft(wh, input), createReceiptDraft(wh, input)]);
    expect(x.receiptId).toBe(y.receiptId);
    expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.idempotencyKey, key))).toHaveLength(1);
  });

  it("validates V-UOM, dates and the receipt site's locations", async () => {
    await expectDomain(draft([await line({ uom: "L" })]), "validation");
    await expectDomain(draft([await line({ qty: "0" })]), "validation");
    await expectDomain(draft([await line({ manufacturedOn: future(2) })]), "validation");
    await expectDomain(draft([await line({ retestOn: future(400) })]), "validation");
    await expectDomain(draft([await line({ locationId: (await loc(nfd.id, "A-01")).id })]), "validation"); // storage bin for a quarantined lot (V-LOC)
    await expectDomain(draft([await line({ locationId: (await loc(rvs.id, "QUA-01")).id })]), "validation");
    await expectDomain(draft([]), "validation");
    await expectDomain(draft(undefined, { unplannedReasonCode: "made_up" }), "validation");
  });

  it("V-EXP: expired material posts only with a recorded discrepancy, as a quarantined reject candidate", async () => {
    const d1 = await draft([await line({ expiresOn: future(-1) })]);
    await expectDomain(postReceipt(wh, { receiptId: d1.receiptId }), "validation");
    const d2 = await draft([await line({ expiresOn: future(-1), discrepancyKind: "damaged", discrepancyNote: "Label shows expired date" })]);
    await postReceipt(wh, { receiptId: d2.receiptId });
    const [l] = await linesOf(d2.receiptId);
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
    expect(lot.qualityStatus).toBe("quarantine");
  });

  it("V-ASL: a suspended supplier blocks posting until procurement or QA resolves it", async () => {
    const [sus] = await db.select().from(suppliers).where(eq(suppliers.name, "Visayas Essence Trading"));
    const d = await draft(undefined, { supplierId: sus.id });
    const e = await expectDomain(postReceipt(wh, { receiptId: d.receiptId }), "conflict");
    expect(e.details?.rule).toBe("V-ASL");
    await db.update(suppliers).set({ qualityStatus: "conditional" }).where(eq(suppliers.id, sus.id));
    await postReceipt(wh, { receiptId: d.receiptId });
  });

  it("discrepancies: over-delivery blocks posting until approved; approver must not be the receiver; release waits for approval", async () => {
    const d = await draft([await line({ discrepancyKind: "over", discrepancyNote: "2 kg more than the DR" })]);
    const e = await expectDomain(postReceipt(wh, { receiptId: d.receiptId }), "conflict");
    expect(e.details?.rule).toBe("CX-QTY");
    const [l] = await linesOf(d.receiptId);
    // The receiver cannot approve, even holding the permission (procurement.discrepancy_approve_not_receiver).
    const whWithApprove = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", [...ROLE_BUNDLES.warehouse_operator.permissions, "procurement.receipt_discrepancy.approve"], [nfd]);
    await expectDomain(approveLineDiscrepancy(whWithApprove, { lineId: l.id, note: "Accept extra" }), "separation_of_duties");
    await expectDomain(approveLineDiscrepancy(wh, { lineId: l.id, note: "Accept extra" }), "forbidden");
    await approveLineDiscrepancy(procurement, { lineId: l.id, note: "Accepted: supplier will invoice actual weight" });
    await postReceipt(wh, { receiptId: d.receiptId });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, l.id), eq(auditEvents.action, "procurement.goods_receipt_line.discrepancy_approved")))).toHaveLength(1);

    // A damaged line posts (stock is physically present) but QA release is blocked until approval.
    const d2 = await draft();
    await postReceipt(wh, { receiptId: d2.receiptId });
    const [l2] = await linesOf(d2.receiptId);
    await recordLineDiscrepancy(wh, { lineId: l2.id, kind: "damaged", note: "Drum dented on unloading" });
    expect((await lotReleaseBlockers(db, l2.lotId!)).join(" ")).toMatch(/not yet approved/);
    await expectDomain(decideLot(qa, { lotId: l2.lotId!, decision: "release", reason: "CoA reviewed, conforms" }), "state");
    await approveLineDiscrepancy(procurement, { lineId: l2.id, note: "Dent cosmetic only; accepted" });
    await decideLot(qa, { lotId: l2.lotId!, decision: "release", reason: "CoA reviewed, conforms" });
  });

  it("an unregistered supplier name posts but blocks release until procurement links the supplier", async () => {
    const r = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Brand New Oils Inc. (fictional)", supplierDocumentNumber: "BN-1", lines: [await line()] });
    const [l] = await linesOf(r.receiptId);
    expect((await lotReleaseBlockers(db, l.lotId!)).join(" ")).toMatch(/not in the supplier list/);
    await expectDomain(linkReceiptSupplier(wh, { receiptId: r.receiptId, supplierId: lagunaId }), "forbidden");
    await linkReceiptSupplier(procurement, { receiptId: r.receiptId, supplierId: lagunaId });
    expect(await lotReleaseBlockers(db, l.lotId!)).toEqual([]);
  });

  it("edits a draft: lines keep ids, removed lines are deleted; posted receipts cannot be edited or cancelled", async () => {
    const d = await draft([await line(), await line({ supplierLotNumber: "LOS-T2" })]);
    const [l1, l2] = await linesOf(d.receiptId);
    await updateReceiptDraft(wh, d.receiptId, { supplierId: lagunaId, supplierDocumentNumber: "DR-T-9", lines: [{ ...(await line({ qty: "30" })), lineId: l2.id }] });
    const after = await linesOf(d.receiptId);
    expect(after.map((l) => l.id)).toEqual([l2.id]);
    expect(after[0]).toMatchObject({ lineNo: 1, qtyBase: "30000.000000" });
    expect(after.some((l) => l.id === l1.id)).toBe(false);
    await postReceipt(wh, { receiptId: d.receiptId });
    await expectDomain(updateReceiptDraft(wh, d.receiptId, { supplierId: lagunaId, supplierDocumentNumber: "X", lines: [await line()] }), "state");
    await expectDomain(cancelReceiptDraft(wh, { receiptId: d.receiptId, reason: "Wrong delivery" }), "state");
    const d2 = await draft();
    await cancelReceiptDraft(wh, { receiptId: d2.receiptId, reason: "Supplier took the goods back" });
    await expectDomain(postReceipt(wh, { receiptId: d2.receiptId }), "state");
  });

  it("released-on-receipt materials (requires_incoming_inspection = false) get a recorded release disposition", async () => {
    const water = await mat("MAT-0063");
    await db.update(materials).set({ requiresIncomingInspection: false }).where(eq(materials.id, water.id));
    try {
      await expectDomain(draft([await line({ materialId: water.id, qty: "1000", uom: "g", locationId: (await loc(nfd.id, "HLD-01")).id })]), "validation");
      const d = await draft([await line({ materialId: water.id, qty: "1000", uom: "g", locationId: (await loc(nfd.id, "B-01")).id })]);
      await postReceipt(wh, { receiptId: d.receiptId });
      const [l] = await linesOf(d.receiptId);
      const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
      expect(lot.qualityStatus).toBe("released");
      expect(await db.select().from(dispositions).where(eq(dispositions.subjectId, lot.id))).toHaveLength(1);
    } finally {
      await db.update(materials).set({ requiresIncomingInspection: true }).where(eq(materials.id, water.id));
    }
  });
});

describe("receipt reversal (US-2-07 AC3)", () => {
  it("procurement.receipt_void_requires_void_permission and ledger.reversal.receipt_with_lot", async () => {
    const r = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierId: lagunaId, supplierDocumentNumber: "DR-REV", lines: [await line()] });
    await expectDomain(reverseReceipt(wh, { receiptId: r.receiptId, reason: "Posted to the wrong site" }), "forbidden");
    await expectDomain(reverseReceipt(manager, { receiptId: r.receiptId, reason: "" }), "validation");
    const [l] = await linesOf(r.receiptId);
    await reverseReceipt(manager, { receiptId: r.receiptId, reason: "Posted twice by mistake" });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, r.receiptId));
    expect(gr.status).toBe("reversed");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
    expect(lot).toBeTruthy(); // the lot is never deleted
    expect(await onHand(lot.id, l.locationId)).toBe("0.000000");
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.lotId, lot.id));
    const rev = mv.find((m) => m.movementType === "reversal")!;
    expect(rev.reversalOfId).toBe(l.stockMovementId);
    expect(mv.find((m) => m.movementType === "receipt")!.qtyBase).toBe("25000.000000"); // original untouched
    expect((await lotReleaseBlockers(db, lot.id)).join(" ")).toMatch(/reversed/);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.receiptId), eq(auditEvents.action, "procurement.goods_receipt.reversed")))).toHaveLength(1);
    await expectDomain(reverseReceipt(manager, { receiptId: r.receiptId, reason: "Again please" }), "state");
  });

  it("refuses to reverse when the stock has moved since", async () => {
    const r = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierId: lagunaId, supplierDocumentNumber: "DR-REV2", lines: [await line({ locationId: (await loc(nfd.id, "RCV")).id })] });
    const [l] = await linesOf(r.receiptId);
    await transferStock(wh, { lotId: l.lotId!, fromLocationId: l.locationId, toLocationId: (await loc(nfd.id, "QUA-01")).id, qty: "1000", reason: "to cage", idempotencyKey: randomUUID() });
    await expectDomain(reverseReceipt(manager, { receiptId: r.receiptId, reason: "Wrong supplier" }), "insufficient_stock");
  });
});

describe("receipt authorization (authz.cross_site.*, authz.role_escalation.*)", () => {
  it("another site's user cannot see, edit, post, cancel or reverse a receipt", async () => {
    const d = await draft();
    await expectDomain(getReceiptDocument(whRvs, d.receiptId), "not_found");
    await expectDomain(postReceipt(whRvs, { receiptId: d.receiptId }), "not_found");
    await expectDomain(cancelReceiptDraft(whRvs, { receiptId: d.receiptId, reason: "not mine" }), "not_found");
    await expectDomain(updateReceiptDraft(whRvs, d.receiptId, { supplierId: lagunaId, supplierDocumentNumber: "X", lines: [await line()] }), "not_found");
    const [l] = await linesOf(d.receiptId);
    await expectDomain(recordLineDiscrepancy(whRvs, { lineId: l.id, kind: "short", note: "cross site attempt" }), "not_found");
    const rvsList = await listReceipts(whRvs);
    expect(rvsList.some((x) => x.id === d.receiptId)).toBe(false);
  });

  it("roles without the permission are refused", async () => {
    await expectDomain(createReceiptDraft(auditor, { idempotencyKey: randomUUID(), supplierId: lagunaId, supplierDocumentNumber: "A", lines: [await line()] }), "forbidden");
    const d = await draft();
    await expectDomain(postReceipt(operator, { receiptId: d.receiptId }), "forbidden");
    await expectDomain(postReceipt(procurement, { receiptId: d.receiptId }), "forbidden");
    await expectDomain(reverseReceipt(qa, { receiptId: d.receiptId, reason: "not allowed" }), "forbidden");
    // The auditor can read but not write.
    const doc = await getReceiptDocument(auditor, d.receiptId);
    expect(doc.can).toMatchObject({ post: false, edit: false, reverse: false });
  });
});

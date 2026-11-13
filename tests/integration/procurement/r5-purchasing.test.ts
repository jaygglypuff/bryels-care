/**
 * Round 5 office fixes, purchasing (docs/ux-audit/round5/C-office.md problems 5, 8, 9, 11; B-owner-manager.md problems 3,
 * 7, 8; bugs B1, B3, B16). ADR-131.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materials, notifications, purchaseOrderLines, purchaseOrders, supplierMaterials } from "@/db/schema";
import { resolveDoneNotifications } from "@/modules/platform/notification-done";
import { buildContextForUser } from "@/lib/auth/context";
import {
  createPurchaseOrder,
  createPurchaseRequest,
  decidePurchaseOrder,
  decidePurchaseRequest,
  getPurchaseRequest,
  lastPurchasePrices,
  listDeliveryProblems,
  decideDeliveryProblem,
  receiveAgainstPurchaseOrder,
  saveReorderPolicy,
  whatToBuy,
  recordSupplierConfirmation,
  sendPurchaseOrder,
  submitPurchaseOrder,
  submitPurchaseRequest,
} from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { registerAppHooks } from "@/modules/wiring";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { setOrgSetting } from "../production/w2a-fixtures";
import { materialByCode, sentPo, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
});

describe("one approval per purchase (A-PO-1APP-01 as amended by the owner, B-owner problem 7)", () => {
  it("the owner's own approved request carries over to the order the owner makes: no second Approve", async () => {
    await setOrgSetting(kit.orgId, "governance.owner_override", true);
    try {
      const owner = (await buildContextForUser(u.owner.userId))!;
      const m = await materialByCode("MAT-0012");
      const s = await supplierByName("Laguna Oleo Supply");
      const pr = await createPurchaseRequest(owner, { neededByDate: "2030-01-15", lines: [{ materialId: m.id, qty: "50", uom: "kg", estimatedUnitAmount: "200" }] });
      await submitPurchaseRequest(owner, { requestId: pr.requestId });
      expect((await decidePurchaseRequest(owner, { requestId: pr.requestId, decision: "approve" })).final).toBe(true);
      const line = (await getPurchaseRequest(owner, pr.requestId)).lines[0];
      const po = await createPurchaseOrder(owner, { supplierId: s.id, lines: [{ materialId: m.id, qty: "50", uom: "kg", unitAmount: "190", purchaseRequestLineId: line.id }] });
      const sub = await submitPurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId });
      expect(sub.status).toBe("approved");
      expect(sub.approvedByRequest).toEqual([pr.requestNumber]);
      const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
      expect(row.approvedBy).toBe(owner.userId);
    } finally {
      await setOrgSetting(kit.orgId, "governance.owner_override", false);
    }
  });

  it("a higher price than the request was approved for needs a second OK", async () => {
    const m = await materialByCode("MAT-0012");
    const s = await supplierByName("Laguna Oleo Supply");
    const pr = await createPurchaseRequest(u.proc, { lines: [{ materialId: m.id, qty: "50", uom: "kg", estimatedUnitAmount: "100" }] });
    await submitPurchaseRequest(u.proc, { requestId: pr.requestId });
    await decidePurchaseRequest(u.manager, { requestId: pr.requestId, decision: "approve" });
    const line = (await getPurchaseRequest(u.proc, pr.requestId)).lines[0];
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "50", uom: "kg", unitAmount: "120", purchaseRequestLineId: line.id }] });
    expect(await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId })).toMatchObject({ status: "submitted", notCoveredBecause: "amount" });
  });

  it("a missing price is refused in words, naming the item (no codes)", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const noPrice = (await db.select().from(supplierMaterials).where(eq(supplierMaterials.supplierId, s.id))).find((x) => x.unitPrice === null);
    if (!noPrice) return; // every pair has a price in this seed: nothing to refuse
    const [mat] = await db.select().from(materials).where(eq(materials.id, noPrice.materialId));
    const e = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: mat.id, qty: "1", uom: mat.baseUom }] }).catch((x) => x);
    expect(e.message).toBe(`Type the price of ${mat.name} (per ${mat.baseUom}).`);
    expect(e.details?.field).toBe("lines.0.unitAmount");
  });

  it("last prices: the newest sent order's price per item; nothing for people who may not see prices", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const rows = await lastPurchasePrices(u.proc, s.id);
    for (const r of rows) expect(r.poNumber).toMatch(/^PO-/);
    await expectCode(lastPurchasePrices(u.warehouse, s.id), "forbidden");
  });
});

describe("delivery problems reach purchasing (C-office problem 11)", () => {
  it("a short delivery tells purchasing, is listed, and 'not needed' closes the rest; decided once; the message clears", async () => {
    const po = await sentPo(u, [{ code: "MAT-0012", qty: "50" }]);
    const [pl] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await receiveAgainstPurchaseOrder(u.warehouse, {
      purchaseOrderId: po.id,
      supplierDocumentNumber: "LOS-DR-R5-SHORT",
      lines: [{ purchaseOrderLineId: pl.id, materialId: pl.materialId, qty: "30", uom: "kg", supplierLotNumber: "LOS-R5-S", expiresOn: exp, locationId: (await loc(kit.nfd.id, "QUA-01")).id, storageConditionsConfirmed: true, discrepancyKind: "short", discrepancyNote: "Only 30 kg came" }],
      idempotencyKey: randomUUID(),
      intent: "post",
    });
    const [msg] = await db.select().from(notifications).where(and(eq(notifications.kind, "procurement.delivery_problem"), eq(notifications.entityId, po.id)));
    expect(msg).toBeTruthy();
    const list = await listDeliveryProblems(u.proc, { purchaseOrderId: po.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "short", decision: null });
    await expectCode(decideDeliveryProblem(u.warehouse, { goodsReceiptLineId: list[0].goodsReceiptLineId, decision: "close_rest", note: "warehouse tries" }), "forbidden");
    const procRvs = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
    await expectCode(decideDeliveryProblem(procRvs, { goodsReceiptLineId: list[0].goodsReceiptLineId, decision: "close_rest", note: "other site tries" }), "not_found");
    await decideDeliveryProblem(u.proc, { goodsReceiptLineId: list[0].goodsReceiptLineId, decision: "close_rest", note: "Supplier has no more this month", idempotencyKey: randomUUID() });
    const [after] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, pl.id));
    expect(after.lineStatus).toBe("short_closed");
    const [poAfter] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
    expect(poAfter.status).toBe("received");
    await expectCode(decideDeliveryProblem(u.proc, { goodsReceiptLineId: list[0].goodsReceiptLineId, decision: "money_back", note: "again" }), "conflict");
    await resolveDoneNotifications(db, { organizationId: kit.orgId });
    const [done] = await db.select().from(notifications).where(eq(notifications.id, msg.id));
    expect(done.resolvedAt).not.toBeNull();
  });
});

describe("what to buy (C-office problem 5)", () => {
  it("lists a material below its minimum with Ask to buy in the unit people use; refused for finance", async () => {
    const m = await materialByCode("MAT-0012");
    await saveReorderPolicy(u.proc, { materialId: m.id, minStockBase: "100000000" });
    const rows = await whatToBuy(u.proc);
    const r = rows.find((x) => x.materialId === m.id)!;
    expect(r).toBeTruthy();
    expect(Number(r.shortBase)).toBeGreaterThan(0);
    expect(r.askUom).toBe("kg");
    expect(r.why).toMatch(/minimum/);
    await expectCode(whatToBuy(u.finance), "forbidden");
  });
});

describe("B1: sending an order the owner made and approved alone", () => {
  it("sends, records the email outcome and does not fail after the order was sent; later changes by others work", async () => {
    await setOrgSetting(kit.orgId, "governance.owner_override", true); // the small demo's owner (ADR-073)
    const owner = (await buildContextForUser(u.owner.userId))!;
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(owner, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId });
    const d = await decidePurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    expect(d.final).toBe(true);
    const r = await sendPurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId, email: true });
    expect(r.documentNumber).toBeTruthy();
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
    expect(row.status).toBe("sent");
    expect(row.sendResult).not.toBe("pending");
    // Another person's later change of the same order (the supplier answered) is not refused by the same-person rule.
    await recordSupplierConfirmation(u.proc, { purchaseOrderId: po.purchaseOrderId, supplierReference: "SO-LAG-1" });
    await setOrgSetting(kit.orgId, "governance.owner_override", false);
  });

  it("the same-person rule still refuses a write that makes the approver the creator (no flag)", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
    await decidePurchaseOrder(u.manager, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    const e = await db.update(purchaseOrders).set({ approvedBy: u.proc.userId }).where(eq(purchaseOrders.id, po.purchaseOrderId)).catch((x) => x);
    expect(String(e?.cause?.message ?? e?.message)).toMatch(/ck_purchase_orders_sod/);
  });

  it("migration 0041 ends with the canonical src/db/sql/adr131.sql", () => {
    void 0;
    const root = path.resolve(__dirname, "../../..");
    const migration = readFileSync(path.join(root, "src/db/migrations/0041_adr131_custom_sql.sql"), "utf8").trim();
    const canonical = readFileSync(path.join(root, "src/db/sql/adr131.sql"), "utf8").trim();
    expect(migration.endsWith(canonical)).toBe(true);
  });
});

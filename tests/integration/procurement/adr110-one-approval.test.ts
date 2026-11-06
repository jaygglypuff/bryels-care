/**
 * ADR-110 C15 "one approval per purchase" (owner decision, A-PO-1APP-01): a purchase order made from an approved
 * request to buy is approved at submit when the supplier, the items and the amount stay within what the request's
 * approver approved. Anything above the amount, another supplier, more than requested, a request without a supplier,
 * or the approver making the order follows the normal approval rule. Approvers see the amount they approve.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, purchaseOrderStateTransitions, purchaseOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createPurchaseOrder, createPurchaseRequest, decidePurchaseOrder, decidePurchaseRequest, getPurchaseOrder, getPurchaseRequest, submitPurchaseOrder, submitPurchaseRequest } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { materialByCode, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  u = await w4aUsers(kit);
});

/** An approved request to buy MAT-0012 (Coconut Oil), made by procurement and approved by the NFD site manager. */
async function approvedRequest(opts: { qty?: string; estimate?: string | null; supplier?: string | null; by?: AuthContext; approver?: AuthContext } = {}) {
  const m = await materialByCode("MAT-0012");
  const s = opts.supplier === null ? null : await supplierByName(opts.supplier ?? "Laguna Oleo Supply");
  const by = opts.by ?? u.proc;
  const pr = await createPurchaseRequest(by, { justification: "ADR-110 C15 test (fictional)", lines: [{ materialId: m.id, qty: opts.qty ?? "100", uom: "kg", estimatedUnitAmount: opts.estimate === undefined ? "200" : opts.estimate, suggestedSupplierId: s?.id ?? null }] });
  await submitPurchaseRequest(by, { requestId: pr.requestId });
  const d = await decidePurchaseRequest(opts.approver ?? u.manager, { requestId: pr.requestId, decision: "approve" });
  expect(d.final).toBe(true);
  const v = await getPurchaseRequest(u.proc, pr.requestId);
  return { pr, line: v.lines[0], material: m };
}

async function orderFrom(req: Awaited<ReturnType<typeof approvedRequest>>, opts: { supplier?: string; qty?: string; by?: AuthContext } = {}) {
  const s = await supplierByName(opts.supplier ?? "Laguna Oleo Supply");
  const by = opts.by ?? u.proc;
  const po = await createPurchaseOrder(by, { supplierId: s.id, lines: [{ materialId: req.material.id, qty: opts.qty ?? "100", uom: "kg", purchaseRequestLineId: req.line.id }] });
  return { po, submitted: await submitPurchaseOrder(by, { purchaseOrderId: po.purchaseOrderId }) };
}

describe("ADR-110 C15: one approval per purchase", () => {
  it("within supplier, items and amount: the order is approved at submit, by the request's approver, with no second decision", async () => {
    const req = await approvedRequest(); // 100 kg × ₱200 = ₱20,000 approved
    const { po, submitted } = await orderFrom(req); // 100 kg × ₱180 (supplier price) = ₱18,000
    expect(submitted.status).toBe("approved");
    expect(submitted.approvedByRequest).toEqual([req.pr.requestNumber]);
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
    expect(row.status).toBe("approved");
    expect(row.approvedBy).toBe(u.manager.userId);
    const tr = await db.select().from(purchaseOrderStateTransitions).where(eq(purchaseOrderStateTransitions.purchaseOrderId, po.purchaseOrderId));
    expect(tr.map((t) => t.toState)).toEqual(["draft", "submitted", "approved"]);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "procurement.purchase_order.approved_by_request"), eq(auditEvents.entityId, po.purchaseOrderId)));
    expect(ev).toBeTruthy();
    // a second decision is refused: the order is no longer waiting
    await expectCode(decidePurchaseOrder(u.manager, { purchaseOrderId: po.purchaseOrderId, decision: "approve" }), "state");
    const view = await getPurchaseOrder(u.proc, po.purchaseOrderId);
    expect(view.approvedByRequest).toEqual([req.pr.requestNumber]);
    expect(view.can.send).toBe(true);
  });

  it("above the approved amount: the normal approval applies", async () => {
    const req = await approvedRequest({ estimate: "150" }); // ₱15,000 approved; the order is ₱18,000
    const { submitted } = await orderFrom(req);
    expect(submitted.status).toBe("submitted");
    expect(submitted.approvedByRequest).toBeNull();
    expect(submitted).toMatchObject({ notCoveredBecause: "amount" });
  });

  it("a different supplier from the one approved: the normal approval applies", async () => {
    const req = await approvedRequest({ supplier: "Cebu Chemicals" });
    const { submitted } = await orderFrom(req, { supplier: "Laguna Oleo Supply" });
    expect(submitted.status).toBe("submitted");
    expect(submitted).toMatchObject({ notCoveredBecause: "supplier" });
  });

  it("no supplier or no estimate on the request, or more than requested: the normal approval applies", async () => {
    const noSupplier = await orderFrom(await approvedRequest({ supplier: null }));
    expect(noSupplier.submitted).toMatchObject({ status: "submitted", notCoveredBecause: "supplier" });
    const noEstimate = await orderFrom(await approvedRequest({ estimate: null }));
    expect(noEstimate.submitted).toMatchObject({ status: "submitted", notCoveredBecause: "no_estimate" });
    const more = await orderFrom(await approvedRequest({ qty: "50", estimate: "1000" }), { qty: "60" });
    expect(more.submitted).toMatchObject({ status: "submitted", notCoveredBecause: "quantity" });
  });

  it("a purchase order without a request follows the approval rule", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    const r = await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
    expect(r).toMatchObject({ status: "submitted", notCoveredBecause: "no_request" });
  });

  it("separation of duties: the request's approver who makes the order does not skip the order's approval", async () => {
    const procAndManager = await asUser(kit, "procurement@bryels-care.test", ["procurement", "site_manager"], [kit.nfd]);
    const req = await approvedRequest({ by: u.planner, approver: procAndManager });
    const { submitted } = await orderFrom(req, { by: procAndManager });
    expect(submitted).toMatchObject({ status: "submitted", notCoveredBecause: "same_person" });
  });

  it("cross-site and role negatives: another site cannot order an NFD request; the warehouse cannot make orders", async () => {
    const req = await approvedRequest();
    const procRvs = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
    const s = await supplierByName("Laguna Oleo Supply");
    await expectCode(createPurchaseOrder(procRvs, { supplierId: s.id, lines: [{ materialId: req.material.id, qty: "100", uom: "kg", purchaseRequestLineId: req.line.id }] }), "validation");
    await expectCode(createPurchaseOrder(u.warehouse, { supplierId: s.id, lines: [{ materialId: req.material.id, qty: "100", uom: "kg", purchaseRequestLineId: req.line.id }] }), "forbidden");
    await expectCode(getPurchaseRequest(u.warehouseRvs, req.pr.requestId), "not_found");
  });

  it("the approver sees the amount on the request and on the order; others without prices do not", async () => {
    const m = await materialByCode("MAT-0012");
    const s = await supplierByName("Laguna Oleo Supply");
    const pr = await createPurchaseRequest(u.proc, { lines: [{ materialId: m.id, qty: "100", uom: "kg", estimatedUnitAmount: "200", suggestedSupplierId: s.id }] });
    await submitPurchaseRequest(u.proc, { requestId: pr.requestId });
    const asManager = await getPurchaseRequest(u.manager, pr.requestId);
    expect(asManager.request.estimatedTotalAmount).not.toBeNull();
    expect(asManager.lines[0].estimatedUnitAmount).toBeNull(); // unit prices stay hidden
    expect((await getPurchaseRequest(u.warehouse, pr.requestId)).request.estimatedTotalAmount).toBeNull();
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
    const poAsManager = await getPurchaseOrder(u.manager, po.purchaseOrderId);
    expect(Number(poAsManager.po.totalAmount)).toBeGreaterThan(0);
    expect(poAsManager.lines[0].unitAmount).toBeNull();
    expect((await getPurchaseOrder(u.warehouse, po.purchaseOrderId)).po.totalAmount).toBeNull();
  });
});

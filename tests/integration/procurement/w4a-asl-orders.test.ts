import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, emailOutbox, generatedDocuments, purchaseOrderStateTransitions, purchaseOrders, purchaseRequests, supplierMaterialChanges, supplierMaterials } from "@/db/schema";
import { ROLE_BUNDLES } from "@/lib/permissions";
import {
  PO_TRANSITIONS,
  approvedMaterialsFor,
  canMove,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createPurchaseRequest,
  decideAslChange,
  decidePurchaseOrder,
  decidePurchaseRequest,
  getPurchaseOrder,
  getPurchaseRequest,
  listPurchaseOrders,
  listSupplierMaterials,
  proposeAslChange,
  proposeSupplierMaterial,
  sendPurchaseOrder,
  submitPurchaseOrder,
  submitPurchaseRequest,
  updatePurchaseOrder,
  updateSupplierTerms,
  withdrawAslChange,
} from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { expectCode, loadKit, type Kit } from "../../support/kit";
import { materialByCode, pair, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  u = await w4aUsers(kit);
});

describe("US-6-01 approved-supplier list, prices, lead times, MOQ", () => {
  it("role bundles follow the matrix: QA approves the ASL, procurement edits prices, warehouse and QA see no prices", () => {
    expect(ROLE_BUNDLES.qa_qc.permissions).toContain("masterdata.supplier.approve");
    expect(ROLE_BUNDLES.procurement.permissions).not.toContain("masterdata.supplier.approve");
    expect(ROLE_BUNDLES.procurement.permissions).toContain("masterdata.supplier_price.edit");
    for (const r of ["warehouse_operator", "qa_qc", "site_manager", "system_admin", "production_planner"]) expect(ROLE_BUNDLES[r].permissions, r).not.toContain("masterdata.supplier_price.view");
    expect(ROLE_BUNDLES.owner_director.permissions).not.toContain("masterdata.supplier.approve");
    expect(ROLE_BUNDLES.system_admin.permissions).not.toContain("procurement.purchase_order.view");
  });

  it("procurement proposes a pair; the proposer cannot approve it (SoD) and QA's decision is audited", async () => {
    const s = await supplierByName("Cebu Chemicals");
    const m = await materialByCode("MAT-0060");
    // procurement cannot decide (role escalation)
    const p = await proposeSupplierMaterial(u.proc, { supplierId: s.id, materialId: m.id, note: "Second source for aloe juice (fictional evidence on file)." });
    await expectCode(decideAslChange(u.proc, { changeId: p.changeId, decision: "approved" }), "forbidden");
    // a QA person who also proposes cannot approve their own proposal
    const qaProposer = await (await import("../../support/kit")).asUser(kit, "qa.nfd@bryels-care.test", ["qa_qc", "procurement"], [kit.nfd, kit.rvs]);
    const s2 = await supplierByName("Laguna Oleo Supply");
    const p2 = await proposeSupplierMaterial(qaProposer, { supplierId: s2.id, materialId: m.id, note: "Laguna Oleo can also supply aloe (fictional)." });
    await expectCode(decideAslChange(qaProposer, { changeId: p2.changeId, decision: "approved" }), "separation_of_duties");
    await withdrawAslChange(qaProposer, { changeId: p2.changeId });
    // QA approves the first
    const d = await decideAslChange(u.qa, { changeId: p.changeId, decision: "approved", note: "Supplier audit 2026 on file." });
    expect(d.isApproved).toBe(true);
    const [sm] = await db.select().from(supplierMaterials).where(eq(supplierMaterials.id, p.supplierMaterialId));
    expect(sm.isApproved).toBe(true);
    expect(sm.requestedBy).toBe(u.proc.userId);
    expect(sm.approvedBy).toBe(u.qa.userId);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.supplier.asl_changed"), eq(auditEvents.entityId, s.id)));
    expect(ev.actorId).toBe(u.qa.userId);
    // decided proposals are immutable (custom SQL trigger)
    await expect(db.update(supplierMaterialChanges).set({ note: "edited" }).where(eq(supplierMaterialChanges.id, p.changeId))).rejects.toThrow();
  });

  it("suspension: proposed by procurement, decided by QA; then PO lines for the pair are refused", async () => {
    const sm = await pair("Cebu Chemicals", "MAT-0060");
    const c = await proposeAslChange(u.proc, { supplierMaterialId: sm.id, action: "suspend", note: "Two late deliveries with damaged drums (fictional)." });
    await decideAslChange(u.qa2, { changeId: c.changeId, decision: "approved" });
    const s = await supplierByName("Cebu Chemicals");
    const m = await materialByCode("MAT-0060");
    const e = await expectCode(createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "20", uom: "kg", unitAmount: "60" }] }), "validation");
    expect(e.details?.rule).toBe("V-ASL");
  });

  it("procurement.asl_blocks_line: a pair not approved or a suspended supplier gives 422 V-ASL", async () => {
    const pending = await supplierByName("Bukidnon Aloe Farms");
    const aloe = await materialByCode("MAT-0060");
    const e1 = await expectCode(createPurchaseOrder(u.proc, { supplierId: pending.id, lines: [{ materialId: aloe.id, qty: "20", uom: "kg", unitAmount: "60" }] }), "validation");
    expect(e1.details?.rule).toBe("V-ASL");
    const suspended = await supplierByName("Visayas Essence Trading");
    const e2 = await expectCode(createPurchaseOrder(u.proc, { supplierId: suspended.id, lines: [{ materialId: aloe.id, qty: "20", uom: "kg", unitAmount: "60" }] }), "validation");
    expect(e2.details?.rule).toBe("V-ASL");
    expect(String(e2.message)).toMatch(/suspended/);
  });

  it("procurement.po_prices_hidden_from_warehouse: prices are masked for warehouse, QA and the site manager", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const rowsW = await listSupplierMaterials(u.warehouse, s.id);
    expect(rowsW[0].unitPrice).toBeUndefined();
    const rowsP = await listSupplierMaterials(u.proc, s.id);
    expect(rowsP.find((r) => r.materialCode === "MAT-0012")?.unitPrice).toBe("185.0000");
    expect((await approvedMaterialsFor(u.qa, s.id))[0].unitPrice).toBeUndefined();
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, "partially_received"));
    const forWh = await getPurchaseOrder(u.warehouse, po.id);
    expect(forWh.po.totalAmount).toBeNull();
    expect(forWh.lines.every((l) => l.unitAmount === null && l.lineAmount === null)).toBe(true);
    expect((await listPurchaseOrders(u.warehouse, {})).every((r) => r.totalAmount === undefined)).toBe(true);
    const forMgr = await getPurchaseOrder(u.manager, po.id);
    expect(forMgr.po.totalAmount).toBeNull();
    expect((await getPurchaseOrder(u.proc, po.id)).po.totalAmount).not.toBeNull();
  });

  it("terms: price, MOQ and lead time need masterdata.supplier_price.edit and units that convert (V-UOM)", async () => {
    const sm = await pair("Laguna Oleo Supply", "MAT-0012");
    await expectCode(updateSupplierTerms(u.qa, { supplierMaterialId: sm.id, unitPrice: "1" }), "forbidden");
    await expectCode(updateSupplierTerms(u.proc, { supplierMaterialId: sm.id, unitPrice: "180", priceUom: "pcs" }), "validation");
    await updateSupplierTerms(u.proc, { supplierMaterialId: sm.id, unitPrice: "180", priceUom: "kg", currency: "PHP", moqQty: "50", moqUom: "kg", leadTimeDays: 7, supplierPartNumber: "LOS-CO-RBD" });
    const [after] = await db.select().from(supplierMaterials).where(eq(supplierMaterials.id, sm.id));
    expect(after.unitPrice).toBe("180.0000");
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.action, "masterdata.supplier_price.updated"));
    expect((ev.before as { unitPrice: string }).unitPrice).toBe("185.0000");
  });
});

describe("US-6-02 purchase requests and purchase orders", () => {
  it("statemachine.purchase_order: the transition table of data-model §6.4", () => {
    expect(canMove(PO_TRANSITIONS, "draft", "submitted")).toBe(true);
    expect(canMove(PO_TRANSITIONS, "draft", "sent")).toBe(false);
    expect(canMove(PO_TRANSITIONS, "submitted", "draft")).toBe(true);
    expect(canMove(PO_TRANSITIONS, "approved", "sent")).toBe(true);
    expect(canMove(PO_TRANSITIONS, "partially_received", "cancelled")).toBe(false);
    expect(canMove(PO_TRANSITIONS, "closed", "sent")).toBe(false);
  });

  it("authz.sod.approve_own (purchase_request): the submitter cannot approve; the site manager can", async () => {
    const m = await materialByCode("PKG-0101");
    const asManagerAndRequester = await (await import("../../support/kit")).asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    const pr = await createPurchaseRequest(asManagerAndRequester, { neededByDate: null, lines: [{ materialId: m.id, qty: "5000", uom: "pcs" }], idempotencyKey: "w4a-pr-1" });
    expect(pr.requestNumber).toMatch(/^PR-\d{2}-\d{5}$/);
    const again = await createPurchaseRequest(asManagerAndRequester, { lines: [{ materialId: m.id, qty: "5000" }], idempotencyKey: "w4a-pr-1" });
    expect(again.requestId).toBe(pr.requestId);
    await submitPurchaseRequest(asManagerAndRequester, { requestId: pr.requestId });
    await expectCode(decidePurchaseRequest(asManagerAndRequester, { requestId: pr.requestId, decision: "approve" }), "separation_of_duties");
    await expectCode(decidePurchaseRequest(u.warehouse, { requestId: pr.requestId, decision: "approve" }), "forbidden");
    // warehouse at RVS cannot see the NFD request (cross-site)
    await expectCode(getPurchaseRequest(u.warehouseRvs, pr.requestId), "not_found");
    // another site manager approves (the owner holds approve too; the default rule names site_manager)
    const otherManager = await (await import("../../support/kit")).asUser(kit, "checker.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    const r = await decidePurchaseRequest(otherManager, { requestId: pr.requestId, decision: "approve" });
    expect(r.final).toBe(true);
    const [row] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, pr.requestId));
    expect(row.status).toBe("approved");
    expect(row.approvedBy).toBe(otherManager.userId);
  });

  it("converts approved request lines into a PO line; the request becomes converted; MOQ shortfall warns", async () => {
    const [pr] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.status, "approved"));
    const d = await getPurchaseRequest(u.proc, pr.id);
    const line = d.lines[0];
    const s = await supplierByName(line.materialCode.startsWith("PKG") ? "Manila Print & Pack" : "Cebu Chemicals");
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: line.materialId, qty: "10", uom: line.uomEntered, purchaseRequestLineId: line.id }] });
    expect(po.poNumber).toMatch(/^PO-\d{2}-\d{5}$/);
    expect(po.warnings.some((w) => w.code === "moq")).toBe(true);
    const [after] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, pr.id));
    expect(after.status).toBe("converted");
    // the same request line cannot be ordered twice
    await expectCode(createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: line.materialId, qty: "10", uom: line.uomEntered, purchaseRequestLineId: line.id }] }), "state");
    await cancelPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId, reason: "Test cleanup (fictional)." });
  });

  it("thresholds: up to PHP 50,000 one site-manager step; above, a second step by owner_director; submitter never approves", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    // 100 kg × 180 = 18,000 → one step
    const small = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "100", uom: "kg" }] });
    await submitPurchaseOrder(u.proc, { purchaseOrderId: small.purchaseOrderId });
    await expectCode(decidePurchaseOrder(u.proc, { purchaseOrderId: small.purchaseOrderId, decision: "approve" }), "forbidden");
    const procAndManager = await (await import("../../support/kit")).asUser(kit, "procurement@bryels-care.test", ["procurement", "site_manager"], [kit.nfd]);
    await expectCode(decidePurchaseOrder(procAndManager, { purchaseOrderId: small.purchaseOrderId, decision: "approve" }), "separation_of_duties");
    const r1 = await decidePurchaseOrder(u.manager, { purchaseOrderId: small.purchaseOrderId, decision: "approve" });
    expect(r1.final).toBe(true);
    // 400 kg × 180 = 72,000 → two steps
    const big = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "400", uom: "kg" }] });
    await submitPurchaseOrder(u.proc, { purchaseOrderId: big.purchaseOrderId });
    const owner1 = await expectCode(decidePurchaseOrder(u.owner, { purchaseOrderId: big.purchaseOrderId, decision: "approve" }), "forbidden");
    expect(owner1.message).toMatch(/site manager/);
    const s1 = await decidePurchaseOrder(u.manager, { purchaseOrderId: big.purchaseOrderId, decision: "approve" });
    expect(s1.final).toBe(false);
    expect(s1.status).toBe("submitted");
    await expectCode(decidePurchaseOrder(u.manager, { purchaseOrderId: big.purchaseOrderId, decision: "approve" }), "forbidden");
    const s2 = await decidePurchaseOrder(u.owner, { purchaseOrderId: big.purchaseOrderId, decision: "approve" });
    expect(s2.final).toBe(true);
    const decisions = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "purchase_order"), eq(approvalDecisions.recordId, big.purchaseOrderId)));
    expect(decisions.map((d) => d.step).sort()).toEqual([1, 2]);
    const tr = await db.select().from(purchaseOrderStateTransitions).where(eq(purchaseOrderStateTransitions.purchaseOrderId, big.purchaseOrderId));
    expect(tr.map((t) => t.toState)).toEqual(["draft", "submitted", "approved"]);
    // transition log is append-only
    await expect(db.delete(purchaseOrderStateTransitions).where(eq(purchaseOrderStateTransitions.purchaseOrderId, big.purchaseOrderId))).rejects.toThrow();
  });

  it("sending generates the PO document (role titles only) and emails the supplier through the adapter; repeat is idempotent", async () => {
    process.env.EMAIL_PROVIDER = "outbox";
    try {
      const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.status, "approved"), eq(purchaseOrders.createdBy, u.proc.userId)));
      await expectCode(sendPurchaseOrder(u.manager, { purchaseOrderId: po.id }), "forbidden");
      const r = await sendPurchaseOrder(u.proc, { purchaseOrderId: po.id, idempotencyKey: "w4a-send-1" });
      expect(r.documentNumber).toMatch(/^DOC-/);
      expect(r.sendResult).toBe("captured");
      const again = await sendPurchaseOrder(u.proc, { purchaseOrderId: po.id, idempotencyKey: "w4a-send-1" });
      expect(again.replayed).toBe(true);
      expect(again.documentId).toBe(r.documentId);
      const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, r.documentId));
      expect(doc.documentKind).toBe("purchase_order");
      const data = JSON.stringify(doc.dataset);
      expect(data).toContain("Site Manager");
      expect(data).not.toContain("Dino Reyes"); // the approver's name never prints
      const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.template, "procurement.purchase_order"));
      expect(mails).toHaveLength(1);
      expect(mails[0].bodyText).toContain(po.poNumber);
      const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
      expect(after.status).toBe("sent");
      expect(after.sendResult).toBe("captured");
      // a sent PO cannot be approved again or edited
      await expectCode(decidePurchaseOrder(u.manager, { purchaseOrderId: po.id, decision: "approve" }), "state");
    } finally {
      delete process.env.EMAIL_PROVIDER;
    }
  });

  it("authz.cross_site.purchase_order: an RVS user cannot see or act on an NFD purchase order", async () => {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, "submitted"));
    await expectCode(getPurchaseOrder(u.warehouseRvs, po.id), "not_found");
    expect((await listPurchaseOrders(u.warehouseRvs, { status: "all" })).find((x) => x.id === po.id)).toBeUndefined();
    const rvsManager = await (await import("../../support/kit")).asUser(kit, "checker.nfd@bryels-care.test", "site_manager", [kit.rvs]);
    await expectCode(decidePurchaseOrder(rvsManager, { purchaseOrderId: po.id, decision: "approve" }), "not_found");
    // role escalation: warehouse and QA cannot create or approve purchase orders
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    await expectCode(createPurchaseOrder(u.warehouse, { supplierId: s.id, lines: [{ materialId: m.id, qty: "1", uom: "kg" }] }), "forbidden");
    await expectCode(decidePurchaseOrder(u.qa, { purchaseOrderId: po.id, decision: "approve" }), "forbidden");
  });

  it("a draft PO can be edited (V-ASL re-checked); a submitted one cannot", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await updatePurchaseOrder(u.proc, po.purchaseOrderId, { supplierId: s.id, lines: [{ materialId: m.id, qty: "12", uom: "kg", unitAmount: "181" }] });
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
    expect(row.totalAmount).toBe("2172.0000");
    const aloe = await materialByCode("MAT-0060");
    const e = await expectCode(updatePurchaseOrder(u.proc, po.purchaseOrderId, { supplierId: s.id, lines: [{ materialId: aloe.id, qty: "1", uom: "kg", unitAmount: "1" }] }), "validation");
    expect(e.details?.rule).toBe("V-ASL");
    await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
    await expectCode(updatePurchaseOrder(u.proc, po.purchaseOrderId, { supplierId: s.id, lines: [{ materialId: m.id, qty: "1", uom: "kg" }] }), "state");
    await expectCode(updatePurchaseOrder(u.warehouse, po.purchaseOrderId, { supplierId: s.id, lines: [{ materialId: m.id, qty: "1", uom: "kg" }] }), "forbidden");
  });

  it("returning to draft needs a reason and starts a new approval cycle", async () => {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, "submitted"));
    const otherManager = await (await import("../../support/kit")).asUser(kit, "checker.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    await expectCode(decidePurchaseOrder(otherManager, { purchaseOrderId: po.id, decision: "return" }), "validation");
    await decidePurchaseOrder(otherManager, { purchaseOrderId: po.id, decision: "return", note: "Check the quantity with production." });
    const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
    expect(after.status).toBe("draft");
  });
});

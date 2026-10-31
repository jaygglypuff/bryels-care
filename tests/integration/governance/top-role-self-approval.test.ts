/**
 * ADR-088 §2: the Owner/Director and a Site Manager (at the record's site) approve their own operational
 * records and decide every step alone while `approvals.top_roles_self_approve` is on (default on, only the
 * owner changes it). Each own-request approval is audited (`governance.self_approval.used`, `ownRequest`
 * on the decision event) and the database same-person triggers accept it on operational tables only.
 * Other roles keep the same-person rule; quality release stays independent (GMP); cross-site negatives.
 * Contexts are built from the real assignments (buildContextForUser), as in production.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, inventoryLots, materials, priceLists, products, purchaseRequests, roles, settings, supplierReturns, suppliers, userSiteAssignments, users, workOrders } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { listMyApprovals, refreshActionItems } from "@/modules/action-centre";
import { approveSettingChange, changeSetting } from "@/modules/governance";
import { approveAdjustment, approveCount, createAdjustment, createCount, getAdjustment, getCount, liftHold, placeHold, postAdjustment, recordCount, releaseCount, submitAdjustment, submitCount } from "@/modules/inventory";
import { createFormula, decideFormulaRevision, saveFormulaRevisionDraft, submitFormulaRevision } from "@/modules/masterdata";
import { createPurchaseOrder, createPurchaseRequest, createSupplierReturn, decidePurchaseOrder, decidePurchaseRequest, decideSupplierReturn, getPurchaseRequest, submitPurchaseOrder, submitPurchaseRequest } from "@/modules/procurement";
import { approveProductionOrder, createWorkOrder, planWorkOrder, releaseWorkOrder } from "@/modules/production";
import { approveOrder, approvePriceList, approveQuote, approveRequirement, createOrder, createPriceList, createQuote, draftRequirement, submitOrder, submitPriceList, submitQuote, submitRequirement } from "@/modules/sales";
import { approveInvoice, createExpenseClaim, createInvoiceFromShipment, decideExpenseClaim, submitExpenseClaim, submitInvoice } from "@/modules/finance";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";
import { loadW4b, shipNfdOrder, stockUp } from "../../support/w4b";

const KEY = "approvals.top_roles_self_approve";
let kit: Kit;
const ids: Record<string, string> = {};

async function userId(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u.id;
}
async function grant(email: string, roleCode: string, siteId: string | null) {
  const [r] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, roleCode)));
  await db.insert(userSiteAssignments).values(siteId ? { userId: await userId(email), roleId: r.id, siteId } : { userId: await userId(email), roleId: r.id, isOrganizationWide: true });
}
async function newUser(email: string, name: string) {
  await db.insert(users).values({ organizationId: kit.orgId, email, displayName: name, passwordHash: "!" });
}
const ctx = async (email: string, siteId?: string) => (await buildContextForUser(await userId(email), siteId ?? kit.nfd.id))!;
const owner = () => ctx("owner@bryels-care.test");
const manager = () => ctx("manager.nfd@bryels-care.test");
async function settingOff() {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY), isNull(settings.siteId)));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: KEY, value: false });
}
async function settingDefault() {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY)));
}
async function selfApprovalEvents(entityId: string) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, "governance.self_approval.used")));
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const productId = async (sku: string) => (await db.select().from(products).where(eq(products.skuCode, sku)))[0].id;
const materialId = async (code: string) => (await db.select().from(materials).where(eq(materials.code, code)))[0].id;
const supplierId = async (name: string) => (await db.select().from(suppliers).where(sql`${suppliers.name} like ${name + "%"}`))[0].id;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  // The NFD site manager also plans, buys and sells at NFD (a small company); real assignments.
  for (const r of ["production_planner", "procurement", "sales_cs"]) await grant("manager.nfd@bryels-care.test", r, kit.nfd.id);
  // An RVS site manager who also plans at NFD (cross-site negative) and a planner who also buys (role negative).
  await newUser("manager.rvs@bryels-care.test", "Rina Ramos (fictional)");
  await grant("manager.rvs@bryels-care.test", "site_manager", kit.rvs.id);
  await grant("manager.rvs@bryels-care.test", "production_planner", kit.nfd.id);
  await grant("manager.rvs@bryels-care.test", "procurement", kit.nfd.id);
  await newUser("planner.buyer@bryels-care.test", "Pia Lopez (fictional)");
  await grant("planner.buyer@bryels-care.test", "production_planner", kit.nfd.id);
  await grant("planner.buyer@bryels-care.test", "procurement", kit.nfd.id);
  // A QA person who is also the owner (owner holds every QA permission through a qa_qc assignment).
  await grant("owner@bryels-care.test", "qa_qc", kit.nfd.id);
  // The seeded owner role does not hold every sales and purchasing string: the owner also sells and buys at NFD.
  for (const r of ["sales_cs", "procurement"]) await grant("owner@bryels-care.test", r, kit.nfd.id);
  ids.acs = await productId("ACS-135");
}, 240_000);

// A failed test never leaves the setting switched off for the next one.
beforeEach(settingDefault);

describe("setting approvals.top_roles_self_approve", () => {
  it("is on by default; a change is a request that only the owner approves (with re-authentication)", async () => {
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    const o = await owner();
    expect(o.selfApprovesAt(kit.nfd.id)).toBe(true);
    expect(o.selfApprovesAt(null)).toBe(true);
    const m = await manager();
    expect(m.selfApprovesAt(kit.nfd.id)).toBe(true);
    expect(m.selfApprovesAt(null)).toBe(false); // organization-level records need the owner
    const rvsManager = await ctx("manager.rvs@bryels-care.test");
    expect(rvsManager.selfApprovesAt(kit.rvs.id)).toBe(true);
    expect(rvsManager.selfApprovesAt(kit.nfd.id)).toBe(false);
    expect((await ctx("planner.buyer@bryels-care.test")).selfApprovesAt(kit.nfd.id)).toBe(false);

    // The system administrator proposes (settings are their work); nothing changes until the owner approves.
    const admin = await ctx("admin@bryels-care.test");
    await expectCode(changeSetting(admin, { key: KEY, siteId: null, value: false, reason: "No password (test)" }, null), "reauth_required");
    const r = await changeSetting(admin, { key: KEY, siteId: null, value: false, reason: "Owner asked to switch it off (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    // A second system administrator may approve other settings, never this one.
    const admin2 = await ctx("admin2@bryels-care.test");
    const e = await expectCode(approveSettingChange(admin2, r.requestId, { password: "demo1234" }), "forbidden");
    expect(e.message).toContain("Only the owner");
    await expectCode(changeSetting(m, { key: KEY, siteId: null, value: false, reason: "Manager tries (test)" }, "demo1234"), "forbidden"); // no settings access at all
    await approveSettingChange(o, r.requestId, { password: "demo1234" });
    expect(await getSetting(db, kit.orgId, KEY)).toBe(false);
    expect((await owner()).selfApprovesAt(kit.nfd.id)).toBe(false);
  });
});

describe("production orders (approvals.sod.work_order_release)", () => {
  it("the owner and the NFD site manager approve their own production order; audited with the own-request flag", async () => {
    for (const who of [owner, manager]) {
      const c = await who();
      const wo = await createWorkOrder(c, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
      await approveProductionOrder(c, wo.workOrderId);
      const [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.workOrderId));
      expect(row.status).toBe("released");
      const used = await selfApprovalEvents(wo.workOrderId);
      expect(used.length).toBeGreaterThanOrEqual(1);
      expect(used[0].actorId).toBe(c.userId);
      const flagged = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, wo.workOrderId), sql`${auditEvents.after} ->> 'ownRequest' = 'true'`));
      expect(flagged.length).toBeGreaterThanOrEqual(1);
    }
    // The older plan → release path too.
    const o = await owner();
    const wo2 = await createWorkOrder(o, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    await planWorkOrder(o, wo2.workOrderId);
    await releaseWorkOrder(o, wo2.workOrderId);
  });

  it("with the setting off both are refused; a planner never approves their own; an RVS manager not at NFD", async () => {
    await settingOff();
    for (const who of [owner, manager]) {
      const c = await who();
      const wo = await createWorkOrder(c, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
      await expectCode(approveProductionOrder(c, wo.workOrderId), "separation_of_duties");
    }
    await settingDefault();
    const planner = await ctx("planner.buyer@bryels-care.test");
    const wo = await createWorkOrder(planner, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    expect(["separation_of_duties", "forbidden"]).toContain((await approveProductionOrder(planner, wo.workOrderId).catch((x) => x)).code);
    const rvsManager = await ctx("manager.rvs@bryels-care.test");
    const wo3 = await createWorkOrder(rvsManager, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    expect(rvsManager.allowedSiteIds).toContain(kit.nfd.id);
    await expectCode(approveProductionOrder(rvsManager, wo3.workOrderId), "separation_of_duties");
  });

  it("To approve: the owner's own order is decidable, says why, and counts in the badge", async () => {
    const o = await owner();
    const wo = await createWorkOrder(o, { productId: ids.acs, batchCount: 1, plannedStart: day(4), plannedEnd: day(5) });
    await refreshActionItems(kit.orgId);
    const row = (await listMyApprovals(o)).find((r) => r.entityId === wo.workOrderId);
    expect(row?.canDecide).toBe(true);
    expect(row?.ownRequest).toBe(true);
    expect(row?.selfApprovalNote).toBe("You can approve this yourself because you are the owner.");
    const planner = await ctx("planner.buyer@bryels-care.test");
    const pw = await createWorkOrder(planner, { productId: ids.acs, batchCount: 1, plannedStart: day(4), plannedEnd: day(5) });
    await refreshActionItems(kit.orgId);
    // The planner holds production.work_order.approve but it is their own: waiting for others.
    const prow = (await listMyApprovals(planner)).find((r) => r.entityId === pw.workOrderId);
    if (prow) expect(prow.canDecide).toBe(false);
    await settingOff();
    const off = (await listMyApprovals(await owner())).find((r) => r.entityId === wo.workOrderId);
    expect(off?.canDecide).toBe(false);
    await settingDefault();
  });
});

describe("purchase requests, purchase orders and supplier returns", () => {
  it("purchase request: the owner (standing in for the site manager step) and the NFD manager approve their own", async () => {
    const pkg = await materialId("PKG-0101");
    for (const who of [owner, manager]) {
      const c = await who();
      const pr = await createPurchaseRequest(c, { lines: [{ materialId: pkg, qty: "200", uom: "pcs" }], idempotencyKey: randomUUID() });
      await submitPurchaseRequest(c, { requestId: pr.requestId });
      await decidePurchaseRequest(c, { requestId: pr.requestId, decision: "approve" });
      const [row] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, pr.requestId));
      expect(row.status).toBe("approved");
      expect(row.approvedBy).toBe(c.userId); // the database same-person trigger accepted it (guarded path)
      expect((await selfApprovalEvents(pr.requestId)).length).toBeGreaterThanOrEqual(1);
      const view = await getPurchaseRequest(c, pr.requestId);
      expect(JSON.stringify(view.progress)).toContain("(own request)");
    }
  });

  it("purchase request: refused with the setting off, for a buyer, and for the RVS manager at NFD", async () => {
    const pkg = await materialId("PKG-0101");
    await settingOff();
    for (const who of [owner, manager]) {
      const c = await who();
      const pr = await createPurchaseRequest(c, { lines: [{ materialId: pkg, qty: "200", uom: "pcs" }], idempotencyKey: randomUUID() });
      await submitPurchaseRequest(c, { requestId: pr.requestId });
      const e = await decidePurchaseRequest(c, { requestId: pr.requestId, decision: "approve" }).catch((x) => x);
      expect(["separation_of_duties", "forbidden"]).toContain(e.code);
    }
    await settingDefault();
    for (const email of ["planner.buyer@bryels-care.test", "manager.rvs@bryels-care.test"]) {
      const c = await ctx(email);
      const pr = await createPurchaseRequest(c, { lines: [{ materialId: pkg, qty: "200", uom: "pcs" }], idempotencyKey: randomUUID() });
      await submitPurchaseRequest(c, { requestId: pr.requestId });
      const e = await decidePurchaseRequest(c, { requestId: pr.requestId, decision: "approve" }).catch((x) => x);
      expect(["separation_of_duties", "forbidden"]).toContain(e.code);
    }
  });

  it("purchase order above PHP 50,000: the owner decides both steps of their own order alone; the manager only step 1", async () => {
    const s = await supplierId("Laguna Oleo Supply");
    const m = await materialId("MAT-0012");
    const o = await owner();
    const big = await createPurchaseOrder(o, { supplierId: s, lines: [{ materialId: m, qty: "400", uom: "kg" }] });
    await submitPurchaseOrder(o, { purchaseOrderId: big.purchaseOrderId });
    const s1 = await decidePurchaseOrder(o, { purchaseOrderId: big.purchaseOrderId, decision: "approve" });
    expect(s1.final).toBe(false);
    const s2 = await decidePurchaseOrder(o, { purchaseOrderId: big.purchaseOrderId, decision: "approve" });
    expect(s2.final).toBe(true);
    const mg = await manager();
    const po = await createPurchaseOrder(mg, { supplierId: s, lines: [{ materialId: m, qty: "400", uom: "kg" }] });
    await submitPurchaseOrder(mg, { purchaseOrderId: po.purchaseOrderId });
    expect((await decidePurchaseOrder(mg, { purchaseOrderId: po.purchaseOrderId, decision: "approve" })).final).toBe(false);
    await expectCode(decidePurchaseOrder(mg, { purchaseOrderId: po.purchaseOrderId, decision: "approve" }), "forbidden"); // step 2 is the owner's role
    // The owner may not stand in for the site manager on someone else's order (no change for others' records).
    const small = await createPurchaseOrder(mg, { supplierId: s, lines: [{ materialId: m, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(mg, { purchaseOrderId: small.purchaseOrderId });
    await expectCode(decidePurchaseOrder(o, { purchaseOrderId: small.purchaseOrderId, decision: "approve" }), "forbidden");
  });

  it("supplier return: the owner and the NFD manager approve their own; refused when off", async () => {
    const s = await supplierId("Laguna Oleo Supply");
    const make = async (c: AuthContext) => {
      const r = await createSupplierReturn(c, { supplierId: s, reasonCode: "rejected_at_inspection", idempotencyKey: randomUUID() });
      // Lines need a QA-rejected lot from this supplier; the decision rules are what this test covers.
      await db.update(supplierReturns).set({ status: "submitted", submittedBy: c.userId, submittedAt: new Date(), creditExpectedAmount: "1000" }).where(eq(supplierReturns.id, r.returnId));
      return r.returnId;
    };
    for (const who of [owner, manager]) {
      const c = await who();
      const id = await make(c);
      expect((await decideSupplierReturn(c, { returnId: id, decision: "approve" })).final).toBe(true);
      const [row] = await db.select().from(supplierReturns).where(eq(supplierReturns.id, id));
      expect(row.approvedBy).toBe(c.userId);
    }
    await settingOff();
    const m = await manager();
    await expectCode(decideSupplierReturn(m, { returnId: await make(m), decision: "approve" }), "separation_of_duties");
    await settingDefault();
    const rvs = await ctx("manager.rvs@bryels-care.test");
    const id = await make(rvs);
    const e = await decideSupplierReturn(rvs, { returnId: id, decision: "approve" }).catch((x) => x);
    expect(["separation_of_duties", "forbidden"]).toContain(e.code);
  });
});

describe("stock adjustments and counts", () => {
  it("adjustment above the threshold: the owner drafts, approves both steps and posts alone", async () => {
    const o = await owner();
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(o, kit.nfd.id, b01.id, "10000", { materialCode: "MAT-0062" });
    const a = await createAdjustment(o, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "5000", unitCost: "5.00" }], idempotencyKey: randomUUID() });
    expect((await submitAdjustment(o, a.id)).requiresSecondApproval).toBe(true);
    await refreshActionItems(kit.orgId);
    const row = (await listMyApprovals(await owner())).find((r) => r.entityId === a.id);
    expect(row?.canDecide).toBe(true);
    expect(row?.selfApprovalNote).toContain("because you are the owner");
    expect((await approveAdjustment(o, a.id, "Step 1")).awaitingSecondStep).toBe(true);
    expect((await approveAdjustment(o, a.id, "Step 2")).status).toBe("approved");
    const p = await postAdjustment(o, a.id, randomUUID());
    expect(p.movements.length).toBe(1);
    const view = await getAdjustment(o, a.id);
    expect(view.approvedByName).toMatch(/\(own request\)$/);
  });

  it("adjustment: the NFD manager approves their own step 1 but not the owner step; off → refused; a warehouse user never", async () => {
    const m = await manager();
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(m, kit.nfd.id, b01.id, "1000", { materialCode: "MAT-0061" });
    const small = await createAdjustment(m, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: b01.id, direction: "increase", qty: "1", unitCost: "0.10" }], idempotencyKey: randomUUID() });
    await submitAdjustment(m, small.id);
    expect((await approveAdjustment(m, small.id)).status).toBe("approved");
    const big = await createAdjustment(m, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "900", unitCost: "50.00" }], idempotencyKey: randomUUID() });
    await submitAdjustment(m, big.id);
    expect((await approveAdjustment(m, big.id)).awaitingSecondStep).toBe(true);
    await expectCode(approveAdjustment(m, big.id), "forbidden");
    await settingOff();
    const m2 = await manager();
    const again = await createAdjustment(m2, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: b01.id, direction: "increase", qty: "1", unitCost: "0.10" }], idempotencyKey: randomUUID() });
    await submitAdjustment(m2, again.id);
    await expectCode(approveAdjustment(m2, again.id), "separation_of_duties");
    await settingDefault();
  });

  it("count: the NFD manager who counted approves the variance as site manager; off → refused", async () => {
    const run = async (code: string) => {
      const m = await manager();
      const l = await loc(kit.nfd.id, code);
      const lot = await makeLot(m, kit.nfd.id, l.id, "1000", { materialCode: "PKG-0101" });
      const c = await createCount(m, { countKind: "cycle", isBlind: false, locationIds: [l.id], counterUserIds: [m.userId] }).then((x) => x);
      await releaseCount(m, c.id);
      const view = await getCount(m, c.id);
      for (const line of view.lines) {
        const qty = line.lotId === lot.id ? "990" : String(Number(line.expected ?? 0));
        await recordCount(m, { countId: c.id, locationId: l.id, lotId: line.lotId, qty, idempotencyKey: randomUUID() });
      }
      await submitCount(m, c.id);
      const after = await getCount(m, c.id);
      const variant = after.lines.find((x) => x.lotId === lot.id)!;
      return { m, c, variant, after };
    };
    const one = await run("PKG-01");
    expect(one.after.canApproveVariances).toBe(true);
    const r = await approveCount(one.m, one.c.id, { lines: { [one.variant.id]: { reasonCode: "unrecorded_issue", note: "Sample pulled (fictional)" } } });
    expect(["approved", "pending_approval"]).toContain(r.status);
    await settingOff();
    const two = await run("A-02");
    expect(two.after.canApproveVariances).toBe(false);
    await expectCode(approveCount(two.m, two.c.id, { lines: { [two.variant.id]: { reasonCode: "unrecorded_issue", note: "x" } } }), "separation_of_duties");
    await settingDefault();
  });
});

describe("price lists, quotations, customer orders, customer requirements", () => {
  it("price list (organization level): the owner approves their own; the site manager is not a top role there", async () => {
    const o = await owner();
    const pl = await createPriceList(o, { code: `PL-SELF-${Date.now().toString(36)}`, name: "Owner list (fictional)", partyKind: "general", effectiveFrom: today(), lines: [{ productId: ids.acs, unitAmount: "72" }] });
    await submitPriceList(o, pl.id);
    await approvePriceList(o, pl.id, "Own list");
    const [row] = await db.select().from(priceLists).where(eq(priceLists.id, pl.id));
    expect(row.approvedBy).toBe(o.userId);
    await settingOff();
    const o2 = await owner();
    const pl2 = await createPriceList(o2, { code: `PL-SELF2-${Date.now().toString(36)}`, name: "Owner list 2 (fictional)", partyKind: "general", effectiveFrom: today(), lines: [{ productId: ids.acs, unitAmount: "73" }] });
    await submitPriceList(o2, pl2.id);
    await expectCode(approvePriceList(o2, pl2.id), "separation_of_duties");
    await settingDefault();
  });

  it("quotation above 10 % discount: the owner decides both steps (site manager, finance) alone; the manager only step 1", async () => {
    const o = await owner();
    const pl = await createPriceList(o, { code: `PL-Q-${Date.now().toString(36)}`, name: "Quote list (fictional)", partyKind: "general", effectiveFrom: today(), lines: [{ productId: ids.acs, unitAmount: "80" }] });
    await submitPriceList(o, pl.id);
    await approvePriceList(o, pl.id);
    const customerId = (await db.execute(sql`select id from customers limit 1`))[0].id as string;
    const q = await createQuote(o, { customerId, lines: [{ productId: ids.acs, qtyUnits: "48", unitPrice: "68" }] });
    expect((await submitQuote(o, q.id)).status).toBe("pending_approval");
    await approveQuote(o, q.id);
    await approveQuote(o, q.id);
    const steps = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "quote"), eq(approvalDecisions.recordId, q.id)));
    expect(steps.map((s) => s.step).sort()).toEqual([1, 2]);
    const m = await manager();
    const q2 = await createQuote(m, { customerId, lines: [{ productId: ids.acs, qtyUnits: "48", unitPrice: "68" }] });
    await submitQuote(m, q2.id);
    await approveQuote(m, q2.id);
    await expectCode(approveQuote(m, q2.id), "forbidden"); // finance step: not a site-manager decision
    await settingOff();
    const m2 = await manager();
    const q3 = await createQuote(m2, { customerId, lines: [{ productId: ids.acs, qtyUnits: "48", unitPrice: "68" }] });
    await submitQuote(m2, q3.id);
    await expectCode(approveQuote(m2, q3.id), "separation_of_duties");
    await settingDefault();
  });

  it("customer order over the credit limit: the owner approves their own (finance step stood in); a sales user never", async () => {
    const o = await owner();
    const [c] = await db.execute(sql`select id from customers order by created_at limit 1`);
    const [{ credit_limit_amount: oldLimit }] = await db.execute(sql`select credit_limit_amount from customers where id = ${c.id}`);
    await db.execute(sql`update customers set credit_limit_amount = 10 where id = ${c.id}`);
    const order = await createOrder(o, { customerId: c.id as string, requestedDeliveryOn: day(10), lines: [{ productId: ids.acs, qtyUnits: "96", unitPrice: "70" }] });
    const sub = await submitOrder(o, order.id);
    expect(sub.status).toBe("pending_approval");
    const res = await approveOrder(o, order.id, { note: "Own order" });
    expect(res.confirmed).toBe(true);
    const salesUser = await ctx("sales@bryels-care.test");
    const so = await createOrder(salesUser, { customerId: c.id as string, requestedDeliveryOn: day(10), lines: [{ productId: ids.acs, qtyUnits: "96", unitPrice: "70" }] });
    await submitOrder(salesUser, so.id);
    await expectCode(approveOrder(salesUser, so.id), "forbidden");
    // The owner cannot stand in for finance on the sales user's order (before the escalation delay).
    await expectCode(approveOrder(o, so.id), "forbidden");
    await db.execute(sql`update customers set credit_limit_amount = ${oldLimit} where id = ${c.id}`);
  });

  it("customer requirement (organization level): the owner approves their own; refused when off", async () => {
    const o = await owner();
    const [c] = await db.execute(sql`select id from customers order by created_at limit 1`);
    const r = await draftRequirement(o, { customerId: c.id as string, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "200", effectiveFrom: today() });
    await submitRequirement(o, r.id);
    await approveRequirement(o, r.id, "Own requirement");
    await settingOff();
    const o2 = await owner();
    const r2 = await draftRequirement(o2, { customerId: c.id as string, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "210", effectiveFrom: day(30) });
    await submitRequirement(o2, r2.id);
    await expectCode(approveRequirement(o2, r2.id), "separation_of_duties");
    await settingDefault();
  });
});

describe("expense claims, recipes and invoices", () => {
  it("expense claim: the owner and the NFD manager approve their own claim; off → refused", async () => {
    for (const who of [owner, manager]) {
      const c = await who();
      const claim = await createExpenseClaim(c, { categoryCode: "meals", description: "Supplier lunch (fictional)", expenseDate: today(), amount: "300" });
      await submitExpenseClaim(c, claim.claimId);
      await decideExpenseClaim(c, claim.claimId, { decision: "approved" });
      const [row] = await db.execute(sql`select status, approved_by from expense_claims where id = ${claim.claimId}`);
      expect(row.status).toBe("approved");
      expect(row.approved_by).toBe(c.userId);
    }
    await settingOff();
    const m = await manager();
    const claim = await createExpenseClaim(m, { categoryCode: "meals", description: "Supplier lunch 2 (fictional)", expenseDate: today(), amount: "300" });
    await submitExpenseClaim(m, claim.claimId);
    await expectCode(decideExpenseClaim(m, claim.claimId, { decision: "approved" }), "separation_of_duties");
    await settingDefault();
  });

  it("recipe: the QA step stays with QA; the owner then approves their own recipe at the owner step", async () => {
    const o = await owner();
    // The owner also holds qa_qc here (beforeAll): the QA step of their own recipe still needs another QA person.
    const ahl = await productId("AHL-250");
    const [mat] = await db.select().from(materials).limit(1);
    const f = await createFormula(o, { productId: ahl, code: `F-SELF-${Date.now().toString(36)}`, name: "Owner recipe (fictional)", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" });
    await saveFormulaRevisionDraft(o, { revisionId: f.revisionId, referenceBatchSizeG: "1000", theoreticalYieldPct: "97", lines: [{ materialId: mat.id, quantityG: "1000", toleranceAbsG: "2" }] });
    await submitFormulaRevision(o, f.revisionId);
    await expectCode(decideFormulaRevision(o, { id: f.revisionId, decision: "approved", note: "Owner as QA on own recipe" }), "separation_of_duties");
    const qa = await ctx("qa.nfd@bryels-care.test");
    await decideFormulaRevision(qa, { id: f.revisionId, decision: "approved", note: "QA step" });
    const r = await decideFormulaRevision(o, { id: f.revisionId, decision: "approved", note: "Owner step" });
    expect(r.status).toBe("approved");
    // A site manager is not a top role for organization-level recipes.
    const m = await manager();
    expect(m.selfApprovesAt(null)).toBe(false);
  });

  it("invoice above PHP 100,000: finance decides the finance step; the owner approves the owner step of their own invoice", async () => {
    const w = await loadW4b();
    await stockUp(w, ["ACS-135"], "5000");
    await db.execute(sql`update customers set credit_limit_amount = null`); // the shipment fixture must not stop at a credit check
    const shipped = await shipNfdOrder(w, "ZBT-001", [{ sku: "ACS-135", qty: "2000", price: "70" }]).catch(async () => {
      const [c] = await db.execute(sql`select code from customers where status = 'active' order by created_at limit 1`);
      return shipNfdOrder(w, c.code as string, [{ sku: "ACS-135", qty: "2000", price: "70" }]);
    });
    const o = await owner();
    const { invoiceId } = await createInvoiceFromShipment(o, { shipmentId: shipped.shipment.id });
    await submitInvoice(o, invoiceId);
    await expectCode(approveInvoice(o, invoiceId), "forbidden"); // the finance step is finance's (rules do not name the owner)
    const finance = await ctx("finance@bryels-care.test");
    await approveInvoice(finance, invoiceId, "Finance step");
    await approveInvoice(o, invoiceId, "Owner step, own invoice");
    const [row] = await db.execute(sql`select status, approved_by, submitted_by from invoices where id = ${invoiceId}`);
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(row.submitted_by); // ck_invoices_sod accepted the own-request approval
  });
});

describe("quality release stays independent (GMP) and the database guard", () => {
  it("the owner who also holds QA cannot lift a hold they placed (same-person rule unchanged)", async () => {
    const o = await owner();
    expect(o.can("quality.hold.approve")).toBe(true); // through the qa_qc assignment
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(o, kit.nfd.id, b01.id, "100", { materialCode: "MAT-0063" });
    const h = await placeHold(o, { scope: "lot", lotRef: lot.id, reasonCode: "other", reason: "Owner suspects a leak (fictional)", idempotencyKey: randomUUID() });
    await expectCode(liftHold(o, { holdId: h.holdId, resolution: "released", reason: "Owner lifts own hold" }), "separation_of_duties");
    const [l] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lot.id));
    expect(l.qualityStatus).toBe("on_hold");
  });

  it("bc.self_approval opens operational tables only: quality holds and disposition requests still refuse the same person", async () => {
    const ownerId = await userId("owner@bryels-care.test");
    const [pl] = await db.select().from(priceLists).limit(1);
    const accepted = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('bc.self_approval', 'on', true)`);
        await tx.update(priceLists).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(priceLists.id, pl.id));
        await tx.execute(sql`set constraints all immediate`);
        tx.rollback();
      })
      .catch((e) => e);
    expect(String(accepted?.cause?.message ?? accepted?.message ?? "")).not.toContain("price_lists_sod_ck");
    const refused = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('bc.self_approval', 'on', true)`);
        await tx.execute(sql`update quality_holds set closed_by = opened_by where id = (select id from quality_holds order by opened_at desc limit 1)`);
        await tx.execute(sql`set constraints all immediate`);
      })
      .catch((e) => e);
    expect(String(refused?.cause?.message ?? refused?.message ?? "")).toMatch(/ck_quality_holds_closer_not_opener/);
    const withoutFlag = await db
      .transaction(async (tx) => {
        await tx.update(priceLists).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(priceLists.id, pl.id));
      })
      .catch((e) => e);
    expect(String(withoutFlag?.cause?.message ?? withoutFlag?.message ?? "")).toContain("price_lists_sod_ck");
  });

  it("the custom migration matches src/db/sql/adr088.sql", async () => {
    const { customMigration } = await import("../../support/custom-sql");
    const { migration, canonical } = customMigration("adr088");
    expect(migration.trim()).toBe(canonical.trim());
  });

  it("the ADR-073 owner override still works with the setting off", async () => {
    await settingOff();
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "governance.owner_override", value: true });
    const o = await owner();
    expect(o.ownerOverride).toBe(true);
    expect(o.selfApprovesAt(kit.nfd.id)).toBe(false);
    const wo = await createWorkOrder(o, { productId: ids.acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    await approveProductionOrder(o, wo.workOrderId);
    const used = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, wo.workOrderId), eq(auditEvents.action, "governance.owner_override.used"))).orderBy(desc(auditEvents.occurredAt));
    expect(used.length).toBeGreaterThanOrEqual(1);
    await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "governance.owner_override")));
    await settingDefault();
  });
});

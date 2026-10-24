/**
 * US-4-05 sales order entry, credit/approval check and state machine (W3D). Tests: statemachine.*
 * (sales order), authz.threshold.rule_evaluation, authz.sod.approve_own (sales_order),
 * sales.cancel_after_dispatch_rejected, sales.order_site_of_fulfilment, idempotency, concurrency.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, notifications, salesOrderStateTransitions, salesOrders, stockAllocations, stockReservations } from "@/db/schema";
import {
  allocateOrder,
  approveOrder,
  cancelOrder,
  createOrder,
  draftRequirement,
  editOrder,
  getOrder,
  returnOrderToDraft,
  setCustomerStatus,
  submitOrder,
  submitRequirement,
  approveRequirement,
  ORDER_TRANSITIONS,
  canOrderTransition,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { auditCount, bundle, clearOrgSetting, inDays, loadW3d, newCustomer, productId, setOrgSetting, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;
let acs: string;
let gbs: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  acs = await productId("ACS-135");
  gbs = await productId("GBS-135");
});

const transitionsOf = async (orderId: string) =>
  (await db.select().from(salesOrderStateTransitions).where(eq(salesOrderStateTransitions.salesOrderId, orderId)).orderBy(asc(salesOrderStateTransitions.occurredAt))).map((t) => `${t.fromState ?? "∅"}>${t.toState}`);

async function draft(customerId: string, qty = "48", price = "70", ctx = w.sales) {
  return createOrder(ctx, { customerId, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: qty, unitPrice: price }] });
}

describe("US-4-05 order state machine", () => {
  it("statemachine.sales_order: the transition table matches docs/data-model.md §6.5", () => {
    expect(canOrderTransition("draft", "submitted")).toBe(true);
    expect(canOrderTransition("submitted", "pending_approval")).toBe(true);
    expect(canOrderTransition("pending_approval", "confirmed")).toBe(true);
    expect(canOrderTransition("confirmed", "allocated")).toBe(true);
    expect(canOrderTransition("shipped", "cancelled")).toBe(false);
    expect(canOrderTransition("partially_shipped", "cancelled")).toBe(false);
    expect(canOrderTransition("draft", "confirmed")).toBe(false);
    for (const to of Object.values(ORDER_TRANSITIONS).flat()) expect(Object.keys(ORDER_TRANSITIONS)).toContain(to);
  });

  it("within limits a submitted order confirms itself; every transition is a row; audit submitted and confirmed", async () => {
    const c = await newCustomer(w, { creditLimit: "100000" });
    const o = await draft(c.id);
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("confirmed");
    expect(await transitionsOf(o.id)).toEqual(["∅>draft", "draft>submitted", "submitted>confirmed"]);
    const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
    expect(row).toMatchObject({ status: "confirmed", creditCheckStatus: "passed", submittedBy: w.sales.userId, totalAmount: "3360.0000" });
    expect(await auditCount(o.id, "sales.sales_order.submitted")).toBe(1);
    expect(await auditCount(o.id, "sales.sales_order.confirmed")).toBe(1);
    // The warehouse is told to allocate.
    const n = await db.select().from(notifications).where(and(eq(notifications.entityId, o.id), eq(notifications.kind, "sales_order_confirmed")));
    expect(n.length).toBeGreaterThan(0);
    // Illegal moves are 409 and write nothing.
    await expectCode(submitOrder(w.sales, o.id), "state");
    await expectCode(approveOrder(w.finance, o.id), "state");
    expect(await transitionsOf(o.id)).toHaveLength(3);
  });

  it("authz.threshold.rule_evaluation: over the credit limit it stops at pending_approval with the reason; the creator cannot approve; finance confirms", async () => {
    const c = await newCustomer(w, { creditLimit: "5000" });
    const o = await draft(c.id, "96"); // 6,720 > 5,000
    const r = await submitOrder(w.sales, o.id);
    expect(r).toMatchObject({ status: "pending_approval" });
    expect(r.reasons.map((x) => x.message)).toContain("Over credit limit");
    const view = await getOrder(w.sales, o.id);
    expect(view.order.approvalReasons).toEqual([{ code: "credit_limit", message: "Over credit limit" }]);
    expect(view.approval?.next?.roleCodes).toEqual(["finance"]);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, o.id), eq(auditEvents.action, "platform.approval_rule.evaluated")));
    expect(ev.length).toBeGreaterThan(0);
    expect((ev[0].after as { ruleIds: string[] }).ruleIds.length).toBeGreaterThan(0);
    // sales_cs has no approve permission at all
    await expectCode(approveOrder(w.sales, o.id), "forbidden");
    // SoD: even holding finance permissions, the person who entered the order cannot approve it
    const creatorAsFinance = withPermissions(w.sales, [...bundle("sales_cs"), ...bundle("finance")], ["sales_cs", "finance"]);
    await expectCode(approveOrder(creatorAsFinance, o.id), "separation_of_duties");
    // The site manager holds sales.sales_order.approve but the rule names finance
    await expectCode(approveOrder(w.manager, o.id), "forbidden");
    // The owner may approve only after the 24 h escalation delay
    await expectCode(approveOrder(w.owner, o.id), "forbidden");
    const res = await approveOrder(w.finance, o.id, { note: "Customer paid last invoice (fictional)" });
    expect(res.confirmed).toBe(true);
    const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
    expect(row).toMatchObject({ status: "confirmed", creditCheckStatus: "overridden", approvedBy: w.finance.userId });
    expect(await transitionsOf(o.id)).toEqual(["∅>draft", "draft>submitted", "submitted>pending_approval", "pending_approval>confirmed"]);
  });

  it("escalation: after 24 hours the owner may approve; a credit-hold customer always needs approval", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    await setCustomerStatus(w.finance, c.id, "on_hold", "Overdue balance (fictional)");
    const o = await draft(c.id, "24");
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("pending_approval");
    expect(r.reasons[0]).toMatchObject({ code: "credit_hold" });
    await db.update(salesOrders).set({ submittedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(salesOrders.id, o.id));
    expect((await approveOrder(w.owner, o.id)).confirmed).toBe(true);
  });

  it("the order amount threshold (PHP 200,000 by default) needs approval even within the credit limit", async () => {
    const c = await newCustomer(w, { creditLimit: "10000000" });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: "3000", unitPrice: "70" }] }); // 210,000
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("pending_approval");
    expect(r.reasons.map((x) => x.code)).toEqual(["amount"]);
  });

  it("a returned order goes back to draft with a reason; after editing and resubmitting the previous decisions do not count", async () => {
    const c = await newCustomer(w, { creditLimit: "1000" });
    const o = await draft(c.id, "48");
    await submitOrder(w.sales, o.id);
    await expectCode(returnOrderToDraft(w.finance, o.id, ""), "validation");
    await returnOrderToDraft(w.finance, o.id, "Split into two deliveries");
    expect((await getOrder(w.sales, o.id)).order.status).toBe("draft");
    await editOrder(w.sales, o.id, { customerId: c.id, requestedDeliveryOn: inDays(12), lines: [{ productId: acs, qtyUnits: "12", unitPrice: "70" }] });
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("confirmed"); // 840 within 1,000
    expect(await transitionsOf(o.id)).toContain("pending_approval>draft");
  });

  it("MOQ below the customer's approved requirement warns by default and blocks when the setting says block", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    const req = await draftRequirement(w.sales, { customerId: c.id, productId: acs, requirementKind: "moq", valueNumeric: "96", effectiveFrom: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) });
    await submitRequirement(w.sales, req.id);
    await approveRequirement(w.qa, req.id);
    const o = await draft(c.id, "48");
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("confirmed");
    expect(r.warnings.map((x) => x.code)).toContain("moq");
    await setOrgSetting(w.orgId, "sales.order.moq_policy", "block");
    try {
      const o2 = await draft(c.id, "48");
      await expectCode(submitOrder(w.sales, o2.id), "validation");
      expect((await getOrder(w.sales, o2.id)).order.status).toBe("draft");
    } finally {
      await clearOrgSetting(w.orgId, "sales.order.moq_policy");
    }
  });

  it("cancelling a confirmed (allocated) order releases allocations and reservations with the reason; after dispatch it is 409", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await draft(c.id, "12");
    await submitOrder(w.sales, o.id);
    const alloc = await allocateOrder(w.warehouse, o.id);
    expect(alloc.created.length).toBeGreaterThan(0);
    await expectCode(cancelOrder(w.warehouse, o.id, "nope"), "forbidden");
    await expectCode(cancelOrder(w.sales, o.id, ""), "validation");
    await cancelOrder(w.sales, o.id, "Customer withdrew the PO");
    const view = await getOrder(w.sales, o.id);
    expect(view.order.status).toBe("cancelled");
    expect(view.allocations).toHaveLength(0);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, o.id), eq(auditEvents.action, "sales.sales_order.cancelled")));
    expect(ev[0].reason).toBe("Customer withdrew the PO");
    expect((ev[0].before as { status: string }).status).toBe("allocated");
    // W3E: allocations are released with the reason, never deleted.
    const left = await db.select().from(stockAllocations).where(eq(stockAllocations.salesOrderLineId, view.lines[0].id));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((a) => a.status === "released" && a.releaseReason === "Order cancelled: Customer withdrew the PO")).toBe(true);
    const rsv = await db.select().from(stockReservations).where(and(eq(stockReservations.demandId, view.lines[0].id), eq(stockReservations.status, "active")));
    expect(rsv).toHaveLength(0);
    // sales.cancel_after_dispatch_rejected: the seeded shipped order SO-…-00001
    const shipped = (await db.select().from(salesOrders)).find((x) => x.orderNumber.endsWith("00001"))!;
    const e = await expectCode(cancelOrder(w.sales, shipped.id, "Too late"), "state");
    expect(e.message).toMatch(/customer return/);
  });

  it("sales.order_site_of_fulfilment: the order belongs to the entering site; other sites cannot see or act on it", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    const o = await draft(c.id, "5");
    expect(o.siteId).toBe(w.nfd.id);
    await expectCode(getOrder(w.warehouseRvs, o.id), "not_found");
    const rvsSales = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.rvs]);
    await expectCode(submitOrder(rvsSales, o.id), "not_found");
    await expectCode(cancelOrder(rvsSales, o.id, "x"), "not_found");
    // A user assigned only to NFD cannot enter an order for RVS.
    const nfdOnly = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.nfd]);
    await expectCode(createOrder(nfdOnly, { customerId: c.id, requestedDeliveryOn: inDays(3), siteId: w.rvs.id, lines: [{ productId: acs, qtyUnits: "1", unitPrice: "70" }] } as never), "not_found");
    // Role escalation: a warehouse operator cannot enter or submit orders.
    await expectCode(createOrder(w.warehouse, { customerId: c.id, requestedDeliveryOn: inDays(3), lines: [{ productId: acs, qtyUnits: "1" }] }), "forbidden");
    await expectCode(submitOrder(w.warehouse, o.id), "forbidden");
  });

  it("idempotency: a repeated submit with the same key returns the stored result; concurrent submits confirm once", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    const o = await draft(c.id, "6");
    const key = `w3d-submit-${o.id}`;
    const a = await submitOrder(w.sales, o.id, { idempotencyKey: key });
    const b = await submitOrder(w.sales, o.id, { idempotencyKey: key });
    expect(b).toEqual(a);
    expect(await transitionsOf(o.id)).toHaveLength(3);
    const o2 = await draft(c.id, "7");
    const results = await Promise.allSettled([submitOrder(w.sales, o2.id), submitOrder(w.sales, o2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await transitionsOf(o2.id)).toHaveLength(3);
  });

  it("separation of duties can be switched off for sales orders only by setting (A-PM-14)", async () => {
    const c = await newCustomer(w, { creditLimit: "1" });
    const both = withPermissions(w.finance, [...bundle("finance"), ...bundle("sales_cs")], ["finance", "sales_cs"]);
    const o = await draft(c.id, "1", "70", both);
    await submitOrder(both, o.id);
    await expectCode(approveOrder(both, o.id), "separation_of_duties");
    await setOrgSetting(w.orgId, "approvals.sod.sales_order", false);
    try {
      expect((await approveOrder(both, o.id)).confirmed).toBe(true);
    } finally {
      await clearOrgSetting(w.orgId, "approvals.sod.sales_order");
    }
    void gbs;
  });
});

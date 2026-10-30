/**
 * Consultant review 2026-10-30 (flow C, "17 shipments never invoiced"): dispatching a shipment creates its
 * invoice draft in the same transaction, exactly once even when the dispatch is retried; the draft still goes
 * through submit → approve (submitter ≠ approver) → issue; a draft that cannot be made never blocks the
 * dispatch (audited, finance told); reversing the dispatch cancels the untouched draft; `notInvoicedShipments`
 * counts dispatched shipments without an issued invoice, per site, for finance.invoice.view only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, invoices, notifications, shipments, users } from "@/db/schema";
import { SYSTEM_ACTOR_EMAIL } from "@/lib/auth/system";
import { approveInvoice, createInvoiceFromShipment, dispatchDraftKey, draftInvoiceAtDispatch, issueInvoice, notInvoicedShipments, submitInvoice } from "@/modules/finance";
import { allocateOrder, confirmOrder, createOrder, dispatchShipment, manilaToday, reverseShipment } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { pickAll, verifyAll } from "../../support/w3e";
import { PW, bundle, clearOrgSetting, customerByCode, loadW4b, productBySku, setOrgSetting, shipNfdOrder, stockUp, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;
let systemUserId: string;
const invoicesOf = (shipmentId: string) => db.select().from(invoices).where(eq(invoices.shipmentId, shipmentId));

/** An NFD order picked and verified, ready to dispatch (so the test controls the dispatch call). */
async function packedShipment(customerCode: string, sku: string, qty: string, price: string) {
  const c = await customerByCode(customerCode);
  const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: d < manilaToday() ? manilaToday() : d, lines: [{ productId: (await productBySku(sku)).id, qtyUnits: qty, unitPrice: price }] });
  await confirmOrder(w.sales, o.id);
  await allocateOrder(w.warehouse, o.id);
  const { pickId, shipmentId } = await pickAll(w.warehouse, o.id);
  await verifyAll(w.manager, w.warehouse, pickId, shipmentId);
  return shipmentId;
}

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b({ draftAtDispatch: true });
  await stockUp(w);
  systemUserId = (await db.select().from(users).where(eq(users.email, SYSTEM_ACTOR_EMAIL)))[0].id;
}, 180_000);

describe("invoice draft at dispatch", () => {
  let shipmentId: string;
  let invoiceId: string;

  it("dispatch creates exactly one invoice draft, even when the dispatch is retried", async () => {
    shipmentId = await packedShipment("CUS-001", "ACS-135", "24", "68");
    const k = randomUUID();
    const input = { driverName: "Jun Dela Cruz", vehiclePlate: "NFD 2468", idempotencyKey: k };
    const first = await dispatchShipment(w.warehouse, shipmentId, input);
    expect(first.replayed).toBe(false);
    // Same form submitted again (double tap / network retry): replayed, no second draft.
    expect((await dispatchShipment(w.warehouse, shipmentId, input)).replayed).toBe(true);
    // A new submission on the dispatched shipment is refused and changes nothing.
    await expectCode(dispatchShipment(w.warehouse, shipmentId, { ...input, idempotencyKey: randomUUID() }), "state");
    // The hook itself run again (e.g. a retried job) replays the first draft.
    const again = await db.transaction((tx) => draftInvoiceAtDispatch(tx, w.warehouse, { shipmentId, siteId: w.nfd.id }));
    const rows = await invoicesOf(shipmentId);
    expect(rows).toHaveLength(1);
    invoiceId = rows[0].id;
    expect(again?.invoiceId).toBe(invoiceId);
    expect(rows[0]).toMatchObject({ status: "draft", siteId: w.nfd.id, createdBy: systemUserId, idempotencyKey: dispatchDraftKey(shipmentId), totalAmount: "1632.0000" });
    // Audited as the system action on behalf of the dispatcher.
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, invoiceId), eq(auditEvents.action, "finance.invoice.created")));
    expect(ev.actorLabel).toBe("system:finance.invoice_draft_at_dispatch");
    expect(ev.onBehalfOf).toBe(w.warehouse.userId);
    // The people who submit invoices at NFD are told once; the dispatcher is not.
    const notes = await db.select().from(notifications).where(and(eq(notifications.entityId, invoiceId), eq(notifications.kind, "finance.invoice.draft_at_dispatch")));
    const to = notes.map((n) => n.recipientUserId);
    expect(to).toContain(w.sales.userId);
    expect(to).not.toContain(w.warehouse.userId);
    expect(new Set(to).size).toBe(to.length);
    expect(notes[0].link).toBe(`/finance/invoices/${invoiceId}`);
    // "Create invoice from a dispatched order" by hand now finds the draft instead of making a second one.
    const dup = await expectCode(createInvoiceFromShipment(w.sales, { shipmentId }), "conflict");
    expect(dup.details?.code).toBe("DUPLICATE_DOCUMENT");
  });

  it("the draft is still submitted, approved (not by the submitter) and issued by people", async () => {
    await submitInvoice(w.sales, invoiceId);
    await expectCode(approveInvoice(w.sales, invoiceId), "forbidden");
    await approveInvoice(w.finance, invoiceId);
    const r = await issueInvoice(w.finance2, invoiceId, { password: PW });
    expect(r.invoiceNumber).toMatch(/^INV-/);
  });

  it("a draft that cannot be made never blocks the dispatch: audited, finance told, shipment stays not invoiced", async () => {
    const sid = await packedShipment("CUS-002", "GBS-135", "12", "70");
    await setOrgSetting(w.orgId, "finance.currency", "USD"); // orders are in PHP → the draft is refused
    try {
      const r = await dispatchShipment(w.warehouse, sid, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: randomUUID() });
      expect(r.replayed).toBe(false);
    } finally {
      await clearOrgSetting(w.orgId, "finance.currency");
    }
    expect((await db.select().from(shipments).where(eq(shipments.id, sid)))[0].status).toBe("dispatched");
    expect(await invoicesOf(sid)).toHaveLength(0);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, sid), eq(auditEvents.action, "finance.invoice.draft_at_dispatch_failed")));
    expect(ev.reason).toMatch(/USD/);
    const notes = await db.select().from(notifications).where(and(eq(notifications.entityId, sid), eq(notifications.kind, "finance.invoice.draft_at_dispatch")));
    expect(notes.map((n) => n.recipientUserId)).toContain(w.finance.userId);
    // The shipment is listed as not invoiced and without any draft.
    const n = await notInvoicedShipments(w.finance);
    expect(n.withoutDraft).toBeGreaterThanOrEqual(1);
  });

  it("switched off (finance.invoice.draft_at_dispatch = false): no draft", async () => {
    const sid = await packedShipment("CUS-003", "ACS-135", "12", "70");
    await setOrgSetting(w.orgId, "finance.invoice.draft_at_dispatch", false);
    try {
      await dispatchShipment(w.warehouse, sid, { driverName: "Ramon", vehiclePlate: "NBC 1234", idempotencyKey: randomUUID() });
    } finally {
      await setOrgSetting(w.orgId, "finance.invoice.draft_at_dispatch", true);
    }
    expect(await invoicesOf(sid)).toHaveLength(0);
  });

  it("reversing the dispatch cancels the untouched draft made at dispatch (a submitted one still blocks)", async () => {
    const s = await shipNfdOrder(w, "CUS-003", [{ sku: "GBS-135", qty: "12", price: "70.00" }]);
    const [draft] = await invoicesOf(s.shipment.id);
    expect(draft.status).toBe("draft");
    await reverseShipment(w.manager, s.shipment.id, { reason: "Truck did not leave the yard", idempotencyKey: randomUUID() });
    const [after] = await invoicesOf(s.shipment.id);
    expect(after).toMatchObject({ status: "cancelled", cancelReason: "Dispatch reversed: Truck did not leave the yard" });
    // Submitted: finance has moved it on, so the reversal is refused as before.
    const t = await shipNfdOrder(w, "CUS-003", [{ sku: "GBS-135", qty: "12", price: "70.00" }]);
    const [d2] = await invoicesOf(t.shipment.id);
    await submitInvoice(w.sales, d2.id);
    const e = await expectCode(reverseShipment(w.manager, t.shipment.id, { reason: "Truck did not leave the yard", idempotencyKey: randomUUID() }), "conflict");
    expect(e.details?.code).toBe("SHIPMENT_INVOICED");
  });
});

describe("notInvoicedShipments (owner Home)", () => {
  it("counts dispatched shipments without an issued invoice at the caller's sites, oldest first; never another site's", async () => {
    const before = await notInvoicedShipments(w.finance);
    const rvsOnly = withPermissions(w.finance, bundle("finance"), w.finance.roleCodes, [w.rvs]);
    const rvsBefore = await notInvoicedShipments(rvsOnly);
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "12", price: "68" }]);
    const mid = await notInvoicedShipments(w.finance);
    expect(mid.count).toBe(before.count + 1); // the draft made at dispatch is not an invoice yet
    expect(mid.withoutDraft).toBe(before.withoutDraft);
    expect(mid.oldestDispatchedAt).toBeInstanceOf(Date);
    expect(mid.oldestDispatchedAt!.getTime()).toBeLessThanOrEqual(new Date(s.shipment.dispatchedAt!).getTime());
    // Cross-site negative: an RVS-only finance user does not see the NFD shipment.
    expect((await notInvoicedShipments(rvsOnly)).count).toBe(rvsBefore.count);
    // Issued → no longer counted.
    const [inv] = await invoicesOf(s.shipment.id);
    await submitInvoice(w.sales, inv.id);
    await approveInvoice(w.finance, inv.id);
    await issueInvoice(w.finance2, inv.id, { password: PW });
    expect((await notInvoicedShipments(w.finance)).count).toBe(before.count);
  });

  it("needs finance.invoice.view", async () => {
    await expectCode(notInvoicedShipments(w.warehouse), "forbidden");
  });
});

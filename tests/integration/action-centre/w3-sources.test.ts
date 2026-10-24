/**
 * Wave 3 integration of the action centre (US-5-06) and the customer 360 (US-4-06): W3D order, quote,
 * price-list and requirement approvals and credit holds, W3E unacknowledged delivery receipts (from
 * W3E's reminder setting) and orders unshipped in any fulfilment state, W3F open complaints, returns to
 * approve and returns waiting for QA, W3C failed imports and imports to approve. Visibility follows the
 * kind's permission at the item's site (role and cross-site negatives).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { actionItems, complaints, customerReturns, customers, importJobs, salesOrders, settings, shipments } from "@/db/schema";
import { listActionItems, refreshActionItems } from "@/modules/action-centre";
import { startValidation, submitImport, uploadImport } from "@/modules/imports";
import { allocateOrder, createOrder, getCustomer360, submitOrder } from "@/modules/sales";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";
import { shipOrder } from "../../support/w3e";

let w: W3d;
const open = async (kind: string, entityId: string) => (await db.select().from(actionItems).where(and(eq(actionItems.kind, kind), eq(actionItems.entityId, entityId), isNull(actionItems.resolvedAt))))[0];

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  registerAppHooks();
}, 180_000);

describe("W3D: commercial approvals and credit holds", () => {
  it("an order over the credit limit waits for approval: approvers see it, sales_cs and the warehouse do not", async () => {
    const c = await newCustomer(w, { creditLimit: "10" });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "12", unitPrice: "70" }] });
    const r = await submitOrder(w.sales, o.id);
    expect(r.status).toBe("pending_approval");
    await refreshActionItems(w.orgId);
    expect(await open("approval.sales_order", o.id)).toMatchObject({ tab: "approvals", siteId: w.nfd.id, link: `/sales/${o.id}` });
    expect((await listActionItems(w.finance, { tab: "approvals" })).some((i) => i.entityId === o.id)).toBe(true);
    expect((await listActionItems(w.manager, { tab: "approvals" })).some((i) => i.entityId === o.id)).toBe(true);
    expect((await listActionItems(w.sales)).some((i) => i.entityId === o.id)).toBe(false);
    expect((await listActionItems(w.warehouse)).some((i) => i.entityId === o.id)).toBe(false);
  });

  it("a customer on credit hold is an exception for credit-terms viewers only", async () => {
    const c = await newCustomer(w);
    await db.update(customers).set({ status: "on_hold" }).where(eq(customers.id, c.id));
    await refreshActionItems(w.orgId);
    expect(await open("credit_hold", c.id)).toBeTruthy();
    expect((await listActionItems(w.finance)).some((i) => i.kind === "credit_hold" && i.entityId === c.id)).toBe(true);
    expect((await listActionItems(w.qa)).some((i) => i.kind === "credit_hold")).toBe(false);
    expect((await listActionItems(w.warehouse)).some((i) => i.kind === "credit_hold")).toBe(false);
  });
});

describe("W3E: delivery receipts and unshipped orders", () => {
  let shipmentId: string;
  it("a dispatched DR shows after sales.delivery_receipt.unacknowledged_days (not before), at its site only", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "6", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    await allocateOrder(w.warehouse, o.id);
    shipmentId = (await shipOrder({ picker: w.warehouse, checker: w.manager, dispatcher: w.warehouse }, o.id)).id;
    await refreshActionItems(w.orgId);
    expect(await open("unacknowledged_dr", shipmentId)).toBeUndefined();
    await db.update(shipments).set({ dispatchedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(shipments.id, shipmentId));
    await refreshActionItems(w.orgId);
    expect(await open("unacknowledged_dr", shipmentId)).toBeUndefined(); // default 3 days
    await db.update(shipments).set({ dispatchedAt: new Date(Date.now() - 4 * 86_400_000) }).where(eq(shipments.id, shipmentId));
    await refreshActionItems(w.orgId);
    expect(await open("unacknowledged_dr", shipmentId)).toMatchObject({ link: `/sales/shipments/${shipmentId}` });
    expect((await listActionItems(w.warehouse)).some((i) => i.entityId === shipmentId)).toBe(true);
    expect((await listActionItems(w.warehouseRvs)).some((i) => i.entityId === shipmentId)).toBe(false);
    // The site setting moves the threshold (same setting as W3E's daily reminder).
    await db.insert(settings).values({ organizationId: w.orgId, siteId: w.nfd.id, scope: "site", key: "sales.delivery_receipt.unacknowledged_days", value: 10 as unknown as object });
    await refreshActionItems(w.orgId);
    expect(await open("unacknowledged_dr", shipmentId)).toBeUndefined();
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "sales.delivery_receipt.unacknowledged_days")));
  });

  it("an order still picking past its requested date is unshipped", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "3", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    await allocateOrder(w.warehouse, o.id);
    await db.update(salesOrders).set({ status: "picking", requestedDeliveryOn: "2026-01-05" }).where(eq(salesOrders.id, o.id));
    await refreshActionItems(w.orgId);
    expect(await open("unshipped_order", o.id)).toMatchObject({ detail: "Status picking" });
  });
});

describe("W3F: complaints and returns", () => {
  it("open complaints reach complaint viewers; a received return waits for QA; a submitted return for its approvers", async () => {
    await refreshActionItems(w.orgId);
    const [c] = await db.select().from(complaints).where(eq(complaints.status, "investigating")).limit(1);
    expect(c).toBeTruthy();
    expect((await listActionItems(w.qa)).some((i) => i.kind === "open_complaint" && i.entityId === c.id)).toBe(true);
    expect((await listActionItems(w.sales)).some((i) => i.kind === "open_complaint" && i.entityId === c.id)).toBe(true);
    expect((await listActionItems(w.warehouse)).some((i) => i.kind === "open_complaint")).toBe(false);
    const [rt] = await db.select().from(customerReturns).where(eq(customerReturns.status, "received")).limit(1);
    expect((await listActionItems(w.qa)).some((i) => i.kind === "return_awaiting_qa" && i.entityId === rt.id)).toBe(true);
    expect((await listActionItems(w.sales)).some((i) => i.kind === "return_awaiting_qa")).toBe(false);
    await db.update(customerReturns).set({ status: "inspected" }).where(eq(customerReturns.id, rt.id));
    await refreshActionItems(w.orgId);
    expect(await open("return_awaiting_qa", rt.id)).toBeUndefined();
  });

  it("the customer 360 shows the customer's complaints and returns to their viewers only", async () => {
    const [c] = await db.select().from(complaints).limit(1);
    const asSales = await getCustomer360(w.sales, c.customerId);
    expect(asSales.sections.find((s) => s.key === "complaints")?.rows.some((r) => r.id === c.id)).toBe(true);
    const asWarehouse = await getCustomer360(w.warehouse, c.customerId);
    expect(asWarehouse.sections.some((s) => s.key === "complaints")).toBe(false);
    expect(asWarehouse.sections.some((s) => s.key === "returns")).toBe(true); // warehouse_operator holds sales.customer_return.view
  });
});

describe("W3C: imports", () => {
  it("a submitted import is an approval for import approvers; a failed one is an exception for import viewers", async () => {
    const saved = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };
    process.env.FILE_STORAGE = "local";
    process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "bc-w3-ac-"));
    try {
      const { jobId } = await uploadImport(w.admin, { kind: "suppliers", fileName: "sup.csv", bytes: new TextEncoder().encode("code,name\nSUP-8101,Quezon Fiber Traders (fictional)\n"), idempotencyKey: randomUUID() });
      await startValidation(w.admin, jobId);
      await submitImport(w.admin, jobId);
      await refreshActionItems(w.orgId);
      expect(await open("approval.import_job", jobId)).toMatchObject({ tab: "approvals", link: `/admin/imports/${jobId}` });
      expect((await listActionItems(w.manager, { tab: "approvals" })).some((i) => i.entityId === jobId)).toBe(true);
      expect((await listActionItems(w.sales)).some((i) => i.entityId === jobId)).toBe(false);
      await db.update(importJobs).set({ status: "failed", failureMessage: "Test failure (fictional)" }).where(eq(importJobs.id, jobId));
      await refreshActionItems(w.orgId);
      expect(await open("approval.import_job", jobId)).toBeUndefined();
      expect(await open("failed_import", jobId)).toMatchObject({ link: `/admin/imports/${jobId}`, severity: "critical" });
      expect((await listActionItems(w.admin)).some((i) => i.entityId === jobId && i.kind === "failed_import")).toBe(true);
      expect((await listActionItems(w.sales)).some((i) => i.entityId === jobId)).toBe(false);
    } finally {
      process.env.FILE_STORAGE = saved.FILE_STORAGE;
      process.env.FILE_STORAGE_DIR = saved.FILE_STORAGE_DIR;
    }
  });
});

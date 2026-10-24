/**
 * Wave 3 integration of the KPI engine (W3A) with W3D: "orders confirmed" and order-to-ship time start at
 * the confirmed transition in sales_order_state_transitions (A-W3A-03), order and shipped values need
 * W3D's sales.price_list.view on top of analytics.financial_kpi.view (A-W3A-06), and the finance role
 * holds its matrix §3.11 analytics strings.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { salesOrderStateTransitions, salesOrders } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { getKpiRecords } from "@/modules/analytics";
import { allocateOrder, createOrder, manilaToday, submitOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";

let w: W3d;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
}, 180_000);

describe("KPI-SAL-01 on W3D transitions", () => {
  it("counts an order in the period it was confirmed, not the period it was entered", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: await productId("ACS-135"), qtyUnits: "4", unitPrice: "70" }] });
    await db.update(salesOrders).set({ createdAt: new Date(Date.now() - 45 * 86_400_000) }).where(eq(salesOrders.id, o.id));
    const waiting = await getKpiRecords(w.owner, "KPI-SAL-01", { from: day(-1), to: day(1) });
    expect(waiting.rows.some((r) => r.refId === o.id)).toBe(false); // entered but not confirmed
    await submitOrder(w.sales, o.id);
    const now = await getKpiRecords(w.owner, "KPI-SAL-01", { from: day(-1), to: day(1) });
    expect(now.rows.some((r) => r.refId === o.id)).toBe(true);
    const entry = await getKpiRecords(w.owner, "KPI-SAL-01", { from: day(-46), to: day(-44) });
    expect(entry.rows.some((r) => r.refId === o.id)).toBe(false);
    expect(manilaToday()).toBe(day(0));
  });

  it("keeps an order entered before Wave 3 at its entry time when later fulfilment moves are recorded", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: await productId("ACS-135"), qtyUnits: "4", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    // Simulate a pre-Wave-3 order: no recorded entry or confirmation, entered 45 days ago, then allocated today.
    await db.execute(sql`alter table sales_order_state_transitions disable trigger tg_sales_order_state_transitions_append_only`);
    await db.delete(salesOrderStateTransitions).where(eq(salesOrderStateTransitions.salesOrderId, o.id));
    await db.execute(sql`alter table sales_order_state_transitions enable trigger tg_sales_order_state_transitions_append_only`);
    await db.update(salesOrders).set({ createdAt: new Date(Date.now() - 45 * 86_400_000) }).where(eq(salesOrders.id, o.id));
    await allocateOrder(w.warehouse, o.id);
    expect((await getKpiRecords(w.owner, "KPI-SAL-01", { from: day(-46), to: day(-44) })).rows.some((r) => r.refId === o.id)).toBe(true);
    expect((await getKpiRecords(w.owner, "KPI-SAL-01", { from: day(-1), to: day(1) })).rows.some((r) => r.refId === o.id)).toBe(false);
  });
});

describe("money KPIs need sales.price_list.view (W3D) and analytics.financial_kpi.view", () => {
  it("refuses the order value to a financial viewer without price-list access; finance sees it", async () => {
    const noPrices = new AuthContext(w.owner.userId, w.owner.organizationId, w.owner.displayName, w.owner.email, w.owner.roleCodes, new Set([...w.owner.permissions].filter((p) => p !== "sales.price_list.view")), w.owner.allowedSites, w.owner.currentSiteId);
    await expectCode(getKpiRecords(noPrices, "KPI-SAL-01V", { from: day(-1), to: day(1) }), "forbidden");
    await expectCode(getKpiRecords(noPrices, "KPI-FIN-02", { from: day(-1), to: day(1) }), "forbidden");
    expect(ROLE_BUNDLES.finance.permissions).toEqual(expect.arrayContaining(["analytics.dashboard.view", "analytics.financial_kpi.view", "analytics.owner_dashboard.view", "analytics.report.view"]));
    const r = await getKpiRecords(w.finance, "KPI-SAL-01V", { from: day(-1), to: day(1) });
    expect(r.total).toBeTruthy();
  });
});

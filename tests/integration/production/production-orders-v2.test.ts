/**
 * ADR-080 stage G1 (V2-1, V2-2): the production order hub on real data. Needed-by date and late
 * flag, pieces first ("247 bars · 2 batches"), "Make for this order" from a customer order line that
 * is short (prefill + link via work_orders.sales_order_id), status v2 from real batches, one action
 * per batch, the "Today" list, and negative permission / cross-site tests.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batches, salesOrderLines, salesOrders, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  addDailyLog,
  approveProductionOrder,
  createProductionOrder,
  editWorkOrder,
  getProductionOrder,
  listProductionOrderBoard,
  listProductionOrders,
  listSiteDailyLogs,
  makeForSalesLine,
  productionOrdersForSalesOrder,
  salesOrderShortfalls,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let acs: string;
let operatorRvs: AuthContext;
let so7: { id: string; lineId: string; requestedDeliveryOn: string | null };
let soRvs: string;
let soCancelled: string;

const soByNumber = async (n: string) => {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.orderNumber, n));
  const [l] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  return { id: so.id, lineId: l.id, requestedDeliveryOn: so.requestedDeliveryOn };
};

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  acs = await productId("ACS-135");
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  so7 = await soByNumber("SO-26-00007"); // NFD, confirmed, 480 × ACS-135
  soRvs = (await soByNumber("SO-26-00009")).id; // RVS
  soCancelled = (await soByNumber("SO-26-00008")).id;
}, 120_000);

describe("needed-by date, late flag and pieces first", () => {
  let lateId: string;
  it("stores the needed-by date and shows the order as late when it has passed and the order is not Done", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), neededBy: day(-2), idempotencyKey: "g1-late-0001" });
    lateId = r.workOrderId;
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, lateId));
    expect(wo.neededBy).toBe(day(-2));
    const row = (await listProductionOrders(w.planner)).find((x) => x.id === lateId)!;
    expect(row).toMatchObject({ neededBy: day(-2), late: true, status: "draft" });
    const v = await getProductionOrder(w.planner, lateId);
    expect(v.late).toBe(true);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, lateId), eq(auditEvents.action, "production.work_order.created")));
    expect((au[0].after as { neededBy: string }).neededBy).toBe(day(-2));
  });

  it("is not late with a future needed-by date", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), neededBy: day(5) });
    expect((await listProductionOrders(w.planner)).find((x) => x.id === r.workOrderId)?.late).toBe(false);
  });

  it("editing a draft without a needed-by keeps it", async () => {
    await editWorkOrder(w.planner, lateId, { productId: acs, batchCount: 1, plannedStart: day(0), plannedEnd: day(1) });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, lateId));
    expect(wo.neededBy).toBe(day(-2));
  });

  it("pieces first: 247 bars become 2 whole batches (2 × 17.6 kg at 95 % ÷ 135 g = 247) and show as '247 bars · 2 batches'", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "247" });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, r.workOrderId));
    expect(wo.batchCount).toBe(2);
    expect(wo.targetUnits).toBe("247.000000");
    expect((await listProductionOrders(w.planner)).find((x) => x.id === r.workOrderId)?.piecesText).toBe("247 bars · 2 batches");
    expect((await getProductionOrder(w.planner, r.workOrderId)).pieces).toMatchObject({ text: "247 bars · 2 batches", word: "expected" });
  });

  it("validates pieces and dates", async () => {
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "12.5" }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "0" }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), neededBy: "2026-13-45" }), "validation");
  });
});

describe("Make for this order (customer order line short of stock)", () => {
  let missing: string;
  it("prefills the product, the missing pieces, whole batches and the delivery date", async () => {
    const lines = await salesOrderShortfalls(w.planner, so7.id);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.productId).toBe(acs);
    expect(Number(l.missing)).toBeGreaterThan(0);
    expect(Number(l.missing)).toBeLessThanOrEqual(480);
    expect(l.unitsPerBatch).toBe("123");
    expect(l.batchCount).toBeGreaterThanOrEqual(Math.ceil(Number(l.missing) / 123.85));
    expect(Math.floor((l.batchCount! * 17600 * 0.95) / 135)).toBeGreaterThanOrEqual(Number(l.missing));
    expect(l.neededBy).toBe(so7.requestedDeliveryOn);
    const p = await makeForSalesLine(w.planner, so7.lineId);
    expect(p.missing).toBe(l.missing);
    missing = l.missing;
  });

  it("creates the order linked to the customer order with its delivery date as needed-by", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: missing, salesOrderId: so7.id, idempotencyKey: "g1-make-for-0001" });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, r.workOrderId));
    expect(wo.salesOrderId).toBe(so7.id);
    expect(wo.neededBy).toBe(so7.requestedDeliveryOn);
    expect(wo.targetUnits).toBe(`${missing}.000000`);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.workOrderId), eq(auditEvents.action, "production.work_order.created")));
    expect((au[0].after as { salesOrderId: string }).salesOrderId).toBe(so7.id);
    expect((await listProductionOrders(w.planner)).find((x) => x.id === r.workOrderId)?.salesOrderNumber).toBe("SO-26-00007");
    // The line is now covered by the open production order: nothing more to make.
    expect((await salesOrderShortfalls(w.planner, so7.id))[0].missing).toBe("0");
    expect((await productionOrdersForSalesOrder(w.planner, so7.id)).map((x) => x.id)).toContain(r.workOrderId);
  });

  it("sales users with view only, operators, warehouse and QA cannot make for an order (role escalation)", async () => {
    await expectCode(salesOrderShortfalls(w.sales, so7.id), "forbidden");
    await expectCode(makeForSalesLine(w.sales, so7.lineId), "forbidden");
    await expectCode(createProductionOrder(w.sales, { productId: acs, plannedStart: day(0), salesOrderId: so7.id }), "forbidden");
    await expectCode(createProductionOrder(w.operator, { productId: acs, plannedStart: day(0), salesOrderId: so7.id }), "forbidden");
    await expectCode(salesOrderShortfalls(w.warehouse, so7.id), "forbidden");
    await expectCode(salesOrderShortfalls(w.qa, so7.id), "forbidden");
  });

  it("cross-site: another site's customer order is not found; a closed one cannot be made for", async () => {
    await expectCode(salesOrderShortfalls(w.plannerRvs, so7.id), "not_found");
    await expectCode(makeForSalesLine(w.plannerRvs, so7.lineId), "not_found");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), salesOrderId: soRvs }), "not_found");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), salesOrderId: soCancelled }), "state");
    expect(await salesOrderShortfalls(w.planner, soCancelled)).toEqual([]);
  });
});

describe("order hub on real batches", () => {
  let id: string;
  it("approved 2-batch order: one button per batch, status Approved, strip with 5 steps", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), batchCount: 2, neededBy: day(3) });
    id = r.workOrderId;
    const a = await approveProductionOrder(w.manager, id, { idempotencyKey: "g1-approve-2b" });
    expect(a.batches).toHaveLength(2);
    const v = await getProductionOrder(w.operator, id);
    expect(v.status).toBe("approved");
    expect(v.progress.steps).toHaveLength(5);
    expect(v.batchActions.map((b) => (b.action.kind === "link" ? b.action.label : b.action.kind))).toEqual(["Get materials", "Get materials"]);
    expect(v.nextAction).toMatchObject({ kind: "link", label: "Get materials" });
    expect(v.statusView.batchesNote).toBe("0 of 2 done");
    // A user without the permission waits and is told who can help; never offered the button.
    const s = await getProductionOrder(w.qa, id);
    expect(s.nextAction.kind).toBe("wait");
  });

  it("a batch in the hold area shows Quality check; the board puts it in the Quality check column", async () => {
    const bs = await db.select().from(batches).where(eq(batches.workOrderId, id));
    // Test shortcut (the execution path is covered by batch-execution tests): both batches made.
    for (const b of bs) await db.update(batches).set({ status: "awaiting_qc", startedAt: new Date() }).where(eq(batches.id, b.id));
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, id));
    const v = await getProductionOrder(w.qa, id);
    expect(v.status).toBe("quality_check");
    expect(v.nextAction).toMatchObject({ kind: "link", label: "Check quality" });
    expect((await getProductionOrder(w.operator, id)).nextAction.kind).toBe("wait");
    const board = await listProductionOrderBoard(w.planner);
    expect(board.map((c) => c.key)).toEqual(["draft", "approved", "in_progress", "quality_check", "done"]);
    expect(board.find((c) => c.key === "quality_check")!.rows.map((r) => r.id)).toContain(id);
    expect(board.find((c) => c.key === "done")!.rows.map((r) => r.id)).not.toContain(id);
  });

  it("cross-site: the order is not found from another site; the list never shows it", async () => {
    await expectCode(getProductionOrder(operatorRvs, id), "not_found");
    expect((await listProductionOrders(w.plannerRvs, { status: "all" })).map((x) => x.id)).not.toContain(id);
  });
});

describe("Today: the site's daily log entries of today", () => {
  it("lists today's entries of every order of the site; other sites and roles without the log see nothing", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0) });
    await approveProductionOrder(w.manager, r.workOrderId);
    const e = await addDailyLog(w.operator, { workOrderId: r.workOrderId, goodQty: "40", defects: [{ defectType: "Cracked bar", quantity: "2" }], notes: "Wrapped tray 1" });
    const t = await listSiteDailyLogs(w.operator);
    expect(t.date).toBe(day(0));
    const row = t.entries.find((x) => x.id === e.id)!;
    expect(row).toMatchObject({ workOrderId: r.workOrderId, rejectTotal: "2", replacedById: null });
    expect(row.rejects).toEqual([{ type: "Cracked bar", quantity: "2.000000" }]);
    expect((await listSiteDailyLogs(operatorRvs)).entries.map((x) => x.id)).not.toContain(e.id);
    await expectCode(listSiteDailyLogs(w.warehouse), "forbidden");
    await expectCode(listSiteDailyLogs(w.sales), "forbidden");
    expect((await listSiteDailyLogs(w.operator, { date: day(-1) })).entries.map((x) => x.id)).not.toContain(e.id);
  });
});

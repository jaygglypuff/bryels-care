/**
 * ADR-074 (S2): one production order the owner follows from ordering to done.
 * Simple status mapping, one-step Approve (plan + release + reserve + create batch, idempotent,
 * plain shortage message), auto batch creation, the append-only daily log with corrections and
 * defects, the defect summary, and negative permission / cross-site tests.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batches, productionDailyLogs, productionDefectEntries, stockReservations, workOrderStateTransitions, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  addDailyLog,
  approveProductionOrder,
  cancelWorkOrder,
  correctDailyLog,
  createProductionOrder,
  defectSummary,
  getProductionOrder,
  listDailyLogs,
  listProductionOrders,
  productionOrderStatus,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, day, expectCode, loadWorld, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
let acs: string;
let operatorRvs: AuthContext;
let managerRvs: AuthContext;

const transitionsOf = async (id: string) => (await db.select().from(workOrderStateTransitions).where(eq(workOrderStateTransitions.workOrderId, id)).orderBy(workOrderStateTransitions.occurredAt)).map((t) => t.toState);
const batchesOf = (id: string) => db.select().from(batches).where(eq(batches.workOrderId, id));
const activeReservations = (id: string) => db.select().from(stockReservations).where(and(eq(stockReservations.demandType, "work_order"), eq(stockReservations.demandId, id), eq(stockReservations.status, "active")));

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  acs = await productId("ACS-135");
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  managerRvs = await ctxFor(w.orgId, "manager.nfd@bryels-care.test", "site_manager", [w.rvs]);
}, 120_000);

describe("status mapping (ADR-080 §1)", () => {
  it("maps work order states without batches; every batch row is unit-tested in tests/unit/production-order-status.test.ts", () => {
    expect(productionOrderStatus("draft").status).toBe("draft");
    expect(productionOrderStatus("planned").status).toBe("draft");
    expect(productionOrderStatus("released").status).toBe("approved");
    expect(productionOrderStatus("cancelled").status).toBe("cancelled");
    expect(() => productionOrderStatus("bogus")).toThrow();
  });
});

let orderId: string;
let batchId: string;

describe("Approve in one step", () => {
  it("creates a draft production order with one batch by default", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), idempotencyKey: "po-create-0001" });
    orderId = r.workOrderId;
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, orderId));
    expect(wo.batchCount).toBe(1);
    expect(wo.plannedEnd).toBe(wo.plannedStart);
    const rows = await listProductionOrders(w.planner);
    expect(rows.find((x) => x.id === orderId)?.status).toBe("draft");
    expect(await batchesOf(orderId)).toHaveLength(0);
  });

  it("refuses role escalation and cross-site approval", async () => {
    await expectCode(approveProductionOrder(w.planner, orderId), "forbidden");
    await expectCode(approveProductionOrder(w.operator, orderId), "forbidden");
    await expectCode(approveProductionOrder(managerRvs, orderId), "not_found");
    await expectCode(getProductionOrder(w.plannerRvs, orderId), "not_found");
    expect(await transitionsOf(orderId)).toEqual(["draft"]);
  });

  it("approve = plan + release + reserve + create the batch, in one transaction", async () => {
    const r = await approveProductionOrder(w.manager, orderId, { idempotencyKey: "po-approve-0001" });
    expect(r.batches).toHaveLength(1);
    expect(r.reservations).toBeGreaterThan(0);
    expect(r.shortages).toEqual([]);
    batchId = r.batches[0].batchId;
    expect(await transitionsOf(orderId)).toEqual(["draft", "planned", "released"]);
    const bs = await batchesOf(orderId);
    expect(bs).toHaveLength(1);
    expect(bs[0].status).toBe("planned");
    expect((await activeReservations(orderId)).length).toBe(r.reservations);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, orderId), eq(auditEvents.action, "production.production_order.approved")));
    expect(au).toHaveLength(1);

    const view = await getProductionOrder(w.operator, orderId);
    expect(view.status).toBe("approved");
    expect(view.nextAction).toMatchObject({ kind: "link", label: "Get materials", href: `/production/staging/${batchId}` });
    expect(view.progress.steps!.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
  });

  it("is idempotent: the same key returns the stored result and creates nothing more", async () => {
    const again = await approveProductionOrder(w.manager, orderId, { idempotencyKey: "po-approve-0001" });
    expect(again.batches[0].batchId).toBe(batchId);
    expect(await batchesOf(orderId)).toHaveLength(1);
    expect(await transitionsOf(orderId)).toEqual(["draft", "planned", "released"]);
    await expectCode(approveProductionOrder(w.manager, orderId, { idempotencyKey: "po-approve-0002" }), "state");
  });

  it("separation of duties: the person who created the order cannot approve it", async () => {
    const own = await createProductionOrder(w.manager, { productId: acs, plannedStart: day(1) });
    const e = await expectCode(approveProductionOrder(w.manager, own.workOrderId), "separation_of_duties");
    expect(e.message).toMatch(/another person/);
    const view = await getProductionOrder(w.manager, own.workOrderId);
    expect(view.nextAction.kind).toBe("wait");
    expect(await transitionsOf(own.workOrderId)).toEqual(["draft"]);
  });

  it("shortage: says which material and how much, in plain words, and changes nothing", async () => {
    const big = await createProductionOrder(w.planner, { productId: acs, batchCount: 30, plannedStart: day(1), plannedEnd: day(2) });
    const e = await expectCode(approveProductionOrder(w.manager, big.workOrderId, { idempotencyKey: "po-approve-big-1" }), "insufficient_stock");
    expect(e.message).toMatch(/^Not enough materials to approve this order\./);
    expect(e.message).toMatch(/[A-Za-z]+: need [\d.,]+ (kg|g), only [\d.,]+ (kg|g) can be used — [\d.,]+ (kg|g) short\./);
    expect((e.details?.shortages as { materialCode: string }[]).map((s) => s.materialCode)).toContain("MAT-0012");
    expect(e.message).toMatch(/Nothing was changed/);
    expect((e.details?.lines as string[]).length).toBeGreaterThanOrEqual(1);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, big.workOrderId));
    expect(wo.status).toBe("draft");
    expect(wo.formulaRevisionId).toBeNull();
    expect(await transitionsOf(big.workOrderId)).toEqual(["draft"]);
    expect(await batchesOf(big.workOrderId)).toHaveLength(0);
    expect(await activeReservations(big.workOrderId)).toHaveLength(0);
    // The failed attempt did not burn the key: the same key is retried, not replayed.
    await expectCode(approveProductionOrder(w.manager, big.workOrderId, { idempotencyKey: "po-approve-big-1" }), "insufficient_stock");
    // Daily log entries need an approved order.
    await expectCode(addDailyLog(w.operator, { workOrderId: big.workOrderId, notes: "Waiting for oil" }), "state");
    await cancelWorkOrder(w.manager, big.workOrderId, "Test clean-up: too big for stock");
    expect((await listProductionOrders(w.planner, { status: "cancelled" })).map((x) => x.id)).toContain(big.workOrderId);
  });
});

let firstLog: string;

describe("daily log and rejects (append-only, corrections)", () => {
  it("an operator adds what happened today with good output and defects by type", async () => {
    const r = await addDailyLog(w.operator, {
      workOrderId: orderId,
      batchId,
      shift: "Morning",
      notes: "Cut and wrapped the first trays.",
      goodQty: "120",
      defects: [
        { defectType: "Cracked bar", quantity: "3" },
        { defectType: "air bubbles", quantity: "2", note: "tray 4" },
      ],
      idempotencyKey: "po-log-0001",
    });
    firstLog = r.id;
    const again = await addDailyLog(w.operator, { workOrderId: orderId, notes: "Cut and wrapped the first trays.", goodQty: "120", idempotencyKey: "po-log-0001" });
    expect(again.id).toBe(firstLog);
    const logs = await listDailyLogs(w.planner, orderId);
    expect(logs).toHaveLength(1);
    expect(logs[0].defects.map((d) => d.defectType).sort()).toEqual(["Air bubbles", "Cracked bar"]);
    expect(logs[0].defectTotal).toBe("5");
    expect(logs[0].author).toBeTruthy();
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, firstLog), eq(auditEvents.action, "production.daily_log.created")));
    expect(au).toHaveLength(1);
  });

  it("validates defect types, quantities, dates and the batch", async () => {
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, defects: [{ defectType: "Melted", quantity: "1" }] }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, defects: [{ defectType: "Cracked bar", quantity: "1" }, { defectType: "cracked bar", quantity: "2" }] }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, defects: [{ defectType: "Cracked bar", quantity: "0" }] }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, goodQty: "-4" }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, notes: "Tomorrow", logDate: day(3) }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId }), "validation");
    await expectCode(addDailyLog(w.operator, { workOrderId: orderId, notes: "x", batchId: "0190a0a0-0000-7000-8000-000000000000" }), "validation");
  });

  it("uses the configurable defect list (production.defect_types)", async () => {
    await setOrgSetting(w.orgId, "production.defect_types", ["Soft bar", "Other"]);
    try {
      await expectCode(addDailyLog(w.operator, { workOrderId: orderId, defects: [{ defectType: "Cracked bar", quantity: "1" }] }), "validation");
      const r = await addDailyLog(w.operator, { workOrderId: orderId, logDate: day(-1), goodQty: "50", defects: [{ defectType: "Soft bar", quantity: "4" }] });
      expect(r.logDate).toBe(day(-1));
    } finally {
      await setOrgSetting(w.orgId, "production.defect_types", ["Cracked bar", "Wrong weight", "Air bubbles", "Discoloration", "Bad wrapping", "Other"]);
    }
  });

  it("refuses role escalation and cross-site access", async () => {
    await expectCode(addDailyLog(w.planner, { workOrderId: orderId, notes: "Planner note" }), "forbidden");
    await expectCode(addDailyLog(w.warehouse, { workOrderId: orderId, notes: "Warehouse note" }), "forbidden");
    await expectCode(listDailyLogs(w.warehouse, orderId), "forbidden");
    await expectCode(addDailyLog(operatorRvs, { workOrderId: orderId, notes: "Wrong site" }), "not_found");
    await expectCode(listDailyLogs(operatorRvs, orderId), "not_found");
    await expectCode(correctDailyLog(operatorRvs, { logId: firstLog, reason: "Wrong site attempt", notes: "x" }), "not_found");
    await expectCode(defectSummary(operatorRvs, { siteId: w.nfd.id }), "not_found");
    expect((await defectSummary(operatorRvs, {})).rows).toHaveLength(0);
  });

  it("is append-only in the database", async () => {
    await expect(db.update(productionDailyLogs).set({ notes: "edited" }).where(eq(productionDailyLogs.id, firstLog))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    await expect(db.delete(productionDefectEntries).where(eq(productionDefectEntries.dailyLogId, firstLog))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
  });

  it("corrects by a new entry with a reason; the replaced entry stays and stops counting", async () => {
    await expectCode(correctDailyLog(w.operator, { logId: firstLog, reason: "no", goodQty: "118" }), "validation");
    const c = await correctDailyLog(w.operator, { logId: firstLog, reason: "Counted one tray twice", notes: "Cut and wrapped the first trays.", goodQty: "118", defects: [{ defectType: "Cracked bar", quantity: "5" }], idempotencyKey: "po-corr-0001" });
    expect(c.replacedId).toBe(firstLog);
    const logs = await listDailyLogs(w.operator, orderId);
    const orig = logs.find((l) => l.id === firstLog)!;
    const repl = logs.find((l) => l.id === c.id)!;
    expect(orig.replacedById).toBe(c.id);
    expect(orig.goodQty).toBe("120.000000");
    expect(repl.correctsId).toBe(firstLog);
    expect(repl.correctionReason).toBe("Counted one tray twice");
    expect(repl.batchId).toBe(batchId);
    await expectCode(correctDailyLog(w.operator, { logId: firstLog, reason: "Second correction of the same entry", goodQty: "117" }), "state");
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, c.id), eq(auditEvents.action, "production.daily_log.corrected")));
    expect(au[0].reason).toBe("Counted one tray twice");

    const s = await defectSummary(w.owner, { workOrderId: orderId });
    const today = s.rows.find((r) => r.logDate === day(0))!;
    expect(today.good).toBe("118");
    expect(today.defects).toBe("5");
    expect(today.defectPct).toBe("4.1"); // 5 ÷ 123
    expect(today.byType).toEqual({ "Cracked bar": "5" });
    expect(s.totals.good).toBe("168");
    expect(s.totals.defects).toBe("9");
    expect(s.byProduct).toHaveLength(1);
  });

  it("the site summary covers products per day; planners and QA can read it", async () => {
    const s = await defectSummary(w.planner, {});
    expect(s.rows.some((r) => r.productId === acs && r.logDate === day(0))).toBe(true);
    expect((await defectSummary(w.qa, {})).totals.defects).toBe("9");
    await expectCode(defectSummary(w.warehouse, {}), "forbidden");
  });
});

describe("status follows the batches (ADR-080: Done = QA decided)", () => {
  it("In progress once a batch has started; Quality check (not Done) when the work order completes; Done after QA", async () => {
    // Test shortcut: starting a batch needs staging and a line clearance (covered by staging/execution tests);
    // here the read model reads the batch and work order states only.
    await db.update(batches).set({ startedAt: new Date(), status: "in_process" }).where(eq(batches.id, batchId));
    await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, orderId));
    expect((await listProductionOrders(w.planner)).find((x) => x.id === orderId)?.status).toBe("in_progress");
    const view = await getProductionOrder(w.planner, orderId);
    expect(view.status).toBe("in_progress");
    await db.update(batches).set({ status: "quarantined" }).where(eq(batches.id, batchId));
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, orderId));
    expect((await listProductionOrders(w.planner, { status: "quality_check" })).map((x) => x.id)).toContain(orderId);
    expect((await listProductionOrders(w.planner, { status: "done" })).map((x) => x.id)).not.toContain(orderId);
    expect((await listProductionOrders(w.planner)).map((x) => x.id)).toContain(orderId); // still open
    await db.update(batches).set({ status: "released" }).where(eq(batches.id, batchId));
    expect((await listProductionOrders(w.planner, { status: "done" })).map((x) => x.id)).toContain(orderId);
    expect((await listProductionOrders(w.planner)).map((x) => x.id)).not.toContain(orderId);
    expect((await getProductionOrder(w.planner, orderId)).nextAction.kind).toBe("none");
  });
});

describe("ADR-074 custom SQL", () => {
  it("the migration matches src/db/sql/s2.sql", async () => {
    const { customMigration } = await import("../../support/custom-sql");
    const { migration, canonical } = customMigration("s2");
    expect(migration.trim()).toBe(canonical.trim());
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batches, productionPlanLines, productionPlans, stockReservations, workOrders } from "@/db/schema";
import { SETTINGS } from "@/lib/settings";
import {
  approveProductionPlan,
  boardMove,
  buildProductionPlan,
  convertPlanLine,
  getProductionBoard,
  getProductionPlan,
  moveBoardCard,
  planWorkOrder,
  releaseWorkOrder,
  setMinStock,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { day, expectCode, loadWorld, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
const COLUMNS = SETTINGS["production.board.columns"].default;
const col = (key: string) => COLUMNS.find((c) => c.key === key)!;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
}, 120_000);

describe("board move rules (pure)", () => {
  const all = () => true;
  const none = () => false;
  it("allows the planner's forward steps only with the permission", () => {
    expect(boardMove({ kind: "work_order", status: "draft", hasWorkOrder: true }, col("planned"), all)).toMatchObject({ allowed: true, action: "plan_work_order" });
    expect(boardMove({ kind: "work_order", status: "draft", hasWorkOrder: true }, col("planned"), none).allowed).toBe(false);
    expect(boardMove({ kind: "work_order", status: "planned", hasWorkOrder: true }, col("ready"), all)).toMatchObject({ allowed: true, action: "release_work_order" });
    expect(boardMove({ kind: "work_order", status: "draft", hasWorkOrder: true }, col("ready"), all).allowed).toBe(false);
    expect(boardMove({ kind: "batch", status: "materials_staged", hasWorkOrder: true }, col("in_process"), all)).toMatchObject({ allowed: true, action: "start_batch" });
  });
  it("explains moves that happen in another flow", () => {
    const staged = boardMove({ kind: "batch", status: "planned", hasWorkOrder: true }, col("staged"), all);
    expect(staged.allowed).toBe(false);
    expect(!staged.allowed && staged.reason).toMatch(/scanning/);
    const qa = boardMove({ kind: "batch", status: "awaiting_qc", hasWorkOrder: false }, col("released"), all);
    expect(!qa.allowed && qa.reason).toMatch(/QA/);
  });
});

describe("production board (US-3-07)", () => {
  it("shows work orders and batches of the site by state, with progress and assignees", async () => {
    const board = await getProductionBoard(w.manager);
    const keys = (k: string) => board.columns.find((c) => c.key === k)!.cards;
    expect(keys("to_plan").some((c) => c.kind === "work_order" && c.status === "draft")).toBe(true);
    expect(keys("planned").some((c) => c.kind === "work_order" && c.status === "planned")).toBe(true);
    expect(keys("in_process").some((c) => c.kind === "batch")).toBe(true);
    const b = keys("released").find((c) => c.kind === "batch")!;
    expect(b.progress?.total).toBe(7);
    expect(b.assignees.length).toBeGreaterThan(0);
    // RVS has no production: an RVS-only user sees an empty board and never NFD cards.
    const rvs = await getProductionBoard(w.plannerRvs);
    expect(rvs.total).toBe(0);
    await expectCode(getProductionBoard(w.plannerRvs, { siteId: w.nfd.id }), "not_found");
  });

  it("drag: a permitted, legal move runs the command; anything else explains and changes nothing", async () => {
    const board = await getProductionBoard(w.planner);
    const draft = board.columns.find((c) => c.key === "to_plan")!.cards[0];
    const planned = board.columns.find((c) => c.key === "planned")!.cards.find((c) => c.kind === "work_order")!;
    // Planner may plan, may not release.
    await moveBoardCard(w.planner, { kind: "work_order", id: draft.id, toColumn: "planned" });
    expect((await db.select().from(workOrders).where(eq(workOrders.id, draft.id)))[0].status).toBe("planned");
    const e = await expectCode(moveBoardCard(w.planner, { kind: "work_order", id: planned.id, toColumn: "ready" }), "state");
    expect(e.details?.board).toBe(true);
    expect((await db.select().from(workOrders).where(eq(workOrders.id, planned.id)))[0].status).toBe("planned");
    // Site manager releases by drag (reserves materials).
    const r = await moveBoardCard(w.manager, { kind: "work_order", id: planned.id, toColumn: "ready" });
    expect(r.message).toMatch(/released/);
    // A batch cannot be dragged to Released (QA decides).
    const inProc = board.columns.find((c) => c.key === "in_process")!.cards.find((c) => c.kind === "batch")!;
    await expectCode(moveBoardCard(w.manager, { kind: "batch", id: inProc.id, toColumn: "released" }), "state");
    expect((await db.select().from(batches).where(eq(batches.id, inProc.id)))[0].status).toBe("in_process");
    await expectCode(moveBoardCard(w.plannerRvs, { kind: "batch", id: inProc.id, toColumn: "released" }), "not_found");
    await expectCode(moveBoardCard(w.manager, { kind: "batch", id: inProc.id, toColumn: "no_such_column" }), "validation");
  });
});

describe("demand-to-production planning (E-5-07, US-5-15)", () => {
  let planId: string;

  it("builds a plan from confirmed orders and min stock with the net requirement", async () => {
    await expectCode(buildProductionPlan(w.sales, { periodStart: day(0), periodEnd: day(14) }), "forbidden");
    const r = await buildProductionPlan(w.planner, { periodStart: day(0), periodEnd: day(14), idempotencyKey: "plan-key-000001" });
    planId = r.planId;
    expect(r.planNumber).toMatch(/^PP-\d{4}-\d{3}$/);
    const lines = await db.select().from(productionPlanLines).where(eq(productionPlanLines.productionPlanId, planId));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const net = Decimal.max(new Decimal(l.demandUnits).plus(l.minStockUnits ?? 0).minus(l.availableUnits).minus(l.openWorkOrderUnits), 0).ceil();
      expect(new Decimal(l.qtyUnits).eq(net)).toBe(true);
    }
    const again = await buildProductionPlan(w.planner, { periodStart: day(0), periodEnd: day(14), idempotencyKey: "plan-key-000001" });
    expect(again.planId).toBe(planId);
    await expectCode(getProductionPlan(w.plannerRvs, planId), "not_found");
  });

  it("production.plan_line_creates_work_order_with_reservations", async () => {
    const d = await getProductionPlan(w.planner, planId);
    const line = d.lines[0];
    expect(line.materials.length).toBeGreaterThan(0);
    const c = await convertPlanLine(w.planner, { planLineId: line.id, plannedStart: day(1) });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, c.workOrderId));
    expect(wo.productionPlanLineId).toBe(line.id);
    expect(wo.status).toBe("draft");
    await expectCode(convertPlanLine(w.planner, { planLineId: line.id }), "state");
    await planWorkOrder(w.planner, wo.id);
    await setOrgSetting(w.orgId, "production.work_order.allow_release_with_shortage", true);
    await releaseWorkOrder(w.manager, wo.id);
    const rsv = await db.select().from(stockReservations).where(and(eq(stockReservations.demandType, "work_order"), eq(stockReservations.demandId, wo.id)));
    expect(rsv.length).toBeGreaterThan(0);
  });

  it("optional approval gate (A-PROC-30) with separation of duties", async () => {
    await setOrgSetting(w.orgId, "production.production_plan.approval_required", true);
    await setMinStock(w.planner, { productId: await productId("GBS-135"), minStockUnits: "2000" });
    const r = await buildProductionPlan(w.planner, { periodStart: day(0), periodEnd: day(14) });
    const d = await getProductionPlan(w.planner, r.planId);
    const gbs = d.lines.find((l) => l.productSku === "GBS-135")!;
    await expectCode(convertPlanLine(w.planner, { planLineId: gbs.id }), "state");
    await expectCode(approveProductionPlan(w.planner, r.planId), "forbidden");
    const own = await buildProductionPlan(w.manager, { periodStart: day(0), periodEnd: day(7) });
    await expectCode(approveProductionPlan(w.manager, own.planId), "separation_of_duties");
    await approveProductionPlan(w.manager, r.planId);
    expect((await db.select().from(productionPlans).where(eq(productionPlans.id, r.planId)))[0].status).toBe("approved");
    const c = await convertPlanLine(w.planner, { planLineId: gbs.id });
    expect(c.batchCount).toBeGreaterThan(1);
    await setOrgSetting(w.orgId, "production.production_plan.approval_required", false);
  });
});

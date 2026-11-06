import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { productionPlanLines, productionPlans, stockReservations, workOrders } from "@/db/schema";
import {
  approveProductionPlan,
  buildProductionPlan,
  convertPlanLine,
  getProductionPlan,
  planWorkOrder,
  releaseWorkOrder,
  setMinStock,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { day, expectCode, loadWorld, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
}, 120_000);

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

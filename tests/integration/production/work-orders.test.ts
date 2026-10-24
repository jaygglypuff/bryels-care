import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batches, settings, stockReservations, workOrderStateTransitions, workOrders } from "@/db/schema";
import {
  cancelWorkOrder,
  createBatchFromWorkOrder,
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  planWorkOrder,
  releaseWorkOrder,
  reserveWorkOrderShortages,
  workOrderRequirements,
} from "@/modules/production";
import { createBatch } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { day, expectCode, loadWorld, lotBySupplier, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
let acs: string;

const transitionsOf = async (id: string) => (await db.select().from(workOrderStateTransitions).where(eq(workOrderStateTransitions.workOrderId, id)).orderBy(workOrderStateTransitions.occurredAt)).map((t) => t.toState);
const activeReservations = async (id: string) =>
  db.select().from(stockReservations).where(and(eq(stockReservations.demandType, "work_order"), eq(stockReservations.demandId, id), eq(stockReservations.status, "active")));

async function newWo(over: Partial<{ batchCount: number; plannedStart: string; plannedEnd: string; key: string }> = {}) {
  return createWorkOrder(w.planner, {
    productId: acs,
    batchCount: over.batchCount ?? 1,
    plannedStart: over.plannedStart ?? day(2),
    plannedEnd: over.plannedEnd ?? day(3),
    idempotencyKey: over.key ?? null,
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  acs = await productId("ACS-135");
}, 120_000);

describe("concurrent releases never over-reserve (W05-04, ledger serialization)", () => {
  it("two releases competing for the same lots: one wins, the other is refused with a shortage", async () => {
    const a = await newWo({ batchCount: 5 });
    const b = await newWo({ batchCount: 5 });
    await planWorkOrder(w.planner, a.workOrderId);
    await planWorkOrder(w.planner, b.workOrderId);
    const coconut = await lotBySupplier("LOS-24871");
    const results = await Promise.allSettled([releaseWorkOrder(w.manager, a.workOrderId), releaseWorkOrder(w.manager, b.workOrderId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.code).toBe("insufficient_stock");
    const onCoconut = await db.select().from(stockReservations).where(and(eq(stockReservations.lotId, coconut.id), eq(stockReservations.status, "active")));
    const total = onCoconut.reduce((s, r) => s.plus(r.qtyBase), new Decimal(0));
    expect(total.lte(40000)).toBe(true);
    // Clean up so later tests see the seeded stock.
    for (const id of [a.workOrderId, b.workOrderId]) {
      const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
      await cancelWorkOrder(w.manager, id, "Test clean-up after concurrency check");
      expect((await db.select().from(workOrders).where(eq(workOrders.id, wo.id)))[0].status).toBe("cancelled");
    }
  });
});

describe("work order lifecycle (US-3-05)", () => {
  let woId: string;

  it("creates a draft with number, creation transition and audit", async () => {
    const r = await newWo({ key: "wo-create-key-0001" });
    woId = r.workOrderId;
    expect(r.workOrderNumber).toMatch(/^WO-\d{2}-\d{5}$/);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
    expect(wo.status).toBe("draft");
    expect(wo.batchSizeBase).toBe("17600.000000");
    expect(wo.qtyPlannedBase).toBe("17600.000000");
    expect(await transitionsOf(woId)).toEqual(["draft"]);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, woId), eq(auditEvents.action, "production.work_order.created")));
    expect(au).toHaveLength(1);
  });

  it("replays the stored result for a repeated idempotency key", async () => {
    const again = await newWo({ key: "wo-create-key-0001" });
    expect(again.workOrderId).toBe(woId);
  });

  it("refuses role escalation: an operator cannot create, a planner cannot release", async () => {
    await expectCode(createWorkOrder(w.operator, { productId: acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) }), "forbidden");
    await expectCode(releaseWorkOrder(w.planner, woId), "forbidden");
  });

  it("is invisible across sites (cross-site by id)", async () => {
    await expectCode(getWorkOrder(w.plannerRvs, woId), "not_found");
    await expectCode(planWorkOrder(w.plannerRvs, woId), "not_found");
    expect((await listWorkOrders(w.plannerRvs)).find((x) => x.id === woId)).toBeUndefined();
  });

  it("illegal transitions are 409 and write no transition row", async () => {
    await expectCode(releaseWorkOrder(w.manager, woId), "state");
    expect(await transitionsOf(woId)).toEqual(["draft"]);
  });

  it("V-REV: planning is 422 when no revision is effective on the planned start", async () => {
    const old = await createWorkOrder(w.planner, { productId: acs, batchCount: 1, plannedStart: "2020-01-06", plannedEnd: "2020-01-07" });
    const e = await expectCode(planWorkOrder(w.planner, old.workOrderId), "validation");
    expect(e.details?.rule).toBe("V-REV");
    expect(await transitionsOf(old.workOrderId)).toEqual(["draft"]);
  });

  it("plans: resolves the effective formula and routing revisions", async () => {
    const r = await planWorkOrder(w.planner, woId);
    expect(r.formulaRevision).toMatch(/^F-ACS-01 rev \d+$/);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
    expect(wo.status).toBe("planned");
    expect(wo.formulaRevisionId).not.toBeNull();
    expect(wo.routingRevisionId).not.toBeNull();
    expect(wo.submittedBy).toBe(w.planner.userId);
    await expectCode(planWorkOrder(w.planner, woId), "state");
    expect(await transitionsOf(woId)).toEqual(["draft", "planned"]);
  });

  it("separation of duties: the planner of a work order cannot release it (owner can switch off)", async () => {
    const own = await createWorkOrder(w.manager, { productId: acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    await planWorkOrder(w.manager, own.workOrderId);
    await expectCode(releaseWorkOrder(w.manager, own.workOrderId), "separation_of_duties");
    await cancelWorkOrder(w.manager, own.workOrderId, "Test: SoD check done");
  });

  it("releases with FEFO reservations covering the whole requirement", async () => {
    const r = await releaseWorkOrder(w.manager, woId, { idempotencyKey: "wo-release-key-0001" });
    expect(r.shortages).toEqual([]);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
    expect(wo.status).toBe("released");
    expect(wo.approvedBy).toBe(w.manager.userId);
    const reqs = await workOrderRequirements(db, wo);
    const rows = await activeReservations(woId);
    expect(rows.every((x) => x.demandType === "work_order")).toBe(true);
    const total = rows.reduce((s, x) => s.plus(x.qtyBase), new Decimal(0));
    expect(total.eq(reqs.reduce((s, x) => s.plus(x.required), new Decimal(0)))).toBe(true);
    // FEFO: the earliest-expiring released palm oil lot (LOS-24872, ~21 days) is used first.
    const palmShort = await lotBySupplier("LOS-24872");
    expect(rows.some((x) => x.lotId === palmShort.id)).toBe(true);
    expect(await transitionsOf(woId)).toEqual(["draft", "planned", "released"]);
    const replay = await releaseWorkOrder(w.manager, woId, { idempotencyKey: "wo-release-key-0001" });
    expect(replay.reservations.map((x) => x.id)).toEqual(r.reservations.map((x) => x.id));
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, woId), eq(auditEvents.action, "production.work_order.released")));
    expect(au).toHaveLength(1);
  });

  it("top-up finds nothing more to reserve when fully covered", async () => {
    const r = await reserveWorkOrderShortages(w.manager, woId);
    expect(r.reservations).toEqual([]);
    expect(r.shortages).toEqual([]);
  });

  it("the detail shows required = reserved and no shortage", async () => {
    const d = await getWorkOrder(w.planner, woId);
    expect(d.materials).toHaveLength(5);
    for (const m of d.materials) {
      expect(new Decimal(m.reserved).eq(m.required)).toBe(true);
      expect(new Decimal(m.short).eq(0)).toBe(true);
    }
    expect(d.actions.canCreateBatch).toBe(true);
  });

  it("cancel needs a reason and ends the reservations", async () => {
    const other = await newWo();
    await planWorkOrder(w.planner, other.workOrderId);
    await releaseWorkOrder(w.manager, other.workOrderId);
    expect((await activeReservations(other.workOrderId)).length).toBeGreaterThan(0);
    await expectCode(cancelWorkOrder(w.manager, other.workOrderId, ""), "validation");
    await expectCode(cancelWorkOrder(w.planner, other.workOrderId, "Customer changed the order"), "forbidden");
    await cancelWorkOrder(w.manager, other.workOrderId, "Customer changed the order");
    expect(await activeReservations(other.workOrderId)).toHaveLength(0);
    const ended = await db.select().from(stockReservations).where(eq(stockReservations.demandId, other.workOrderId));
    expect(ended.every((x) => x.status === "cancelled" && x.releasedReason)).toBe(true);
    expect(await transitionsOf(other.workOrderId)).toEqual(["draft", "planned", "released", "cancelled"]);
  });
});

describe("shortages and expiry margin at release", () => {
  it("refuses release with a shortage and reserves nothing; the owner setting allows it", async () => {
    const big = await newWo({ batchCount: 30 });
    await planWorkOrder(w.planner, big.workOrderId);
    const e = await expectCode(releaseWorkOrder(w.manager, big.workOrderId), "insufficient_stock");
    const shortages = e.details?.shortages as { materialCode: string }[];
    expect(shortages.map((s) => s.materialCode)).toContain("MAT-0012");
    expect(await activeReservations(big.workOrderId)).toHaveLength(0);
    expect(await transitionsOf(big.workOrderId)).toEqual(["draft", "planned"]);

    await setOrgSetting(w.orgId, "production.work_order.allow_release_with_shortage", true);
    const r = await releaseWorkOrder(w.manager, big.workOrderId);
    expect(r.shortages.length).toBeGreaterThan(0);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, big.workOrderId));
    expect(wo.releasedWithShortage).toBe(true);
    await setOrgSetting(w.orgId, "production.work_order.allow_release_with_shortage", false);
    await cancelWorkOrder(w.manager, big.workOrderId, "Test clean-up of shortage order");
  });

  it("only lots expiring after the planned end are reserved", async () => {
    // Planned end in 25 days: palm oil LOS-24872 (~21 days) and lye LYE-1009 (~24 days) are too short.
    const late = await newWo({ plannedStart: day(24), plannedEnd: day(25) });
    await planWorkOrder(w.planner, late.workOrderId);
    const e = await expectCode(releaseWorkOrder(w.manager, late.workOrderId), "insufficient_stock");
    const shortages = e.details?.shortages as { materialCode: string; reasons: string[] }[];
    expect(shortages.map((s) => s.materialCode)).toEqual(["MAT-0021"]);
    expect(shortages[0].reasons.join(" ")).toMatch(/shelf life/i);
  });
});

describe("batches from work orders (US-3-06)", () => {
  it("creates the batch with the work order's frozen revisions and refuses more than batch_count", async () => {
    const r = await newWo();
    await expectCode(createBatchFromWorkOrder(w.planner, { workOrderId: r.workOrderId }), "state"); // draft: plan first
    await planWorkOrder(w.planner, r.workOrderId);
    const b = await createBatchFromWorkOrder(w.planner, { workOrderId: r.workOrderId });
    const [row] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, r.workOrderId));
    expect(row.workOrderId).toBe(wo.id);
    expect(row.formulaRevisionId).toBe(wo.formulaRevisionId);
    expect(row.routingRevisionId).toBe(wo.routingRevisionId);
    expect(row.status).toBe("planned");
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), inArray(auditEvents.action, ["production.batch.created", "production.batch.revisions_snapshotted"])));
    expect(au).toHaveLength(2);
    await expectCode(createBatchFromWorkOrder(w.planner, { workOrderId: r.workOrderId }), "state");
    await expectCode(createBatchFromWorkOrder(w.plannerRvs, { workOrderId: r.workOrderId }), "not_found");
  });

  it("direct batch creation is refused by default (production.batch.allow_without_work_order is off)", async () => {
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.batch.allow_without_work_order")));
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.status, "released")).limit(1);
    await expectCode(createBatch(w.manager, { formulaRevisionId: wo.formulaRevisionId!, plannedSizeKg: "17.6", plannedStartOn: day(2) }), "validation");
    // The switch exists for legacy/service callers; turned on, direct creation works.
    await setOrgSetting(w.orgId, "production.batch.allow_without_work_order", true);
    await createBatch(w.manager, { formulaRevisionId: wo.formulaRevisionId!, plannedSizeKg: "17.6", plannedStartOn: day(2) });
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.batch.allow_without_work_order")));
  });

  it("cancelling a work order abandons its unstarted batches (planned → rejected)", async () => {
    const r = await newWo();
    await planWorkOrder(w.planner, r.workOrderId);
    const b = await createBatchFromWorkOrder(w.planner, { workOrderId: r.workOrderId });
    await cancelWorkOrder(w.manager, r.workOrderId, "Line maintenance this week");
    const [row] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    expect(row.status).toBe("rejected");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batchMaterialStagings, batches, inventoryBalances, stockMovements, stockReservations, workOrders } from "@/db/schema";
import {
  approveMaterialSubstitution,
  createBatchFromWorkOrder,
  createWorkOrder,
  getStagingView,
  planWorkOrder,
  releaseWorkOrder,
  stageMaterial,
  startBatch,
  cancelWorkOrder,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { signChecklist, snapshotOf } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, loc, lotBySupplier, productId, type World } from "./w2a-fixtures";

let w: World;
let woId: string;
let batchId: string;
const LOT = async (supplierLot: string) => `BC:LOT:${(await lotBySupplier(supplierLot)).lotNumber}`;
const STAGE = "BC:LOC:PRD-01";

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  const acs = await productId("ACS-135");
  const wo = await createWorkOrder(w.planner, { productId: acs, batchCount: 1, plannedStart: day(1), plannedEnd: day(2) });
  woId = wo.workOrderId;
  await planWorkOrder(w.planner, woId);
  await releaseWorkOrder(w.manager, woId);
  ({ batchId } = await createBatchFromWorkOrder(w.planner, { workOrderId: woId }));
}, 120_000);

describe("staging by scan (US-3-08, W05-05)", () => {
  it("stages a reserved lot: transfer to staging, reservation converted, batch reservation created", async () => {
    const coconut = await lotBySupplier("LOS-24871");
    const prd = await loc(w.nfd.id, "PRD-01");
    const r = await stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LOS-24871"), toLocationCode: STAGE, idempotencyKey: "stage-key-0001" });
    expect(r.materialName).toMatch(/coconut/i);
    expect(r.batchStaged).toBe(false);
    expect(new Decimal(r.remaining).eq(0)).toBe(true);
    const [st] = await db.select().from(batchMaterialStagings).where(eq(batchMaterialStagings.batchId, batchId));
    expect(new Decimal(st.qtyBase).eq("3723.2")).toBe(true);
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.id, st.movementId));
    expect(mv.movementType).toBe("transfer");
    expect(mv.toLocationId).toBe(prd.id);
    const [bal] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, coconut.id), eq(inventoryBalances.locationId, prd.id)));
    expect(new Decimal(bal.qtyBase).eq("3723.2")).toBe(true);
    const woRsv = await db.select().from(stockReservations).where(and(eq(stockReservations.demandId, woId), eq(stockReservations.lotId, coconut.id)));
    expect(woRsv.map((x) => x.status)).toEqual(["converted"]);
    const [bRsv] = await db.select().from(stockReservations).where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, batchId)));
    expect(bRsv.locationId).toBe(prd.id);
    expect(bRsv.status).toBe("active");
    // Replay: same key, no second staging row.
    await stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LOS-24871"), toLocationCode: STAGE, idempotencyKey: "stage-key-0001" });
    expect(await db.select().from(batchMaterialStagings).where(eq(batchMaterialStagings.batchId, batchId))).toHaveLength(1);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.batch_material.staged")));
    expect(au).toHaveLength(1);
  });

  it("production.wrong_material_never_allowed: a lot of another material is blocked", async () => {
    const e = await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LB-7719"), toLocationCode: STAGE }), "blocked_lot");
    expect(e.message).toMatch(/not an ingredient/);
  });

  it("a lot that is not the reserved lot is blocked with the expected lot shown", async () => {
    const reserved = await lotBySupplier("LOS-24872");
    const e = await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: await LOT("MPC-7731"), toLocationCode: STAGE }), "blocked_lot");
    expect(e.message).toContain(reserved.lotNumber);
    expect((e.details?.expected as { lotNumber: string }[]).map((x) => x.lotNumber)).toContain(reserved.lotNumber);
  });

  it("refuses a destination that is not a staging location and more than the ingredient needs", async () => {
    await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LOS-24872"), toLocationCode: "BC:LOC:A-01" }), "validation");
    await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LOS-24872"), toLocationCode: STAGE, qty: "999999" }), "validation");
    await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: "BC:LOC:PRD-01", toLocationCode: STAGE }), "validation");
  });

  it("is site-scoped and permission-checked", async () => {
    await expectCode(stageMaterial(w.warehouseRvs, { batchId, lotCode: await LOT("LOS-24872"), toLocationCode: STAGE }), "not_found");
    await expectCode(stageMaterial(w.sales, { batchId, lotCode: await LOT("LOS-24872"), toLocationCode: STAGE }), "forbidden");
    await expectCode(getStagingView(w.warehouseRvs, batchId), "not_found");
  });

  it("production.material_substitution_requires_approver: only QA substitutes, and only with the same material", async () => {
    const view = await getStagingView(w.warehouse, batchId);
    const palm = view.lines.find((l) => l.materialCode === "MAT-0013")!;
    const input = { batchId, batchMaterialId: palm.batchMaterialId, substituteLotCode: await LOT("MPC-7731"), reason: "Short-dated lot kept for the trial batch" };
    await expectCode(approveMaterialSubstitution(w.warehouse, input), "forbidden");
    await expectCode(approveMaterialSubstitution(w.operator, input), "forbidden");
    await expectCode(approveMaterialSubstitution(w.qa, { ...input, substituteLotCode: await LOT("LB-7719") }), "blocked_lot");
    await expectCode(approveMaterialSubstitution(w.qa, { ...input, reason: "no" }), "validation");
    const r = await approveMaterialSubstitution(w.qa, input);
    expect(r.lotNumber).toBe((await lotBySupplier("MPC-7731")).lotNumber);
    expect(r.expectedLots).toContain((await lotBySupplier("LOS-24872")).lotNumber);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.dispense_record.material_substituted")));
    expect(au).toHaveLength(1);
    expect(au[0].reason).toBe(input.reason);
    // The substitute is now the reserved lot and can be staged.
    const s = await stageMaterial(w.warehouse, { batchId, lotCode: await LOT("MPC-7731"), toLocationCode: STAGE });
    expect(new Decimal(s.qty).eq("8687.4")).toBe(true);
  });

  it("a work-order batch cannot start before staging is complete", async () => {
    await expectCode(startBatch(w.operator, batchId), "state");
  });

  it("when every ingredient and the wrappers (ADR-088 §3) are staged the batch becomes materials_staged; the signed line clearance starts it and the work order is in progress", async () => {
    for (const sl of ["LYE-1009", "LB-7712", "GRN-0311", "MPP-901"]) await stageMaterial(w.warehouse, { batchId, lotCode: await LOT(sl), toLocationCode: STAGE });
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(b.status).toBe("materials_staged");
    const view = await getStagingView(w.warehouse, batchId);
    expect(view.allStaged).toBe(true);
    await expectCode(cancelWorkOrder(w.manager, woId, "Trying to cancel after staging"), "state");
    // §6.2: materials_staged → in_process only by the first signed line clearance (W2B), never by "start".
    await expectCode(startBatch(w.operator, batchId), "state");
    const checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
    const clearance = snapshotOf(b).steps.sort((x, z) => x.stepNo - z.stepNo).find((st) => st.stepKind === "line_clearance")!;
    await signChecklist(w.operator, checker, batchId, clearance);
    const [after] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(after.status).toBe("in_process");
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
    expect(wo.status).toBe("in_progress");
    await expectCode(stageMaterial(w.warehouse, { batchId, lotCode: await LOT("LOS-24871"), toLocationCode: STAGE }), "state");
  });
});

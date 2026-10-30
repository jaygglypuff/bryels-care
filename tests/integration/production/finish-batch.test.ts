import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batches,
  deviations,
  inspections,
  inventoryBalances,
  inventoryLots,
  packagingReconciliations,
  productionPostings,
  scrapReworkRecords,
  stockMovements,
  yieldRecords,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { addDailyLog, countPackaging, finishBatch, getFinishView, postBatchToQuarantine, recordScrapRework, recordYield } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { directBatchReadyToFinish, orderReadyToFinish } from "../../support/g3";

/**
 * Stage G3 / V2-6 Finish (ADR-080 §6): one transaction over the yield, rejects, packaging count and
 * hold-area bodies; counts from the daily log; samples out of the good pieces; wrappers must balance.
 */
let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let warehouse: AuthContext;
let planner: AuthContext;
let operatorRvs: AuthContext;

const key = () => `fin-${randomUUID()}`;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
}, 180_000);

async function onHandTotal(lotId: string) {
  const rows = await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, lotId));
  return rows.reduce((t, r) => t.plus(r.qtyBase), new Decimal(0)).toString();
}

describe("Finish: permissions and site scope", () => {
  let b: Awaited<ReturnType<typeof directBatchReadyToFinish>>;
  beforeAll(async () => {
    b = await directBatchReadyToFinish(kit, { manager, operator, checker });
  }, 120_000);

  it("refuses QA, the warehouse and a user of another site", async () => {
    const input = { batchId: b.batchId, goodUnits: "60", packaging: [{ materialId: b.wrapperMaterialId, damaged: "2", leftOver: "7" }], idempotencyKey: key() };
    await expectCode(finishBatch(qa, input, { checker }), "forbidden");
    await expectCode(finishBatch(warehouse, input, { checker }), "forbidden");
    await expectCode(finishBatch(operatorRvs, input, { checker }), "not_found");
    await expectCode(getFinishView(operatorRvs, b.batchId), "not_found");
  });

  it("asks for the good pieces when nothing was logged, and for the wrapper counts", async () => {
    const e = await expectCode(finishBatch(operator, { batchId: b.batchId, packaging: [], idempotencyKey: key() }, { checker }), "validation");
    expect(e.details?.field).toBe("goodUnits");
    const p = await expectCode(finishBatch(operator, { batchId: b.batchId, goodUnits: "60", idempotencyKey: key() }, { checker }), "validation");
    expect(String(p.details?.field)).toMatch(/^pkg-/);
  });

  it("blocks when the wrappers do not balance, and nothing is recorded", async () => {
    // 70 taken; 60 good + 0 wrapped rejects = 60 used; 2 + 3 → 5 missing.
    const e = await expectCode(finishBatch(operator, { batchId: b.batchId, goodUnits: "60", packaging: [{ materialId: b.wrapperMaterialId, damaged: "2", leftOver: "3" }], idempotencyKey: key() }, { checker }), "state");
    expect(e.message).toMatch(/5 .* missing/);
    expect(await db.select().from(yieldRecords).where(eq(yieldRecords.batchId, b.batchId))).toHaveLength(0);
    expect(await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId))).toHaveLength(0);
    const [row] = await db.select().from(packagingReconciliations).where(eq(packagingReconciliations.batchId, b.batchId));
    expect(row.countedAt).toBeNull();
  });

  it("the old transfer refuses uncounted wrappers (no silent skip of their consumption)", async () => {
    await recordYield(operator, { batchId: b.batchId, actualUnits: "60" });
    const e = await expectCode(postBatchToQuarantine(operator, { batchId: b.batchId, locationRef: "BC:LOC:QUA-01", idempotencyKey: key() }, { checker }), "state");
    expect(e.message).toMatch(/Count .*damaged and left over/);
  });

  it("finishes in one transaction: yield, rejects, samples, wrappers, hold area, quality check task; a retry returns the same result", async () => {
    const k = key();
    const input = {
      batchId: b.batchId,
      goodUnits: "60",
      rejects: [{ type: "Cracked bar", qty: "1" }],
      rejectsWrapped: "1",
      packaging: [{ materialId: b.wrapperMaterialId, damaged: "2", leftOver: "7" }], // 70 = 61 used + 2 + 7
      idempotencyKey: k,
    };
    const r = await finishBatch(operator, input, { checker });
    expect(r).toMatchObject({ goodUnits: "60", samplesKept: "2", sellableUnits: "58", rejects: "1", location: "QUA-01", countsFrom: "typed", within: true, replayed: false });
    const [bt] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    expect(bt.status).toBe("awaiting_qc");
    expect(new Decimal(bt.actualUnits!).toString()).toBe("60");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId));
    expect(lot.qualityStatus).toBe("quarantine");
    expect(await onHandTotal(lot.id)).toBe("58");
    const sample = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.sourceDocumentType, "batch_retained_sample")));
    expect(sample.map((m) => new Decimal(m.qtyBase).toString())).toEqual(["2"]);
    // The earlier yield of the old screen (same 60) is kept, not duplicated.
    expect(await db.select().from(yieldRecords).where(eq(yieldRecords.batchId, b.batchId))).toHaveLength(1);
    const scrap = await db.select().from(scrapReworkRecords).where(eq(scrapReworkRecords.batchId, b.batchId));
    expect(scrap.map((x) => [x.recordKind, x.reasonCode, new Decimal(x.qty).toString(), x.note])).toEqual([["scrap", "other", "1", "Reject: Cracked bar"]]);
    const [pkg] = await db.select().from(packagingReconciliations).where(and(eq(packagingReconciliations.batchId, b.batchId), isNull(packagingReconciliations.voidedAt)));
    expect([pkg.usedQty, pkg.damagedQty, pkg.returnedQty, pkg.varianceQty].map((v) => new Decimal(v!).toString())).toEqual(["61", "2", "7", "0"]);
    expect(pkg.productionPostingId).toBeTruthy();
    expect(await db.select().from(inspections).where(eq(inspections.batchId, b.batchId))).toHaveLength(1);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), eq(auditEvents.action, "production.batch.finished")));
    expect(au).toHaveLength(1);
    expect((au[0].after as { rejectsByType: unknown[] }).rejectsByType).toEqual([{ type: "Cracked bar", qty: "1", kind: "scrap" }]);

    const again = await finishBatch(operator, input, { checker });
    expect(again.replayed).toBe(true);
    expect(again.lotNumber).toBe(r.lotNumber);
    expect(await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId))).toHaveLength(1);
    // A new key on a finished batch is refused (no second finish).
    await expectCode(finishBatch(operator, { ...input, idempotencyKey: key() }, { checker }), "state");
  });
});

describe("Finish: yield outside the range needs a reason and opens a problem report", () => {
  it("refuses without a reason, then opens the deviation and sends the batch to the hold area", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const input = { batchId: b.batchId, goodUnits: "50", samplesKept: "0", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "20" }], idempotencyKey: key() };
    const e = await expectCode(finishBatch(operator, input, { checker }), "validation");
    expect(e.details?.field).toBe("problemReason");
    expect(e.message).toMatch(/made 50 of 61 expected/);
    const r = await finishBatch(operator, { ...input, idempotencyKey: key(), problemReason: "Mould leaked, 11 bars lost on the floor" }, { checker });
    expect(r.within).toBe(false);
    expect(r.deviationId).toBeTruthy();
    const [dev] = await db.select().from(deviations).where(eq(deviations.id, r.deviationId!));
    expect(dev.source).toBe("yield");
    expect(dev.description).toMatch(/Mould leaked/);
    const [y] = await db.select().from(yieldRecords).where(and(eq(yieldRecords.batchId, b.batchId), eq(yieldRecords.isCurrent, true)));
    expect(y.deviationId).toBe(r.deviationId);
    expect(y.approvedBy).toBeNull();
    expect((await db.select().from(batches).where(eq(batches.id, b.batchId)))[0].status).toBe("awaiting_qc");
  });
});

describe("Finish equals the old commands run one by one (comparison)", () => {
  it("same yield, scrap, packaging, lot, postings and batch state", async () => {
    const qua = await loc(kit.nfd.id, "QUA-01");
    // A: the five old commands.
    const a = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const [ra] = await db.select().from(packagingReconciliations).where(eq(packagingReconciliations.batchId, a.batchId));
    await recordYield(operator, { batchId: a.batchId, actualUnits: "60" });
    await recordScrapRework(operator, { batchId: a.batchId, kind: "scrap", reasonCode: "other", qty: "1", note: "Reject: Cracked bar" });
    await countPackaging(operator, { reconciliationId: ra.id, used: "61", damaged: "2", returned: "7" });
    await postBatchToQuarantine(operator, { batchId: a.batchId, locationRef: "BC:LOC:QUA-01", idempotencyKey: key() }, { checker });
    // B: one Finish (no samples, to compare like with like).
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    await finishBatch(operator, { batchId: b.batchId, goodUnits: "60", rejects: [{ type: "Cracked bar", qty: "1" }], rejectsWrapped: "1", samplesKept: "0", packaging: [{ materialId: b.wrapperMaterialId, damaged: "2", leftOver: "7" }], idempotencyKey: key() }, { checker });

    const snapshot = async (batchId: string) => {
      const [bt] = await db.select().from(batches).where(eq(batches.id, batchId));
      const [y] = await db.select().from(yieldRecords).where(and(eq(yieldRecords.batchId, batchId), eq(yieldRecords.isCurrent, true)));
      const scrap = await db.select().from(scrapReworkRecords).where(eq(scrapReworkRecords.batchId, batchId));
      const pkg = await db.select().from(packagingReconciliations).where(and(eq(packagingReconciliations.batchId, batchId), isNull(packagingReconciliations.voidedAt)));
      const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, batchId));
      const [bal] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, qua.id)));
      const postings = await db.select().from(productionPostings).where(eq(productionPostings.batchId, batchId));
      const ins = await db.select().from(inspections).where(eq(inspections.batchId, batchId));
      return {
        status: bt.status,
        actualUnits: bt.actualUnits,
        yieldPct: bt.yieldPct,
        actualOutputG: bt.actualOutputG,
        yield: [y.actualUnits, y.actualBase, y.yieldPct, y.isWithinLimits],
        scrap: scrap.map((x) => [x.recordKind, x.reasonCode, x.qty, x.note, x.requiresApproval]),
        pkg: pkg.map((x) => [x.issuedQty, x.usedQty, x.damagedQty, x.returnedQty, x.varianceQty, x.isWithinTolerance, !!x.productionPostingId]),
        lot: [lot.qualityStatus, lot.expiresOn, lot.manufacturedOn, bal.qtyBase],
        postings: postings.map((p) => `${p.postingType}:${new Decimal(p.qtyBase).toString()}`).sort(),
        inspections: ins.map((i) => [i.inspectionKind, i.status]),
      };
    };
    expect(await snapshot(b.batchId)).toEqual(await snapshot(a.batchId));
  });
});

describe("Finish reads the counts back from the daily log", () => {
  it("good pieces and rejects come from the log; only wrappers are typed", async () => {
    const order = await orderReadyToFinish(kit, { manager, operator, checker, planner, warehouse }, { batches: 1 });
    const b = order.batches[0];
    await addDailyLog(operator, { workOrderId: order.workOrderId, batchId: b.batchId, goodQty: "50", defects: [{ defectType: "Cracked bar", quantity: "1" }] });
    await addDailyLog(operator, { workOrderId: order.workOrderId, batchId: b.batchId, goodQty: "10" });
    const v = await getFinishView(operator, b.batchId);
    expect(v.log).toMatchObject({ entries: 2, good: "60", rejects: [{ type: "Cracked bar", qty: "1" }] });
    expect(v.expectedUnits).toBe("61");
    expect(v.hold?.code).toBe("QUA-01");
    expect(v.samples).toEqual({ enabled: true, units: 2 });
    // 70 taken = 60 used + 3 damaged + 7 left over.
    const r = await finishBatch(operator, { batchId: b.batchId, packaging: [{ materialId: b.wrapperMaterialId, damaged: "3", leftOver: "7" }], idempotencyKey: key() }, { checker });
    expect(r).toMatchObject({ countsFrom: "daily_log", goodUnits: "60", rejects: "1", sellableUnits: "58" });
  });
});

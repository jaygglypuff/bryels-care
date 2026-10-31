/**
 * ADR-088 §3, packaging and labels in the flow:
 *   - the wrappers a batch needs are a batch line (recipe packaging line, else the per-piece setup) that is
 *     set aside when the order is approved and listed on "Get materials" with lot, shelf and quantity;
 *   - the line is never weighed;
 *   - "Step done" on the packaging step records the issue against the taken lot without a scan (same
 *     packaging_reconciliations row and audit as the scan path; the set-aside quantity is converted);
 *   - Finish still reconciles taken = used + damaged + left over and posts the consumption;
 *   - "Print labels for this batch": one label job of N copies, lot number and dates frozen on the batch and
 *     used by Finish for the finished lot;
 *   - negatives: other site, role without the permission, packaging line refused at weighing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, inventoryLots, labelJobs, materials, packagingReconciliations, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  type FormulaSnapshot,
  approveProductionOrder,
  completeStep,
  confirmPicked,
  createProductionOrder,
  finishBatch,
  getFinishView,
  getMaterialsList,
  getStepCard,
  getWeighView,
  printBatchLabels,
  recordDispense,
  recordReading,
  selectEquipment,
  stepDone,
} from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { cleanEquipment, signChecklist } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let operatorRvs: AuthContext;
let orderId: string;
let batchId: string;
let wrapperId: string;
const key = () => `pk-${uuidv7()}`;
const batchRow = async () => (await db.select().from(batches).where(eq(batches.id, batchId)))[0];
const snap = async () => (await batchRow()).formulaSnapshot as FormulaSnapshot;

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  const r = await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() });
  orderId = r.workOrderId;
  const a = await approveProductionOrder(w.manager, orderId, { idempotencyKey: key() });
  batchId = a.batches[0].batchId;
  [{ id: wrapperId }] = await db.select({ id: materials.id }).from(materials).where(eq(materials.code, "PKG-0101"));
}, 180_000);

describe("packaging lines are set aside and listed on Get materials", () => {
  it("the batch has a wrapper line from the per-piece setup (one per expected bar), not weighed", async () => {
    const s = await snap();
    const pieces = new Decimal((await batchRow()).plannedSizeG).mul(s.theoreticalYieldPct).div(100).div(135).floor();
    expect(s.packaging).toEqual([expect.objectContaining({ materialCode: "PKG-0101", source: "per_piece", qty: pieces.toString() })]);
    const [line] = await db.select().from(batchMaterials).where(and(eq(batchMaterials.batchId, batchId), eq(batchMaterials.materialId, wrapperId)));
    expect(line.status).toBe("packaging");
    expect(line.bomLineId).toBeNull();
    expect(new Decimal(line.theoreticalQtyG).eq(pieces)).toBe(true);
  });

  it("the order sets the wrappers aside and the list shows lot, shelf and quantity", async () => {
    const rs = await db
      .select({ r: stockReservations })
      .from(stockReservations)
      .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
      .where(and(eq(stockReservations.demandId, orderId), eq(stockReservations.status, "active"), eq(inventoryLots.materialId, wrapperId)));
    expect(rs.length).toBeGreaterThan(0);
    const v = await getMaterialsList(w.operator, batchId);
    const l = v.lines.find((x) => x.materialId === wrapperId)!;
    expect(l.materialKind).toBe("packaging");
    expect(l.weighingOpen).toBe(false);
    expect(l.needsCheck).toBe(false);
    expect(l.lots[0]).toMatchObject({ locationCode: "PKG-01", usable: true });
    // Never on the Weigh screen.
    const weigh = await getWeighView(w.operator, batchId);
    expect(weigh.cards.map((c) => c.materialCode)).not.toContain("PKG-0101");
  });

  it("other sites and people without access cannot read the list", async () => {
    await expectCode(getMaterialsList(operatorRvs, batchId), "not_found");
    await expectCode(getMaterialsList(w.sales, batchId), "forbidden");
  });
});

describe("the packaging step records the taken lot without a scan", () => {
  let pieces: Decimal;
  let pkgStep: FormulaSnapshot["steps"][number];
  let weighWrapper: unknown;

  beforeAll(async () => {
    await confirmPicked(w.operator, { batchId, all: true, idempotencyKey: key() });
    await cleanEquipment(w.operator, "SC-01");
    await cleanEquipment(w.operator, "MIX-01");
    const s = await snap();
    pieces = new Decimal(s.packaging![0].qty);
    for (const st of [...s.steps].sort((a, z) => a.stepNo - z.stepNo)) {
      if (st.stepKind === "line_clearance" || (st.checklistItems ?? []).length) await signChecklist(w.operator, checker, batchId, st);
      else if (st.stepKind === "dispensing") {
        const v = await getWeighView(w.operator, batchId);
        for (const c of v.cards) {
          const lot = c.lots[0];
          await recordDispense(w.operator, { batchId, batchMaterialId: c.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: lot.last4, qty: c.target, equipmentRef: "SC-01" }, { checker });
        }
        // While the weighing step is open, a try to weigh the wrapper line is refused.
        const [line] = await db.select().from(batchMaterials).where(and(eq(batchMaterials.batchId, batchId), eq(batchMaterials.materialId, wrapperId)));
        const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.materialId, wrapperId));
        weighWrapper = await recordDispense(w.operator, { batchId, batchMaterialId: line.id, lotRef: lot.id, qty: "1", equipmentRef: "SC-01" }).catch((e) => e);
        await completeStep(w.operator, { batchId, stepNo: st.stepNo }, { checker });
      } else if (st.stepKind === "process") {
        if (st.requiresEquipment) await selectEquipment(w.operator, { batchId, stepNo: st.stepNo, equipmentRef: "MIX-01" });
        for (const p of st.parameters ?? []) if (p.isRequired) await recordReading(w.operator, { batchId, stepNo: st.stepNo, parameterId: p.id, value: p.valueKind === "numeric" ? (p.targetValue ?? p.minValue ?? "45") : p.valueKind === "boolean" ? "yes" : "MOULD-A" });
        await completeStep(w.operator, { batchId, stepNo: st.stepNo }, { checker });
      } else if (st.stepKind === "packaging") {
        pkgStep = st;
        break;
      }
    }
  }, 180_000);

  it("a packaging line cannot be weighed", async () => {
    await expectCode(Promise.reject(weighWrapper), "validation");
  });

  it("the step card shows the taken wrapper lot, shelf and count, and the label button", async () => {
    const v = await getStepCard(w.operator, batchId, pkgStep.stepNo);
    expect(v.packaging?.needsScan).toBe(false);
    const l = v.packaging!.lines[0];
    expect(l.picked).toBe("taken");
    expect(l.plan[0]).toMatchObject({ locationCode: "PKG-01", qty: pieces.toString() });
    expect(v.packaging!.labels.defaultCount).toBe(pieces.toNumber());
    expect(v.packaging!.labels.canPrint).toBe(true);
  });

  it("prints the batch labels: one job of N copies, lot number and dates frozen; a repeat returns the same job", async () => {
    await expectCode(printBatchLabels(operatorRvs, { batchId, copies: 5, idempotencyKey: key() }), "not_found");
    await expectCode(printBatchLabels(w.sales, { batchId, copies: 5, idempotencyKey: key() }), "forbidden");
    await expectCode(printBatchLabels(w.operator, { batchId, copies: 1000, idempotencyKey: key() }), "validation");
    const r = await printBatchLabels(w.operator, { batchId, copies: pieces.toNumber(), idempotencyKey: key() });
    expect(r.alreadyPrinted).toBe(false);
    const [job] = await db.select().from(labelJobs).where(eq(labelJobs.id, r.jobId));
    expect(job).toMatchObject({ entityType: "batch", entityId: batchId, copies: pieces.toNumber(), status: "ready" });
    const b = await batchRow();
    expect(b.outputLotNumber).toBe(r.lotNumber);
    expect(b.outputExpiresOn).toBe(r.expiresOn);
    const again = await printBatchLabels(w.operator, { batchId, copies: pieces.toNumber(), idempotencyKey: key() });
    expect(again).toMatchObject({ alreadyPrinted: true, jobId: r.jobId, lotNumber: r.lotNumber });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.batch.label_lot_fixed")))).toHaveLength(1);
  });

  it("Step done records the issue against the taken lot (no scan), converts the set-aside wrappers and audits", async () => {
    await expectCode(stepDone(operatorRvs, { batchId, stepNo: pkgStep.stepNo }), "not_found");
    const used = pkgStep.parameters?.find((p) => /used/.test(p.code));
    const spoiled = pkgStep.parameters?.find((p) => /destroy/.test(p.code));
    const readings = [used && { parameterId: used.id, value: pieces.minus(2).toString() }, spoiled && { parameterId: spoiled.id, value: "2" }].filter(Boolean) as { parameterId: string; value: string }[];
    const k = key();
    const r = await stepDone(w.operator, { batchId, stepNo: pkgStep.stepNo, readings, idempotencyKey: k }, { checker });
    expect(r.blocked).toBe(false);
    await stepDone(w.operator, { batchId, stepNo: pkgStep.stepNo, readings, idempotencyKey: k }, { checker }); // replay
    const rows = await db.select().from(packagingReconciliations).where(eq(packagingReconciliations.batchId, batchId));
    expect(rows).toHaveLength(1);
    const picked = (await getMaterialsList(w.operator, batchId)).lines.find((x) => x.materialId === wrapperId)!;
    expect(rows[0].lotId).toBe(picked.lots.length ? picked.lots[0].lotId : rows[0].lotId);
    expect(new Decimal(rows[0].issuedQty).eq(pieces)).toBe(true);
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rows[0].id), eq(auditEvents.action, "production.packaging_component.issued")));
    expect((au.after as { source: string }).source).toBe("materials_list");
    const converted = await db.select().from(stockReservations).where(and(eq(stockReservations.demandId, orderId), eq(stockReservations.lotId, rows[0].lotId), eq(stockReservations.status, "converted")));
    expect(converted.length).toBeGreaterThan(0);
  });

  it("Finish still reconciles (taken = used + damaged + left over) and posts the lot printed on the labels", async () => {
    const v = await getFinishView(w.operator, batchId);
    const g = v.packaging.find((p) => p.materialId === wrapperId)!;
    expect(new Decimal(g.taken).eq(pieces)).toBe(true);
    const good = pieces.minus(2).toString();
    // Off by one: refused.
    await expectCode(finishBatch(w.manager, { batchId, goodUnits: good, packaging: [{ materialId: wrapperId, damaged: "1", leftOver: "0" }], idempotencyKey: key() }, { checker }), "state");
    const r = await finishBatch(w.manager, { batchId, goodUnits: good, packaging: [{ materialId: wrapperId, damaged: "2", leftOver: "0" }], problemReason: "Expected pieces check in the packaging-flow test", idempotencyKey: key() }, { checker });
    const b = await batchRow();
    expect(r.lotNumber).toBe(b.outputLotNumber);
    expect(r.expiresOn).toBe(b.outputExpiresOn);
    const [rec] = await db.select().from(packagingReconciliations).where(and(eq(packagingReconciliations.batchId, batchId)));
    expect(rec.isWithinTolerance).toBe(true);
    expect(rec.productionPostingId).not.toBeNull();
  });
});

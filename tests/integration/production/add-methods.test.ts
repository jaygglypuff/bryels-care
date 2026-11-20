/**
 * ADR-137 "How is it added?": count, volume, whole container, as needed and own-way lines, from the material units and
 * the recipe through the normal approval to the batch, the floor, stock and corrections. Fictional data only.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, bomLines, dispenseRecords, formulaRevisions, materialUnits, materials, recipeTemplates, settings, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  addMaterialUnit,
  changeMaterialUnit,
  createFormulaRevision,
  decideFormulaRevision,
  getFormulaRevision,
  listMaterialUnits,
  listRecipeTemplates,
  retireMaterialUnit,
  retireRecipeTemplate,
  saveFormulaRevisionDraft,
  saveRecipeTemplate,
  submitFormulaRevision,
} from "@/modules/masterdata";
import { createBatch, getWeighView, recordDispense, recordNoneNeeded, startBatch, submitChecklist, undoNoneNeeded, voidDispense, workOrderRequirements } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, onHand, type Kit } from "../../support/kit";
import { type FixtureStep, allowDirectBatches, makeExecutionFixture, manilaDay, snapshotOf } from "../../support/w2b";

let kit: Kit;
let planner: AuthContext;
let qa: AuthContext;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let operatorRvs: AuthContext;
let warehouse: AuthContext;
const key = () => randomUUID();

const STEPS: FixtureStep[] = [
  { name: "Start check", kind: "line_clearance", area: "weighing", requiresChecker: false, checklist: [{ text: "Area clean" }] },
  { name: "Weigh and add", kind: "dispensing", requiresChecker: false },
];

const matId = async (code: string) => (await db.select().from(materials).where(eq(materials.code, code)))[0].id;

/** Units used by the recipe: fragrance sachets (25 g), lye solution mL (1.33 g/mL), a palm oil pail (500 g). */
let U: { sachet: string; lyeMl: string; pail: string };
let revisionId: string;

async function methodRecipe() {
  const f = await makeExecutionFixture(kit, STEPS);
  const [rev1] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, f.formulaRevisionId));
  const { revisionId: rid } = await createFormulaRevision(planner, { formulaId: rev1.formulaId, baseRevisionId: rev1.id });
  const [coconut, palm, lye, fragrance, green] = await Promise.all(["MAT-0012", "MAT-0013", "MAT-0021", "MAT-0043", "MAT-0051"].map(matId));
  const lines = [
    // 1 weigh, as before
    { materialId: coconut, quantityG: "1000", tolerancePct: "1", toleranceAbsG: null },
    // 2 count 5 sachets, round up, exact
    { materialId: fragrance, quantityG: "125", tolerancePct: null, toleranceAbsG: null, toleranceUnits: "0", addMethod: "count", methodQty: "5", materialUnitId: U.sachet, scaling: "proportional_round", rounding: "up" },
    // 3 measure 250 mL ± 5 mL
    { materialId: lye, quantityG: "332.5", tolerancePct: null, toleranceAbsG: null, toleranceUnits: "5", addMethod: "volume", methodQty: "250", materialUnitId: U.lyeMl },
    // 4 the whole pail, same for every batch
    { materialId: palm, quantityG: "500", tolerancePct: null, toleranceAbsG: null, addMethod: "whole_container", methodQty: "1", materialUnitId: U.pail, scaling: "fixed" },
    // 5 as needed until pH 5.0–5.5, about 10 g, at most 20 g
    { materialId: green, quantityG: "10", tolerancePct: null, toleranceAbsG: null, addMethod: "as_needed", maxQtyG: "20", methodSpec: { recordBy: "weigh", reading: { name: "pH", unit: "", min: "5.0", max: "5.5" } } },
  ];
  await saveFormulaRevisionDraft(planner, { revisionId: rid, referenceBatchSizeG: "1500", theoreticalYieldPct: "100", changeSummary: "ADR-137 test: ways of adding", lines });
  await submitFormulaRevision(planner, rid);
  for (const who of [qa, manager]) await decideFormulaRevision(who, { id: rid, decision: "approved", effectiveFrom: manilaDay(0) });
  return rid;
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  await allowDirectBatches(kit);
  U = {
    sachet: (await addMaterialUnit(planner, { materialId: await matId("MAT-0043"), kind: "pack", name: "Sachet", qtyPerUnit: "25" })).unitId,
    lyeMl: (await addMaterialUnit(planner, { materialId: await matId("MAT-0021"), kind: "volume", qtyPerUnit: "1.33" })).unitId,
    pail: (await addMaterialUnit(planner, { materialId: await matId("MAT-0013"), kind: "pack", name: "pail", qtyPerUnit: "500" })).unitId,
  };
  revisionId = await methodRecipe();
}, 240_000);

describe("material units", () => {
  it("are named, validated, versioned and never rewritten", async () => {
    const m = await matId("MAT-0043");
    const list = await listMaterialUnits(planner, m);
    expect(list.map((u) => [u.name, u.qtyPerUnit, u.versionNo])).toEqual([["sachet", "25.000000", 1]]);
    await expectCode(addMaterialUnit(planner, { materialId: m, kind: "pack", name: "sachet", qtyPerUnit: "30" }), "conflict");
    await expectCode(addMaterialUnit(planner, { materialId: m, kind: "pack", name: "kg", qtyPerUnit: "1000" }), "validation");
    await expectCode(addMaterialUnit(planner, { materialId: m, kind: "pack", name: "bottle", qtyPerUnit: "0" }), "validation");
    await expectCode(addMaterialUnit(planner, { materialId: m, kind: "volume", qtyPerUnit: "80" }), "validation");
    // A new size is a new version; the old row stays as it was.
    const bottle = await addMaterialUnit(planner, { materialId: m, kind: "pack", name: "bottle", qtyPerUnit: "500", idempotencyKey: "addm-bottle" });
    expect((await addMaterialUnit(planner, { materialId: m, kind: "pack", name: "bottle", qtyPerUnit: "500", idempotencyKey: "addm-bottle" })).unitId).toBe(bottle.unitId);
    const v2 = await changeMaterialUnit(planner, { unitId: bottle.unitId, qtyPerUnit: "450", reason: "Supplier changed the bottle" });
    expect(v2.versionNo).toBe(2);
    const [old] = await db.select().from(materialUnits).where(eq(materialUnits.id, bottle.unitId));
    expect(old.status).toBe("retired");
    expect(old.qtyPerUnit).toBe("500.000000");
    await expect(db.update(materialUnits).set({ qtyPerUnit: "1" }).where(eq(materialUnits.id, bottle.unitId))).rejects.toThrow();
    await expect(db.delete(materialUnits).where(eq(materialUnits.id, bottle.unitId))).rejects.toThrow();
    await retireMaterialUnit(planner, { unitId: v2.unitId, reason: "Not bought any more" });
    expect((await listMaterialUnits(planner, m)).map((u) => u.name)).toEqual(["sachet"]);
    const events = await db.select({ action: auditEvents.action }).from(auditEvents).where(sql`${auditEvents.action} like 'masterdata.material_unit.%'`);
    expect(new Set(events.map((e) => e.action))).toEqual(new Set(["masterdata.material_unit.added", "masterdata.material_unit.changed", "masterdata.material_unit.retired"]));
  });

  it("refuses people who may not edit materials", async () => {
    await expectCode(addMaterialUnit(operator, { materialId: await matId("MAT-0012"), kind: "pack", name: "drum", qtyPerUnit: "180000" }), "forbidden");
    await expectCode(changeMaterialUnit(warehouse, { unitId: U.sachet, qtyPerUnit: "30", reason: "trying it" }), "forbidden");
  });
});

describe("recipe lines", () => {
  it("store the stock amount worked out from the unit and keep weighed lines as before", async () => {
    const lines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, revisionId)).orderBy(asc(bomLines.lineNo));
    expect(lines.map((l) => [l.addMethod, l.quantityG, l.methodQty, l.methodUnit, l.methodUnitQty])).toEqual([
      ["weigh", "1000.000000", null, null, null],
      ["count", "125.000000", "5.000000", "sachet", "25.000000"],
      ["volume", "332.500000", "250.000000", "mL", "1.330000"],
      ["whole_container", "500.000000", "1.000000", "pail", "500.000000"],
      ["as_needed", "10.000000", null, null, null],
    ]);
    // ± units are also kept in the stock unit for every older reader of the line.
    expect(lines[1].toleranceAbsG).toBe("0.000000");
    expect(lines[2].toleranceAbsG).toBe("6.650000");
    const view = await getFormulaRevision(planner, revisionId);
    expect(view!.lines.map((l) => l.methodSentence)).toEqual(["Weigh 1,000 g", "Count 5 sachets", "Measure 250 mL", "Add the whole pail", "Add until pH 5.0–5.5 (about 10 g, at most 20 g)"]);
    // Every line made before ADR-137 is a weighed line.
    const old = await db.select({ n: sql<number>`count(*)::int` }).from(bomLines).where(sql`${bomLines.addMethod} <> 'weigh' and ${bomLines.formulaRevisionId} <> ${revisionId}`);
    expect(old[0].n).toBe(0);
  });

  it("refuse combinations that do not make sense, with the field named", async () => {
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, revisionId));
    const draft = await createFormulaRevision(planner, { formulaId: rev.formulaId, baseRevisionId: rev.id });
    const fragrance = await matId("MAT-0043");
    const save = (line: Record<string, unknown>) => saveFormulaRevisionDraft(planner, { revisionId: draft.revisionId, referenceBatchSizeG: "1500", theoreticalYieldPct: "100", lines: [{ materialId: fragrance, quantityG: "125", tolerancePct: null, toleranceAbsG: null, toleranceUnits: "0", ...line }] });
    // Whole units cannot grow in parts.
    let e = await expectCode(save({ addMethod: "count", methodQty: "5", materialUnitId: U.sachet, scaling: "proportional" }), "validation");
    expect(Object.keys(e.details?.fieldErrors as object)).toContain("lines.0.scaling");
    // Rounding needs its rule.
    e = await expectCode(save({ addMethod: "count", methodQty: "5", materialUnitId: U.sachet, scaling: "proportional_round" }), "validation");
    expect(Object.keys(e.details?.fieldErrors as object)).toContain("lines.0.rounding");
    // A unit of another material.
    await expectCode(save({ addMethod: "count", methodQty: "5", materialUnitId: U.pail, scaling: "fixed" }), "validation");
    // Half a sachet.
    await expectCode(save({ addMethod: "count", methodQty: "2.5", materialUnitId: U.sachet, scaling: "fixed" }), "validation");
    // As needed without the reading.
    await expectCode(save({ addMethod: "as_needed", toleranceUnits: null, maxQtyG: "20", methodSpec: { recordBy: "weigh" } }), "validation");
    // The browser's number never decides the stock amount.
    await save({ quantityG: "1", addMethod: "count", methodQty: "4", materialUnitId: U.sachet, scaling: "fixed" });
    const [l] = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, draft.revisionId));
    expect(l.quantityG).toBe("100.000000");
  });
});

describe("a batch and the floor", () => {
  async function batch(sizeKg: string) {
    const { batchId } = await createBatch(manager, { formulaRevisionId: revisionId, plannedSizeKg: sizeKg, plannedStartOn: manilaDay(0) });
    const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(asc(batchMaterials.lineNo));
    return { batchId, lines };
  }
  async function started(sizeKg: string) {
    const b = await batch(sizeKg);
    await startBatch(operator, b.batchId);
    const [row] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    const s1 = snapshotOf(row).steps.find((s) => s.stepKind === "line_clearance")!;
    await submitChecklist(operator, { batchId: b.batchId, stepNo: s1.stepNo, answers: s1.checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) });
    return b;
  }

  it("scales each way: rounded sachets say so; fixed pail stays; mL and the as-needed maximum grow", async () => {
    const { batchId, lines } = await batch("2.25"); // factor 1.5
    expect(lines.map((l) => [l.addMethod, l.theoreticalQtyG, l.methodTargetQty, l.methodRoundedFrom, l.maxQtyG])).toEqual([
      ["weigh", "1500.000000", null, null, null],
      ["count", "200.000000", "8.000000", "7.500000", null],
      ["volume", "498.750000", "375.000000", null, null],
      ["whole_container", "500.000000", "1.000000", null, null],
      ["as_needed", "15.000000", null, null, "30.000000"],
    ]);
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const snap = snapshotOf(b).lines.find((l) => l.lineNo === 2)!;
    expect(snap.addMethod).toBe("count");
    expect(snap.method).toMatchObject({ unit: "sachet", perUnit: "25.000000", target: "8", roundedFrom: "7.5", rounding: "up" });
    // A tiny batch still gets one whole sachet (round up) and says so.
    const tiny = await batch("0.003");
    expect([tiny.lines[1].methodTargetQty, tiny.lines[1].methodRoundedFrom]).toEqual(["1.000000", "0.010000"]);
  });

  it("order requirements use the stock amounts, rounding per batch", async () => {
    const req = await workOrderRequirements(db, { formulaRevisionId: revisionId, batchCount: 2, batchSizeBase: "1500", batchPlan: { sizesG: ["2250", "750"] } as never });
    const frag = req.find((r) => r.materialCode === "MAT-0043")!;
    // 7.5 → 8 sachets and 2.5 → 3 sachets = 11 × 25 g
    expect(frag.required.toString()).toBe("275");
    const palm = req.find((r) => r.materialCode === "MAT-0013")!;
    expect(palm.required.toString()).toBe("1000");
  });

  it("count, measure, whole container, as needed: judged their own way, posted in the stock unit", async () => {
    // Post each amount when it is recorded (site option, A-PROC-31), to see the stock move at once.
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "production.post_consumption_at_dispense", value: true });
    const { batchId, lines } = await started("1.5");
    const b01 = (await loc(kit.nfd.id, "B-01")).id;
    const lot = (code: string, qty: string) => makeLot(manager, kit.nfd.id, b01, qty, { materialCode: code });
    const [frag, lye, palm, green] = await Promise.all([lot("MAT-0043", "1000"), lot("MAT-0021", "2000"), lot("MAT-0013", "480"), lot("MAT-0051", "100")]);
    const at = (l: { id: string }) => ({ batchId, lotRef: (l as { id: string }).id });
    // Count: 4 sachets is not 5 (exact), 5 is.
    let e = await expectCode(recordDispense(operator, { ...at(frag), batchMaterialId: lines[1].id, units: "4" }, { checker }), "out_of_tolerance");
    expect(e.message).toMatch(/4 sachets .*exactly 5 sachets/);
    await expectCode(recordDispense(operator, { ...at(frag), batchMaterialId: lines[1].id, units: "4.5" }, { checker }), "validation");
    const c = await recordDispense(operator, { ...at(frag), batchMaterialId: lines[1].id, units: "5" }, { checker });
    expect(c.lineTotalG).toBe("125");
    const [crow] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, c.dispenseRecordId));
    expect([crow.addMethod, crow.enteredQty, crow.enteredUom, crow.methodUnitQty, crow.actualQtyG]).toEqual(["count", "5.000000", "sachet", "25.000000", "125.000000"]);
    // No scale is needed to count.
    expect(crow.equipmentId).toBeNull();
    // Volume: 240 mL is outside 245–255; 252 mL is fine and is 335.16 g of stock.
    await expectCode(recordDispense(operator, { ...at(lye), batchMaterialId: lines[2].id, units: "240" }, { checker }), "out_of_tolerance");
    const v = await recordDispense(operator, { ...at(lye), batchMaterialId: lines[2].id, units: "252" }, { checker });
    expect(v.lineTotalG).toBe("335.16");
    // Whole container: the 480 g left in the pail goes in (nothing typed).
    const w = await recordDispense(operator, { ...at(palm), batchMaterialId: lines[3].id, wholeContainer: true }, { checker });
    expect(w.lineTotalG).toBe("480");
    const [wrow] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, w.dispenseRecordId));
    expect(wrow.wholeContainer).toBe(true);
    // As needed: more than the maximum, or a reading outside the range, needs QA; inside both is fine.
    await expectCode(recordDispense(operator, { ...at(green), batchMaterialId: lines[4].id, qty: "21", reading: "5.2" }, { checker }), "out_of_tolerance");
    await expectCode(recordDispense(operator, { ...at(green), batchMaterialId: lines[4].id, qty: "12" }, { checker }), "validation");
    e = await expectCode(recordDispense(operator, { ...at(green), batchMaterialId: lines[4].id, qty: "12", reading: "4.6" }, { checker }), "out_of_tolerance");
    expect(e.message).toMatch(/pH 4.6 is outside pH 5.0–5.5/);
    // QA approves an out-of-range reading on this device, with a reason (CX-TOL with a deviation).
    const a = await recordDispense(operator, { ...at(green), batchMaterialId: lines[4].id, qty: "12", reading: "4.9", exceptionReason: "pH 4.9 accepted after QA review of the sample" }, { checker, exceptionApprover: qa });
    expect(a.status).toBe("exception");
    const [arow] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, a.dispenseRecordId));
    expect([arow.readingValue, arow.readingWithin]).toEqual(["4.9", false]);
    // Stock: every way posts grams through postMovement (the ledger), in the stock unit.
    await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "production.post_consumption_at_dispense")));
    expect([await onHand(frag.id, b01), await onHand(lye.id, b01), await onHand(palm.id, b01), await onHand(green.id, b01)]).toEqual(["875", "1664.84", "0", "88"]);
    const moves = await db.select({ lotId: stockMovements.lotId, qty: stockMovements.qtyBase }).from(stockMovements).where(and(eq(stockMovements.lotId, frag.id), eq(stockMovements.movementType, "consumption")));
    expect(moves.map((m) => new Decimal(m.qty).abs().toString())).toEqual(["125"]);
  });

  it("a correction voids and re-records; the counted amount and the unit size stay on the record", async () => {
    const { batchId, lines } = await started("1.5");
    const b01 = (await loc(kit.nfd.id, "B-01")).id;
    const frag = await makeLot(manager, kit.nfd.id, b01, "500", { materialCode: "MAT-0043" });
    const first = await recordDispense(operator, { batchId, batchMaterialId: lines[1].id, lotRef: frag.id, units: "5" });
    await voidDispense(manager, { dispenseRecordId: first.dispenseRecordId, reason: "Counted the wrong bag" });
    const again = await recordDispense(operator, { batchId, batchMaterialId: lines[1].id, lotRef: frag.id, units: "5", supersedesId: first.dispenseRecordId, correctionReason: "Counted again from the right bag" });
    const rows = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, lines[1].id)).orderBy(asc(dispenseRecords.sequence));
    expect(rows.map((r) => [r.enteredQty, r.voidedAt !== null, r.supersedesId])).toEqual([
      ["5.000000", true, null],
      ["5.000000", false, first.dispenseRecordId],
    ]);
    expect(again.status).toBe("dispensed");
  });

  it("as needed: none was needed, with the reading and a second person; undo with a reason", async () => {
    const { batchId, lines } = await started("1.5");
    await expectCode(recordNoneNeeded(operator, { batchId, batchMaterialId: lines[4].id, reading: "5.2" }), "validation"); // the checker must sign
    await expectCode(recordNoneNeeded(operator, { batchId, batchMaterialId: lines[4].id, reading: "4.2" }, { checker }), "out_of_tolerance");
    await expectCode(recordNoneNeeded(operator, { batchId, batchMaterialId: lines[1].id, reading: "5.2" }, { checker }), "validation"); // not an as-needed line
    await expectCode(recordNoneNeeded(operator, { batchId, batchMaterialId: lines[4].id, reading: "5.2" }, { checker: operator }), "separation_of_duties");
    const r = await recordNoneNeeded(operator, { batchId, batchMaterialId: lines[4].id, reading: "5.2", idempotencyKey: "addm-none" }, { checker });
    expect(r.status).toBe("dispensed");
    expect((await recordNoneNeeded(operator, { batchId, batchMaterialId: lines[4].id, reading: "5.2", idempotencyKey: "addm-none" }, { checker })).status).toBe("dispensed");
    const [bm] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, lines[4].id));
    expect([bm.noneNeeded, bm.noneNeededReading, bm.dispensedQtyG]).toEqual([true, "5.2", "0.000000"]);
    await expectCode(undoNoneNeeded(operator, { batchMaterialId: lines[4].id, reason: "Read the wrong meter" }), "forbidden");
    await undoNoneNeeded(manager, { batchMaterialId: lines[4].id, reason: "Read the wrong meter" });
    const [back] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, lines[4].id));
    expect([back.status, back.noneNeeded]).toEqual(["pending", false]);
  });

  it("the Weigh screen shows the right control per line", async () => {
    const { batchId } = await started("2.25");
    const v = await getWeighView(operator, batchId);
    expect(v.cards.map((c) => [c.method.addMethod, c.method.sentence])).toEqual([
      ["weigh", "Weigh 1,500 g"],
      ["count", "Count 8 sachets"],
      ["volume", "Measure 375 mL"],
      ["whole_container", "Add the whole pail"],
      ["as_needed", "Add until pH 5.0–5.5 (about 15 g, at most 30 g)"],
    ]);
    expect(v.cards[1].method.rounded).toBe("Rounded up from 7.5 to 8 sachets (recipe rule).");
    expect(v.cards[1].method.window).toEqual({ min: "8", max: "8", unit: "sachet" });
  });

  it("is refused at another site and for roles that may not weigh", async () => {
    const { batchId, lines } = await started("1.5");
    const lotRef = (await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "500", { materialCode: "MAT-0043" })).id;
    await expectCode(recordDispense(operatorRvs, { batchId, batchMaterialId: lines[1].id, lotRef, units: "5" }), "not_found");
    await expectCode(recordDispense(warehouse, { batchId, batchMaterialId: lines[1].id, lotRef, units: "5" }), "forbidden");
    await expectCode(recordNoneNeeded(operatorRvs, { batchId, batchMaterialId: lines[4].id, reading: "5.2" }, { checker }), "not_found");
    await expectCode(recordNoneNeeded(warehouse, { batchId, batchMaterialId: lines[4].id, reading: "5.2" }, { checker }), "forbidden");
  });
});

describe("templates", () => {
  it("a site saves a custom step or way of adding; people see their sites only; audited; retired with a reason", async () => {
    const body = { method: "custom", customName: "Scoop with measuring spoon #3", customUnit: "scoop", customUnitQty: "12", diffKind: "units", diff: "0", needsCheck: true };
    const t = await saveRecipeTemplate(planner, { siteId: kit.nfd.id, kind: "add_method", name: "Spoon #3", body, idempotencyKey: "addm-tpl" });
    expect((await saveRecipeTemplate(planner, { siteId: kit.nfd.id, kind: "add_method", name: "Spoon #3", body, idempotencyKey: "addm-tpl" })).templateId).toBe(t.templateId);
    await expectCode(saveRecipeTemplate(planner, { siteId: kit.nfd.id, kind: "add_method", name: "spoon #3", body }), "conflict");
    await expectCode(saveRecipeTemplate(planner, { siteId: kit.nfd.id, kind: "add_method", name: "No name", body: { method: "custom" } }), "validation");
    // Another site, another role.
    await expectCode(saveRecipeTemplate(planner, { siteId: kit.rvs.id, kind: "add_method", name: "Spoon #4", body }), "not_found");
    await expectCode(saveRecipeTemplate(operator, { siteId: kit.nfd.id, kind: "step", name: "Check the colour", body: { name: "Check the colour" } }), "forbidden");
    const step = await saveRecipeTemplate(planner, { siteId: kit.nfd.id, kind: "step", name: "Check the colour", body: { name: "Check the colour", qaSigns: true, needsCheck: true, readings: [{ name: "Colour", kind: "choice", unit: "", min: "", max: "", required: true, options: ["Light green", "Green", "Dark green"] }] } });
    const mine = await listRecipeTemplates(planner);
    expect(mine.map((x) => x.name).sort()).toEqual(["Check the colour", "Spoon #3"]);
    const rvsOnly = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.rvs]);
    expect(await listRecipeTemplates(rvsOnly)).toEqual([]);
    await expectCode(retireRecipeTemplate(rvsOnly, { templateId: step.templateId, reason: "Not used any more" }), "not_found");
    await retireRecipeTemplate(planner, { templateId: step.templateId, reason: "Not used any more" });
    const [row] = await db.select().from(recipeTemplates).where(eq(recipeTemplates.id, step.templateId));
    expect(row.status).toBe("retired");
    const ev = await db.select({ a: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.entityId, step.templateId)));
    expect(ev.map((x) => x.a).sort()).toEqual(["masterdata.recipe_template.retired", "masterdata.recipe_template.saved"]);
  });
});

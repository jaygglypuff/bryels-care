/**
 * ADR-104 §2 (box labels by default) and §4 (one batch or several), ADR-106 §4 (wrappers in plain words):
 *   - New order: split (default) / one batch (up to the largest batch, else refused with the reason) / choose
 *     sizes (> 0, ≤ largest, sum); batches are created with their planned size and ingredient targets scale;
 *   - Packaging step: "How many pieces did you pack?" → boxes; one label job per box (kind carton, entity
 *     batch_box), QR = BC:BOX:<box number>; a new count replaces the plan (old labels cancelled);
 *   - Finish: the boxes become containers in the hold area with their pieces; the QR opens the box; more boxed
 *     pieces than good pieces is refused;
 *   - the "taken 1" wrapper bug: wrappers moved from two places at Get materials are all recorded as taken;
 *   - left-over wrappers go back to the shelf in one tap (once);
 *   - negatives: other site, roles without permission, replay.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batchBoxes, batchMaterials, batchMaterialStagings, batches, containerContents, containers, generatedDocuments, inventoryBalances, inventoryLots, labelJobs, locations, materials, products, stockMovements, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import { updateProduct, getProduct } from "@/modules/masterdata";
import {
  type FormulaSnapshot,
  approveProductionOrder,
  batchBoxInfoFor,
  completeStep,
  confirmPicked,
  createProductionOrder,
  finishBatch,
  getFinishView,
  getStepCard,
  getWeighView,
  planBatchBoxes,
  recordDispense,
  recordReading,
  returnLeftOverWrappers,
  selectEquipment,
  stepDone,
} from "@/modules/production";
import { gramsForPieces } from "@/modules/production/batch-plan";
import { resolveScanCard } from "@/modules/scan";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { cleanEquipment, signChecklist } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let operatorRvs: AuthContext;
let managerRvs: AuthContext;
let acs: string;
const key = () => `adr104-${uuidv7()}`;
const woOf = async (id: string) => (await db.select().from(workOrders).where(eq(workOrders.id, id)))[0];
const batchesOf = async (woId: string) => db.select().from(batches).where(eq(batches.workOrderId, woId)).orderBy(asc(batches.batchNumber));

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  managerRvs = await ctxFor(w.orgId, "manager.nfd@bryels-care.test", "site_manager", [w.rvs]);
  acs = await productId("ACS-135");
}, 180_000);

/* ------------------------------------------------------------------ §4 one batch or several */

describe("one batch or several (ACS-135: recipe batch 17.6 kg ≈ 123 bars; mixer MIX-01 takes 40 kg ≈ 281 bars)", () => {
  it("split (default): 300 bars → 3 batches of 100, each planned at the grams for 100 bars; approval creates them with that size", async () => {
    const k = key();
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", idempotencyKey: k });
    const wo = await woOf(r.workOrderId);
    expect(wo.batchCount).toBe(3);
    expect(wo.batchPlan).toMatchObject({ mode: "split", pieces: ["100", "100", "100"], largestFrom: "Soap mixer 50 L" });
    const g = gramsForPieces(100, "135", "95").toString();
    expect(wo.batchPlan!.sizesG).toEqual([g, g, g]);
    expect(new Decimal(wo.qtyPlannedBase).eq(new Decimal(g).mul(3))).toBe(true);
    // Replay: same order.
    expect((await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", idempotencyKey: k })).workOrderId).toBe(r.workOrderId);
    const a = await approveProductionOrder(w.manager, r.workOrderId, { idempotencyKey: key() });
    expect(a.batches).toHaveLength(3);
    for (const b of await batchesOf(r.workOrderId)) expect(new Decimal(b.plannedSizeG).eq(g)).toBe(true);
  });

  it("one batch: 250 bars fit the mixer → 1 batch; 400 bars are over the largest → refused with the reason and the split", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "250", batchMode: "one" });
    const wo = await woOf(r.workOrderId);
    expect(wo.batchCount).toBe(1);
    expect(wo.batchPlan!.sizesG).toEqual([gramsForPieces(250, "135", "95").toString()]);
    const e = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "400", batchMode: "one" }).catch((x) => x);
    expect(e.code).toBe("validation");
    expect(e.message).toContain("more than the largest batch");
    expect(e.message).toContain("Split it into");
    expect(e.details.fieldErrors.batchMode).toBeTruthy();
  });

  it("choose sizes: 200 + 100 for 300 is fine and the ingredient targets of each batch scale from its size; a wrong sum, zero or over the largest is refused", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", batchMode: "custom", batchSizes: ["200", "100"] });
    const wo = await woOf(r.workOrderId);
    expect(wo.batchPlan).toMatchObject({ mode: "custom", pieces: ["200", "100"] });
    await approveProductionOrder(w.manager, r.workOrderId, { idempotencyKey: key() });
    const [b1, b2] = await batchesOf(r.workOrderId);
    const sizes = [b1, b2].map((b) => new Decimal(b.plannedSizeG)).sort((x, y) => y.cmp(x));
    expect(sizes[0].eq(gramsForPieces(200, "135", "95"))).toBe(true);
    expect(sizes[1].eq(gramsForPieces(100, "135", "95"))).toBe(true);
    const big = new Decimal(b1.plannedSizeG).gt(b2.plannedSizeG) ? b1 : b2;
    const small = big === b1 ? b2 : b1;
    const lines = async (id: string) => db.select().from(batchMaterials).where(eq(batchMaterials.batchId, id)).orderBy(asc(batchMaterials.lineNo));
    const [l1] = await lines(big.id);
    const [l2] = await lines(small.id);
    expect(new Decimal(l1.theoreticalQtyG).div(l2.theoreticalQtyG).toDecimalPlaces(2).toNumber()).toBeCloseTo(new Decimal(big.plannedSizeG).div(small.plannedSizeG).toNumber(), 1);
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", batchMode: "custom", batchSizes: ["200", "50"] }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", batchMode: "custom", batchSizes: ["0", "300"] }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", batchMode: "custom", batchSizes: ["290", "10"] }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "300", batchMode: "sideways" }), "validation");
  });

  it("a batch size typed under More details above the mixer capacity is refused", async () => {
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), batchSizeKg: "45", batchCount: "1" }), "validation");
  });

  it("roles and sites: operators and sales cannot create; another site's manager cannot approve", async () => {
    await expectCode(createProductionOrder(w.operator, { productId: acs, plannedStart: day(0), quantityUnits: "100" }), "forbidden");
    await expectCode(createProductionOrder(w.sales, { productId: acs, plannedStart: day(0), quantityUnits: "100" }), "forbidden");
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), quantityUnits: "100" });
    await expectCode(approveProductionOrder(managerRvs, r.workOrderId, { idempotencyKey: key() }), "not_found");
  });
});

/* ------------------------------------------------------------------ §2 box labels + ADR-106 §4 wrappers */

describe("box labels, boxes at Finish and wrappers", () => {
  let orderId: string;
  let batchId: string;
  let wrapperId: string;
  let pkgStep: FormulaSnapshot["steps"][number];
  let needed: Decimal;
  const snap = async () => (await db.select().from(batches).where(eq(batches.id, batchId)))[0].formulaSnapshot as FormulaSnapshot;

  beforeAll(async () => {
    [{ id: wrapperId }] = await db.select({ id: materials.id }).from(materials).where(eq(materials.code, "PKG-0101"));
    // The "taken 1" bug: put the wrappers in two places so Get materials moves them in two transfers.
    const [pkg01] = await db.select().from(locations).where(and(eq(locations.siteId, w.nfd.id), eq(locations.code, "PKG-01")));
    const [a02] = await db.select().from(locations).where(and(eq(locations.siteId, w.nfd.id), eq(locations.code, "A-02")));
    const [bal] = await db
      .select({ b: inventoryBalances })
      .from(inventoryBalances)
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
      .where(and(eq(inventoryLots.materialId, wrapperId), eq(inventoryBalances.locationId, pkg01.id), eq(inventoryLots.qualityStatus, "released")));
    const keep = new Decimal(60);
    await db.transaction((tx) => postMovement(tx, w.warehouse, { movementType: "transfer", lotId: bal.b.lotId, fromLocationId: pkg01.id, toLocationId: a02.id, qtyBase: keep, reason: "Test: wrappers on two shelves", idempotencyKey: key() }));

    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(0), idempotencyKey: key() });
    orderId = r.workOrderId;
    batchId = (await approveProductionOrder(w.manager, orderId, { idempotencyKey: key() })).batches[0].batchId;
    needed = new Decimal((await snap()).packaging![0].qty);
    expect(needed.gt(keep)).toBe(true);
  }, 180_000);

  it("box labels are refused before the packaging step, for another site and for roles without label printing", async () => {
    await expectCode(planBatchBoxes(w.operator, { batchId, pieces: 100, idempotencyKey: key() }), "state");
    await expectCode(planBatchBoxes(operatorRvs, { batchId, pieces: 100, idempotencyKey: key() }), "not_found");
    await expectCode(planBatchBoxes(w.sales, { batchId, pieces: 100, idempotencyKey: key() }), "forbidden");
  });

  it("walks the batch to its packaging step; the wrappers moved in two transfers are all planned as taken (not 1)", async () => {
    // This site moves stock with each tick (the live setting where "taken 1" was seen).
    await setOrgSetting(w.orgId, "production.prepare.move_stock", true);
    await confirmPicked(w.manager, { batchId, all: true, idempotencyKey: key() });
    await setOrgSetting(w.orgId, "production.prepare.move_stock", false);
    const stagings = await db.select().from(batchMaterialStagings).where(and(eq(batchMaterialStagings.batchId, batchId)));
    const [line] = await db.select().from(batchMaterials).where(and(eq(batchMaterials.batchId, batchId), eq(batchMaterials.materialId, wrapperId)));
    expect(stagings.filter((s) => s.batchMaterialId === line.id).length).toBeGreaterThanOrEqual(2);
    await cleanEquipment(w.operator, "SC-01");
    await cleanEquipment(w.operator, "MIX-01");
    for (const st of [...(await snap()).steps].sort((a, z) => a.stepNo - z.stepNo)) {
      if (st.stepKind === "line_clearance" || (st.checklistItems ?? []).length) await signChecklist(w.operator, checker, batchId, st);
      else if (st.stepKind === "dispensing") {
        const v = await getWeighView(w.operator, batchId);
        for (const c of v.cards) {
          const lot = c.lots[0];
          await recordDispense(w.operator, { batchId, batchMaterialId: c.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: lot.last4, qty: c.target, equipmentRef: "SC-01" }, { checker });
        }
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
    const v = await getStepCard(w.operator, batchId, pkgStep.stepNo);
    const planned = v.packaging!.lines[0].plan.reduce((t, p) => t.plus(p.qty), new Decimal(0));
    expect(planned.eq(needed)).toBe(true);
  }, 240_000);

  it("per_box product: the card offers box labels, 48 a box; 'How many pieces did you pack?' 100 → 3 box labels (48 + 48 + 4), one job each with its own BOX code", async () => {
    const info = await batchBoxInfoFor(w.operator, batchId);
    expect(info).toMatchObject({ labelling: "per_box", unitsPerBox: 48, canPrint: true, plan: null });
    expect(info.preview?.options[0]?.face.payload).toMatch(/^BC:BOX:/);
    const k = key();
    const r = await planBatchBoxes(w.operator, { batchId, pieces: "100", idempotencyKey: k });
    expect(r).toMatchObject({ boxes: 3, pieces: 100, replacedPlan: false });
    const rows = await db.select().from(batchBoxes).where(eq(batchBoxes.batchId, batchId)).orderBy(asc(batchBoxes.boxNo));
    expect(rows.map((x) => x.pieces)).toEqual([48, 48, 4]);
    const jobs = await db.select().from(labelJobs).where(inArray(labelJobs.id, r.jobIds));
    expect(jobs).toHaveLength(3);
    for (const j of jobs) expect(j).toMatchObject({ entityType: "batch_box", copies: 1, status: "ready" });
    const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, jobs.find((j) => j.entityId === rows[2].id)!.generatedDocumentId!));
    const ent = (doc.dataset as { data: { entity: { payloadType: string; value: string; boxOfText: string; quantityText: string; statusWord: string | null } } }).data.entity;
    expect(ent).toMatchObject({ payloadType: "BOX", value: rows[2].containerNumber, boxOfText: "3 of 3", statusWord: null });
    expect(ent.quantityText).toContain("4 pcs · PART BOX");
    // Replay and the same count again: the same boxes and jobs.
    expect((await planBatchBoxes(w.operator, { batchId, pieces: "100", idempotencyKey: k })).jobIds).toEqual(r.jobIds);
    expect((await planBatchBoxes(w.operator, { batchId, pieces: "100", idempotencyKey: key() })).jobIds.sort()).toEqual([...r.jobIds].sort());
    await expectCode(planBatchBoxes(w.operator, { batchId, pieces: "0", idempotencyKey: key() }), "validation");
  });

  it("a new count replaces the boxes: old labels cancelled, new numbers; scanning a box label before Finish opens the batch", async () => {
    const old = await db.select().from(batchBoxes).where(eq(batchBoxes.batchId, batchId));
    const r = await planBatchBoxes(w.operator, { batchId, pieces: 96, idempotencyKey: key() });
    expect(r).toMatchObject({ boxes: 2, replacedPlan: true });
    const after = await db.select().from(batchBoxes).where(inArray(batchBoxes.id, old.map((o) => o.id)));
    expect(after.every((x) => x.status === "replaced" && x.replacedReason?.includes("from 100 to 96"))).toBe(true);
    const oldJobs = await db.select().from(labelJobs).where(inArray(labelJobs.id, old.map((o) => o.labelJobId!)));
    expect(oldJobs.every((j) => j.status === "cancelled")).toBe(true);
    const [cur] = await db.select().from(batchBoxes).where(and(eq(batchBoxes.batchId, batchId), eq(batchBoxes.status, "planned"))).orderBy(asc(batchBoxes.boxNo));
    const card = await resolveScanCard(w.operator, `BC:BOX:${cur.containerNumber}`);
    expect(card).toMatchObject({ outcome: "found", caption: "Box (batch being made)" });
    const oldCard = await resolveScanCard(w.operator, `BC:BOX:${old[0].containerNumber}`);
    expect(oldCard).toMatchObject({ outcome: "found", caption: "Old box label" });
  });

  it("Finish: more boxed pieces than good pieces is refused; then each box becomes a sealed box in the hold area and its QR opens the box", async () => {
    const used = pkgStep.parameters?.find((p) => /used/.test(p.code));
    const spoiled = pkgStep.parameters?.find((p) => /destroy/.test(p.code));
    const readings = [used && { parameterId: used.id, value: "96" }, spoiled && { parameterId: spoiled.id, value: "2" }].filter(Boolean) as { parameterId: string; value: string }[];
    const done = await stepDone(w.operator, { batchId, stepNo: pkgStep.stepNo, readings, idempotencyKey: key() }, { checker });
    expect(done.blocked).toBe(false);
    // Wrappers: ADR-106 §4 words; 96 wrapped + 2 damaged + rest left over.
    const fv = await getFinishView(w.operator, batchId);
    const g = fv.packaging.find((p) => p.materialId === wrapperId)!;
    expect(new Decimal(g.taken).eq(needed)).toBe(true); // was "taken 1"
    const left = new Decimal(g.taken).minus(96).minus(2).toString();
    // 95 good − samples < 96 boxed: refused before anything is posted.
    await expectCode(finishBatch(w.manager, { batchId, goodUnits: "95", samplesKept: "0", packaging: [{ materialId: wrapperId, damaged: "2", leftOver: left }], problemReason: "Test of the box count check", idempotencyKey: key() }, { checker }), "validation");
    // Too many wrappers counted: always refused, in plain words.
    const tooMany = await finishBatch(w.manager, { batchId, goodUnits: "96", samplesKept: "0", packaging: [{ materialId: wrapperId, damaged: "2", leftOver: String(Number(left) + 1) }], problemReason: "Testing the wrapper sum check", idempotencyKey: key() }, { checker }).catch((e) => e);
    expect(tooMany.message).toContain("too many — count the left-over and damaged ones again");
    const r = await finishBatch(w.manager, { batchId, goodUnits: "96", samplesKept: "0", packaging: [{ materialId: wrapperId, damaged: "2", leftOver: left }], problemReason: "Fewer bars than expected in this test", idempotencyKey: key() }, { checker });
    expect(r.boxes).toHaveLength(2);
    expect(r.loosePieces).toBe("0");
    const boxes = await db.select().from(containers).where(inArray(containers.id, r.boxes.map((b) => b.containerId)));
    const [loc] = await db.select().from(locations).where(eq(locations.code, r.location));
    for (const b of boxes) expect(b).toMatchObject({ status: "sealed", currentLocationId: loc.id, siteId: w.nfd.id });
    const contents = await db.select().from(containerContents).where(inArray(containerContents.containerId, boxes.map((b) => b.id)));
    expect(contents.reduce((t, c) => t.plus(c.qtyBase), new Decimal(0)).eq(96)).toBe(true);
    const planned = await db.select().from(batchBoxes).where(and(eq(batchBoxes.batchId, batchId), eq(batchBoxes.status, "boxed")));
    expect(planned.map((p) => p.containerNumber).sort()).toEqual(r.boxes.map((b) => b.containerNumber).sort());
    const card = await resolveScanCard(w.warehouse, `BC:BOX:${r.boxes[0].containerNumber}`);
    expect(card).toMatchObject({ outcome: "found", entity: "box" });
    // Boxes are made: no new box labels.
    await expectCode(planBatchBoxes(w.operator, { batchId, pieces: 90, idempotencyKey: key() }), "state");
  }, 120_000);

  it("left-over wrappers go back to their shelf in one tap, once; other sites and roles cannot", async () => {
    await expectCode(returnLeftOverWrappers(operatorRvs, { batchId }), "not_found");
    await expectCode(returnLeftOverWrappers(w.sales, { batchId }), "forbidden");
    const before = (await getFinishView(w.manager, batchId)).leftOver;
    expect(before.length).toBeGreaterThan(0);
    const r = await returnLeftOverWrappers(w.manager, { batchId });
    expect(r.moved.length).toBe(before.filter((x) => x.toLocationId).length);
    const again = await returnLeftOverWrappers(w.manager, { batchId });
    expect(again.moved).toHaveLength(0);
    const moves = await db.select().from(stockMovements).where(inArray(stockMovements.idempotencyKey, before.map((x) => `wrapper-return:${x.reconciliationId}`)));
    expect(moves.length).toBe(r.moved.length);
  });
});

/* ------------------------------------------------------------------ product setting */

describe("How do you label it? (product setting)", () => {
  it("defaults to a label on each box; can be set to each piece; other values refused; sales cannot change it", async () => {
    const p = await getProduct(w.owner, acs);
    expect(p.labelling).toBe("per_box");
    const base = { name: p.name, family: p.family, unitNetMassG: p.unitNetMassG, unitsPerBox: p.unitsPerBox, shelfLifeDays: p.shelfLifeDays, storageConditions: p.storageConditions };
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    expect(ahl.labelling).toBe("per_piece");
    await expectCode(updateProduct(w.owner, acs, { ...base, labelling: "sideways" }), "validation");
    await expectCode(updateProduct(w.sales, acs, { ...base, labelling: "per_piece" }), "forbidden");
    const u = await updateProduct(w.owner, acs, { ...base, labelling: "per_piece" });
    expect(u.labelling).toBe("per_piece");
    // Left out on edit: unchanged.
    expect((await updateProduct(w.owner, acs, base)).labelling).toBe("per_piece");
    await updateProduct(w.owner, acs, { ...base, labelling: "per_box" });
  });
});

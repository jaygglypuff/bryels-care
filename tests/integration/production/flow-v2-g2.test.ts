/**
 * ADR-080 stage G2 (production flow v2, slices V2-3..V2-5):
 *   - Materials list ticks (no stock move by default, audit per tick, idempotent, lot on hold refused,
 *     "Not needed" never skips a weighing, startBatch via the tick path);
 *   - Weigh cards: preselected lot confirmed by the last 4 characters / scan (lot_confirm), the lot set
 *     aside for the order enforced, second-person check mode all | marked | none frozen per line,
 *     checker confirm on the operator's device;
 *   - Step card "Step done" with readings, curing ready date, early end only with approval, one
 *     reminder per wait (idempotent job), the flow facts and next screen G1 consumes;
 *   - expiry counted from the mixing date (ADR-080 §7), and the G2 custom SQL (settings migration).
 * Negative tests: role escalation and cross-site access on every new command and view.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, batchMaterialPicks, batchMaterials, batches, inventoryLots, notifications, processStepRecords, settings, stockMovements, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import {
  type FormulaSnapshot,
  approveProductionOrder,
  approveStepException,
  batchExpiryDates,
  batchFlowFacts,
  checkDispense,
  completeStep,
  confirmPicked,
  createBatch,
  createProductionOrder,
  getBatchFlowFacts,
  getMaterialsList,
  getStepCard,
  getWeighView,
  nextBatchScreen,
  recordDispense,
  registerExecutionHooks,
  remindCuringReady,
  resetExecutionHooks,
  startBatch,
  stepDone,
  submitChecklist,
  waitLabel,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { makeLot } from "../../support/kit";
import { type FixtureStep, allowDirectBatches, cleanEquipment, makeExecutionFixture, manilaDay, signChecklist, snapshotOf } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, loc, productId, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let operatorRvs: AuthContext;
let orderId: string;
let batchId: string;
const key = () => `g2-${uuidv7()}`;
const batchRow = async (id: string) => (await db.select().from(batches).where(eq(batches.id, id)))[0];
const movementsOf = async (id: string) => db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "batch"), eq(stockMovements.sourceDocumentId, id)));
const auditOf = async (id: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, action)));

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  const r = await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() });
  orderId = r.workOrderId;
  const a = await approveProductionOrder(w.manager, orderId, { idempotencyKey: key() });
  batchId = a.batches[0].batchId;
}, 180_000);

afterAll(() => resetExecutionHooks());

describe("settings (ADR-080 Appendix B)", () => {
  it("defaults: no stock move, no scan, lot confirm by last 4, checker on marked lines, expiry from mixing", async () => {
    expect(await getSetting(db, w.orgId, "production.prepare.move_stock")).toBe(false);
    expect(await getSetting(db, w.orgId, "production.prepare.scan_lots")).toBe(false);
    expect(await getSetting(db, w.orgId, "production.weighing.lot_confirm")).toBe("last4");
    expect(await getSetting(db, w.orgId, "production.weighing.second_person_check")).toBe("marked");
    expect(await getSetting(db, w.orgId, "production.output.expiry_basis")).toBe("mixing_date");
  });

  it("a stored boolean from before ADR-080 still reads: true → all, false → none", async () => {
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", true);
    expect(await getSetting(db, w.orgId, "production.weighing.second_person_check")).toBe("all");
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", false);
    expect(await getSetting(db, w.orgId, "production.weighing.second_person_check")).toBe("none");
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.weighing.second_person_check")));
  });
});

describe("Materials list (V2-3)", () => {
  it("lists every ingredient with how much and the set-aside lot and place; nothing taken yet", async () => {
    const v = await getMaterialsList(w.operator, batchId);
    expect(v.lines.length).toBeGreaterThanOrEqual(5);
    expect(v.progress).toMatchObject({ taken: 0, complete: false });
    expect(v.canTick).toBe(true);
    for (const l of v.lines) {
      expect(l.state).toBe("open");
      expect(l.lots.length).toBeGreaterThan(0);
      expect(l.lots[0].sectionLabel).toBeTruthy();
      expect(l.lots[0].usable).toBe(true);
    }
    // The storekeeper sees and may tick it too (inventory.movement.post).
    expect((await getMaterialsList(w.warehouse, batchId)).canTick).toBe(true);
  });

  it("refuses role escalation and cross-site access", async () => {
    await expectCode(getMaterialsList(w.sales, batchId), "forbidden");
    await expectCode(getMaterialsList(w.warehouseRvs, batchId), "not_found");
    const v = await getMaterialsList(w.operator, batchId);
    const first = v.lines[0].batchMaterialId;
    await expectCode(confirmPicked(w.sales, { batchId, lines: [{ batchMaterialId: first, action: "taken" }] }), "forbidden");
    await expectCode(confirmPicked(w.qa, { batchId, lines: [{ batchMaterialId: first, action: "taken" }] }), "forbidden");
    await expectCode(confirmPicked(operatorRvs, { batchId, lines: [{ batchMaterialId: first, action: "taken" }] }), "not_found");
    expect(await db.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batchId))).toHaveLength(0);
  });

  it("a tick records who took it, moves no stock, writes one audit event, and a repeat with the same key does nothing", async () => {
    const v = await getMaterialsList(w.operator, batchId);
    const line = v.lines[0];
    const k = key();
    const r1 = await confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken" }], idempotencyKey: k });
    const r2 = await confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken" }], idempotencyKey: k });
    expect(r2).toEqual(r1);
    expect(r1.progress.taken).toBe(1);
    expect(r1.status).toBe("planned");
    const rows = await db.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batchId));
    expect(rows).toHaveLength(1);
    expect(rows[0].lotId).toBe(line.lots[0].lotId);
    expect(rows[0].stagingId).toBeNull();
    expect(await auditOf(batchId, "production.pick_line.confirmed")).toHaveLength(1);
    expect(await movementsOf(batchId)).toHaveLength(0);
    // Ticking an already taken line again (new key) records nothing new.
    const r3 = await confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken" }], idempotencyKey: key() });
    expect(r3.changed).toBe(0);
  });

  it("a work-order batch cannot start before the list is complete", async () => {
    const e = await expectCode(startBatch(w.operator, batchId), "state");
    expect(e.message).toMatch(/Materials list/);
  });

  it("a tick can be withdrawn while the batch is not started (append-only: a new row)", async () => {
    const v = await getMaterialsList(w.operator, batchId);
    const line = v.lines[0];
    const r = await confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: line.batchMaterialId, action: "untaken" }], idempotencyKey: key() });
    expect(r.progress.taken).toBe(0);
    expect(await db.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batchId))).toHaveLength(2);
    expect(await auditOf(batchId, "production.pick_line.withdrawn")).toHaveLength(1);
  });

  it("a lot on QA hold is refused", async () => {
    const v = await getMaterialsList(w.operator, batchId);
    const line = v.lines[1];
    const lotId = line.lots[0].lotId;
    await db.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, lotId));
    try {
      const shown = (await getMaterialsList(w.operator, batchId)).lines[1];
      expect(shown.lots[0].usable).toBe(false);
      expect(shown.lots[0].problem).toBe("On QA hold");
      const e = await expectCode(confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken" }], idempotencyKey: key() }), "blocked_lot");
      expect(e.message).toMatch(/Use another lot/);
      // "All taken" is refused as a whole: nothing is recorded.
      await expectCode(confirmPicked(w.operator, { batchId, all: true, idempotencyKey: key() }), "blocked_lot");
      expect((await getMaterialsList(w.operator, batchId)).progress.taken).toBe(0);
    } finally {
      await db.update(inventoryLots).set({ qualityStatus: "released" }).where(eq(inventoryLots.id, lotId));
    }
  });

  it('"Not needed" needs a reason', async () => {
    const v = await getMaterialsList(w.operator, batchId);
    await expectCode(confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: v.lines[2].batchMaterialId, action: "not_needed", reason: "" }] }), "validation");
    const r = await confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: v.lines[2].batchMaterialId, action: "not_needed", reason: "Already in the mixing room" }], idempotencyKey: key() });
    expect(r.progress.notNeeded).toBe(1);
    expect(await auditOf(batchId, "production.pick_line.not_needed")).toHaveLength(1);
  });

  it('"All taken" completes the list: the batch is ready (materials_staged) without any stock movement', async () => {
    const r = await confirmPicked(w.warehouse, { batchId, all: true, idempotencyKey: key() });
    expect(r.progress.complete).toBe(true);
    expect(r.status).toBe("materials_staged");
    expect((await batchRow(batchId)).status).toBe("materials_staged");
    expect(await movementsOf(batchId)).toHaveLength(0);
    const changed = await auditOf(batchId, "production.batch.state_changed");
    expect(changed.map((a) => (a.after as { status: string }).status)).toContain("materials_staged");
    // One audit event per tick.
    const lines = (await getMaterialsList(w.operator, batchId)).lines.length;
    expect((await auditOf(batchId, "production.pick_line.confirmed")).length).toBe(1 + (lines - 1));
    // The list is closed now.
    await expectCode(confirmPicked(w.operator, { batchId, lines: [{ batchMaterialId: (await getMaterialsList(w.operator, batchId)).lines[0].batchMaterialId, action: "untaken" }] }), "state");
    const f = await getBatchFlowFacts(w.operator, db, batchId);
    expect(nextBatchScreen(f)).toMatchObject({ action: "start", label: "Start" });
  });
});

describe("Materials list with the site settings on (move stock, scan lots)", () => {
  let order2: string;
  let batch2: string;
  beforeAll(async () => {
    const r = await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() });
    order2 = r.workOrderId;
    batch2 = (await approveProductionOrder(w.manager, order2, { idempotencyKey: key() })).batches[0].batchId;
  });
  afterAll(async () => {
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), inArray(settings.key, ["production.prepare.move_stock", "production.prepare.scan_lots"])));
  });

  it("scan_lots: a tick needs the label of a set-aside lot", async () => {
    await setOrgSetting(w.orgId, "production.prepare.scan_lots", true);
    const v = await getMaterialsList(w.operator, batch2);
    const line = v.lines[0];
    await expectCode(confirmPicked(w.operator, { batchId: batch2, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken" }] }), "validation");
    const wrong = await expectCode(confirmPicked(w.operator, { batchId: batch2, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken", lotCode: `BC:LOT:${v.lines[1].lots[0].lotNumber}` }] }), "blocked_lot");
    expect(wrong.message).toMatch(/This label says/);
    const r = await confirmPicked(w.operator, { batchId: batch2, lines: [{ batchMaterialId: line.batchMaterialId, action: "taken", lotCode: `BC:LOT:${line.lots[0].lotNumber}` }], idempotencyKey: key() });
    expect(r.progress.taken).toBe(1);
    const [pick] = await db.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batch2));
    expect(pick.scannedLotCode).toBe(line.lots[0].lotNumber);
    // Undo so the move-stock test below ticks every line itself.
    await confirmPicked(w.operator, { batchId: batch2, lines: [{ batchMaterialId: line.batchMaterialId, action: "untaken" }], idempotencyKey: key() });
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.prepare.scan_lots")));
  });

  it("move_stock on: only the storekeeper may tick, and each tick posts the staging transfer as before", async () => {
    await setOrgSetting(w.orgId, "production.prepare.move_stock", true);
    // A planner may tick a list (production.batch.edit) but cannot post stock movements.
    await expectCode(confirmPicked(w.planner, { batchId: batch2, all: true }), "forbidden");
    expect((await getMaterialsList(w.planner, batch2)).canTick).toBe(false);
    const r = await confirmPicked(w.warehouse, { batchId: batch2, all: true, idempotencyKey: key() });
    expect(r.progress.complete).toBe(true);
    expect((await batchRow(batch2)).status).toBe("materials_staged");
    const moves = await movementsOf(batch2);
    expect(moves.length).toBeGreaterThanOrEqual(r.progress.lines);
    expect(moves.every((m) => m.movementType === "transfer")).toBe(true);
    const picks = await db.select().from(batchMaterialPicks).where(and(eq(batchMaterialPicks.batchId, batch2), eq(batchMaterialPicks.action, "taken")));
    expect(picks.filter((p) => p.stagingId).length).toBe(r.progress.lines);
    // The batch reservations of staging exist, so weighing follows the staged lots (current behaviour).
    expect(await db.select().from(stockReservations).where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, batch2), eq(stockReservations.status, "active")))).not.toHaveLength(0);
  });
});

describe("Start check and Weigh cards (V2-4)", () => {
  let lineIds: { id: string; code: string; lotId: string; lotNumber: string; locationId: string; target: string }[] = [];

  it("the Start check starts the batch (All OK answers every item yes)", async () => {
    const b = await batchRow(batchId);
    const clearance = snapshotOf(b).steps.sort((x, z) => x.stepNo - z.stepNo).find((s) => s.stepKind === "line_clearance")!;
    await signChecklist(w.operator, checker, batchId, clearance);
    expect((await batchRow(batchId)).status).toBe("in_process");
    const f = await getBatchFlowFacts(w.operator, db, batchId);
    expect(nextBatchScreen(f)).toMatchObject({ action: "weigh", label: "Weigh" });
  });

  it("one card per ingredient with target, OK range and the set-aside lot preselected", async () => {
    const v = await getWeighView(w.operator, batchId);
    expect(v.blockedReason).toBeNull();
    expect(v.canWeigh).toBe(true);
    expect(v.settings).toMatchObject({ lotConfirm: "last4", checkMode: "marked" });
    expect(v.cards.length).toBeGreaterThanOrEqual(5);
    for (const c of v.cards) {
      expect(c.lots.length).toBeGreaterThan(0);
      expect(c.lots[0].last4).toHaveLength(4);
      expect(Number(c.min)).toBeLessThanOrEqual(Number(c.target));
    }
    lineIds = v.cards.map((c) => ({ id: c.batchMaterialId, code: c.materialCode, lotId: c.lots[0].lotId, lotNumber: c.lots[0].lotNumber, locationId: c.lots[0].locationId, target: c.target }));
    await expectCode(getWeighView(w.sales, batchId), "forbidden");
    await expectCode(getWeighView(operatorRvs, batchId), "not_found");
  });

  it("the preselected lot must be confirmed: missing or wrong last 4 / wrong label is refused", async () => {
    await cleanEquipment(w.operator, "SC-01");
    const l = lineIds[0];
    const base = { batchId, batchMaterialId: l.id, lotRef: l.lotId, locationRef: l.locationId, lotPreselected: true, qty: l.target, equipmentRef: "SC-01" };
    await expectCode(recordDispense(w.operator, base), "validation");
    const bad = await expectCode(recordDispense(w.operator, { ...base, lotConfirm: "ZZ99" }), "blocked_lot");
    expect(bad.message).toContain(l.lotNumber);
    const other = lineIds[1];
    const label = await expectCode(recordDispense(w.operator, { ...base, lotConfirm: `BC:LOT:${other.lotNumber}` }), "blocked_lot");
    expect(label.message).toMatch(new RegExp(`This label says ${other.lotNumber}`));
    expect(await db.select().from(batchMaterials).where(and(eq(batchMaterials.id, l.id), eq(batchMaterials.status, "pending")))).toHaveLength(1);
  });

  it("a lot that was not set aside for the order is refused with the expected lot", async () => {
    const l = lineIds[0];
    const b01 = await loc(w.nfd.id, "B-01");
    const extra = await makeLot(w.manager, w.nfd.id, b01.id, "9000", { materialCode: l.code });
    const e = await expectCode(recordDispense(w.operator, { batchId, batchMaterialId: l.id, lotRef: extra.id, qty: l.target, equipmentRef: "SC-01" }), "blocked_lot");
    expect(e.message).toContain(l.lotNumber);
  });

  it("the tolerance rule still applies", async () => {
    const l = lineIds[0];
    await expectCode(recordDispense(w.operator, { batchId, batchMaterialId: l.id, lotRef: l.lotId, locationRef: l.locationId, lotPreselected: true, lotConfirm: l.lotNumber.slice(-4), qty: "1", equipmentRef: "SC-01" }), "out_of_tolerance");
  });

  it("a confirmed weighing saves, uses up the order's set-aside quantity and waits for the second check (marked line)", async () => {
    const l = lineIds[0];
    const before = await db.select().from(stockReservations).where(and(eq(stockReservations.demandId, orderId), eq(stockReservations.lotId, l.lotId), eq(stockReservations.status, "active")));
    expect(before.length).toBeGreaterThan(0);
    const r = await recordDispense(w.operator, { batchId, batchMaterialId: l.id, lotRef: l.lotId, locationRef: l.locationId, lotPreselected: true, lotConfirm: l.lotNumber.slice(-4).toLowerCase(), qty: l.target, equipmentRef: "SC-01", idempotencyKey: key() });
    expect(r.status).toBe("dispensed");
    expect(r.checked).toBe(false);
    const converted = await db.select().from(stockReservations).where(and(eq(stockReservations.demandId, orderId), eq(stockReservations.lotId, l.lotId), eq(stockReservations.status, "converted")));
    expect(converted.length).toBeGreaterThan(0);
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.dispenseRecordId), eq(auditEvents.action, "production.dispense_record.recorded")));
    expect((au.after as { lotConfirmed: string }).lotConfirmed).toBe("last4");
    const v = await getWeighView(w.operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === l.id)!;
    expect(card.done).toBe(true);
    expect(card.needsCheck).toBe(true);
    expect(card.waitingForCheck).toHaveLength(1);
    expect(v.checkers.map((c) => c.id)).not.toContain(w.operator.userId);
  });

  it("the checker confirms on the operator's device (name pick); the operator cannot check their own weighing", async () => {
    const v = await getWeighView(w.operator, batchId);
    const waiting = v.cards.flatMap((c) => c.waitingForCheck)[0];
    await expectCode(checkDispense(w.operator, { dispenseRecordId: waiting.id }), "separation_of_duties");
    await expectCode(checkDispense(w.sales, { dispenseRecordId: waiting.id }), "forbidden");
    const k = key();
    await checkDispense(checker, { dispenseRecordId: waiting.id, signedOn: "operator_device", idempotencyKey: k });
    await checkDispense(checker, { dispenseRecordId: waiting.id, signedOn: "operator_device", idempotencyKey: k });
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, waiting.id), eq(auditEvents.action, "production.dispense_record.checked")));
    expect((au.after as { signedOn: string }).signedOn).toBe("operator_device");
    expect((await getWeighView(w.operator, batchId)).uncheckedCount).toBe(0);
  });

  it('"Not needed" on the materials list never skips the weighing: the weighing step stays open', async () => {
    const b = await batchRow(batchId);
    const weighStep = snapshotOf(b).steps.find((s) => s.stepKind === "dispensing")!;
    const notNeeded = (await getMaterialsList(w.operator, batchId)).lines.find((l) => l.state === "not_needed")!;
    expect(notNeeded.weighingOpen).toBe(true);
    expect((await getWeighView(w.operator, batchId)).cards.find((c) => c.batchMaterialId === notNeeded.batchMaterialId)?.done).toBe(false);
    const e = await expectCode(completeStep(w.operator, { batchId, stepNo: weighStep.stepNo }, { checker }), "state");
    expect(e.message).toMatch(/still need to be weighed/);
    expect(e.message).toContain(notNeeded.materialName);
  });
});

describe("second-person check mode all | marked | none (frozen per line)", () => {
  const STEPS: FixtureStep[] = [
    { name: "Start check", kind: "line_clearance", area: "weighing", requiresChecker: false, checklist: [{ text: "Area clean" }] },
    { name: "Weigh", kind: "dispensing", requiresChecker: false },
    { name: "Finish", kind: "transfer" },
  ];
  let f: Awaited<ReturnType<typeof makeExecutionFixture>>;
  const kit = () => ({ orgId: w.orgId, nfd: w.nfd, rvs: w.rvs });
  const newBatch = async () => (await createBatch(w.manager, { formulaRevisionId: f.formulaRevisionId, plannedSizeKg: "1.5", plannedStartOn: manilaDay(0) })).batchId;
  const checks = async (id: string) => (snapshotOf(await batchRow(id)).lines.sort((a, z) => a.lineNo - z.lineNo)).map((l) => l.requiresChecker);

  beforeAll(async () => {
    await allowDirectBatches(kit());
    f = await makeExecutionFixture(kit(), STEPS, { lineChecker: [true, false] });
  });

  it("marked (default) follows the formula line flag; all checks every line; none checks no line", async () => {
    expect(await checks(await newBatch())).toEqual([true, false]);
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", "all");
    expect(await checks(await newBatch())).toEqual([true, true]);
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", "none");
    expect(await checks(await newBatch())).toEqual([false, false]);
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.weighing.second_person_check")));
  });

  it("with marked, the marked line blocks the weighing step until checked; the unmarked line does not", async () => {
    const id = await newBatch();
    await startBatch(w.operator, id);
    const s = snapshotOf(await batchRow(id)).steps.sort((a, z) => a.stepNo - z.stepNo);
    await submitChecklist(w.operator, { batchId: id, stepNo: 1, answers: s[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) });
    const ls = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, id)).orderBy(batchMaterials.lineNo);
    const b01 = (await loc(w.nfd.id, "B-01")).id;
    const coconut = await makeLot(w.manager, w.nfd.id, b01, "2000", { materialCode: "MAT-0012" });
    const palm = await makeLot(w.manager, w.nfd.id, b01, "2000", { materialCode: "MAT-0013" });
    await recordDispense(w.operator, { batchId: id, batchMaterialId: ls[1].id, lotRef: palm.id, lotPreselected: true, lotConfirm: palm.lotNumber.slice(-4), qty: "500" });
    const marked = await recordDispense(w.operator, { batchId: id, batchMaterialId: ls[0].id, lotRef: coconut.id, lotPreselected: true, lotConfirm: coconut.lotNumber.slice(-4), qty: "1000" });
    const e = await expectCode(completeStep(w.operator, { batchId: id, stepNo: 2 }), "state");
    expect(e.message).toMatch(/1 weighing\(s\) still need the checker/);
    await checkDispense(checker, { dispenseRecordId: marked.dispenseRecordId, signedOn: "operator_device" });
    const r = await completeStep(w.operator, { batchId: id, stepNo: 2, idempotencyKey: key() });
    expect(r.status).toBe("completed");
  });
});

describe("Step card and curing (V2-5)", () => {
  const STEPS: FixtureStep[] = [
    { name: "Start check", kind: "line_clearance", area: "weighing", requiresChecker: false, checklist: [{ text: "Area clean" }, { text: "Gloves, goggles, mask on" }] },
    { name: "Weigh", kind: "dispensing", requiresChecker: false },
    {
      name: "Mix and pour",
      kind: "process",
      requiresChecker: false,
      parameters: [
        { code: "oil_temp", name: "Oil temperature", valueKind: "numeric", uom: "°C", min: "40", target: "45", max: "50" },
        { code: "trace", name: "Trace reached", valueKind: "boolean" },
      ],
    },
    { name: "Set in mould", kind: "curing", minDurationMinutes: 24 * 60, requiresChecker: false },
    { name: "Cut", kind: "cutting", requiresChecker: false, parameters: [{ code: "units_cut", name: "Bars cut", valueKind: "numeric", uom: "pcs", min: "1" }] },
    { name: "Finish", kind: "transfer" },
  ];
  let f: Awaited<ReturnType<typeof makeExecutionFixture>>;
  let id: string;
  let opened: string[] = [];
  const kit = () => ({ orgId: w.orgId, nfd: w.nfd, rvs: w.rvs });

  beforeAll(async () => {
    await allowDirectBatches(kit());
    f = await makeExecutionFixture(kit(), STEPS, { lineChecker: [false, false] });
    opened = [];
    registerExecutionHooks({
      openDeviation: async (_tx, _ctx, d) => {
        opened.push(d.kind);
        return { deviationId: uuidv7() };
      },
    });
    id = (await createBatch(w.manager, { formulaRevisionId: f.formulaRevisionId, plannedSizeKg: "1.5", plannedStartOn: manilaDay(0) })).batchId;
    await startBatch(w.operator, id);
  });

  it("the Start check card lists the checks; All OK answers every one and starts the batch", async () => {
    const card = await getStepCard(w.operator, id, 1);
    expect(card.step.isCheck).toBe(true);
    expect(card.step.checklist).toHaveLength(2);
    expect(card.canPerform).toBe(true);
    await expectCode(getStepCard(w.sales, id, 1), "forbidden");
    await expectCode(getStepCard(operatorRvs, id, 1), "not_found");
    await submitChecklist(w.operator, { batchId: id, stepNo: 1, answers: card.step.checklist.map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: key() });
    expect((await batchRow(id)).status).toBe("in_process");
  });

  it("Weigh, then Step done on the weighing step", async () => {
    const ls = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, id)).orderBy(batchMaterials.lineNo);
    const b01 = (await loc(w.nfd.id, "B-01")).id;
    const coconut = await makeLot(w.manager, w.nfd.id, b01, "2000", { materialCode: "MAT-0012" });
    const palm = await makeLot(w.manager, w.nfd.id, b01, "2000", { materialCode: "MAT-0013" });
    await recordDispense(w.operator, { batchId: id, batchMaterialId: ls[0].id, lotRef: coconut.id, lotPreselected: true, lotConfirm: coconut.lotNumber.slice(-4), qty: "1000" });
    await recordDispense(w.operator, { batchId: id, batchMaterialId: ls[1].id, lotRef: palm.id, lotPreselected: true, lotConfirm: palm.lotNumber.slice(-4), qty: "500" });
    const r = await stepDone(w.operator, { batchId: id, stepNo: 2, idempotencyKey: key() });
    expect(r).toMatchObject({ status: "completed", blocked: false });
  });

  it("a step card shows at most 3 fields with their own names; Step done refuses a role without the step permission", async () => {
    const card = await getStepCard(w.operator, id, 3);
    expect(card.step.fields.map((p) => p.name)).toEqual(["Oil temperature", "Trace reached"]);
    expect(card.blockedReason).toBeNull();
    await expectCode(stepDone(w.sales, { batchId: id, stepNo: 3, readings: [] }), "forbidden");
    await expectCode(stepDone(operatorRvs, { batchId: id, stepNo: 3, readings: [] }), "not_found");
    // A later step cannot be done first.
    const e = await expectCode(stepDone(w.operator, { batchId: id, stepNo: 5, readings: [{ parameterId: (await getStepCard(w.operator, id, 5)).step.fields[0].id, value: "12" }] }), "state");
    expect(e.message).toMatch(/first/);
  });

  it("a value outside its range is kept and the step stays open; a changed value needs a reason; then the step completes and the wait starts by itself", async () => {
    const card = await getStepCard(w.operator, id, 3);
    const [temp, trace] = card.step.fields;
    const k = key();
    const r1 = await stepDone(w.operator, { batchId: id, stepNo: 3, readings: [{ parameterId: temp.id, value: "60" }, { parameterId: trace.id, value: "yes" }], idempotencyKey: k });
    expect(r1.blocked).toBe(true);
    expect(r1.blockers.some((b) => b.exceptionable)).toBe(true);
    expect(await stepDone(w.operator, { batchId: id, stepNo: 3, readings: [{ parameterId: temp.id, value: "60" }, { parameterId: trace.id, value: "yes" }], idempotencyKey: k })).toEqual(r1);
    const kept = (await getStepCard(w.operator, id, 3)).step.fields[0].reading;
    expect(kept?.value).toBe("60");
    await expectCode(stepDone(w.operator, { batchId: id, stepNo: 3, readings: [{ parameterId: temp.id, value: "45" }] }), "validation");
    const r2 = await stepDone(w.operator, { batchId: id, stepNo: 3, readings: [{ parameterId: temp.id, value: "45", correctionReason: "Read the wrong thermometer" }, { parameterId: trace.id, value: "yes" }], idempotencyKey: key() });
    expect(r2.status).toBe("completed");
    expect(r2.next).toMatchObject({ stepNo: 4, kind: "curing" });
    expect(r2.next?.readyAt).toBeTruthy();
    const ready = new Date(r2.next!.readyAt!);
    expect(Math.round((ready.getTime() - Date.now()) / 3_600_000)).toBe(24);
  });

  it("the batch exposes the current step and ready date; the next screen is the disabled Mould time finished", async () => {
    const facts = (await batchFlowFacts(db, [id])).get(id)!;
    expect(facts.currentStep).toMatchObject({ stepNo: 4, kind: "curing", status: "in_progress", waiting: true, index: 4, total: 6 });
    expect(facts.readyAt).toBeInstanceOf(Date);
    expect(facts.currentStep!.waitingLabel).toMatch(/^In the mould until [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
    const next = nextBatchScreen(facts);
    expect(next.action).toBe("wait");
    expect(next.disabledReason).toMatch(/^Ready on .* Ending early needs approval\.$/);
    const card = await getStepCard(w.operator, id, 4);
    expect(card.step.waiting).toBe(true);
    expect(card.step.daysLeft).toBe(1);
  });

  it("ending the wait early is refused without approval; with an approver and a reason it completes", async () => {
    const r = await stepDone(w.operator, { batchId: id, stepNo: 4, idempotencyKey: key() });
    expect(r.blocked).toBe(true);
    expect(r.blockers[0].message).toMatch(/minimum hold time/);
    await expectCode(approveStepException(w.operator, { batchId: id, stepNo: 4, reason: "Bars are hard enough to cut" }, { approver: checker }), "forbidden");
    await expectCode(approveStepException(w.operator, { batchId: id, stepNo: 4, reason: "short" }, { approver: w.qa }), "validation");
    await approveStepException(w.operator, { batchId: id, stepNo: 4, reason: "Bars are hard enough to cut (owner checked)" }, { approver: w.qa });
    expect(opened).toContain("out_of_tolerance");
    const done = await stepDone(w.operator, { batchId: id, stepNo: 4, idempotencyKey: key() });
    expect(done.status).toBe("completed");
    const facts = (await batchFlowFacts(db, [id])).get(id)!;
    expect(facts.currentStep).toMatchObject({ stepNo: 5, name: "Cut", waiting: false });
    expect(nextBatchScreen(facts)).toMatchObject({ action: "step", label: "Cut" });
  });

  it("the reminder job notifies once per finished wait (idempotent across runs)", async () => {
    const other = (await createBatch(w.manager, { formulaRevisionId: f.formulaRevisionId, plannedSizeKg: "1.5", plannedStartOn: manilaDay(0) })).batchId;
    await startBatch(w.operator, other);
    // Fixture shortcut: the step record of a started wait whose ready date has passed.
    const snap = snapshotOf(await batchRow(other));
    const cure = snap.steps.find((s) => s.stepKind === "curing")!;
    await db.update(batches).set({ status: "in_process" }).where(eq(batches.id, other));
    await db.insert(processStepRecords).values({ batchId: other, routingStepId: cure.routingStepId, stepNo: cure.stepNo, name: cure.name, stepKind: "curing", status: "in_progress", conductedBy: w.operator.userId, startedAt: new Date(Date.now() - 2 * 86_400_000), earliestCompletionAt: new Date(Date.now() - 3_600_000) });
    const first = await remindCuringReady({ asOf: new Date(), ctx: { organizationId: w.orgId } });
    expect(first.notified).toBeGreaterThan(0);
    const again = await remindCuringReady({ asOf: new Date(), ctx: { organizationId: w.orgId } });
    expect(again.notified).toBe(0);
    const rows = await db.select().from(notifications).where(and(eq(notifications.kind, "production.curing.ready"), eq(notifications.entityId, other)));
    expect(rows.length).toBe(first.notified);
    expect(rows[0].title).toMatch(/mould time finished on/);
    expect(new Set(rows.map((r) => r.recipientUserId)).size).toBe(rows.length);
    // The waiting batch of the earlier test (completed) is not reminded.
    expect(await db.select().from(notifications).where(and(eq(notifications.kind, "production.curing.ready"), eq(notifications.entityId, id)))).toHaveLength(0);
  });
});

describe("expiry from the mixing date (ADR-080 §7)", () => {
  const snapshot = {
    steps: [
      { stepNo: 1, stepKind: "line_clearance" },
      { stepNo: 2, stepKind: "dispensing" },
      { stepNo: 3, stepKind: "process" },
      { stepNo: 4, stepKind: "curing" },
      { stepNo: 5, stepKind: "packaging" },
    ],
  } as unknown as FormulaSnapshot;
  const batch = { startedAt: new Date("2026-10-31T23:30:00Z"), formulaSnapshot: snapshot }; // 1 Nov in Manila
  const recs = [
    { stepNo: 1, startedAt: new Date("2026-10-31T23:30:00Z"), completedAt: new Date("2026-10-31T23:40:00Z") },
    { stepNo: 3, startedAt: new Date("2026-11-03T02:00:00Z"), completedAt: new Date("2026-11-03T03:00:00Z") },
    { stepNo: 5, startedAt: new Date("2026-12-04T02:00:00Z"), completedAt: new Date("2026-12-04T05:00:00Z") },
  ];

  it("mixing_date counts from the day Mix and pour started, and that is the manufacture date", () => {
    expect(batchExpiryDates(batch, snapshot.steps, recs, "mixing_date", 730)).toMatchObject({ manufacturedOn: "2026-11-03", expiresOn: "2028-11-02" });
  });
  it("existing organizations keep the batch start (manufacture_date) or the packaging date", () => {
    expect(batchExpiryDates(batch, snapshot.steps, recs, "manufacture_date", 730)).toMatchObject({ manufacturedOn: "2026-11-01", expiresOn: "2028-10-31" });
    expect(batchExpiryDates(batch, snapshot.steps, recs, "packaging_date", 730)).toMatchObject({ manufacturedOn: "2026-11-01", expiresOn: "2028-12-03" });
  });
  it("words: Resting until a time on the same day, Curing until a day", () => {
    const now = new Date("2026-11-03T01:00:00Z");
    expect(waitLabel("hold", "Rest", new Date("2026-11-03T06:00:00Z"), now)).toBe("Resting until 14:00");
    expect(waitLabel("curing", "Cure", new Date("2026-11-28T06:00:00Z"), now)).toBe("Curing until Sat 28 Nov");
  });
});

describe("G2 custom SQL (src/db/sql/g2.sql)", () => {
  const statements = readFileSync(path.resolve(__dirname, "../../../src/db/sql/g2.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim());
  const run = async () => {
    for (const s of statements) await db.execute(sql.raw(s));
  };

  it("rewrites stored booleans (true → all, or marked when a formula line is unmarked; false → none), stores the old defaults for existing organizations, and is idempotent", async () => {
    const orgs = await db.execute<{ id: string }>(sql`select id from organizations order by created_at`);
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", true);
    await db.delete(settings).where(eq(settings.key, "production.output.expiry_basis"));
    await run();
    await run();
    const rows = await db.select().from(settings).where(inArray(settings.key, ["production.weighing.second_person_check", "production.output.expiry_basis"]));
    const mine = rows.filter((r) => r.organizationId === w.orgId);
    // The demo org now has unmarked formula lines (fixtures above), so true keeps meaning "line flag" = marked.
    expect(mine.find((r) => r.key === "production.weighing.second_person_check")?.value).toBe("marked");
    expect(mine.find((r) => r.key === "production.output.expiry_basis")?.value).toBe("manufacture_date");
    for (const o of orgs) expect(rows.filter((r) => r.organizationId === o.id && r.key === "production.output.expiry_basis")).toHaveLength(1);
    await setOrgSetting(w.orgId, "production.weighing.second_person_check", false);
    await run();
    expect((await getSetting(db, w.orgId, "production.weighing.second_person_check"))).toBe("none");
  });

  it("materials list ticks are append-only", async () => {
    const [row] = await db.select().from(batchMaterialPicks).limit(1);
    const why = (p: Promise<unknown>) => p.then(() => "no error", (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ""}`);
    expect(await why(db.update(batchMaterialPicks).set({ reason: "edited" }).where(eq(batchMaterialPicks.id, row.id)))).toMatch(/append-only/);
    expect(await why(db.delete(batchMaterialPicks).where(eq(batchMaterialPicks.id, row.id)))).toMatch(/append-only/);
  });
});

describe("G2 custom migration", () => {
  it("the migration matches src/db/sql/g2.sql", async () => {
    const { customMigration } = await import("../../support/custom-sql");
    const { migration, canonical } = customMigration("g2");
    expect(migration.trim()).toBe(canonical.trim());
  });
});

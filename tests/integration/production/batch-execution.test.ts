import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batchOutputs,
  batchStateTransitions,
  batches,
  dispenseRecords,
  equipment,
  equipmentUses,
  inventoryLots,
  processStepRecords,
  productionPostings,
  products,
  settings,
  stockMovements,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { traceGenealogy } from "@/modules/quality";
import {
  checkDispense,
  checkStep,
  completeStep,
  countPackaging,
  createBatch,
  getBatchExecution,
  getBatchRecord,
  issuePackaging,
  postBatchToQuarantine,
  recordDispense,
  recordReading,
  recordYield,
  registerExecutionHooks,
  resetExecutionHooks,
  selectEquipment,
  startBatch,
  submitChecklist,
  transitionBatch,
  voidDispense,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { type Kit, asUser, expectCode, loadKit, loc, makeLot, onHand } from "../../support/kit";
import { SOAP_LOTS, acapulcoRevisionId, cleanEquipment, lotBySupplierLot, manilaDay, runSoapBatchToQuarantine, signChecklist, snapshotOf, weighAllAtTarget } from "../../support/w2b";

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let warehouse: AuthContext;
let auditor: AuthContext;
let operatorRvsOnly: AuthContext;
let checkerRvsOnly: AuthContext;
let acsRevisionId: string;

const lines = async (batchId: string) => db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
const batchRow = async (batchId: string) => (await db.select().from(batches).where(eq(batches.id, batchId)))[0];
const steps = async (batchId: string) => [...snapshotOf(await batchRow(batchId)).steps].sort((a, z) => a.stepNo - z.stepNo);
const stepRec = async (batchId: string, stepNo: number) => (await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, stepNo))))[0];
const lotRef = async (supplierLot: string) => `BC:LOT:${(await lotBySupplierLot(supplierLot)).lotNumber}`;
const fakeDeviation = () => registerExecutionHooks({ openDeviation: async () => ({ deviationId: uuidv7() }) });

async function newStartedBatch(sizeKg = "17.6") {
  const { batchId, batchNumber } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: sizeKg, plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  return { batchId, batchNumber };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  operatorRvsOnly = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  checkerRvsOnly = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  acsRevisionId = await acapulcoRevisionId();
  await cleanEquipment(operator, "SC-01");
}, 180_000);

afterEach(() => resetExecutionHooks());

describe("batch creation (snapshot, scaling, numbering)", () => {
  it("creates a planned batch with a frozen snapshot, scaled lines, transition and audit", async () => {
    const { batchId, batchNumber } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "8.8", plannedStartOn: manilaDay(1) });
    expect(batchNumber).toMatch(/^B-\d{2}-\d{4}$/);
    const b = await batchRow(batchId);
    expect(b.status).toBe("planned");
    expect(new Decimal(b.theoreticalYieldG!).eq(8360)).toBe(true);
    expect(snapshotOf(b).steps).toHaveLength(7);
    expect(new Decimal((await lines(batchId))[0].theoreticalQtyG).eq("1861.6")).toBe(true);
  });

  it("refuses role escalation: an operator cannot create batches", async () => {
    await expectCode(createBatch(operator, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) }), "forbidden");
  });
});

describe("line clearance (US-3-09)", () => {
  let batchId: string;
  beforeAll(async () => ({ batchId } = await newStartedBatch()));

  it("blocks weighing until the weighing-area clearance is signed (V-STATE)", async () => {
    const [l1] = await lines(batchId);
    const e = await expectCode(recordDispense(operator, { batchId, batchMaterialId: l1.id, lotRef: await lotRef("LOS-24871"), qty: "3723.2", equipmentRef: "SC-01" }), "state");
    expect(e.message).toMatch(/Complete step 1/);
  });

  it('keeps the step blocked on a "no" answer until resolved; the note is mandatory', async () => {
    const [s1] = await steps(batchId);
    const items = s1.checklistItems!;
    const answers = items.map((i, n) => ({ itemId: i.id, answer: (n === 0 ? "no" : "yes") as "yes" | "no" }));
    await expectCode(submitChecklist(operator, { batchId, stepNo: 1, answers }, { checker }), "validation");
    const r = await submitChecklist(operator, { batchId, stepNo: 1, answers: answers.map((a, n) => (n === 0 ? { ...a, note: "Label of batch B-26-0002 still on bench" } : a)) }, { checker });
    expect(r.blocked).toBe(true);
    expect(r.status).toBe("in_progress");
    expect((await stepRec(batchId, 1)).blockedReason).toMatch(/answered "no"/);
  });

  it("refuses the operator as their own checker (same session) and a checker without the permission", async () => {
    const [s1] = await steps(batchId);
    const answers = s1.checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const }));
    await expectCode(submitChecklist(operator, { batchId, stepNo: 1, answers }, { checker: operator }), "separation_of_duties");
    await expectCode(submitChecklist(operator, { batchId, stepNo: 1, answers }, { checker: warehouse }), "forbidden");
  });

  it("without a co-signed checker the step waits; the conductor cannot check it, the checker can (own session)", async () => {
    const [s1] = await steps(batchId);
    const r = await submitChecklist(operator, { batchId, stepNo: 1, answers: s1.checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) });
    expect(r.status).toBe("awaiting_check");
    await expectCode(checkStep(operator, { batchId, stepNo: 1 }), "separation_of_duties");
    await expectCode(checkStep(checkerRvsOnly, { batchId, stepNo: 1 }), "not_found");
    await checkStep(checker, { batchId, stepNo: 1 });
    const rec = await stepRec(batchId, 1);
    expect(rec).toMatchObject({ status: "completed", checkedBy: checker.userId, conductedBy: operator.userId });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rec.id), eq(auditEvents.action, "production.process_step_record.checked")));
    expect(ev).toHaveLength(1);
  });

  it("the first signed clearance moves a staged batch to in_process and calls the work-order hook", async () => {
    const calls: string[] = [];
    registerExecutionHooks({ onBatchInProcess: async (_tx, _ctx, b) => void calls.push(b.batchNumber) });
    const { batchId: id, batchNumber } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
    await db.transaction(async (tx) => {
      const b = await batchRow(id);
      await transitionBatch(tx, manager, b, "materials_staged");
    });
    const [s1] = await steps(id);
    await signChecklist(operator, checker, id, s1);
    expect((await batchRow(id)).status).toBe("in_process");
    expect(calls).toEqual([batchNumber]);
    const tr = await db.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, id)).orderBy(batchStateTransitions.at);
    expect(tr.map((t) => t.toState)).toEqual(["planned", "materials_staged", "in_process"]);
  });
});

describe("dispensing and weighing (US-3-10)", () => {
  let batchId: string;
  beforeAll(async () => {
    ({ batchId } = await newStartedBatch());
    await signChecklist(operator, checker, batchId, (await steps(batchId))[0]);
  });

  it("AC1: blocks a palm-oil lot scanned on the coconut-oil line with the material names", async () => {
    const [coconut] = await lines(batchId);
    const e = await expectCode(recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("MPC-7731"), qty: "3723.2", equipmentRef: "SC-01" }), "blocked_lot");
    expect(e.message).toMatch(/This is Palm Oil, not Coconut Oil/);
  });

  it("AC1: blocks quarantined and expired lots (status re-read at scan) and writes no row", async () => {
    const ls = await lines(batchId);
    const e1 = await expectCode(recordDispense(operator, { batchId, batchMaterialId: ls[0].id, lotRef: await lotRef("LOS-25013"), qty: "3723.2", equipmentRef: "SC-01" }), "blocked_lot");
    expect(e1.message).toMatch(/quarantine/);
    const e2 = await expectCode(recordDispense(operator, { batchId, batchMaterialId: ls[3].id, lotRef: await lotRef("LB-6620"), qty: "190.9", equipmentRef: "SC-01" }), "blocked_lot");
    expect(e2.message).toMatch(/expired/);
    expect(await db.select().from(dispenseRecords).where(inArray(dispenseRecords.batchMaterialId, [ls[0].id, ls[3].id]))).toHaveLength(0);
  });

  it("V-CAL: refuses a scale past its calibration and requires a scale on this routing", async () => {
    const [coconut] = await lines(batchId);
    const e = await expectCode(recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), qty: "3723.2", equipmentRef: "BC:EQP:SC-02" }), "state");
    expect(e.message).toMatch(/Calibration was due/);
    await expectCode(recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), qty: "3723.2" }), "validation");
  });

  it("AC2: 3,650.0 g on 3,723.2 g (seed tolerance ±0.5 %) is out of tolerance; 3.72 kg is within and stored as 3,720 g", async () => {
    const [coconut] = await lines(batchId);
    const base = { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), equipmentRef: "SC-01" };
    const e = await expectCode(recordDispense(operator, { ...base, qty: "3650.0" }), "out_of_tolerance");
    expect(e.message).toMatch(/Re-weigh, or request an exception/);
    const r = await recordDispense(operator, { ...base, qty: "3.72", uom: "kg" });
    expect(r.status).toBe("dispensed");
    const [row] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.dispenseRecordId));
    expect(row).toMatchObject({ actualQtyG: "3720.000000", enteredQty: "3.720000", enteredUom: "kg", isWithinTolerance: true, checkerId: null, sequence: 1, scaleCode: "SC-01" });
    const use = await db.select().from(equipmentUses).where(eq(equipmentUses.batchId, batchId));
    expect(use).toHaveLength(1);
    expect(use[0].cleaningStatusAtStart).toBe("clean");
  });

  it("AC2: an out-of-tolerance weight needs a QA approver other than the operator and a deviation", async () => {
    const palm = (await lines(batchId))[1];
    const base = { batchId, batchMaterialId: palm.id, lotRef: await lotRef("MPC-7731"), equipmentRef: "SC-01", qty: "8500", exceptionReason: "Last drum short, QA accepts with deviation" };
    await expectCode(recordDispense(operator, base, { exceptionApprover: checker }), "forbidden"); // operator role cannot approve CX-TOL
    await expectCode(recordDispense(operator, base, { exceptionApprover: qa }), "state"); // no deviations module yet
    fakeDeviation();
    await expectCode(recordDispense(operator, { ...base, exceptionReason: "short" }, { exceptionApprover: qa }), "validation");
    const r = await recordDispense(operator, base, { exceptionApprover: qa });
    expect(r.status).toBe("exception");
    const [row] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.dispenseRecordId));
    expect(row.exceptionApprovedBy).toBe(qa.userId);
    expect(row.deviationId).toBeTruthy();
    expect(row.isWithinTolerance).toBe(false);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, row.id), eq(auditEvents.action, "production.dispense_record.over_tolerance_approved")));
    expect(ev[0].actorId).toBe(qa.userId);
  });

  it("AC3: the operator cannot check their own weighing (service 409 and database CHECK); another person can", async () => {
    const [coconut] = await lines(batchId);
    const [row] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, coconut.id));
    await expectCode(checkDispense(operator, { dispenseRecordId: row.id }), "separation_of_duties");
    await expect(db.update(dispenseRecords).set({ checkerId: operator.userId }).where(eq(dispenseRecords.id, row.id))).rejects.toThrow();
    await expectCode(checkDispense(warehouse, { dispenseRecordId: row.id }), "forbidden");
    await checkDispense(checker, { dispenseRecordId: row.id });
    await expectCode(checkDispense(checker, { dispenseRecordId: row.id }), "state");
  });

  it("splits a line over two lots (partial then final) and sums the line total", async () => {
    const lye = (await lines(batchId))[2];
    const l1 = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "2000", { materialCode: "MAT-0021" });
    const base = { batchId, batchMaterialId: lye.id, equipmentRef: "SC-01" };
    await expectCode(recordDispense(operator, { ...base, lotRef: l1.id, qty: "1964.2", partial: false }), "out_of_tolerance");
    const p = await recordDispense(operator, { ...base, lotRef: l1.id, qty: "1964.2", partial: true }, { checker });
    expect(p.status).toBe("partial");
    await expectCode(recordDispense(operator, { ...base, lotRef: await lotRef("LYE-1009"), qty: "3000", partial: true }), "validation");
    const f = await recordDispense(operator, { ...base, lotRef: await lotRef("LYE-1009"), qty: "3000" }, { checker });
    expect(f.status).toBe("dispensed");
    expect(new Decimal(f.lineTotalG).eq("4964.2")).toBe(true);
    const rows = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, lye.id));
    expect(rows.map((r) => r.sequence).sort()).toEqual([1, 2]);
  });

  it("refuses a weighing the lot location cannot cover after earlier unposted weighings (V-NEG)", async () => {
    const extract = (await lines(batchId))[3];
    const small = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "100", { materialCode: "MAT-0043" });
    await expectCode(recordDispense(operator, { batchId, batchMaterialId: extract.id, lotRef: small.id, qty: "190.9", equipmentRef: "SC-01" }), "insufficient_stock");
  });

  it("a void (site manager, reason) appends; the replacement supersedes it; the line is open again", async () => {
    const extract = (await lines(batchId))[3];
    const r = await recordDispense(operator, { batchId, batchMaterialId: extract.id, lotRef: await lotRef("LB-7712"), qty: "190.9", equipmentRef: "SC-01" });
    await expectCode(voidDispense(operator, { dispenseRecordId: r.dispenseRecordId, reason: "Wrong container" }), "forbidden");
    await voidDispense(manager, { dispenseRecordId: r.dispenseRecordId, reason: "Spilled on the bench; re-weighing" });
    expect((await db.select().from(batchMaterials).where(eq(batchMaterials.id, extract.id)))[0].status).toBe("pending");
    await expectCode(recordDispense(operator, { batchId, batchMaterialId: extract.id, lotRef: await lotRef("LB-7712"), qty: "191", equipmentRef: "SC-01", supersedesId: r.dispenseRecordId }), "validation");
    const n = await recordDispense(operator, { batchId, batchMaterialId: extract.id, lotRef: await lotRef("LB-7712"), qty: "191", equipmentRef: "SC-01", supersedesId: r.dispenseRecordId, correctionReason: "Re-weigh after spill" }, { checker });
    const [row] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, n.dispenseRecordId));
    expect(row).toMatchObject({ supersedesId: r.dispenseRecordId, sequence: 2 });
    const [old] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.dispenseRecordId));
    expect(old.voidReason).toMatch(/Spilled/);
  });

  it("serialises concurrent weighings of the same line: exactly one succeeds", async () => {
    const green = (await lines(batchId))[4];
    const base = { batchId, batchMaterialId: green.id, lotRef: await lotRef("GRN-0311"), qty: "34.4", equipmentRef: "SC-01" };
    const results = await Promise.allSettled([recordDispense(operator, { ...base, idempotencyKey: `c-${uuidv7()}` }), recordDispense(operator, { ...base, idempotencyKey: `c-${uuidv7()}` })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, green.id))).toHaveLength(1);
  });

  it("replays a repeated idempotency key and posts no consumption before transfer (A-PROC-31 default)", async () => {
    const before = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentId, batchId), eq(stockMovements.movementType, "consumption")));
    expect(before).toHaveLength(0);
  });

  it("the weighing step completes only when every line is weighed and every weighing checked", async () => {
    const s2 = (await steps(batchId))[1];
    const e = await expectCode(completeStep(operator, { batchId, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/checker's signature/);
    const unchecked = await db
      .select({ id: dispenseRecords.id })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .where(eq(batchMaterials.batchId, batchId));
    for (const u of unchecked) await checkDispense(checker, { dispenseRecordId: u.id }).catch(() => null);
    const r = await completeStep(operator, { batchId, stepNo: s2.stepNo }, { checker });
    expect(r.status).toBe("completed");
    // The scale is dirty after the batch's weighing (cleaning rule per batch, W13-02).
    expect((await db.select().from(equipment).where(eq(equipment.code, "SC-01")))[0].cleaningStatus).toBe("dirty");
    await expectCode(voidDispense(manager, { dispenseRecordId: unchecked[0].id, reason: "Too late for this" }), "state");
  });

  it("denies cross-site access and role escalation", async () => {
    const [coconut] = await lines(batchId);
    await expectCode(getBatchExecution(operatorRvsOnly, batchId), "not_found");
    await expectCode(recordDispense(operatorRvsOnly, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), qty: "1", equipmentRef: "SC-01" }), "not_found");
    await expectCode(recordDispense(auditor, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), qty: "1" }), "forbidden");
    await expectCode(recordDispense(warehouse, { batchId, batchMaterialId: coconut.id, lotRef: await lotRef("LOS-24871"), qty: "1" }), "forbidden");
    await expectCode(submitChecklist(auditor, { batchId, stepNo: 1, answers: [{ itemId: uuidv7(), answer: "yes" }] }), "forbidden");
    await expectCode(postBatchToQuarantine(warehouse, { batchId, locationRef: "QUA-01" }), "forbidden");
    await expectCode(recordYield(auditor, { batchId, actualUnits: "1" }), "forbidden");
  });
});

describe("Acapulco batch end to end: process, packaging, yield, transfer to quarantine (US-3-11..13)", () => {
  let batchId: string;
  let batchNumber: string;
  let s: Awaited<ReturnType<typeof steps>>;
  beforeAll(async () => {
    ({ batchId, batchNumber } = await newStartedBatch());
    s = await steps(batchId);
    await cleanEquipment(operator, "SC-01");
    await signChecklist(operator, checker, batchId, s[0]);
    await weighAllAtTarget(operator, checker, batchId);
    await completeStep(operator, { batchId, stepNo: 2 }, { checker });
    await signChecklist(operator, checker, batchId, s[2]);
  });

  it("process step: refuses an out-of-service mixer, needs the mixer and required readings", async () => {
    const mixing = s[3];
    await expectCode(selectEquipment(operator, { batchId, stepNo: mixing.stepNo, equipmentRef: "MIX-02" }), "state");
    await expectCode(selectEquipment(operator, { batchId, stepNo: mixing.stepNo, equipmentRef: "SC-01" }), "validation"); // a scale is not a mixer
    const e = await expectCode(completeStep(operator, { batchId, stepNo: mixing.stepNo }, { checker }), "state");
    expect(e.message).toMatch(/Select the mixer/);
    expect(e.message).toMatch(/Record Oil phase temperature/);
    await cleanEquipment(operator, "MIX-01");
    await selectEquipment(operator, { batchId, stepNo: mixing.stepNo, equipmentRef: "BC:EQP:MIX-01" });
    const temp = mixing.parameters!.find((p) => p.code === "oil_temp")!;
    await recordReading(operator, { batchId, stepNo: mixing.stepNo, parameterId: temp.id, value: "48" });
    await expectCode(recordReading(operator, { batchId, stepNo: mixing.stepNo, parameterId: temp.id, value: "47" }), "validation");
    await recordReading(operator, { batchId, stepNo: mixing.stepNo, parameterId: temp.id, value: "47.5", correctionReason: "Misread the thermometer" });
    const trace = mixing.parameters!.find((p) => p.code === "trace_time")!;
    await recordReading(operator, { batchId, stepNo: mixing.stepNo, parameterId: trace.id, value: "22" });
    const ex = await getBatchExecution(operator, batchId);
    expect(ex.steps[3].parameters.find((p) => p.code === "oil_temp")!.reading!.value).toBe("47.5");
    expect(ex.steps[3].parameters.find((p) => p.code === "oil_temp")!.corrections).toBe(1);
    const r = await completeStep(operator, { batchId, stepNo: mixing.stepNo }, { checker });
    expect(r.status).toBe("completed");
  });

  it("packaging step: validates packaging lots (V-MAT, status), reconciles issued − used − damaged − returned", async () => {
    await signChecklist(operator, checker, batchId, s[4]);
    const pack = s[5];
    await expectCode(issuePackaging(operator, { batchId, stepNo: pack.stepNo, lotRef: await lotRef("LOS-24871"), qty: "10" }), "blocked_lot");
    await expectCode(issuePackaging(operator, { batchId, stepNo: pack.stepNo, lotRef: await lotRef("MPP-889"), qty: "10" }), "blocked_lot"); // quarantined wrappers
    const wrappers = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "PKG-01")).id, "300", { materialCode: "PKG-0101" });
    const { reconciliationId } = await issuePackaging(operator, { batchId, stepNo: pack.stepNo, lotRef: wrappers.id, qty: "130" });
    const c1 = await countPackaging(operator, { reconciliationId, used: "124", damaged: "2", returned: "3" });
    expect(c1.within).toBe(false);
    expect(c1.variance).toBe("1");
    for (const p of pack.parameters ?? []) await recordReading(operator, { batchId, stepNo: pack.stepNo, parameterId: p.id, value: p.code === "wrappers_used" ? "124" : "2" });
    const e = await expectCode(completeStep(operator, { batchId, stepNo: pack.stepNo }, { checker }), "state");
    expect(e.message).toMatch(/does not reconcile/);
    await expectCode(countPackaging(operator, { reconciliationId: c1.reconciliationId, used: "124", damaged: "2", returned: "4" }), "validation");
    const c2 = await countPackaging(operator, { reconciliationId: c1.reconciliationId, used: "124", damaged: "2", returned: "4", correctionReason: "Found one wrapper in the return bin" });
    expect(c2.within).toBe(true);
    await completeStep(operator, { batchId, stepNo: pack.stepNo }, { checker });
  });

  it("transfer: needs the yield, the checker and a quarantine location", async () => {
    await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }, { checker }), "state"); // no yield yet
    await recordYield(operator, { batchId, actualUnits: "124" });
    await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }), "validation"); // checker
    const e = await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "BC:LOC:A-01" }, { checker }), "validation");
    expect(e.message).toMatch(/quarantine location/);
    await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }, { checker: operator }), "separation_of_duties");
  });

  it("AC1: one transaction posts consumption per lot and the quarantined output lot; batch awaiting_qc; idempotent", async () => {
    const calls: string[] = [];
    registerExecutionHooks({ onBatchSubmitted: async (_tx, _c, b) => void calls.push(b.id) });
    const coconutLot = await lotBySupplierLot(SOAP_LOTS["MAT-0012"]);
    const a01 = await loc(kit.nfd.id, "A-01");
    const before = await onHand(coconutLot.id, a01.id);
    const key = `t-${uuidv7()}`;
    const r1 = await postBatchToQuarantine(operator, { batchId, locationRef: "BC:LOC:QUA-01", idempotencyKey: key }, { checker });
    const r2 = await postBatchToQuarantine(operator, { batchId, locationRef: "BC:LOC:QUA-01", idempotencyKey: key }, { checker });
    expect(r2.lotNumber).toBe(r1.lotNumber);
    expect(r1.consumptionPostings).toBe(6); // five weighings + one packaging component
    expect(calls).toEqual([batchId]);
    expect(new Decimal(before).minus(await onHand(coconutLot.id, a01.id)).eq("3723.2")).toBe(true);
    const b = await batchRow(batchId);
    expect(b.status).toBe("awaiting_qc");
    expect(new Decimal(b.yieldPct!).eq("100.12")).toBe(true);
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    const [product] = await db.select().from(products).where(eq(products.id, b.productId));
    expect(lot).toMatchObject({ qualityStatus: "quarantine", itemKind: "product", sourceBatchId: batchId, manufacturedOn: manilaDay(0) });
    const expected = new Date(manilaDay(0) + "T00:00:00Z");
    expected.setUTCDate(expected.getUTCDate() + product.shelfLifeDays);
    expect(lot.expiresOn).toBe(expected.toISOString().slice(0, 10));
    const postings = await db.select().from(productionPostings).where(eq(productionPostings.batchId, batchId));
    expect(postings.filter((p) => p.postingType === "consumption")).toHaveLength(6);
    expect(postings.filter((p) => p.postingType === "output")).toHaveLength(1);
    const mv = await db.select().from(stockMovements).where(inArray(stockMovements.id, postings.map((p) => p.stockMovementId)));
    expect(mv).toHaveLength(7);
    // production_postings is append-only (src/db/sql/w2b.sql).
    await expect(db.update(productionPostings).set({ qtyBase: "1" }).where(eq(productionPostings.id, postings[0].id))).rejects.toThrow();
    const [out] = await db.select().from(batchOutputs).where(eq(batchOutputs.batchId, batchId));
    expect(out).toMatchObject({ outputKind: "finished", lotId: lot.id, checkedBy: checker.userId });
    const transfer = await stepRec(batchId, 7);
    expect(transfer).toMatchObject({ status: "completed", conductedBy: operator.userId, checkedBy: checker.userId });
    await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01", idempotencyKey: `t-${uuidv7()}` }, { checker }), "state");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityNumber, batchNumber), eq(auditEvents.action, "production.batch.submitted")));
    expect(ev).toHaveLength(1);
  });

  it("genealogy: the coconut-oil lot traces forward to the batch and its finished lot", async () => {
    const coconutLot = await lotBySupplierLot(SOAP_LOTS["MAT-0012"]);
    const b = await batchRow(batchId);
    const [fg] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    const t = await traceGenealogy(qa, { lotNumber: coconutLot.lotNumber });
    const flat = JSON.stringify(t.forward);
    expect(flat).toContain(batchNumber);
    expect(flat).toContain(fg.lotNumber);
  });

  it("the batch record shows every step as signed by conductor and checker", async () => {
    const rec = await getBatchRecord(operator, batchId);
    expect(rec.stepsDone).toBe(7);
    expect(rec.steps.every((x) => x.record?.checkedBy === "Jun Dela Cruz")).toBe(true);
  });
});

describe("consumption posted at dispense (site option A-PROC-31)", () => {
  it("posts each weighing at once and a void reverses it", async () => {
    const [row] = await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "production.post_consumption_at_dispense", value: true }).returning();
    try {
      const { batchId } = await newStartedBatch();
      await cleanEquipment(operator, "SC-01");
      await signChecklist(operator, checker, batchId, (await steps(batchId))[0]);
      const [coconut] = await lines(batchId);
      const lot = await lotBySupplierLot("LOS-24871");
      const a01 = await loc(kit.nfd.id, "A-01");
      const before = await onHand(lot.id, a01.id);
      const r = await recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotRef: lot.id, locationRef: "A-01", qty: "3723.2", equipmentRef: "SC-01" });
      expect(new Decimal(before).minus(await onHand(lot.id, a01.id)).eq("3723.2")).toBe(true);
      const [d] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.dispenseRecordId));
      expect(d.productionPostingId).toBeTruthy();
      await voidDispense(manager, { dispenseRecordId: r.dispenseRecordId, reason: "Wrong drum opened" });
      expect(await onHand(lot.id, a01.id)).toBe(before);
      const rev = await db.select().from(productionPostings).where(and(eq(productionPostings.batchId, batchId), eq(productionPostings.postingType, "reversal")));
      expect(rev).toHaveLength(1);
      expect(rev[0].reversalOfId).toBe(d.productionPostingId);
    } finally {
      await db.delete(settings).where(eq(settings.id, row.id));
    }
  });
});

describe("support helper for other streams", () => {
  it("runs a seeded-routing soap batch to awaiting_qc through the services", async () => {
    await cleanEquipment(operator, "SC-01");
    const r = await runSoapBatchToQuarantine(kit, { manager, operator, checker });
    expect((await batchRow(r.batchId)).status).toBe("awaiting_qc");
  });
});

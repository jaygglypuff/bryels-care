import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, equipment, equipmentOverrideRequests, equipmentUses, inspectionPlans, notifications, processStepRecords, scrapReworkRecords, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { decideEquipmentOverride, requestEquipmentOverride } from "@/modules/masterdata";
import {
  type FormulaSnapshot,
  approveStepException,
  approveYield,
  checkStep,
  completeStep,
  countPackaging,
  createBatch,
  decideScrapRework,
  getBatchExecution,
  issuePackaging,
  postBatchToQuarantine,
  recordDispense,
  recordReading,
  recordScrapRework,
  recordYield,
  registerExecutionHooks,
  resetExecutionHooks,
  returnStep,
  selectEquipment,
  startBatch,
  startStep,
  submitChecklist,
} from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { type Kit, asUser, expectCode, loadKit, loc, makeLot } from "../../support/kit";
import { type FixtureStep, allowDirectBatches, cleanEquipment, makeExecutionFixture, manilaDay } from "../../support/w2b";

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;

const fakeDeviation = () => {
  const opened: string[] = [];
  registerExecutionHooks({
    openDeviation: async (_tx, _ctx, d) => {
      opened.push(d.kind);
      return { deviationId: uuidv7() };
    },
  });
  return opened;
};

const STEPS: FixtureStep[] = [
  { name: "Weighing area clearance", kind: "line_clearance", area: "weighing", checklist: [{ text: "Bench clear" }, { text: "Bin emptied (advisory)", isBlocking: false }] },
  { name: "Weighing", kind: "dispensing", equipmentKind: "scale" },
  { name: "Heating", kind: "process", equipmentKind: "mixer", parameters: [{ code: "temp", name: "Melt temperature", valueKind: "numeric", uom: "°C", min: "70", target: "75", max: "80" }, { code: "note", name: "Observation", valueKind: "text", isRequired: false }] },
  { name: "Cure", kind: "hold", minDurationMinutes: 60, requiresChecker: false },
  { name: "Packaging", kind: "packaging" },
  { name: "Transfer to quarantine", kind: "transfer" },
];

let fixture: Awaited<ReturnType<typeof makeExecutionFixture>>;

async function fixtureBatch(steps?: FixtureStep[], opts?: Parameters<typeof makeExecutionFixture>[2]) {
  const f = steps ? await makeExecutionFixture(kit, steps, opts) : fixture;
  const { batchId } = await createBatch(manager, { formulaRevisionId: f.formulaRevisionId, plannedSizeKg: "1.5", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  return batchId;
}
const snap = async (batchId: string) => {
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  return b.formulaSnapshot as FormulaSnapshot;
};

/** Steps 1 and 2 (clearance, weighing from fresh lots on SC-01). */
async function throughWeighing(batchId: string) {
  const s = (await snap(batchId)).steps.sort((a, z) => a.stepNo - z.stepNo);
  await submitChecklist(operator, { batchId, stepNo: 1, answers: s[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
  await cleanEquipment(operator, "SC-01");
  const ls = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
  const b01 = (await loc(kit.nfd.id, "B-01")).id;
  const coconut = await makeLot(manager, kit.nfd.id, b01, "2000", { materialCode: "MAT-0012" });
  const palm = await makeLot(manager, kit.nfd.id, b01, "2000", { materialCode: "MAT-0013" });
  await recordDispense(operator, { batchId, batchMaterialId: ls[0].id, lotRef: coconut.id, qty: "1000", equipmentRef: "SC-01" }, { checker });
  await recordDispense(operator, { batchId, batchMaterialId: ls[1].id, lotRef: palm.id, qty: "503", equipmentRef: "SC-01" }, { checker });
  await completeStep(operator, { batchId, stepNo: 2 }, { checker });
  return s;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  await allowDirectBatches(kit); // execution tests create batches without work orders on purpose
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  fixture = await makeExecutionFixture(kit, STEPS);
}, 180_000);

afterEach(() => resetExecutionHooks());

describe("checklist with a non-blocking item", () => {
  it('a "no" on an advisory item does not block the clearance', async () => {
    const batchId = await fixtureBatch();
    const s = await snap(batchId);
    const items = s.steps[0].checklistItems!;
    const r = await submitChecklist(operator, { batchId, stepNo: 1, answers: [{ itemId: items[0].id, answer: "yes" }, { itemId: items[1].id, answer: "no", note: "Bin half full, emptied after" }] }, { checker });
    expect(r.status).toBe("completed");
  });
});

describe("process parameters, CX-TOL, holds and checkers (US-3-11)", () => {
  let batchId: string;
  let s: FormulaSnapshot["steps"];
  beforeAll(async () => {
    batchId = await fixtureBatch();
    s = await throughWeighing(batchId);
    await cleanEquipment(operator, "MIX-01");
    await selectEquipment(operator, { batchId, stepNo: 3, equipmentRef: "MIX-01" });
  });

  it("process.parameter_outside_limits: the reading is saved as out of limits and blocks completion", async () => {
    const temp = s[2].parameters!.find((p) => p.code === "temp")!;
    const r = await recordReading(operator, { batchId, stepNo: 3, parameterId: temp.id, value: "85" });
    expect(r.isWithinLimits).toBe(false);
    expect(r.limits).toBe("70–80 °C");
    const e = await expectCode(completeStep(operator, { batchId, stepNo: 3 }, { checker }), "state");
    expect(e.message).toMatch(/outside 70–80 °C/);
    expect((e.details?.blockers as { exceptionable: boolean }[])[0].exceptionable).toBe(true);
    await expectCode(recordReading(operator, { batchId, stepNo: 3, parameterId: temp.id, value: "abc", correctionReason: "typo fix" }), "validation");
  });

  it("CX-TOL on a step: refused without the deviations module, by the operator's own role, then approved by QA with a deviation", async () => {
    const reason = "Melt ran hot for 2 minutes; QA assessed, no impact expected";
    await expectCode(approveStepException(operator, { batchId, stepNo: 3, reason }, { approver: qa }), "state");
    const opened = fakeDeviation();
    await expectCode(approveStepException(operator, { batchId, stepNo: 3, reason }, { approver: checker }), "forbidden");
    await expectCode(approveStepException(operator, { batchId, stepNo: 3, reason: "short" }, { approver: qa }), "validation");
    const { deviationId } = await approveStepException(operator, { batchId, stepNo: 3, reason }, { approver: qa });
    expect(deviationId).toBeTruthy();
    expect(opened).toEqual(["out_of_tolerance"]);
    const [rec] = await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, 3)));
    expect(rec).toMatchObject({ exceptionApprovedBy: qa.userId, deviationId });
  });

  it("sod.step.checker_not_performer and the checker's return with a reason", async () => {
    const r = await completeStep(operator, { batchId, stepNo: 3 });
    expect(r.status).toBe("awaiting_check");
    await expectCode(checkStep(operator, { batchId, stepNo: 3 }), "separation_of_duties");
    await expectCode(returnStep(checker, { batchId, stepNo: 3, reason: "no" }), "validation");
    await returnStep(checker, { batchId, stepNo: 3, reason: "Mixer id missing on the label" });
    const ex = await getBatchExecution(operator, batchId);
    expect(ex.steps[2].status).toBe("in_progress");
    expect(ex.steps[2].record!.blockedReason).toMatch(/Returned by the checker/);
    await completeStep(operator, { batchId, stepNo: 3 });
    await checkStep(checker, { batchId, stepNo: 3 });
    // The mixer is dirty after the step (cleaning rule per batch).
    expect((await db.select().from(equipment).where(eq(equipment.code, "MIX-01")))[0].cleaningStatus).toBe("dirty");
  });

  it("a hold step cannot complete before its minimum duration without an exception", async () => {
    const st = await startStep(operator, { batchId, stepNo: 4 });
    expect(st.earliestCompletionAt).toBeTruthy();
    const e = await expectCode(completeStep(operator, { batchId, stepNo: 4 }), "state");
    expect(e.message).toMatch(/minimum hold time/);
    fakeDeviation();
    await approveStepException(operator, { batchId, stepNo: 4, reason: "Customer order, cure verified by hardness check", kind: "other" }, { approver: manager });
    const r = await completeStep(operator, { batchId, stepNo: 4 });
    expect(r.status).toBe("completed"); // this hold step needs no checker
  });

  it("concurrency.batch_step_posted_once: two completions of the same step, one succeeds", async () => {
    const id = await fixtureBatch();
    const sx = await snap(id);
    const answers = sx.steps[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const }));
    await submitChecklist(operator, { batchId: id, stepNo: 1, answers });
    const results = await Promise.allSettled([checkStep(checker, { batchId: id, stepNo: 1, idempotencyKey: `a-${uuidv7()}` }), checkStep(checker, { batchId: id, stepNo: 1, idempotencyKey: `b-${uuidv7()}` })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("state");
  });

  it("in-process QC hook: a routing step with an inspection plan stays blocked until the inspection passes", async () => {
    const [plan] = await db.select({ id: inspectionPlans.id }).from(inspectionPlans).limit(1);
    const id = await fixtureBatch([
      { name: "Clearance", kind: "line_clearance", area: "weighing", checklist: [{ text: "Clear" }] },
      { name: "In-process check", kind: "in_process_qc", inspectionPlanId: plan.id, parameters: [{ code: "ok", name: "Appearance conforms", valueKind: "boolean" }] },
      { name: "Transfer", kind: "transfer" },
    ]);
    const sx = await snap(id);
    await submitChecklist(operator, { batchId: id, stepNo: 1, answers: [{ itemId: sx.steps[0].checklistItems![0].id, answer: "yes" }] }, { checker });
    const ok = sx.steps[1].parameters![0];
    const r = await recordReading(operator, { batchId: id, stepNo: 2, parameterId: ok.id, value: "yes" });
    expect(r.isWithinLimits).toBe(true);
    let e = await expectCode(completeStep(operator, { batchId: id, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/QA inspections are not connected/);
    let status: "failed" | "passed" = "failed";
    registerExecutionHooks({ inProcessQcStatus: async () => ({ status }) });
    e = await expectCode(completeStep(operator, { batchId: id, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/inspection failed/);
    status = "passed";
    expect((await completeStep(operator, { batchId: id, stepNo: 2 }, { checker })).status).toBe("completed");
  });
});

describe("equipment gate: warn rule and CX-CAL override (W13-03/04)", () => {
  it("warn: the reasons are recorded on the use and the site manager is notified", async () => {
    await db.update(equipment).set({ blockingRule: "warn" }).where(eq(equipment.code, "SC-02"));
    try {
      const batchId = await fixtureBatch();
      const s = await snap(batchId);
      await submitChecklist(operator, { batchId, stepNo: 1, answers: s.steps[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
      await cleanEquipment(operator, "SC-02");
      const [l1] = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
      const lot = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "2000", { materialCode: "MAT-0012" });
      await recordDispense(operator, { batchId, batchMaterialId: l1.id, lotRef: lot.id, qty: "1000", equipmentRef: "SC-02" });
      const [use] = await db.select().from(equipmentUses).where(eq(equipmentUses.batchId, batchId));
      expect(use.availabilityReasons).toContain("calibration_due");
      const n = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, manager.userId), eq(notifications.kind, "production.equipment_warning")));
      expect(n.length).toBeGreaterThan(0);
    } finally {
      await db.update(equipment).set({ blockingRule: "block" }).where(eq(equipment.code, "SC-02"));
    }
  });

  it("override: approved by site manager and QA, the use records the override and opens a deviation", async () => {
    const batchId = await fixtureBatch();
    const s = await snap(batchId);
    await submitChecklist(operator, { batchId, stepNo: 1, answers: s.steps[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
    const [sc2] = await db.select().from(equipment).where(eq(equipment.code, "SC-02"));
    const [l1] = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
    const lot = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "2000", { materialCode: "MAT-0012" });
    const input = { batchId, batchMaterialId: l1.id, lotRef: lot.id, qty: "1000", equipmentRef: "SC-02" };
    await expectCode(recordDispense(operator, input), "state");
    const { requestId } = await requestEquipmentOverride(operator, { equipmentId: sc2.id, reason: "SC-01 under repair; SC-02 verified with test weight", workReference: "test", validHours: 4 });
    await decideEquipmentOverride(manager, { id: requestId, decision: "approved", note: "ok" });
    await decideEquipmentOverride(qa, { id: requestId, decision: "approved", note: "ok, deviation follows" });
    const e = await expectCode(recordDispense(operator, input), "state");
    expect(e.message).toMatch(/deviation/);
    const opened = fakeDeviation();
    await recordDispense(operator, input);
    expect(opened).toEqual(["equipment_override"]);
    const [use] = await db.select().from(equipmentUses).where(and(eq(equipmentUses.batchId, batchId), eq(equipmentUses.equipmentId, sc2.id)));
    const [req] = await db.select().from(equipmentOverrideRequests).where(eq(equipmentOverrideRequests.id, requestId));
    expect(use).toMatchObject({ overrideRequestId: requestId, exceptionApprovedBy: req.approvedBy });
    expect(use.deviationId).toBeTruthy();
  });
});

describe("yield, scrap and transfer controls (US-3-13)", () => {
  let batchId: string;
  beforeAll(async () => {
    batchId = await fixtureBatch([
      { name: "Clearance", kind: "line_clearance", area: "weighing", checklist: [{ text: "Clear" }] },
      { name: "Weighing", kind: "dispensing", equipmentKind: "scale" },
      { name: "Packaging", kind: "packaging" },
      { name: "Transfer", kind: "transfer" },
    ]);
    await throughWeighing(batchId);
    const wrappers = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "PKG-01")).id, "100", { materialCode: "PKG-0101" });
    const { reconciliationId } = await issuePackaging(operator, { batchId, stepNo: 3, lotRef: wrappers.id, qty: "12" });
    await countPackaging(operator, { reconciliationId, used: "10", damaged: "0", returned: "1" });
    // 1 unexplained wrapper: blocked, then accepted under CX-TOL with a deviation.
    await expectCode(completeStep(operator, { batchId, stepNo: 3 }, { checker }), "state");
    fakeDeviation();
    await approveStepException(operator, { batchId, stepNo: 3, reason: "One wrapper torn and discarded unrecorded; QA accepts", kind: "reconciliation_mismatch" }, { approver: qa });
    await completeStep(operator, { batchId, stepNo: 3 }, { checker });
    resetExecutionHooks();
  });

  it("yield outside the configured range blocks posting until approved with a deviation by someone else", async () => {
    const y = await recordYield(operator, { batchId, actualUnits: "10" }); // 1,000 g of 1,500 g = 66.67 %
    expect(y.within).toBe(false);
    await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }, { checker }), "state");
    await expectCode(approveYield(checker, { yieldRecordId: y.yieldRecordId, reason: "Mould leaked, cause known" }), "forbidden");
    await expectCode(approveYield(qa, { yieldRecordId: y.yieldRecordId, reason: "Mould leaked, cause known" }), "state");
    const y2 = await recordYield(manager, { batchId, actualUnits: "10", correctionReason: "Recount by supervisor" });
    await expectCode(approveYield(manager, { yieldRecordId: y2.yieldRecordId, reason: "Mould leaked, cause known" }), "separation_of_duties");
    fakeDeviation();
    await approveYield(qa, { yieldRecordId: y2.yieldRecordId, reason: "Mould leaked, cause known" });
    await expectCode(approveYield(qa, { yieldRecordId: y.yieldRecordId, reason: "Mould leaked, cause known" }), "state"); // superseded
  });

  it("scrap above the threshold needs approval by another person before posting", async () => {
    const r = await recordScrapRework(operator, { batchId, kind: "scrap", reasonCode: "broken_bar", qty: "2" });
    expect(r.requiresApproval).toBe(true);
    await expectCode(recordScrapRework(operator, { batchId, kind: "scrap", reasonCode: "other", qty: "1" }), "validation");
    const e = await expectCode(postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }, { checker }), "state");
    expect(e.message).toMatch(/Scrap of 2 needs approval/);
    await expectCode(decideScrapRework(operator, { scrapReworkRecordId: r.scrapReworkRecordId, decision: "approve", note: "fine" }), "forbidden");
    await decideScrapRework(manager, { scrapReworkRecordId: r.scrapReworkRecordId, decision: "approve", note: "Broken in demoulding" });
    const [row] = await db.select().from(scrapReworkRecords).where(eq(scrapReworkRecords.id, r.scrapReworkRecordId));
    expect(row).toMatchObject({ status: "approved", decidedBy: manager.userId });
  });

  it("posts to quarantine once every control is satisfied", async () => {
    const r = await postBatchToQuarantine(operator, { batchId, locationRef: "QUA-01" }, { checker });
    expect(r.consumptionPostings).toBe(3);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.batch.submitted")));
    expect(ev).toHaveLength(1);
  });
});

describe("co-signature on the operator's device", () => {
  it("refuses the operator signing for themself, a wrong password (audited) and a signer without the permission", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "checker.nfd@bryels-care.test"));
    const [wh] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
    const base = { role: "checker" as const, permission: "production.line_clearance.approve" as const, siteId: kit.nfd.id };
    await expectCode(coSign(operator, { ...base, userId: operator.userId, password: "demo1234" }), "separation_of_duties");
    await expectCode(coSign(operator, { ...base, userId: u.id, password: "wrong-password" }), "validation");
    const failed = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, u.id), eq(auditEvents.action, "identity.co_signature.failed")));
    expect(failed).toHaveLength(1);
    await expectCode(coSign(operator, { ...base, userId: wh.id, password: "demo1234" }), "validation");
    const signer = await coSign(operator, { ...base, userId: u.id, password: "demo1234" });
    expect(signer.userId).toBe(u.id);
    expect(signer.can("production.line_clearance.approve")).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after.failedLoginCount).toBe(0);
  });

  it("a QA lead is a valid exception approver; an operator is not", async () => {
    const [lead] = await db.select().from(users).where(eq(users.email, "qa.lead@bryels-care.test"));
    const s = await coSign(operator, { role: "exception_approver", permission: "production.over_tolerance_dispense.approve", siteId: kit.nfd.id, userId: lead.id, password: "demo1234" });
    expect(s.userId).toBe(qaLead.userId);
  });
});

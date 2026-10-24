import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, deviations, dispenseRecords, inspectionPlanTests, inspectionPlans, inspections, materials, processStepRecords, products, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { buildBmrDataset, completeStep, createBatch, issuePaperPage, openDeviationNumbers, recordDispense, recordReading, resetExecutionHooks, startBatch, startStep, submitChecklist, voidDispense } from "@/modules/production";
import { createInspection, getBatchRelease, recordInspectionResult, reviewInspection, traceGenealogy } from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { acapulcoRevisionId, cleanEquipment, lotBySupplierLot, makeExecutionFixture, manilaDay, runSoapBatchToQuarantine, signChecklist, snapshotOf, SOAP_LOTS } from "../../support/w2b";

/**
 * Wave 2 integration: execution (W2B) wired to QA (W2C) through registerAppHooks — real deviations for
 * controlled exceptions, the finished-product inspection created at posting, in-process inspections
 * gating a step (a failed one opens a deviation), genealogy without voided weighings, and paper pages
 * gating every exit from awaiting_qc.
 */

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd]);
  await db.insert(settings).values({
    organizationId: kit.orgId,
    scope: "organization",
    key: "production.batch.allow_without_work_order",
    value: true,
  });
  registerAppHooks();
}, 180_000);

afterAll(() => resetExecutionHooks());

async function startedSoapBatch() {
  const { batchId } = await createBatch(manager, {
    formulaRevisionId: await acapulcoRevisionId(),
    plannedSizeKg: "8.8",
    plannedStartOn: manilaDay(0),
  });
  await startBatch(operator, batchId);
  await cleanEquipment(operator, "SC-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const clearance = [...snapshotOf(b).steps].sort((x, z) => x.stepNo - z.stepNo).find((s) => s.stepKind === "line_clearance")!;
  await signChecklist(operator, checker, batchId, clearance);
  return batchId;
}

describe("execution → QA hooks", () => {
  it("posting to quarantine creates the finished-product inspection in the same transaction", async () => {
    const r = await runSoapBatchToQuarantine(kit, {
      manager,
      operator,
      checker,
      plannedSizeKg: "8.8",
      units: "62",
    });
    const rows = await db.select().from(inspections).where(eq(inspections.batchId, r.batchId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inspectionKind: "finished_product",
      status: "pending",
      lotId: r.lotId,
    });
    const [ev] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "production.batch.submitted"), eq(auditEvents.entityId, r.batchId)));
    expect((ev.after as { inspectionId: string }).inspectionId).toBe(rows[0].id);
    // QA's manual start returns the same inspection.
    expect((await createInspection(qa, { batchId: r.batchId })).inspectionId).toBe(rows[0].id);
  });

  it("an over-tolerance weighing approved on the device opens a real CX-TOL deviation that blocks release", async () => {
    const batchId = await startedSoapBatch();
    const [line] = await db
      .select({ bm: batchMaterials, code: materials.code })
      .from(batchMaterials)
      .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
      .where(eq(batchMaterials.batchId, batchId))
      .orderBy(batchMaterials.lineNo)
      .limit(1);
    const lot = await lotBySupplierLot(SOAP_LOTS[line.code]);
    const over = new Decimal(line.bm.theoreticalQtyG).mul(1.2).toDecimalPlaces(1).toString();
    await expectCode(
      recordDispense(
        operator,
        {
          batchId,
          batchMaterialId: line.bm.id,
          lotRef: `BC:LOT:${lot.lotNumber}`,
          qty: over,
          equipmentRef: "SC-01",
        },
        { checker },
      ),
      "out_of_tolerance",
    );
    await recordDispense(
      operator,
      {
        batchId,
        batchMaterialId: line.bm.id,
        lotRef: `BC:LOT:${lot.lotNumber}`,
        qty: over,
        equipmentRef: "SC-01",
        exceptionReason: "QA accepts the heavier charge; trial batch",
      },
      { checker, exceptionApprover: qa },
    );
    const devs = await db.select().from(deviations).where(eq(deviations.batchId, batchId));
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({
      source: "cx_tol",
      status: "open",
      raisedBy: qa.userId,
      lotId: null,
    });
    expect(devs[0].deviationNumber).toMatch(/^DEV-\d{2}-\d{4}$/);
    expect(await openDeviationNumbers(db, batchId)).toEqual([devs[0].deviationNumber]);
    const [rec] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, line.bm.id));
    expect(rec.deviationId).toBe(devs[0].id);
  });
});

describe("in-process inspection gates a step", () => {
  let planId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(inspectionPlans)
      .values({
        organizationId: kit.orgId,
        productId: (await db.select({ id: products.id }).from(products).where(eq(products.skuCode, "ACS-135")))[0].id,
        code: `IP-INPROC-${Date.now().toString(36).toUpperCase()}`,
        name: "Trace check (fictional)",
        planKind: "in_process",
        revisionNo: 1,
        createdBy: qa.userId,
      })
      .returning();
    await db.insert(inspectionPlanTests).values({
      inspectionPlanId: p.id,
      sequence: 1,
      testCode: "TRACE",
      name: "Trace reached",
      valueKind: "pass_fail",
    });
    // Inserted as draft, then approved (like the W1D seed; fixture only).
    await db
      .update(inspectionPlans)
      .set({ status: "approved", effectiveFrom: manilaDay(-1), approvedBy: qaLead.userId, approvedAt: new Date() })
      .where(eq(inspectionPlans.id, p.id));
    planId = p.id;
  });

  async function batchWithCheckStep() {
    const f = await makeExecutionFixture(kit, [
      {
        name: "Clearance",
        kind: "line_clearance",
        area: "weighing",
        checklist: [{ text: "Area clear" }],
      },
      {
        name: "Trace check",
        kind: "in_process_qc",
        inspectionPlanId: planId,
        parameters: [
          {
            code: "temp",
            name: "Temperature",
            valueKind: "numeric",
            uom: "°C",
            min: "40",
            max: "60",
          },
        ],
      },
      { name: "Transfer", kind: "transfer" },
    ]);
    const { batchId } = await createBatch(manager, {
      formulaRevisionId: f.formulaRevisionId,
      plannedSizeKg: "1.5",
      plannedStartOn: manilaDay(0),
    });
    await startBatch(operator, batchId);
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const s = snapshotOf(b).steps.sort((x, z) => x.stepNo - z.stepNo);
    await submitChecklist(
      operator,
      {
        batchId,
        stepNo: 1,
        answers: s[0].checklistItems!.map((i) => ({
          itemId: i.id,
          answer: "yes" as const,
        })),
      },
      { checker },
    );
    await startStep(operator, { batchId, stepNo: 2 });
    await recordReading(operator, {
      batchId,
      stepNo: 2,
      parameterId: s[1].parameters![0].id,
      value: "50",
    });
    const [rec] = await db
      .select()
      .from(processStepRecords)
      .where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, 2)));
    return { batchId, recId: rec.id };
  }

  async function inspect(batchId: string, recId: string, conforms: boolean) {
    const { inspectionId } = await createInspection(qa, {
      batchId,
      processStepRecordId: recId,
    });
    const [ins] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
    expect(ins).toMatchObject({
      inspectionKind: "in_process",
      processStepRecordId: recId,
      inspectionPlanId: planId,
      lotId: null,
    });
    const [t] = await db.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, planId));
    await recordInspectionResult(qa, {
      inspectionId,
      planTestId: t.id,
      value: conforms ? "Conforms" : "Trace not reached",
      conforms,
    });
    return inspectionId;
  }

  it("blocks the step until QA approves a passing in-process inspection; the batch stays in process", async () => {
    const { batchId, recId } = await batchWithCheckStep();
    let e = await expectCode(completeStep(operator, { batchId, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/in-process inspection/i);
    await expectCode(createInspection(operator, { batchId, processStepRecordId: recId }), "forbidden");
    const id = await inspect(batchId, recId, true);
    e = await expectCode(completeStep(operator, { batchId, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/not complete|awaiting review/i);
    await reviewInspection(qaLead, { inspectionId: id, decision: "approve" });
    expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0].status).toBe("in_process");
    expect((await completeStep(operator, { batchId, stepNo: 2 }, { checker })).status).toBe("completed");
  });

  it("a failed in-process inspection keeps the step blocked (WIP hold) and opens an in-process deviation", async () => {
    const { batchId, recId } = await batchWithCheckStep();
    const id = await inspect(batchId, recId, false);
    await reviewInspection(qaLead, {
      inspectionId: id,
      decision: "approve",
      note: "Trace not reached at 50 min",
    });
    const [ins] = await db.select().from(inspections).where(eq(inspections.id, id));
    expect(ins.outcome).toBe("fail");
    const e = await expectCode(completeStep(operator, { batchId, stepNo: 2 }, { checker }), "state");
    expect(e.message).toMatch(/failed/);
    const devs = await db.select().from(deviations).where(eq(deviations.batchId, batchId));
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({
      source: "in_process_check",
      processStepRecordId: recId,
      inspectionId: id,
      status: "open",
    });
  });
});

describe("genealogy and paper pages", () => {
  it("a voided weighing is not a genealogy input of the batch", async () => {
    const batchId = await startedSoapBatch();
    const [line] = await db
      .select({ bm: batchMaterials, code: materials.code })
      .from(batchMaterials)
      .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
      .where(eq(batchMaterials.batchId, batchId))
      .orderBy(batchMaterials.lineNo)
      .limit(1);
    const lot = await lotBySupplierLot(SOAP_LOTS[line.code]);
    await recordDispense(
      operator,
      {
        batchId,
        batchMaterialId: line.bm.id,
        lotRef: `BC:LOT:${lot.lotNumber}`,
        qty: new Decimal(line.bm.theoreticalQtyG).toDecimalPlaces(3).toString(),
        equipmentRef: "SC-01",
      },
      { checker },
    );
    const [rec] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, line.bm.id));
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const before = await traceGenealogy(qa, { batchNumber: b.batchNumber });
    expect(JSON.stringify(before)).toContain(lot.lotNumber);
    await voidDispense(manager, {
      dispenseRecordId: rec.id,
      reason: "Wrong container scanned",
    });
    const after = await traceGenealogy(qa, { batchNumber: b.batchNumber });
    expect(JSON.stringify(after)).not.toContain(lot.lotNumber);
  });

  it("an unreviewed paper page keeps the batch awaiting QC after inspection review and blocks the decision", async () => {
    const r = await runSoapBatchToQuarantine(kit, {
      manager,
      operator,
      checker,
      plannedSizeKg: "8.8",
      units: "62",
    });
    const [b] = await db.select().from(batches).where(eq(batches.id, r.batchId));
    await issuePaperPage(manager, {
      batchId: r.batchId,
      stepNo: snapshotOf(b).steps[0].stepNo,
      idempotencyKey: randomUUID(),
    });
    const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, r.batchId));
    const tests = await db.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, ins.inspectionPlanId));
    for (const t of tests) {
      await recordInspectionResult(qa, {
        inspectionId: ins.id,
        planTestId: t.id,
        value: t.valueKind === "numeric" ? new Decimal(t.specMin ?? t.specMax ?? "0").plus(t.specMax && t.specMin ? new Decimal(t.specMax).minus(t.specMin).div(2) : 0).toString() : "Conforms",
        uom: t.uom,
        conforms: t.valueKind === "numeric" ? null : true,
      });
    }
    const rv = await reviewInspection(qaLead, {
      inspectionId: ins.id,
      decision: "approve",
    });
    expect(rv.batchStatus).toBe("awaiting_paper_review");
    expect((await db.select().from(batches).where(eq(batches.id, r.batchId)))[0].status).toBe("awaiting_qc");
    const v = await getBatchRelease(qaLead, r.batchId);
    expect(v.blockers.map((x) => x.message).join(" ")).toMatch(/Paper page .* not reviewed/);
  });
});

describe("BMR of an electronically executed batch", () => {
  it("prints line clearance, readings, equipment, packaging, yield with its checker, outputs and the inspection from the W2B/W2C tables", async () => {
    const r = await runSoapBatchToQuarantine(kit, { manager, operator, checker, plannedSizeKg: "8.8", units: "62" });
    const { data } = await buildBmrDataset(db, manager, r.batchId);
    expect(data.lineClearance.available).toBe(true);
    expect(data.lineClearance.rows.length).toBeGreaterThan(0);
    expect(data.lineClearance.rows.every((x) => x.answer === "yes" && x.by)).toBe(true);
    expect(data.parameters.rows.length).toBeGreaterThan(0);
    expect(data.parameters.rows.every((x) => x.value !== "")).toBe(true);
    expect(data.equipment.rows.map((e) => e.code)).toEqual(expect.arrayContaining(["SC-01", "MIX-01"]));
    expect(data.packaging.rows.some((p) => /issued 130/.test(p.value) && /used 124/.test(p.value))).toBe(true);
    const yr = Object.fromEntries(data.outputYield.yieldRecord.rows.map((x) => [x.label, x.value]));
    expect(yr["Checked by"]).toBe(checker.displayName);
    expect(yr["Units"]).toMatch(/^62/);
    expect(data.outputYield.outputs.rows[0]).toMatchObject({ kind: "finished", lot: r.lotNumber, location: "QUA-01" });
    expect(data.outputYield.outputs.rows[0].item).not.toBe("");
    expect(data.qc.inspections.rows).toHaveLength(1);
    expect(data.qc.inspections.rows[0].plan).toMatch(/^IP-ACS-FP rev \d+$/);
    expect(data.deviations.available).toBe(true);
  });
});

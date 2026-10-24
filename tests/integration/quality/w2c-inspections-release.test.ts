import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batches, dispositions, inspections, inventoryLots, settings, stockMovements, testResults } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { runExport } from "@/lib/export";
import {
  closeDeviation,
  containDeviation,
  correctInspectionResult,
  createInspection,
  decideBatch,
  decideConditionalRelease,
  decideLot,
  ensureBatchInspection,
  genealogyExport,
  getBatchRelease,
  getInspection,
  getLotDisposition,
  openDeviation,
  recordInspectionResult,
  recordSample,
  recordTestResult,
  requestConditionalRelease,
  reviewInspection,
  startInvestigation,
  traceGenealogy,
} from "@/modules/quality";
import { liftHold } from "@/modules/inventory";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";
import { awaitingQcBatch } from "./w2c-fixtures";

let kit: Kit;
let manager: AuthContext;
let qa: AuthContext; // enters results
let qaLead: AuthContext; // reviews and decides
let qaRvsOnly: AuthContext;
let operator: AuthContext;
let warehouse: AuthContext;
let sales: AuthContext;
let owner: AuthContext;

/** Message of the database error behind a failed query (drizzle wraps it in `cause`). */
async function dbError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
    return "no error";
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
}

async function testId(inspectionId: string, code: string) {
  const v = await getInspection(qa, inspectionId);
  return v.tests.find((t) => t.testCode === code)!.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaRvsOnly = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
}, 180_000);

describe("US-3-14 inspections, sampling and append-only results", () => {
  let b: Awaited<ReturnType<typeof awaitingQcBatch>>;
  let inspectionId: string;

  it("the batch froze the QA-approved finished-product plan", async () => {
    b = await awaitingQcBatch(kit, manager);
    expect(b.inspectionPlanId).toBeTruthy();
    // Free-form MVP results are refused for a batch with a frozen plan.
    await expectCode(recordTestResult(qa, { batchId: b.batchId, testName: "pH", specification: "any", result: "9.5", passed: true }), "state");
  });

  it("refuses a role without quality.inspection.create and a user outside the site (authz.cross_site)", async () => {
    await expectCode(createInspection(sales, { batchId: b.batchId }), "forbidden");
    await expectCode(createInspection(qaRvsOnly, { batchId: b.batchId }), "not_found");
  });

  it("creates exactly one inspection under concurrent starts, and the production trigger returns the same one", async () => {
    const [r1, r2] = await Promise.all([createInspection(qa, { batchId: b.batchId }), createInspection(qa, { batchId: b.batchId })]);
    expect(r1.inspectionId).toBe(r2.inspectionId);
    inspectionId = r1.inspectionId;
    const rows = await db.select().from(inspections).where(eq(inspections.batchId, b.batchId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", inspectionKind: "finished_product", inspectionPlanId: b.inspectionPlanId, lotId: b.lotId });
    expect(rows[0].inspectionNumber).toMatch(/^INS-\d{2}-\d{5}$/);
    const again = await db.transaction((tx) => ensureBatchInspection(tx, qa, b.batchId));
    expect(again?.inspectionId).toBe(inspectionId);
  });

  it("sampling posts a consumption movement with reason sample and is idempotent", async () => {
    const qua = await loc(kit.nfd.id, "QUA-01");
    const key = randomUUID();
    await expectCode(recordSample(qa, { inspectionId, fromLocationId: qua.id, qty: "1.5", idempotencyKey: randomUUID() }), "validation"); // pieces
    const s1 = await recordSample(qa, { inspectionId, fromLocationId: qua.id, qty: "2", idempotencyKey: key });
    const s2 = await recordSample(qa, { inspectionId, fromLocationId: qua.id, qty: "2", idempotencyKey: key });
    expect(s1.sampleNo).toBe(1);
    expect(s2.replayed).toBe(true);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, b.lotId), eq(stockMovements.movementType, "consumption")));
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ reason: "sample", sourceDocumentType: "inspection", qtyBase: "2.000000" });
    const v = await getInspection(qa, inspectionId);
    expect(v.inspection.status).toBe("in_progress");
    expect(v.inspection.sampleQtyBase).toBe("2.000000");
  });

  it("evaluates results against the plan: a unit that does not match the specification is 422", async () => {
    const ph = await testId(inspectionId, "PH");
    const e = await expectCode(recordInspectionResult(qa, { inspectionId, planTestId: ph, value: "9.8", uom: "g" }), "validation");
    expect(e.details?.field).toBe("uom");
    await expectCode(recordInspectionResult(warehouse, { inspectionId, planTestId: ph, value: "9.8", uom: "pH" }), "forbidden");
    const r = await recordInspectionResult(qa, { inspectionId, planTestId: ph, value: "9.8", uom: "pH" });
    expect(r.passed).toBe(true);
    const appear = await testId(inspectionId, "APPEAR");
    await recordInspectionResult(qa, { inspectionId, planTestId: appear, value: "Smooth bar, no cracks", conforms: true });
    const netwt = await testId(inspectionId, "NETWT");
    const fail = await recordInspectionResult(qa, { inspectionId, planTestId: netwt, value: "134", uom: "g" });
    expect(fail.passed).toBe(false);
    // Every required test has a result: the inspection moves to review by itself (W06-03).
    expect(fail.inspectionStatus).toBe("awaiting_review");
  });

  it("quality.test_result_void_appends: a correction supersedes with a reason and keeps the original", async () => {
    const [orig] = await db.select().from(testResults).where(and(eq(testResults.inspectionId, inspectionId), eq(testResults.testCode, "NETWT")));
    await expectCode(correctInspectionResult(qa, { resultId: orig.id, value: "135.9", uom: "g", reason: "" }), "validation");
    const c = await correctInspectionResult(qa, { resultId: orig.id, value: "135.9", uom: "g", reason: "Transcription error: balance showed 135.9 g" });
    expect(c.passed).toBe(true);
    await expectCode(correctInspectionResult(qa, { resultId: orig.id, value: "136", uom: "g", reason: "Second correction of the original" }), "conflict");
    const rows = await db.select().from(testResults).where(and(eq(testResults.inspectionId, inspectionId), eq(testResults.testCode, "NETWT")));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === c.resultId)).toMatchObject({ supersedesId: orig.id, correctionReason: "Transcription error: balance showed 135.9 g" });
    expect(rows.find((r) => r.id === orig.id)?.result).toBe("134 g"); // original untouched
    const v = await getInspection(qa, inspectionId);
    expect(v.results.find((r) => r.id === orig.id)).toMatchObject({ live: false, supersededById: c.resultId });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "quality.test_result.corrected"), eq(auditEvents.entityId, c.resultId)));
    expect(ev).toHaveLength(1);
    // Results are append-only in the database too.
    expect(await dbError(db.update(testResults).set({ result: "tampered" }).where(eq(testResults.id, orig.id)))).toMatch(/append-only/);
  });

  it("two concurrent corrections of the same result end in one success", async () => {
    const [live] = await db.select().from(testResults).where(and(eq(testResults.inspectionId, inspectionId), eq(testResults.testCode, "PH")));
    const res = await Promise.allSettled([
      correctInspectionResult(qa, { resultId: live.id, value: "9.7", uom: "pH", reason: "Re-read the meter display" }),
      correctInspectionResult(qa, { resultId: live.id, value: "9.6", uom: "pH", reason: "Re-read the meter display" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
  });

  it("sod.results.reviewer_not_tester: the tester cannot review; a second QA user approves and the batch is quarantined", async () => {
    await expectCode(reviewInspection(qa, { inspectionId, decision: "approve" }), "separation_of_duties");
    await expectCode(reviewInspection(operator, { inspectionId, decision: "approve" }), "forbidden");
    const before = await getBatchRelease(qaLead, b.batchId);
    expect(before.blockers.map((x) => x.message).join(" ")).toMatch(/awaiting review/);
    const r = await reviewInspection(qaLead, { inspectionId, decision: "approve", note: "Results and BMR reviewed" });
    expect(r).toMatchObject({ status: "approved", batchStatus: "quarantined" });
    const [ins] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
    expect(ins).toMatchObject({ outcome: "pass", reviewedBy: qaLead.userId });
    expect((await db.select().from(batches).where(eq(batches.id, b.batchId)))[0].status).toBe("quarantined");
    await expectCode(recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "PH"), value: "9.9", uom: "pH" }), "state");
  });
});

describe("US-3-15 / US-3-21 release blocked by deviations and holds, decided by qa_qc only", () => {
  let b: Awaited<ReturnType<typeof awaitingQcBatch>>;
  let deviationId: string;

  it("prepares a reviewed batch", async () => {
    b = await awaitingQcBatch(kit, manager);
    const { inspectionId } = await createInspection(qa, { batchId: b.batchId });
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "PH"), value: "10.1", uom: "pH" });
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "APPEAR"), value: "Conforms", conforms: true });
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "NETWT"), value: "136.2", uom: "g" });
    await reviewInspection(qaLead, { inspectionId, decision: "approve" });
  });

  it("a deviation raised from a step blocks release (deviation-blocks-release)", async () => {
    await expectCode(openDeviation(sales, { batchId: b.batchId, description: "Mixer stopped for 10 minutes" }), "forbidden");
    await expectCode(openDeviation(qaRvsOnly, { batchId: b.batchId, description: "Mixer stopped for 10 minutes" }), "not_found");
    const key = randomUUID();
    const d = await openDeviation(operator, { batchId: b.batchId, stepRef: "Step 3 Saponification", description: "Mixer stopped for 10 minutes during trace", idempotencyKey: key });
    const again = await openDeviation(operator, { batchId: b.batchId, stepRef: "Step 3 Saponification", description: "Mixer stopped for 10 minutes during trace", idempotencyKey: key });
    expect(again).toMatchObject({ deviationId: d.deviationId, replayed: true });
    expect(d.deviationNumber).toMatch(/^DEV-\d{2}-\d{4}$/);
    deviationId = d.deviationId;
    const v = await getBatchRelease(qaLead, b.batchId);
    expect(v.blockers.map((x) => x.message).join(" ")).toMatch(new RegExp(`Deviation ${d.deviationNumber} is open`));
    await expectCode(decideBatch(qaLead, { batchId: b.batchId, decision: "release", reason: "Release attempt with an open deviation" }), "state");
  });

  it("containment places a hold on the output lot; closure waits for the hold; quality.hold_lift_not_creator", async () => {
    const h = await containDeviation(qa, { deviationId, scope: "lot", reason: "Contain the batch output", idempotencyKey: randomUUID() });
    expect((await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.lotId)))[0].qualityStatus).toBe("on_hold");
    await expectCode(closeDeviation(qaLead, { deviationId, rootCause: "Breaker trip", resolution: "Restarted within limits", releasePermitted: true }), "state"); // not classified
    await startInvestigation(qa, { deviationId, severity: "minor", investigation: "Check mixer log and temperature trend" });
    await expectCode(closeDeviation(operator, { deviationId, rootCause: "x", resolution: "y", releasePermitted: true }), "forbidden");
    await expectCode(closeDeviation(qaLead, { deviationId, rootCause: "Breaker trip", resolution: "Restarted within limits", releasePermitted: true }), "state"); // hold open
    await expectCode(liftHold(qa, { holdId: h.holdId, resolution: "released", reason: "Trend within limits" }), "separation_of_duties");
    await liftHold(qaLead, { holdId: h.holdId, resolution: "released", reason: "Trend within limits" });
    expect((await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.lotId)))[0].qualityStatus).toBe("quarantine");
  });

  it("the raiser cannot close their own deviation; another QA user closes it with the release conclusion", async () => {
    const own = await openDeviation(qa, { batchId: b.batchId, description: "Label roll changed mid-batch, check codes" });
    await startInvestigation(qaLead, { deviationId: own.deviationId, severity: "minor", investigation: "Compare label codes" });
    await expectCode(closeDeviation(qa, { deviationId: own.deviationId, rootCause: "Roll end", resolution: "Codes match", releasePermitted: true }), "separation_of_duties");
    await closeDeviation(qaLead, { deviationId: own.deviationId, rootCause: "Roll end", resolution: "Codes match", releasePermitted: true });
    await closeDeviation(qa, { deviationId, rootCause: "Breaker trip on mixer circuit", resolution: "Restarted within the trace window; trend within limits", releasePermitted: true });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "quality.deviation.closed"), eq(auditEvents.entityId, deviationId)));
    expect(ev).toHaveLength(1);
    expect(await dbError(db.execute(sql`update deviations set description = 'changed' where id = ${deviationId}`))).toMatch(/is closed/);
  });

  it("quality.disposition_only_qa and sod.disposition.decider_not_result_entry", async () => {
    await expectCode(decideBatch(owner, { batchId: b.batchId, decision: "release", reason: "Owner wants it shipped" }), "forbidden");
    await expectCode(decideBatch(warehouse, { batchId: b.batchId, decision: "release", reason: "Warehouse wants it" }), "forbidden");
    await expectCode(decideBatch(qa, { batchId: b.batchId, decision: "release", reason: "I tested it, all fine" }), "separation_of_duties");
    const r = await decideBatch(qaLead, { batchId: b.batchId, decision: "release", reason: "Inspection approved, deviations closed" });
    expect(r).toMatchObject({ toStatus: "released", movedTo: "FG-01" });
    const d = await db.select().from(dispositions).where(eq(dispositions.subjectId, b.batchId));
    expect(d[0]).toMatchObject({ decision: "release", fromStatus: "quarantined", toStatus: "released", decidedBy: qaLead.userId });
    expect(d[0].inspectionId).toBeTruthy();
  });
});

describe("failed results, OOS deviations and conditional release", () => {
  it("a failed result blocks release until an OOS deviation on it is closed with release permitted", async () => {
    const b = await awaitingQcBatch(kit, manager);
    const { inspectionId } = await createInspection(qa, { batchId: b.batchId });
    const ph = await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "PH"), value: "11.2", uom: "pH" });
    expect(ph.passed).toBe(false);
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "APPEAR"), value: "Conforms", conforms: true });
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "NETWT"), value: "136", uom: "g" });
    await reviewInspection(qaLead, { inspectionId, decision: "approve" });
    expect((await db.select().from(inspections).where(eq(inspections.id, inspectionId)))[0].outcome).toBe("fail");
    await expectCode(decideBatch(qaLead, { batchId: b.batchId, decision: "release", reason: "Release attempt with failed pH" }), "state");
    const oos = await openDeviation(qa, { batchId: b.batchId, testResultId: ph.resultId, description: "pH 11.2 above specification" });
    const [dev] = await db.execute<{ source: string; inspection_id: string }>(sql`select source, inspection_id from deviations where id = ${oos.deviationId}`);
    expect(dev).toMatchObject({ source: "oos", inspection_id: inspectionId });
    await startInvestigation(qaLead, { deviationId: oos.deviationId, severity: "major", investigation: "Lab investigation of the pH result" });
    await closeDeviation(qaLead, { deviationId: oos.deviationId, rootCause: "Meter not calibrated (lab error)", resolution: "Retest within specification", releasePermitted: true });
    const v = await getBatchRelease(qaLead, b.batchId);
    expect(v.blockers).toEqual([]);
    await decideBatch(qaLead, { batchId: b.batchId, decision: "release", reason: "OOS closed as lab error; retest conforms" });
  });

  it("quality.conditional_release_two_qa_users: off by default; when on, a second approver decides", async () => {
    const b = await awaitingQcBatch(kit, manager);
    const { inspectionId } = await createInspection(qa, { batchId: b.batchId });
    await recordInspectionResult(qa, { inspectionId, planTestId: await testId(inspectionId, "PH"), value: "9.9", uom: "pH" });
    const review = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const req = { batchId: b.batchId, conditions: "Micro result pending; do not ship before it passes", reviewDate: review, reason: "Customer stock-out, QA policy allows" };
    await expectCode(requestConditionalRelease(qaLead, req), "state"); // Q-QA-03 default off
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "quality.conditional_release.enabled", value: true });
    await expectCode(requestConditionalRelease(qa, req), "separation_of_duties"); // qa entered results
    const { requestId } = await requestConditionalRelease(qaLead, req);
    await expectCode(decideConditionalRelease(qaLead, { requestId, decision: "approve", note: "Second approval" }), "separation_of_duties");
    await expectCode(decideConditionalRelease(warehouse, { requestId, decision: "approve", note: "Second approval" }), "forbidden");
    const r = await decideConditionalRelease(owner, { requestId, decision: "approve", note: "Second approval as owner" });
    expect(r.status).toBe("approved");
    const d = await db.select().from(dispositions).where(and(eq(dispositions.subjectId, b.lotId), eq(dispositions.subjectType, "lot")));
    expect(d[0]).toMatchObject({ decision: "conditional_release", toStatus: "released", requestedBy: qaLead.userId, decidedBy: owner.userId, reviewDate: review });
    await db.delete(settings).where(eq(settings.key, "quality.conditional_release.enabled"));
  });
});

describe("incoming lot inspection", () => {
  it("an open incoming inspection blocks lot release; the tester may not release", async () => {
    const qua = await loc(kit.nfd.id, "QUA-01");
    const lot = await makeLot(manager, kit.nfd.id, qua.id, "5000", { status: "quarantine", materialCode: "MAT-0012" });
    await expectCode(createInspection(qaRvsOnly, { lotId: lot.id }), "not_found");
    const { inspectionId } = await createInspection(warehouse, { lotId: lot.id });
    const v0 = await getLotDisposition(qaLead, lot.id);
    expect(v0.decisions.find((d) => d.decision === "release")?.blocker).toMatch(/Inspection INS-/);
    const v = await getInspection(qa, inspectionId);
    for (const t of v.tests) await recordInspectionResult(qa, { inspectionId, planTestId: t.id, value: "Conforms", conforms: true });
    await expectCode(decideLot(qaLead, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" }), "state");
    await reviewInspection(qaLead, { inspectionId, decision: "approve" });
    await expectCode(decideLot(qa, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" }), "separation_of_duties");
    await decideLot(qaLead, { lotId: lot.id, decision: "release", reason: "CoA reviewed, conforms" });
    expect((await db.select().from(inventoryLots).where(eq(inventoryLots.id, lot.id)))[0].qualityStatus).toBe("released");
  });
});

describe("US-3-16 genealogy to finished lot", () => {
  it("genealogy.forward_and_backward: forward from a supplier lot with receipts, as-of time and depth", async () => {
    const t0 = Date.now();
    const t = await traceGenealogy(qa, { supplierLot: "LOS-24871" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(t.root?.kind).toBe("supplier_lot");
    expect(t.asOf).toBeInstanceOf(Date);
    expect(t.maxDepth).toBe(20);
    const lotNode = t.forward[0];
    expect(lotNode.supplierLot).toBe("LOS-24871");
    expect(lotNode.receiptNumber).toMatch(/^GR-/);
    const flat: string[] = [];
    const walk = (ns: typeof t.forward) => ns.forEach((n) => (flat.push(`${n.kind}:${n.itemKind ?? ""}`), walk(n.children)));
    walk(t.forward);
    expect(flat).toContain("batch:");
    expect(flat).toContain("lot:product");
    expect(t.affectedCustomers.length).toBeGreaterThan(0);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "quality.genealogy.viewed"), eq(auditEvents.entityNumber, "LOS-24871")));
    expect(ev.length).toBeGreaterThan(0);
    expect((await traceGenealogy(qaRvsOnly, { supplierLot: "LOS-24871" })).root).toBeNull();
  });

  it("export needs quality.genealogy.export and is audited", async () => {
    await expectCode(runExport(warehouse, genealogyExport, { lotNumber: "L-2610-00001" }, "csv"), "forbidden");
    const f = await runExport(qa, genealogyExport, { lotNumber: "L-2610-00001" }, "csv");
    expect(f.rowCount).toBeGreaterThan(3);
    expect(f.body.toString("utf8")).toContain("Luntian Wellness Stores");
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.action, "quality.genealogy.exported"));
    expect(ev).toHaveLength(1);
    const ex = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.export.created"), eq(auditEvents.entityNumber, "quality.genealogy")));
    expect(ex).toHaveLength(1);
  });
});

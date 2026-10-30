import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batchClosures, batchQualityChecks, batches, generatedDocuments, inspections, inventoryLots, notifications, salesOrders, settings, testResults, users, workOrders } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { systemContext } from "@/lib/auth/system";
import { finishBatch, getProductionOrder } from "@/modules/production";
import { decideQualityCheck, getInspection, getQualityCheck, listWaitingForCheck, recordInspectionResult, recordInspectionResults } from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { type Crew, directBatchReadyToFinish, orderReadyToFinish } from "../../support/g3";

/**
 * Stage G3 / V2-7 Check quality (ADR-080 §8–9; QA review B1, B2, S6, S7): one page, Pass / Not yet /
 * Fail; release independence with the owner override only by typed reason (printed on the BMR);
 * tester may release by setting; pass closes the batch and finishes the order; idempotent.
 */
let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let qaRvs: AuthContext;
let warehouse: AuthContext;
let planner: AuthContext;
let crew: Required<Crew>;

const key = () => `qc-${randomUUID()}`;

async function setSetting(k: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, k)));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: k, value: value as object });
}

/** Finishes a ready batch (operator + checker, wrappers balanced, no samples to keep the numbers simple). */
async function finish(b: { batchId: string; wrapperMaterialId: string }, good: string, taken: number, op: AuthContext = operator) {
  return finishBatch(op, { batchId: b.batchId, goodUnits: good, samplesKept: "0", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: String(taken - Number(good)) }], idempotencyKey: key() }, { checker });
}

/** Enters a conforming result for every test of the batch's inspection. */
async function passTests(by: AuthContext, batchId: string) {
  const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, batchId));
  const v = await getInspection(by, ins.id);
  for (const t of v.tests) {
    if (t.valueKind === "numeric") {
      const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
      const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
      const value = lo && hi ? lo.plus(hi).div(2) : (lo ?? hi ?? new Decimal(1));
      await recordInspectionResult(by, { inspectionId: ins.id, planTestId: t.id, value: value.toString(), uom: t.uom });
    } else await recordInspectionResult(by, { inspectionId: ins.id, planTestId: t.id, value: "Conforms", conforms: true });
  }
  return ins.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd]);
  qaRvs = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  crew = { manager, operator, checker, planner, warehouse };
}, 180_000);

describe("Check quality: who may decide", () => {
  let batchId: string;
  beforeAll(async () => {
    const b = await directBatchReadyToFinish(kit, crew);
    await finish(b, "60", 70);
    batchId = b.batchId;
    await passTests(qa, batchId);
  }, 120_000);

  it("refuses operators, the warehouse and the owner without the override (non-QA), and QA of another site", async () => {
    const input = { batchId, decision: "pass" as const, recordReviewed: true, idempotencyKey: key() };
    await expectCode(decideQualityCheck(operator, input), "forbidden");
    await expectCode(decideQualityCheck(warehouse, input), "forbidden");
    const [o] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
    const owner = (await buildContextForUser(o.id, kit.nfd.id))!;
    expect(owner.ownerOverride).toBe(false);
    await expectCode(decideQualityCheck(owner, input), "forbidden");
    await expectCode(decideQualityCheck(qaRvs, input), "not_found");
    await expectCode(getQualityCheck(qaRvs, batchId), "not_found");
    // Release only from the releaser's own session: a system context with the permission is refused.
    const sys = await systemContext(kit.orgId, { code: "test_release", systemPermissions: ["quality.disposition.approve"] });
    await expectCode(decideQualityCheck(sys, input), "forbidden");
  });

  it("lists the batch as waiting, with its exceptions box and the tests entered", async () => {
    const list = await listWaitingForCheck(qa);
    expect(list.map((x) => x.id)).toContain(batchId);
    const v = await getQualityCheck(qa, batchId);
    expect(v.decidable).toBe(true);
    expect(v.inspection?.tests.every((t) => t.result?.passed)).toBe(true);
    expect(v.independence.isMaker).toBe(false);
    expect(v.isTester).toBe(true);
    expect(v.testerMayRelease).toBe(true);
    expect(v.can.pass).toBe(true);
    expect(Array.isArray(v.exceptions)).toBe(true);
  });

  it("Pass needs the 'batch record reviewed' tick", async () => {
    const e = await expectCode(decideQualityCheck(qa, { batchId, decision: "pass", recordReviewed: false, idempotencyKey: key() }), "validation");
    expect(e.details?.field).toBe("recordReviewed");
  });

  it("the tester passes (setting on): inspection reviewed, lot released, batch closed automatically with the BMR; a retry replays", async () => {
    const k = key();
    const r = await decideQualityCheck(qa, { batchId, decision: "pass", recordReviewed: true, idempotencyKey: k });
    expect(r.decision).toBe("pass");
    expect(r.closed, r.closeBlockers.join(" | ")).toBe(true);
    expect(r.documentNumber).toBeTruthy();
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(b.status).toBe("closed");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    expect(lot.qualityStatus).toBe("released");
    const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, batchId));
    expect(ins.status).toBe("approved");
    expect(ins.reviewedBy).toBe(qa.userId);
    const [cl] = await db.select().from(batchClosures).where(eq(batchClosures.batchId, batchId));
    expect(cl).toBeTruthy();
    const closedAudit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.batch.closed")));
    expect(closedAudit[0].actorLabel).toBe("system:quality_pass_auto_close");
    expect(closedAudit[0].onBehalfOf).toBe(qa.userId);
    const [row] = await db.select().from(batchQualityChecks).where(eq(batchQualityChecks.batchId, batchId));
    expect(row).toMatchObject({ decision: "pass", recordReviewed: true, testerReleased: true, overrideReason: null });
    const again = await decideQualityCheck(qa, { batchId, decision: "pass", recordReviewed: true, idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(await db.select().from(batchQualityChecks).where(eq(batchQualityChecks.batchId, batchId))).toHaveLength(1);
    // The decided batch cannot be decided again with a new key.
    await expectCode(decideQualityCheck(qa, { batchId, decision: "fail", reason: "second try", idempotencyKey: key() }), "state");
  });
});

describe("Release independence (B1) and tester rule (B2)", () => {
  it("a QA person who checked a step of the batch can never pass it", async () => {
    const b = await directBatchReadyToFinish(kit, { ...crew, checker: qaLead });
    await finishBatch(operator, { batchId: b.batchId, goodUnits: "60", samplesKept: "0", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "10" }], idempotencyKey: key() }, { checker: qaLead });
    await passTests(qa, b.batchId);
    const e = await expectCode(decideQualityCheck(qaLead, { batchId: b.batchId, decision: "pass", recordReviewed: true, overrideReason: "I am sure it is fine", idempotencyKey: key() }), "separation_of_duties");
    expect(e.message).toMatch(/cannot pass it/);
    expect((await getQualityCheck(qaLead, b.batchId)).can.pass).toBe(false);
  });

  it("with quality.release.tester_may_release off, the tester cannot pass; another QA person can", async () => {
    await setSetting("quality.release.tester_may_release", false);
    const b = await directBatchReadyToFinish(kit, crew);
    await finish(b, "60", 70);
    await passTests(qa, b.batchId);
    await expectCode(decideQualityCheck(qa, { batchId: b.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() }), "separation_of_duties");
    const r = await decideQualityCheck(qaLead, { batchId: b.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect(r.decision).toBe("pass");
    const [row] = await db.select().from(batchQualityChecks).where(eq(batchQualityChecks.batchId, b.batchId));
    expect(row.testerReleased).toBe(false);
    await setSetting("quality.release.tester_may_release", true);
  });

  it("the owner who made the batch passes only with a typed reason (override), audited and printed on the BMR", async () => {
    await setSetting("governance.owner_override", true);
    const [o] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
    const owner = (await buildContextForUser(o.id, kit.nfd.id))!;
    expect(owner.ownerOverride).toBe(true);
    const b = await directBatchReadyToFinish(kit, { ...crew, operator: owner });
    await finish(b, "60", 70, owner);
    await passTests(qa, b.batchId);
    const v = await getQualityCheck(owner, b.batchId);
    expect(v.independence).toMatchObject({ isMaker: true, ownerOverride: true });
    const e = await expectCode(decideQualityCheck(owner, { batchId: b.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() }), "validation");
    expect(e.details?.field).toBe("overrideReason");
    const reason = "No separate QA person yet; GMP consultant informed";
    const r = await decideQualityCheck(owner, { batchId: b.batchId, decision: "pass", recordReviewed: true, overrideReason: reason, idempotencyKey: key() });
    expect(r.decision).toBe("pass");
    const [row] = await db.select().from(batchQualityChecks).where(eq(batchQualityChecks.batchId, b.batchId));
    expect(row.overrideReason).toBe(reason);
    const used = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "governance.owner_override.used"), eq(auditEvents.actorId, o.id)));
    expect(used.length).toBeGreaterThan(0);
    const passed = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), eq(auditEvents.action, "quality.quality_check.passed")));
    expect((passed[0].after as { overrideReason: string }).overrideReason).toBe(reason);
    const docs = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityId, b.batchId), eq(generatedDocuments.documentKind, "bmr")));
    expect(docs.length).toBeGreaterThan(0);
    const latest = docs.sort((x, y) => y.generatedAt.getTime() - x.generatedAt.getTime())[0];
    expect((latest.dataset as { data: { disposition: { overrideReason: string } } }).data.disposition.overrideReason).toBe(reason);
    expect(JSON.stringify(latest.dataset)).toContain(reason);
    await setSetting("governance.owner_override", false);
  });
});

describe("Not yet and Fail", () => {
  it("Not yet puts the lot on hold (On hold) with a date; a later Pass lifts it", async () => {
    const b = await directBatchReadyToFinish(kit, crew);
    await finish(b, "60", 70);
    await expectCode(decideQualityCheck(qa, { batchId: b.batchId, decision: "not_yet", reason: "Wait for the pH retest", idempotencyKey: key() }), "validation");
    const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    await decideQualityCheck(qa, { batchId: b.batchId, decision: "not_yet", reason: "Wait for the pH retest", checkAgainOn: day, idempotencyKey: key() });
    const v = await getQualityCheck(qa, b.batchId);
    expect(v.onHold).toBe(true);
    expect(v.lastCheck).toMatchObject({ decision: "not_yet", checkAgainOn: day });
    expect((await listWaitingForCheck(qa)).find((x) => x.id === b.batchId)).toMatchObject({ onHold: true, checkAgainOn: day });
    await passTests(qa, b.batchId);
    const r = await decideQualityCheck(qa, { batchId: b.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect(r.decision).toBe("pass");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId));
    expect(lot.qualityStatus).toBe("released");
  });

  it("Fail needs a reason and rejects the batch and its lot", async () => {
    const b = await directBatchReadyToFinish(kit, crew);
    await finish(b, "60", 70);
    await expectCode(decideQualityCheck(qa, { batchId: b.batchId, decision: "fail", idempotencyKey: key() }), "validation");
    const r = await decideQualityCheck(qa, { batchId: b.batchId, decision: "fail", reason: "Soda ash on every bar", idempotencyKey: key() });
    expect(r.batchStatus).toBe("rejected");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId));
    expect(lot.qualityStatus).toBe("rejected");
  });

  it("an open problem report blocks the pass", async () => {
    const b = await directBatchReadyToFinish(kit, crew);
    await finishBatch(operator, { batchId: b.batchId, goodUnits: "50", samplesKept: "0", problemReason: "Mould leaked, bars lost", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "20" }], idempotencyKey: key() }, { checker });
    await passTests(qa, b.batchId);
    const v = await getQualityCheck(qa, b.batchId);
    expect(v.exceptions.map((x) => x.kind)).toEqual(expect.arrayContaining(["yield_out_of_range", "open_problem_report"]));
    await expectCode(decideQualityCheck(qa, { batchId: b.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() }), "state");
  });
});

describe("Order status after the quality check", () => {
  it("a 2-batch order: one pass and one fail → Done with '1 of 2 batches failed'", async () => {
    const order = await orderReadyToFinish(kit, crew, { batches: 2 });
    for (const b of order.batches) await finish(b, "60", 70);
    const [b1, b2] = order.batches;
    await passTests(qa, b1.batchId);
    await decideQualityCheck(qa, { batchId: b1.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect((await getProductionOrder(planner, order.workOrderId)).status).toBe("quality_check");
    await decideQualityCheck(qa, { batchId: b2.batchId, decision: "fail", reason: "Cracked bars throughout", idempotencyKey: key() });
    const v = await getProductionOrder(planner, order.workOrderId);
    expect(v.status).toBe("done");
    expect(v.statusView.warning).toBe("1 of 2 batches failed");
  }, 120_000);

  it("a 1-batch order that fails → Failed", async () => {
    const order = await orderReadyToFinish(kit, crew, { batches: 1 });
    await finish(order.batches[0], "60", 70);
    await decideQualityCheck(qa, { batchId: order.batches[0].batchId, decision: "fail", reason: "Wrong colour", idempotencyKey: key() });
    expect((await getProductionOrder(planner, order.workOrderId)).status).toBe("failed");
  }, 120_000);

  it("an order made for a customer order: Pass closes the batch, the order is Done and the order taker is told", async () => {
    const [so] = await db.select().from(salesOrders).where(and(eq(salesOrders.siteId, kit.nfd.id), inArray(salesOrders.status, ["submitted", "confirmed", "allocated"]))).limit(1);
    const order = await orderReadyToFinish(kit, crew, { batches: 1, salesOrderId: so.id });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, order.workOrderId));
    expect(wo.salesOrderId).toBe(so.id);
    await finish(order.batches[0], "60", 70);
    await passTests(qa, order.batches[0].batchId);
    const r = await decideQualityCheck(qa, { batchId: order.batches[0].batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect(r.closed, r.closeBlockers.join(" | ")).toBe(true);
    expect(r.notified).toBe(1);
    const v = await getProductionOrder(planner, order.workOrderId);
    expect(v.status).toBe("done");
    const [w2] = await db.select().from(workOrders).where(eq(workOrders.id, order.workOrderId));
    expect(w2.status).toBe("closed");
    const n = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, so.createdBy), eq(notifications.kind, "sales.order.stock_available")));
    expect(n).toHaveLength(1);
    expect(n[0].body).toMatch(/60 ready to sell/);
  }, 120_000);
});

describe("Tests saved in one form (consultant review)", () => {
  it("saves all results in one transaction; one wrong entry saves nothing and names each field; site and role scoped; retry replays", async () => {
    const b = await directBatchReadyToFinish(kit, crew);
    await finish(b, "60", 70);
    const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, b.batchId));
    const v = await getInspection(qa, ins.id);
    const good = v.tests.map((t) => {
      if (t.valueKind !== "numeric") return { planTestId: t.id, value: "Conforms", conforms: true };
      const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
      const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
      return { planTestId: t.id, value: (lo && hi ? lo.plus(hi).div(2) : (lo ?? hi ?? new Decimal(1))).toString(), uom: t.uom };
    });
    const numeric = v.tests.find((t) => t.valueKind === "numeric");
    expect(numeric, "the plan has a numeric test").toBeTruthy();
    const other = v.tests.find((t) => t.valueKind !== "numeric");

    // A wrong unit and a missing yes/no: refused together, nothing saved.
    const wrong = good.map((r) => (r.planTestId === numeric!.id ? { ...r, uom: "furlong" } : other && r.planTestId === other.id ? { planTestId: r.planTestId, value: "x", conforms: null } : r));
    const e = await expectCode(recordInspectionResults(qa, { inspectionId: ins.id, results: wrong }), "validation");
    const fe = e.details?.fieldErrors as Record<string, string>;
    expect(Object.keys(fe)).toContain(`r-${numeric!.id}-uom`);
    if (other) expect(Object.keys(fe)).toContain(`r-${other.id}-conforms`);
    expect(await db.select().from(testResults).where(eq(testResults.inspectionId, ins.id))).toHaveLength(0);

    await expectCode(recordInspectionResults(operator, { inspectionId: ins.id, results: good }), "forbidden");
    await expectCode(recordInspectionResults(qaRvs, { inspectionId: ins.id, results: good }), "not_found");
    await expectCode(recordInspectionResults(qa, { inspectionId: ins.id, results: [good[0], good[0]] }), "validation");

    const k = key();
    const r = await recordInspectionResults(qa, { inspectionId: ins.id, results: good, idempotencyKey: k });
    expect(r.saved).toHaveLength(v.tests.length);
    expect(r.failed).toEqual([]);
    const again = await recordInspectionResults(qa, { inspectionId: ins.id, results: good, idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(await db.select().from(testResults).where(eq(testResults.inspectionId, ins.id))).toHaveLength(v.tests.length);
    const [after] = await db.select().from(inspections).where(eq(inspections.id, ins.id));
    expect(after.status).toBe("awaiting_review");
    expect(after.performedBy).toBe(qa.userId);
    const q = await getQualityCheck(qa, b.batchId);
    expect(q.inspection?.tests.every((t) => t.result?.passed)).toBe(true);
  }, 120_000);
});

describe("G3 custom migration", () => {
  it("the migration matches src/db/sql/g3.sql", async () => {
    const { customMigration } = await import("../../support/custom-sql");
    const { migration, canonical } = customMigration("g3");
    expect(migration.trim()).toBe(canonical.trim());
  });
});

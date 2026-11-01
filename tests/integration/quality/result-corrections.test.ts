/**
 * ADR-104 §3 (A-FD-04): correcting a QA test result. Results are append-only; a correction supersedes the old row.
 *  - Before the decision: the person who entered it or another QA user corrects at once (old row stays, struck through).
 *  - After the decision: a request a SECOND QA person approves; approval re-opens the decision (stock moves of the
 *    decision reversed, lot back to quarantine, batch back to the quality check, closed batch → reopen n).
 *  - Never the requester; the owner override never applies; other sites do not find it; refused when stock moved on.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchReopenRequests, batches, inspections, inventoryBalances, inventoryLots, locations, qaResultCorrections, stockMovements, testResults } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";
import { postMovement } from "@/modules/inventory";
import { finishBatch } from "@/modules/production";
import {
  correctTestResult,
  decideQualityCheck,
  decideResultCorrection,
  getInspection,
  getQualityCheck,
  recordInspectionResult,
  requestResultCorrection,
  resultCorrectionApprovalVerdicts,
  resultHistory,
} from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { type Crew, directBatchReadyToFinish } from "../../support/g3";

let kit: Kit;
let operator: AuthContext;
let checker: AuthContext;
let manager: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let qaRvs: AuthContext;
let owner: AuthContext;
let ownerOverride: AuthContext;
let crew: Crew;
const key = () => `rc-${randomUUID()}`;

async function finishedAndTested() {
  const b = await directBatchReadyToFinish(kit, crew);
  await finishBatch(operator, { batchId: b.batchId, goodUnits: "60", samplesKept: "0", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "10" }], idempotencyKey: key() }, { checker });
  const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, b.batchId));
  const v = await getInspection(qa, ins.id);
  for (const t of v.tests) {
    if (t.valueKind === "numeric") {
      const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
      const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
      await recordInspectionResult(qa, { inspectionId: ins.id, planTestId: t.id, value: (lo && hi ? lo.plus(hi).div(2) : (lo ?? hi ?? new Decimal(1))).toString(), uom: t.uom });
    } else await recordInspectionResult(qa, { inspectionId: ins.id, planTestId: t.id, value: "Conforms", conforms: true });
  }
  const [num] = v.tests.filter((t) => t.valueKind === "numeric");
  const [first] = await db.select().from(testResults).where(and(eq(testResults.inspectionId, ins.id), eq(testResults.inspectionPlanTestId, num.id)));
  return { batchId: b.batchId, inspectionId: ins.id, test: num, resultId: first.id };
}

const valueIn = (t: { specMin: string | null; specMax: string | null }, shift = 0) => {
  const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
  const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
  return (lo && hi ? lo.plus(hi).div(2).plus(shift) : (lo ?? hi ?? new Decimal(1)).plus(shift)).toString();
};

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd]);
  qaRvs = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerOverride = new AuthContext(owner.userId, kit.orgId, owner.displayName, owner.email, ["owner_director"], new Set(PERMISSIONS), [kit.nfd, kit.rvs], kit.nfd.id, {
    ownerOverride: { basePermissions: new Set(ROLE_BUNDLES.owner_director.permissions), used: [] },
  });
  crew = { manager, operator, checker };
}, 180_000);

describe("before the decision: correct at once; the old value stays, struck through", () => {
  let f: Awaited<ReturnType<typeof finishedAndTested>>;
  beforeAll(async () => {
    f = await finishedAndTested();
  }, 180_000);

  it("negatives: operator, the owner (not QA, did not enter it), the owner with the override and another site", async () => {
    const input = { resultId: f.resultId, value: valueIn(f.test, 0.1), reason: "Typo in the reading" };
    await expectCode(correctTestResult(operator, input), "forbidden");
    await expectCode(correctTestResult(owner, input), "forbidden");
    await expectCode(correctTestResult(ownerOverride, input), "forbidden");
    await expectCode(correctTestResult(qaRvs, input), "not_found");
    await expectCode(requestResultCorrection(qa, input), "state"); // not decided yet: correct directly
    await expectCode(correctTestResult(qa, { ...input, reason: "x" }), "validation");
  });

  it("the person who entered it corrects; another QA user corrects the newest; a repeat replays; the old one is refused", async () => {
    const k = key();
    const r1 = await correctTestResult(qa, { resultId: f.resultId, value: valueIn(f.test, 0.1), reason: "Typo in the reading", idempotencyKey: k });
    const again = await correctTestResult(qa, { resultId: f.resultId, value: valueIn(f.test, 0.1), reason: "Typo in the reading", idempotencyKey: k });
    expect(again.newResultId).toBe(r1.newResultId);
    await expectCode(correctTestResult(qaLead, { resultId: f.resultId, value: valueIn(f.test), reason: "Old row again" }), "conflict");
    const r2 = await correctTestResult(qaLead, { resultId: r1.newResultId, value: valueIn(f.test), reason: "Read the meter again" });
    const h = await resultHistory(db, f.batchId);
    const chain = h.filter((x) => [f.resultId, r1.newResultId, r2.newResultId].includes(x.id));
    expect(chain.map((x) => x.live)).toEqual([false, false, true]);
    expect(chain[2]).toMatchObject({ supersedesId: r1.newResultId, correctionReason: "Read the meter again", by: expect.stringMatching(/./) });
    f.resultId = r2.newResultId;
  });
});

describe("after the decision: a second QA person approves and the decision re-opens", () => {
  let f: Awaited<ReturnType<typeof finishedAndTested>>;
  let requestId: string;
  beforeAll(async () => {
    f = await finishedAndTested();
    const r = await decideQualityCheck(qa, { batchId: f.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect(r.closed, r.closeBlockers.join(" | ")).toBe(true);
  }, 180_000);

  it("a direct correction is refused; the request is made by QA", async () => {
    await expectCode(correctTestResult(qa, { resultId: f.resultId, value: valueIn(f.test, 0.2), reason: "Wrong decimal place" }), "state");
    const r = await requestResultCorrection(qa, { resultId: f.resultId, value: valueIn(f.test, 0.2), reason: "Wrong decimal place", idempotencyKey: key() });
    requestId = r.requestId;
    await expectCode(requestResultCorrection(qaLead, { resultId: f.resultId, value: "1", reason: "Second request" }), "conflict");
  });

  it("negatives: the requester, the site manager, the owner with the override and another site's QA cannot approve", async () => {
    await expectCode(decideResultCorrection(qa, { requestId, decision: "approve" }), "separation_of_duties");
    await expectCode(decideResultCorrection(manager, { requestId, decision: "approve" }), "forbidden");
    await expectCode(decideResultCorrection(ownerOverride, { requestId, decision: "approve" }), "forbidden");
    await expectCode(decideResultCorrection(qaRvs, { requestId, decision: "approve" }), "not_found");
    expect((await resultCorrectionApprovalVerdicts(qaLead, [requestId])).get(requestId)?.canDecide).toBe(true);
    expect((await resultCorrectionApprovalVerdicts(qa, [requestId])).get(requestId)?.canDecide).toBe(false);
    expect((await resultCorrectionApprovalVerdicts(ownerOverride, [requestId])).get(requestId)?.canDecide).toBe(false);
  });

  it("the second QA person approves: stock moves reversed, lot in quarantine, batch back to the check (reopen 1); a repeat replays", async () => {
    const [before] = await db.select().from(batches).where(eq(batches.id, f.batchId));
    expect(before.status).toBe("closed");
    const k = key();
    const r = await decideResultCorrection(qaLead, { requestId, decision: "approve", note: "Checked the lab sheet", idempotencyKey: k });
    expect(r.status).toBe("approved");
    const again = await decideResultCorrection(qaLead, { requestId, decision: "approve", note: "Checked the lab sheet", idempotencyKey: k });
    expect(again.newResultId).toBe(r.newResultId);
    const [b] = await db.select().from(batches).where(eq(batches.id, f.batchId));
    expect(b.status).toBe("quarantined");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    expect(lot.qualityStatus).toBe("quarantine");
    const bal = await db.select({ kind: locations.kind, qty: inventoryBalances.qtyBase }).from(inventoryBalances).innerJoin(locations, eq(locations.id, inventoryBalances.locationId)).where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")));
    expect(bal.every((x) => x.kind === "quarantine")).toBe(true);
    const rev = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "reversal")));
    expect(rev.length).toBeGreaterThan(0);
    const [reopen] = await db.select().from(batchReopenRequests).where(eq(batchReopenRequests.batchId, f.batchId));
    expect(reopen).toMatchObject({ status: "reopened", reopenNo: 1, targetState: "quarantined" });
    const [ins] = await db.select().from(inspections).where(eq(inspections.id, f.inspectionId));
    expect(["in_progress", "awaiting_review"]).toContain(ins.status);
    const h = await resultHistory(db, f.batchId);
    expect(h.find((x) => x.id === f.resultId)?.live).toBe(false);
    expect(h.find((x) => x.id === r.newResultId)?.live).toBe(true);
    const [row] = await db.select().from(qaResultCorrections).where(eq(qaResultCorrections.id, requestId));
    expect(row).toMatchObject({ status: "approved", decidedBy: qaLead.userId, newResultId: r.newResultId });
    // The batch is decided again on Check quality (the owner override still cannot stand in for QA there).
    const v = await getQualityCheck(qaLead, f.batchId);
    expect(v.decidable).toBe(true);
    const pass = await decideQualityCheck(qaLead, { batchId: f.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    expect(pass.closed, pass.closeBlockers.join(" | ")).toBe(true);
  });
});

describe("refused when stock moved on after the decision; refusal path", () => {
  it("a moved lot cannot be re-opened here (and says why); a request can be refused with a reason", async () => {
    const f = await finishedAndTested();
    await decideQualityCheck(qa, { batchId: f.batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
    const [b] = await db.select().from(batches).where(eq(batches.id, f.batchId));
    const r = await requestResultCorrection(qa, { resultId: f.resultId, value: valueIn(f.test, 0.3), reason: "Meter was not zeroed" });
    await expectCode(decideResultCorrection(qaLead, { requestId: r.requestId, decision: "refuse", note: "x" }), "validation");
    const refused = await decideResultCorrection(qaLead, { requestId: r.requestId, decision: "refuse", note: "The lab sheet agrees with the first value" });
    expect(refused.status).toBe("refused");
    // Move part of the released lot to another place: re-opening is now refused with the reason.
    const [bal] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, b.outputLotId!), gt(inventoryBalances.qtyBase, "0")));
    const [from] = await db.select().from(locations).where(eq(locations.id, bal.locationId));
    const [to] = await db.select().from(locations).where(and(eq(locations.siteId, b.siteId), eq(locations.kind, from.kind))).then((rows) => rows.filter((x) => x.id !== from.id));
    if (to) {
      await db.transaction((tx) => postMovement(tx, manager, { movementType: "transfer", lotId: b.outputLotId!, fromLocationId: from.id, toLocationId: to.id, qtyBase: "1", sourceDocumentType: "test_fixture" }));
      const e = await expectCode(requestResultCorrection(qa, { resultId: f.resultId, value: valueIn(f.test, 0.3), reason: "Meter was not zeroed" }), "state");
      expect(e.message).toMatch(/already moved after the decision/);
    }
  }, 240_000);
});

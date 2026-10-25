import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, dispositions, inventoryLots, recallCaseCustomers, recallCaseLots, recallCaseStateTransitions, recallCases } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { runExport } from "@/lib/export";
import { assertLotUsable } from "@/modules/inventory";
import {
  RECALL_CASE_TRANSITIONS,
  canMoveRecallCase,
  cancelRecallCase,
  closeRecallCase,
  decideLot,
  decideRecallCase,
  getRecallCase,
  listRecallCases,
  markRecallCaseLots,
  openRecallCase,
  recallCaseCandidates,
  recallNotificationExport,
  recordRecallAccounted,
  recordRecallNotification,
  startRecallDrill,
  startRecallRecovery,
  submitRecallCase,
} from "@/modules/quality";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { salesAndWarehouse, shipToCustomer } from "../sales/w3f-fixtures";

/** US-6-18 recall cases (W4C): scope from the explorer, two approvals, bulk "recalled" marking, notifications, reconciliation. */

let kit: Kit;
let sales: AuthContext;
let salesRvs: AuthContext;
let warehouse: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let owner: AuthContext;
let shipped: Awaited<ReturnType<typeof shipToCustomer>>;
let caseId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  ({ sales, warehouse } = await salesAndWarehouse(kit));
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  // Isla Spa Supplies (CUS-002) receives 24 Acapulco soap bars through the real W3E flow.
  shipped = await shipToCustomer(sales, warehouse, "CUS-002", [{ sku: "ACS-135", qty: "24" }]);
});

describe("US-6-18 recall case", () => {
  it("statemachine.recall_case: only the listed transitions are allowed", () => {
    expect(RECALL_CASE_TRANSITIONS.draft).toEqual(["submitted", "cancelled"]);
    expect(canMoveRecallCase("submitted", "notifying")).toBe(false);
    expect(canMoveRecallCase("approved", "notifying")).toBe(true);
    expect(canMoveRecallCase("closed", "draft")).toBe(false);
  });

  it("opens a case from the explorer: lots, boxes and customer lines are stored at opening; retry-safe", async () => {
    const lot = shipped.lots[0];
    await expectCode(openRecallCase(warehouse, { code: lot.lotNumber, recallKind: "recall", title: "x", description: "Spots on bars." }), "forbidden");
    await expectCode(openRecallCase(qa, { code: "L-NO-SUCH", recallKind: "recall", title: "Spots", description: "Spots on bars." }), "validation");
    const r = await openRecallCase(qa, { code: lot.lotNumber, mode: "forward", recallKind: "recall", title: "White spots on Acapulco soap", description: "Complaints of white spots; precautionary recall of the lot.", classification: "To be classified by QA/regulatory", idempotencyKey: "w4c-rc-1" });
    caseId = r.recallCaseId;
    expect(r.recallNumber).toMatch(/^RC-\d{4}-\d{2}$/);
    expect((await openRecallCase(qa, { code: lot.lotNumber, recallKind: "recall", title: "White spots on Acapulco soap", description: "Complaints of white spots; precautionary recall of the lot.", idempotencyKey: "w4c-rc-1" })).replayed).toBe(true);
    const [c] = await db.select().from(recallCases).where(eq(recallCases.id, caseId));
    expect(c).toMatchObject({ status: "draft", recallKind: "recall", originSiteId: kit.nfd.id, traceMode: "forward" });
    const lots = await db.select().from(recallCaseLots).where(eq(recallCaseLots.recallCaseId, caseId));
    expect(lots.map((l) => l.lotId)).toContain(lot.lotId);
    const lines = await db.select().from(recallCaseCustomers).where(eq(recallCaseCustomers.recallCaseId, caseId));
    const isla = lines.find((l) => l.customerId === shipped.customer.id && l.shipmentId === shipped.shipment.id);
    expect(isla?.qtyShippedBase).toMatch(/^24(\.0+)?$/);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, caseId), eq(auditEvents.action, "quality.recall_case.opened")))).toHaveLength(1);
  });

  it("authz.cross_site.recall_case and role escalation: an RVS-only user does not see an NFD case; sales cannot submit or approve", async () => {
    await expectCode(getRecallCase(salesRvs, caseId), "not_found");
    expect((await listRecallCases(salesRvs, { status: "all" })).find((x) => x.id === caseId)).toBeUndefined();
    expect((await getRecallCase(warehouse, caseId)).recall.id).toBe(caseId);
    await expectCode(submitRecallCase(sales, { recallCaseId: caseId }), "forbidden");
    await expectCode(decideRecallCase(sales, { recallCaseId: caseId, decision: "approved", password: "demo1234" }), "forbidden");
  });

  it("quality.recall_two_approvals: qa_qc then owner_director, never the opener or submitter, with re-authentication", async () => {
    await submitRecallCase(qa, { recallCaseId: caseId });
    await expectCode(decideRecallCase(qa, { recallCaseId: caseId, decision: "approved", password: "demo1234" }), "separation_of_duties");
    await expectCode(decideRecallCase(owner, { recallCaseId: caseId, decision: "approved", password: "demo1234" }), "forbidden");
    await expectCode(decideRecallCase(qaLead, { recallCaseId: caseId, decision: "approved", password: "wrong-password" }), "reauth_required");
    expect((await decideRecallCase(qaLead, { recallCaseId: caseId, decision: "approved", note: "Scope checked", password: "demo1234" })).status).toBe("submitted");
    await expectCode(decideRecallCase(qaLead, { recallCaseId: caseId, decision: "approved", password: "demo1234" }), "forbidden");
    await expectCode(markRecallCaseLots(qa, { recallCaseId: caseId, password: "demo1234" }), "state");
    expect((await decideRecallCase(owner, { recallCaseId: caseId, decision: "approved", note: "Go", password: "demo1234" })).status).toBe("approved");
    const ds = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "recall_case"), eq(approvalDecisions.recordId, caseId)));
    expect(ds.map((d) => [d.step, d.decidedBy])).toEqual([
      [1, qaLead.userId],
      [2, owner.userId],
    ]);
  });

  it("Mark recalled writes recall dispositions per lot through decideLot and blocks shipment of the lot (V-REC)", async () => {
    await expectCode(markRecallCaseLots(owner, { recallCaseId: caseId, password: "demo1234" }), "forbidden");
    await expectCode(markRecallCaseLots(qa, { recallCaseId: caseId, password: "nope" }), "reauth_required");
    // A recall decision outside a case is refused.
    await expectCode(decideLot(qa, { lotId: shipped.lots[0].lotId, decision: "recall", reason: "Recall it now" }), "validation");
    const r = await markRecallCaseLots(qa, { recallCaseId: caseId, password: "demo1234" });
    expect(r.recalled).toBeGreaterThanOrEqual(1);
    const lotIds = (await db.select().from(recallCaseLots).where(eq(recallCaseLots.recallCaseId, caseId))).map((l) => l.lotId);
    const lots = await db.select().from(inventoryLots).where(inArray(inventoryLots.id, lotIds));
    expect(lots.every((l) => ["recalled", "rejected"].includes(l.qualityStatus))).toBe(true);
    const lot = lots.find((l) => l.id === shipped.lots[0].lotId)!;
    expect(lot.qualityStatus).toBe("recalled");
    expect(() => assertLotUsable(lot)).toThrow(/recalled/);
    const d = await db.select().from(dispositions).where(and(eq(dispositions.subjectId, lot.id), eq(dispositions.decision, "recall")));
    expect(d).toHaveLength(1);
    const marked = await db.select().from(recallCaseLots).where(and(eq(recallCaseLots.recallCaseId, caseId), eq(recallCaseLots.lotId, lot.id)));
    expect(marked[0]).toMatchObject({ outcome: "recalled", dispositionId: d[0].id });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, lot.id), eq(auditEvents.action, "quality.disposition.recalled")));
    expect(ev).toHaveLength(1);
    expect(ev[0].correlationId).toBe(r.correlationId);
    const [c] = await db.select().from(recallCases).where(eq(recallCases.id, caseId));
    expect(c.status).toBe("notifying");
    // Repeatable: nothing left to mark.
    expect((await markRecallCaseLots(qa, { recallCaseId: caseId, password: "demo1234" })).recalled).toBe(0);
  });

  it("sales records notifications; recovery waits for every customer; accounted quantities are bounded", async () => {
    const v = await getRecallCase(sales, caseId);
    expect(v.customers.length).toBeGreaterThanOrEqual(1);
    await expectCode(startRecallRecovery(qa, { recallCaseId: caseId }), "state");
    await expectCode(recordRecallNotification(sales, { recallCaseId: caseId, customerId: shipped.customer.id, event: "acknowledged" }), "state");
    await expectCode(recordRecallNotification(sales, { recallCaseId: caseId, customerId: shipped.customer.id, event: "notified", method: "pigeon" }), "validation");
    for (const cust of v.customers) await recordRecallNotification(sales, { recallCaseId: caseId, customerId: cust.customerId, event: "notified", method: "phone", note: "Spoke to the buyer" });
    await recordRecallNotification(sales, { recallCaseId: caseId, customerId: shipped.customer.id, event: "acknowledged" });
    const csv = await runExport(sales, recallNotificationExport, { recallCaseId: caseId }, "csv");
    expect(csv.rowCount).toBe(v.customers.flatMap((c) => c.lines).length);
    await startRecallRecovery(qa, { recallCaseId: caseId });
    const isla = (await getRecallCase(qa, caseId)).customers.find((c) => c.customerId === shipped.customer.id)!.lines[0];
    await expectCode(recordRecallAccounted(qa, { lineId: isla.id, qty: "25", note: "Destroyed at the spa" }), "validation");
    await recordRecallAccounted(sales, { lineId: isla.id, qty: "24", note: "Destroyed at the spa (photo on file)" });
  });

  it("closure requires the reconciliation shipped − returned − accounted, with an explanation for any gap", async () => {
    await expectCode(closeRecallCase(sales, { recallCaseId: caseId, closureReport: "All done here", password: "demo1234" }), "forbidden");
    const v = await getRecallCase(qa, caseId);
    const gaps = v.customers.flatMap((c) => c.lines).filter((l) => !l.reconciled);
    if (gaps.length) {
      await expectCode(closeRecallCase(qa, { recallCaseId: caseId, closureReport: "Recall complete; see reconciliation", password: "demo1234" }), "validation");
    }
    const r = await closeRecallCase(qa, { recallCaseId: caseId, closureReport: "Recall complete; see reconciliation", reconciliationExplanation: gaps.length ? "Luntian sold the remaining bars before the notice; customers informed by the store." : null, password: "demo1234" });
    expect(r.status).toBe("closed");
    const tr = await db.select().from(recallCaseStateTransitions).where(eq(recallCaseStateTransitions.recallCaseId, caseId));
    expect(tr.map((t) => t.toState)).toEqual(["draft", "submitted", "approved", "notifying", "recovering", "closed"]);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, caseId), eq(auditEvents.action, "quality.recall_case.closed")))).toHaveLength(1);
  });

  it("a mock recall (drill) never marks stock; a draft can be cancelled by its opener", async () => {
    const [lotion] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.rvs.id), eq(inventoryLots.itemKind, "product"), eq(inventoryLots.qualityStatus, "released"))).limit(1);
    const r = await openRecallCase(qa, { code: lotion.lotNumber, recallKind: "mock", title: "Mock recall drill Q4", description: "Annual traceability drill (no stock is marked)." });
    await submitRecallCase(qa, { recallCaseId: r.recallCaseId });
    await decideRecallCase(qaLead, { recallCaseId: r.recallCaseId, decision: "approved", password: "demo1234" });
    expect((await recallCaseCandidates(kit.orgId)).find((c) => c.entityId === r.recallCaseId)?.kind).toBe("approval.recall_case");
    await decideRecallCase(owner, { recallCaseId: r.recallCaseId, decision: "approved", password: "demo1234" });
    await expectCode(markRecallCaseLots(qa, { recallCaseId: r.recallCaseId, password: "demo1234" }), "state");
    await startRecallDrill(qa, { recallCaseId: r.recallCaseId });
    const [after] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotion.id));
    expect(after.qualityStatus).toBe("released");
    expect((await recallCaseCandidates(kit.orgId)).find((c) => c.entityId === r.recallCaseId)?.kind).toBe("open_recall_case");

    const d = await openRecallCase(qa, { code: lotion.lotNumber, recallKind: "withdrawal", title: "Opened by mistake", description: "Opened from the wrong lot." });
    await expectCode(cancelRecallCase(qa, { recallCaseId: d.recallCaseId, reason: "x" }), "validation");
    expect((await cancelRecallCase(qa, { recallCaseId: d.recallCaseId, reason: "Opened from the wrong lot" })).status).toBe("cancelled");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, capaActions, capaStateTransitions, capas, changeControls, complaints, deviations, formulaRevisions, formulas, notifications, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createFormulaRevision } from "@/modules/masterdata";
import {
  CAPA_TRANSITIONS,
  CHANGE_CONTROL_TRANSITIONS,
  addCapaAction,
  cancelCapa,
  canMoveCapa,
  closeCapa,
  closeChangeControl,
  completeCapaAction,
  createChangeControl,
  decideChangeControl,
  getCapa,
  getChangeControl,
  implementChangeControl,
  listCapas,
  listChangeControls,
  openCapa,
  overdueCapaActionCandidates,
  recordEffectivenessCheck,
  reopenOrCancelCapaAction,
  submitCapaForClosure,
  submitChangeControl,
  updateCapa,
  updateChangeControl,
  verifyCapaAction,
} from "@/modules/quality";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";

/** US-6-18 CAPA and change control (W4C): state machines, separation of duties, cross-site and role negatives. */

let kit: Kit;
let qa: AuthContext;
let qaLead: AuthContext;
let qaRvs: AuthContext;
let manager: AuthContext;
let planner: AuthContext;
let operator: AuthContext;
let warehouse: AuthContext;
let owner: AuthContext;
let deviationId: string;

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaRvs = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  const [d] = await db.select().from(deviations).where(and(eq(deviations.siteId, kit.nfd.id), eq(deviations.status, "open"))).limit(1);
  deviationId = d.id;
});

describe("US-6-18 CAPA", () => {
  let capaId: string;

  it("statemachine.capa: only the listed transitions are allowed", () => {
    expect(CAPA_TRANSITIONS.open).toEqual(["in_progress", "cancelled"]);
    expect(canMoveCapa("open", "closed")).toBe(false);
    expect(canMoveCapa("in_progress", "closed")).toBe(false);
    expect(canMoveCapa("verification", "closed")).toBe(true);
    expect(canMoveCapa("closed", "in_progress")).toBe(false);
  });

  it("opens a CAPA from a deviation at the deviation's site, owner notified, retry-safe", async () => {
    const [mgr] = await db.select().from(users).where(eq(users.email, "manager.nfd@bryels-care.test"));
    await expectCode(openCapa(qa, { sourceKind: "deviation", deviationId, title: "Mixer stops on power dips", problemStatement: "Mixer paused for 8 minutes during trace.", ownerId: warehouse.userId }), "validation");
    const r = await openCapa(qa, { sourceKind: "deviation", deviationId, title: "Mixer stops on power dips", problemStatement: "Mixer paused for 8 minutes during trace.", ownerId: mgr.id, idempotencyKey: "w4c-capa-1" });
    expect(r.capaNumber).toMatch(/^CAPA-\d{2}-\d{3}$/);
    capaId = r.capaId;
    const [c] = await db.select().from(capas).where(eq(capas.id, capaId));
    expect(c).toMatchObject({ status: "open", siteId: kit.nfd.id, deviationId, sourceKind: "deviation", ownerId: mgr.id });
    const again = await openCapa(qa, { sourceKind: "deviation", deviationId, title: "Mixer stops on power dips", problemStatement: "Mixer paused for 8 minutes during trace.", ownerId: mgr.id, idempotencyKey: "w4c-capa-1" });
    expect(again).toMatchObject({ capaId, replayed: true });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, capaId), eq(auditEvents.action, "quality.capa.created")))).toHaveLength(1);
    expect(await db.select().from(notifications).where(and(eq(notifications.recipientUserId, mgr.id), eq(notifications.entityId, capaId)))).toHaveLength(1);
    expect((await listCapas(qa, { deviationId })).map((x) => x.id)).toContain(capaId);
  });

  it("authz.cross_site.capa and authz.role_escalation.capa: other sites see nothing; warehouse cannot open; operators cannot view", async () => {
    await expectCode(getCapa(qaRvs, capaId), "not_found");
    expect((await listCapas(qaRvs, { status: "all" })).find((x) => x.id === capaId)).toBeUndefined();
    await expectCode(openCapa(warehouse, { sourceKind: "audit", sourceReference: "Audit 1", title: "x", problemStatement: "Something happened.", ownerId: manager.userId }), "forbidden");
    await expectCode(getCapa(operator, capaId), "forbidden");
    await expectCode(openCapa(owner, { sourceKind: "audit", sourceReference: "Audit 1", title: "x", problemStatement: "Something happened.", ownerId: manager.userId }), "forbidden");
  });

  it("actions with owners and due dates: the first action starts the CAPA; completion and verification by different people", async () => {
    const [mgr] = await db.select().from(users).where(eq(users.email, "manager.nfd@bryels-care.test"));
    await expectCode(addCapaAction(manager, { capaId, actionKind: "corrective", description: "Install a UPS on the mixer panel", ownerId: mgr.id, dueDate: plusDays(manilaToday(), -1) }), "validation");
    await expectCode(addCapaAction(manager, { capaId, actionKind: "corrective", description: "Install a UPS on the mixer panel", ownerId: operator.userId, dueDate: plusDays(manilaToday(), 7) }), "validation");
    const a1 = await addCapaAction(manager, { capaId, actionKind: "corrective", description: "Install a UPS on the mixer panel", ownerId: mgr.id, dueDate: plusDays(manilaToday(), 7), verificationMethod: "Inspect installation and test switch-over", idempotencyKey: "w4c-act-1" });
    expect(a1.started).toBe(true);
    const replay = await addCapaAction(manager, { capaId, actionKind: "corrective", description: "Install a UPS on the mixer panel", ownerId: mgr.id, dueDate: plusDays(manilaToday(), 7), idempotencyKey: "w4c-act-1" });
    expect(replay.actionId).toBe(a1.actionId);
    const a2 = await addCapaAction(qa, { capaId, actionKind: "preventive", description: "Log temperature during any pause", ownerId: qa.userId, dueDate: plusDays(manilaToday(), 3) });
    const [c] = await db.select().from(capas).where(eq(capas.id, capaId));
    expect(c.status).toBe("in_progress");

    await expectCode(completeCapaAction(qaRvs, { actionId: a1.actionId, note: "Done by RVS" }), "not_found");
    await completeCapaAction(manager, { actionId: a1.actionId, note: "UPS installed on 2026-10-20" });
    await expectCode(verifyCapaAction(manager, { actionId: a1.actionId, note: "Looks fine" }), "forbidden");
    await verifyCapaAction(qa, { actionId: a1.actionId, note: "Switch-over tested with mains off" });
    await completeCapaAction(qa, { actionId: a2.actionId, note: "Batch record form updated" });
    await expectCode(verifyCapaAction(qa, { actionId: a2.actionId, note: "Self check" }), "separation_of_duties");
    // A failed verification sends the action back.
    await reopenOrCancelCapaAction(qaLead, { actionId: a2.actionId, to: "open", reason: "Form not yet issued to the floor" });
    await completeCapaAction(qa, { actionId: a2.actionId, note: "Form issued to the floor" });
    await verifyCapaAction(qaLead, { actionId: a2.actionId, note: "Seen on the floor" });
    const acts = await db.select().from(capaActions).where(eq(capaActions.capaId, capaId));
    expect(acts.every((a) => a.status === "verified")).toBe(true);
  });

  it("submit for closure needs root cause and effectiveness criterion; the check waits for the configured period", async () => {
    await expectCode(submitCapaForClosure(qa, { capaId }), "state");
    await updateCapa(qa, { capaId, rootCause: "No UPS on the mixer control panel", effectivenessCriteria: "No mixer stop during the next 10 batches" });
    const today = manilaToday();
    await expectCode(submitCapaForClosure(qa, { capaId, effectivenessDueOn: plusDays(today, 5) }), "validation");
    const s = await submitCapaForClosure(qa, { capaId });
    expect(s.effectivenessDueOn).toBe(plusDays(today, 30));
    await expectCode(recordEffectivenessCheck(qaLead, { capaId, result: "effective", evidence: "No stops so far" }), "state");
    await expectCode(closeCapa(qaLead, { capaId }), "state");
  });

  it("closure requires an effective check and a closer other than the submitter (authz.sod.approve_own)", async () => {
    const later = new Date(Date.now() + 40 * 86_400_000);
    await recordEffectivenessCheck(qaLead, { capaId, result: "effective", evidence: "10 batches without a stop (B-26-0101..0110)" }, later);
    await expectCode(closeCapa(qa, { capaId }), "separation_of_duties");
    await expectCode(closeCapa(manager, { capaId }), "forbidden");
    const r = await closeCapa(qaLead, { capaId, note: "Effective" });
    expect(r.status).toBe("closed");
    const tr = await db.select().from(capaStateTransitions).where(eq(capaStateTransitions.capaId, capaId));
    expect(tr.map((t) => t.toState)).toEqual(["open", "in_progress", "verification", "closed"]);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, capaId), eq(auditEvents.action, "quality.capa.closed")))).toHaveLength(1);
    const v = await getCapa(qa, capaId);
    expect(v.can.close).toBe(false);
    // Transition logs are append-only (w4c.sql).
    const err = await db.execute(sql`update capa_state_transitions set reason = 'x' where capa_id = ${capaId}`).then(() => null, (e: Error & { cause?: Error }) => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/append-only/);
  });

  it("a check that is not effective returns the CAPA to in progress; complaint CAPAs take the complaint's site", async () => {
    const [cmp] = await db.select().from(complaints).limit(1);
    const r = await openCapa(qa, { sourceKind: "complaint", complaintId: cmp.id, title: "White spots on bars", problemStatement: "Customer reports white powdery spots.", ownerId: qa.userId });
    const [c] = await db.select().from(capas).where(eq(capas.id, r.capaId));
    expect(c.siteId).toBe(cmp.siteId);
    const a = await addCapaAction(qa, { capaId: r.capaId, actionKind: "corrective", description: "Adjust curing-room humidity", ownerId: qa.userId, dueDate: plusDays(manilaToday(), 2) });
    await completeCapaAction(qa, { actionId: a.actionId, note: "Dehumidifier set to 55 %" });
    await verifyCapaAction(qaLead, { actionId: a.actionId, note: "Readings checked" });
    await updateCapa(qa, { capaId: r.capaId, rootCause: "Curing-room humidity too high", effectivenessCriteria: "No spots in the next 3 batches" });
    await submitCapaForClosure(qa, { capaId: r.capaId });
    const res = await recordEffectivenessCheck(qaLead, { capaId: r.capaId, result: "not_effective", evidence: "Spots again on B-26-0120" }, new Date(Date.now() + 40 * 86_400_000));
    expect(res.status).toBe("in_progress");
    const [after] = await db.select().from(capas).where(eq(capas.id, r.capaId));
    expect(after).toMatchObject({ status: "in_progress", effectivenessResult: "not_effective", submittedBy: null });
    await expectCode(cancelCapa(manager, { capaId: r.capaId, reason: "Duplicate" }), "forbidden");
  });

  it("overdue CAPA actions are action-centre candidates", async () => {
    const r = await openCapa(qa, { sourceKind: "audit", sourceReference: "Internal audit Q3 finding 2", title: "Pest log gaps", problemStatement: "Two weeks missing in the pest log.", ownerId: qa.userId });
    const a = await addCapaAction(qa, { capaId: r.capaId, actionKind: "corrective", description: "Fill the log", ownerId: qa.userId, dueDate: plusDays(manilaToday(), 1) });
    await db.update(capaActions).set({ dueDate: plusDays(manilaToday(), -2) }).where(eq(capaActions.id, a.actionId));
    const items = await overdueCapaActionCandidates(kit.orgId);
    expect(items.find((i) => i.entityId === a.actionId)).toMatchObject({ kind: "overdue_capa_action", siteId: kit.nfd.id, link: `/quality/capa/${r.capaId}` });
    await cancelCapa(qaLead, { capaId: r.capaId, reason: "Raised in error for the wrong site" });
    expect((await overdueCapaActionCandidates(kit.orgId)).find((i) => i.entityId === a.actionId)).toBeUndefined();
  });
});

describe("US-6-18 change control", () => {
  let ccId: string;
  let approvedRevisionId: string;
  let draftRevisionId: string;

  beforeAll(async () => {
    const [f] = await db.select().from(formulas).limit(1);
    const [rev] = await db.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, f.id), eq(formulaRevisions.status, "approved"))).limit(1);
    approvedRevisionId = rev.id;
    const draft = await createFormulaRevision(manager, { formulaId: f.id, baseRevisionId: rev.id });
    draftRevisionId = draft.revisionId;
  });

  it("statemachine.change_control: only the listed transitions are allowed", () => {
    expect(CHANGE_CONTROL_TRANSITIONS.draft).toEqual(["submitted", "cancelled"]);
    expect(CHANGE_CONTROL_TRANSITIONS.approved).toContain("implemented");
    expect(CHANGE_CONTROL_TRANSITIONS.rejected).toEqual([]);
  });

  it("a planner proposes a change linked to a formula revision; submit needs impact assessment and risk level", async () => {
    await expectCode(createChangeControl(warehouse, { title: "x", description: "Change something.", justification: "Because reasons.", entityType: "formula_revision" }), "forbidden");
    const r = await createChangeControl(planner, { title: "Raise glycerin to 2 %", description: "Increase glycerin from 1.5 % to 2 % in the soap formula.", justification: "Customer feedback on dryness.", entityType: "formula_revision", siteId: kit.nfd.id, idempotencyKey: "w4c-cc-1" });
    ccId = r.changeControlId;
    expect(r.changeNumber).toMatch(/^CC-\d{2}-\d{3}$/);
    expect((await createChangeControl(planner, { title: "Raise glycerin to 2 %", description: "Increase glycerin from 1.5 % to 2 % in the soap formula.", justification: "Customer feedback on dryness.", entityType: "formula_revision", idempotencyKey: "w4c-cc-1" })).replayed).toBe(true);
    await expectCode(submitChangeControl(planner, { changeControlId: ccId }), "validation");
    await expectCode(updateChangeControl(planner, { changeControlId: ccId, riskLevel: "catastrophic" }), "validation");
    await updateChangeControl(planner, { changeControlId: ccId, impactAssessment: "Stability: retest. Label: INCI order unchanged. Stock: no impact.", riskLevel: "medium", implementationPlan: "New formula revision; first batch under QA watch." });
    await submitChangeControl(planner, { changeControlId: ccId });
    const [c] = await db.select().from(changeControls).where(eq(changeControls.id, ccId));
    expect(c).toMatchObject({ status: "submitted", submittedBy: planner.userId, riskLevel: "medium" });
  });

  it("authz: the planner cannot approve; the RVS-only QA cannot see an NFD change; a return starts a new approval cycle", async () => {
    await expectCode(decideChangeControl(planner, { changeControlId: ccId, decision: "approved" }), "forbidden");
    await expectCode(getChangeControl(qaRvs, ccId), "not_found");
    expect((await listChangeControls(qaRvs, { status: "all" })).find((x) => x.id === ccId)).toBeUndefined();
    await expectCode(decideChangeControl(qa, { changeControlId: ccId, decision: "returned" }), "validation");
    expect((await decideChangeControl(qa, { changeControlId: ccId, decision: "returned", note: "Add the stability plan" })).status).toBe("draft");
    await updateChangeControl(planner, { changeControlId: ccId, impactAssessment: "Stability: 3-month accelerated test before release. Label: unchanged." });
    await submitChangeControl(planner, { changeControlId: ccId });
    expect((await decideChangeControl(qa, { changeControlId: ccId, decision: "approved", note: "OK with the stability plan" })).status).toBe("approved");
    const ds = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "change_control"), eq(approvalDecisions.recordId, ccId)));
    expect(ds.map((d) => [d.cycle, d.decision])).toEqual([
      [1, "returned"],
      [2, "approved"],
    ]);
  });

  it("authz.sod.approve_own: the submitter never approves their own change", async () => {
    const r = await createChangeControl(qa, { title: "Tighten pH spec", description: "Narrow pH range on the lotion plan.", justification: "Trend of drift.", entityType: "inspection_plan" });
    await updateChangeControl(qa, { changeControlId: r.changeControlId, impactAssessment: "Inspection plan revision only.", riskLevel: "low" });
    await submitChangeControl(qa, { changeControlId: r.changeControlId });
    await expectCode(decideChangeControl(qa, { changeControlId: r.changeControlId, decision: "approved" }), "separation_of_duties");
    expect((await decideChangeControl(qaLead, { changeControlId: r.changeControlId, decision: "rejected", note: "Not supported by data" })).status).toBe("rejected");
    await expectCode(submitChangeControl(qa, { changeControlId: r.changeControlId }), "state");
  });

  it("implemented only when the linked revision is approved; closed by someone other than the implementer", async () => {
    await expectCode(implementChangeControl(qa, { changeControlId: ccId, note: "Revision in use" }), "state");
    await updateChangeControl(planner, { changeControlId: ccId, entityId: draftRevisionId });
    const v = await getChangeControl(qa, ccId);
    expect(v.can.implementBlockedReason).toMatch(/draft/);
    await expectCode(implementChangeControl(qa, { changeControlId: ccId, note: "New revision in use" }), "state");
    await updateChangeControl(planner, { changeControlId: ccId, entityId: approvedRevisionId });
    expect((await implementChangeControl(qa, { changeControlId: ccId, note: "Revision approved and effective" })).status).toBe("implemented");
    await expectCode(closeChangeControl(qa, { changeControlId: ccId }), "separation_of_duties");
    expect((await closeChangeControl(qaLead, { changeControlId: ccId, note: "First batch fine" })).status).toBe("closed");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, ccId), eq(auditEvents.action, "quality.change_control.closed")))).toHaveLength(1);
  });
});

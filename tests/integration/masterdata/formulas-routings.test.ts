import { beforeAll, describe, expect, it } from "vitest";
import { allowDirectBatches } from "../../support/w2b";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, batches, bomLines, formulaRevisions, formulas, organizations, products, routingRevisions, routings } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import {
  createFormula,
  createFormulaRevision,
  createRoutingRevision,
  createWorkInstruction,
  decideFormulaRevision,
  decideRoutingRevision,
  decideWorkInstructionRevision,
  getEffectiveFormulaRevision,
  getEffectiveRouting,
  getFormulaRevision,
  getRoutingRevision,
  retireFormulaRevision,
  saveFormulaRevisionDraft,
  saveRoutingRevisionDraft,
  submitFormulaRevision,
  submitRoutingRevision,
  submitWorkInstructionRevision,
  type RoutingStepFull,
} from "@/modules/masterdata";
import { createBatch } from "@/modules/production";
import { expectCode, expectDbError, manilaDate, setupW1D } from "./helpers";

let nfd: SiteRef;
let planner: AuthContext;
let manager: AuthContext;
let qa: AuthContext;
let owner: AuthContext;
let operator: AuthContext;
let auditor: AuthContext;
let acsProductId: string;
let acsFormulaId: string;
let acsRev1Id: string;

const today = manilaDate(0);
const in10 = manilaDate(10);
const in20 = manilaDate(20);

type Line = { materialId: string; quantityG: string; tolerancePct?: string | null; toleranceAbsG?: string | null };
async function linesOf(revisionId: string): Promise<Line[]> {
  const ls = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, revisionId)).orderBy(bomLines.lineNo);
  return ls.map((l) => ({ materialId: l.materialId, quantityG: l.quantityG.replace(/\.?0+$/, ""), tolerancePct: l.tolerancePct, toleranceAbsG: l.toleranceAbsG }));
}

beforeAll(async () => {
  const s = await setupW1D();
  await allowDirectBatches({ orgId: (await db.select({ id: organizations.id }).from(organizations).limit(1))[0].id }); // snapshot tests create batches directly
  nfd = s.nfd;
  planner = await s.ctxFor("planner.nfd@bryels-care.test", "production_planner", [nfd]);
  manager = await s.ctxFor("manager.nfd@bryels-care.test", "site_manager", [nfd]);
  qa = await s.ctxFor("qa.nfd@bryels-care.test", "qa_qc", [nfd, s.rvs]);
  owner = await s.ctxFor("owner@bryels-care.test", "owner_director", [nfd, s.rvs]);
  operator = await s.ctxFor("operator.nfd@bryels-care.test", "production_operator", [nfd]);
  auditor = await s.ctxFor("auditor@bryels-care.test", "auditor", [nfd, s.rvs]);
  const [f] = await db.select().from(formulas).where(eq(formulas.code, "F-ACS-01"));
  acsFormulaId = f.id;
  acsProductId = f.productId;
  const [r] = await db.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, f.id), eq(formulaRevisions.revisionNo, 1)));
  acsRev1Id = r.id;
}, 180_000);

describe("seeded formulas (US-3-01)", () => {
  it("seeds Acapulco and Guava as approved, effective revisions and one Guava revision awaiting approval", async () => {
    const acs = await getEffectiveFormulaRevision(planner, acsProductId, today);
    expect(acs?.rev.revisionNo).toBe(1);
    expect(acs?.lines).toHaveLength(5);
    const [gbs] = await db.select().from(formulas).where(eq(formulas.code, "F-GBS-01"));
    const revs = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, gbs.id)).orderBy(formulaRevisions.revisionNo);
    expect(revs.map((r) => r.status)).toEqual(["approved", "pending_approval"]);
    const decisions = await db.select().from(approvalDecisions).where(eq(approvalDecisions.recordId, revs[0].id));
    expect(decisions.map((d) => d.step).sort()).toEqual([1, 2]);
  });

  it("shows the unrounded line sum next to the batch size (17,600.1 g vs 17,600 g)", async () => {
    const v = await getFormulaRevision(planner, acsRev1Id);
    expect(Number(v!.totals.sumG)).toBe(17600.1);
    expect(Number(v!.totals.referenceBatchSizeG)).toBe(17600);
    expect(Number(v!.totals.differenceG)).toBeCloseTo(0.1, 6);
  });

  it("masterdata.formula_percentages_hidden_from_operator: operators get quantities, never percentages", async () => {
    const asOperator = await getFormulaRevision(operator, acsRev1Id);
    expect(asOperator!.showPercentages).toBe(false);
    expect(asOperator!.lines.every((l) => !("percentOfBatch" in l))).toBe(true);
    const asPlanner = await getFormulaRevision(planner, acsRev1Id);
    expect(asPlanner!.lines[0]).toHaveProperty("percentOfBatch");
    const asAuditor = await getFormulaRevision(auditor, acsRev1Id);
    expect(asAuditor!.showPercentages).toBe(true);
  });
});

describe("drafting and validation", () => {
  let draftId: string;
  it("creates a formula with a draft revision; role escalation is refused", async () => {
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    await expectCode(createFormula(operator, { productId: ahl.id, code: "F-AHL-02", name: "Lotion trial", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" }), "forbidden");
    const r = await createFormula(planner, { productId: ahl.id, code: "f-ahl-02", name: "Lotion trial", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" });
    draftId = r.revisionId;
    const [f] = await db.select().from(formulas).where(eq(formulas.id, r.formulaId));
    expect(f.code).toBe("F-AHL-02");
    await expectCode(createFormula(planner, { productId: ahl.id, code: "F-AHL-02", name: "dup", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" }), "conflict");
  });

  it("requires exactly one tolerance per line (422)", async () => {
    const mat = (await linesOf(acsRev1Id))[0].materialId;
    const base = { revisionId: draftId, referenceBatchSizeG: "1000", theoreticalYieldPct: "97" };
    const none = await expectCode(saveFormulaRevisionDraft(planner, { ...base, lines: [{ materialId: mat, quantityG: "1000" }] }), "validation");
    expect(none.details?.fieldErrors).toHaveProperty("lines.0.tolerancePct");
    await expectCode(saveFormulaRevisionDraft(planner, { ...base, lines: [{ materialId: mat, quantityG: "1000", tolerancePct: "1", toleranceAbsG: "2" }] }), "validation");
    await expectCode(saveFormulaRevisionDraft(planner, { ...base, theoreticalYieldPct: "120", lines: [] }), "validation");
    const ok = await saveFormulaRevisionDraft(planner, { ...base, lines: [{ materialId: mat, quantityG: "1000", toleranceAbsG: "2.5" }] });
    expect(ok.lineCount).toBe(1);
  });

  it("allows only one open revision per formula", async () => {
    await expectCode(createFormulaRevision(planner, { formulaId: acsFormulaId }).then(() => createFormulaRevision(planner, { formulaId: acsFormulaId })), "conflict");
  });
});

describe("two-step approval, separation of duties and effective dating (US-3-01 AC2)", () => {
  let rev2Id: string;

  it("drafts ACS revision 2 as a copy, edits it and submits", async () => {
    const [open] = await db.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, acsFormulaId), eq(formulaRevisions.status, "draft")));
    rev2Id = open.id;
    expect(open.revisionNo).toBe(2);
    expect(open.supersedesId).toBe(acsRev1Id);
    const lines = await linesOf(rev2Id);
    expect(lines).toHaveLength(5);
    lines[3] = { ...lines[3], quantityG: "195.0" };
    await expectCode(submitFormulaRevision(planner, rev2Id), "validation"); // change summary required for rev 2
    await saveFormulaRevisionDraft(planner, { revisionId: rev2Id, referenceBatchSizeG: "17600", theoreticalYieldPct: "95", changeSummary: "Test: more extract", lines });
    await expectCode(submitFormulaRevision(operator, rev2Id), "forbidden");
    await submitFormulaRevision(planner, rev2Id);
    const v = await getFormulaRevision(qa, rev2Id);
    expect(v!.redline).toEqual([expect.objectContaining({ kind: "changed", detail: expect.stringContaining("190.9 g → 195 g") })]);
    expect(v!.approval.nextStep?.step).toBe(1);
    expect(v!.approval.canDecide).toBe(true);
  });

  it("refuses approval by someone without the permission, and step 1 by a non-QA approver", async () => {
    await expectCode(decideFormulaRevision(planner, { id: rev2Id, decision: "approved" }), "forbidden");
    await expectCode(decideFormulaRevision(operator, { id: rev2Id, decision: "approved" }), "forbidden");
    await expectCode(decideFormulaRevision(manager, { id: rev2Id, decision: "approved" }), "forbidden"); // step 1 is QA
  });

  it("approved content is immutable while pending: drafts only", async () => {
    await expectCode(saveFormulaRevisionDraft(planner, { revisionId: rev2Id, referenceBatchSizeG: "17600", theoreticalYieldPct: "95", lines: [] }), "state");
  });

  it("QA approves step 1, the same person cannot approve step 2, the manager approves with a future effective date", async () => {
    const r1 = await decideFormulaRevision(qa, { id: rev2Id, decision: "approved", note: "Tolerances reviewed" });
    expect(r1.status).toBe("pending_approval");
    await expectCode(decideFormulaRevision(owner, { id: rev2Id, decision: "approved", effectiveFrom: manilaDate(-1) }), "validation"); // past date
    const r2 = await decideFormulaRevision(manager, { id: rev2Id, decision: "approved", effectiveFrom: in10 });
    expect(r2.status).toBe("approved");
    const [rev1] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, acsRev1Id));
    expect(rev1.effectiveTo).toBe(in10); // superseded on that date
    const [rev2] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, rev2Id));
    expect(rev2.approvedBy).toBe(manager.userId);
    expect(rev2.effectiveFrom).toBe(in10);
    const [ev] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, rev2Id), eq(auditEvents.action, "masterdata.formula_revision.approved")));
    expect((ev.after as { approvers: string[] }).approvers).toHaveLength(2);
    expect((ev.after as { revisionNo: number }).revisionNo).toBe(2);
  });

  it("resolves the effective revision by date", async () => {
    expect((await getEffectiveFormulaRevision(planner, acsProductId, today))?.rev.revisionNo).toBe(1);
    expect((await getEffectiveFormulaRevision(planner, acsProductId, in10))?.rev.revisionNo).toBe(2);
    expect((await getEffectiveFormulaRevision(planner, acsProductId, in20))?.rev.revisionNo).toBe(2);
  });

  it("authz.sod.approve_own: the author/submitter can never approve their own revision", async () => {
    const { revisionId } = await createFormulaRevision(manager, { formulaId: acsFormulaId });
    const lines = await linesOf(revisionId);
    await saveFormulaRevisionDraft(manager, { revisionId, referenceBatchSizeG: "17600", theoreticalYieldPct: "95", changeSummary: "SoD test", lines });
    await submitFormulaRevision(manager, revisionId);
    await decideFormulaRevision(qa, { id: revisionId, decision: "approved" });
    await expectCode(decideFormulaRevision(manager, { id: revisionId, decision: "approved", effectiveFrom: in20 }), "separation_of_duties");
    // a rejection needs a reason; the owner rejects, the revision is terminal
    await expectCode(decideFormulaRevision(owner, { id: revisionId, decision: "rejected" }), "validation");
    const r = await decideFormulaRevision(owner, { id: revisionId, decision: "rejected", note: "Not needed" });
    expect(r.status).toBe("rejected");
    await expectCode(decideFormulaRevision(owner, { id: revisionId, decision: "approved" }), "state");
  });

  it("approved revisions are immutable in the database too (triggers)", async () => {
    await expectDbError(db.update(bomLines).set({ quantityG: "1" }).where(eq(bomLines.formulaRevisionId, acsRev1Id)), /only change while the revision is draft/);
    await expectDbError(db.update(formulaRevisions).set({ referenceBatchSizeG: "1" }).where(eq(formulaRevisions.id, acsRev1Id)), /immutable/);
    await expectDbError(db.delete(approvalDecisions).where(eq(approvalDecisions.recordId, acsRev1Id)), /append-only/);
  });

  it("approved effective ranges of one formula cannot overlap (exclusion constraint)", async () => {
    await expectDbError(
      db.insert(formulaRevisions).values({ formulaId: acsFormulaId, revisionNo: 99, status: "approved", referenceBatchSizeG: "1", effectiveFrom: in20, approvedBy: owner.userId, submittedBy: manager.userId }),
      /formula_rev_no_overlap_ex|conflicting key/,
    );
  });
});

describe("batch snapshot of approved, effective revisions (AC-13, V-REV)", () => {
  it("V-REV: a revision not effective on the planned date cannot be used", async () => {
    const e = await expectCode(createBatch(manager, { formulaRevisionId: acsRev1Id, plannedSizeKg: "17.6", plannedStartOn: in20 }), "validation");
    expect(e.details?.rule).toBe("V-REV");
    const [rev2] = await db.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, acsFormulaId), eq(formulaRevisions.revisionNo, 2)));
    await expectCode(createBatch(manager, { formulaRevisionId: rev2.id, plannedSizeKg: "17.6", plannedStartOn: today }), "validation");
    const [pending] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.status, "pending_approval"));
    await expectCode(createBatch(manager, { formulaRevisionId: pending.id, plannedSizeKg: "17.6", plannedStartOn: in20 }), "state");
  });

  it("freezes formula, routing and inspection plan; later approvals never change the batch", async () => {
    const { batchId } = await createBatch(manager, { formulaRevisionId: acsRev1Id, plannedSizeKg: "8.8", plannedStartOn: today });
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const routing = await getEffectiveRouting(manager, acsProductId, today);
    expect(b.routingRevisionId).toBe(routing!.rev.id);
    expect(b.inspectionPlanId).not.toBeNull();
    const snap = b.formulaSnapshot as { routing: { routingCode: string }; steps: { stepKind: string; area: string | null; checklistItems: unknown[]; workInstruction: { code: string } | null }[]; inspectionPlan: { isPlaceholder: boolean } };
    expect(snap.routing.routingCode).toBe("R-ACS-01");
    expect(snap.steps.map((s) => s.stepKind)).toEqual(["line_clearance", "dispensing", "line_clearance", "process", "line_clearance", "packaging", "transfer"]);
    expect(snap.steps.map((s) => s.area).filter(Boolean)).toEqual(["weighing", "production", "packaging"]);
    expect(snap.steps[0].checklistItems.length).toBeGreaterThan(0);
    expect(snap.steps[3].workInstruction?.code).toBe("WI-SOAP-MIX");
    expect(snap.inspectionPlan.isPlaceholder).toBe(true);
    const before = JSON.stringify(b.formulaSnapshot);

    // A new routing revision approved afterwards does not touch the batch.
    const { revisionId } = await createRoutingRevision(planner, { routingId: routing!.routing.id });
    const v = await getRoutingRevision(planner, revisionId);
    const steps = v!.steps.map(toStepInput);
    steps[3].parameters[0] = { ...steps[3].parameters[0], name: "Oil temperature (changed)" };
    await saveRoutingRevisionDraft(planner, { revisionId, changeSummary: "Rename parameter", steps });
    await submitRoutingRevision(planner, revisionId);
    await decideRoutingRevision(qa, { id: revisionId, decision: "approved" });
    await decideRoutingRevision(manager, { id: revisionId, decision: "approved" });
    const [after] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(JSON.stringify(after.formulaSnapshot)).toBe(before);
    expect(after.routingRevisionId).toBe(b.routingRevisionId);
    // and the trigger refuses an attempt to re-point the batch
    await expectDbError(db.update(batches).set({ formulaRevisionId: acsRev1Id, routingRevisionId: revisionId }).where(eq(batches.id, batchId)), /frozen at creation/);
  });
});

/** Maps a loaded routing step back to the save-draft input shape. */
function toStepInput(s: RoutingStepFull) {
  return {
    code: s.code,
    name: s.name,
    stepKind: s.stepKind as "process",
    area: s.area as "weighing" | null,
    instruction: s.instruction,
    workInstructionRevisionId: s.workInstructionRevisionId,
    requiresChecker: s.requiresChecker,
    blocksUntilComplete: s.blocksUntilComplete,
    requiresEquipment: s.requiresEquipment,
    equipmentKind: s.equipmentKind as "mixer" | null,
    minDurationMinutes: s.minDurationMinutes,
    parameters: s.parameters.map((p) => ({ code: p.code, name: p.name, valueKind: p.valueKind as "numeric", uom: p.uom, minValue: p.minValue, targetValue: p.targetValue, maxValue: p.maxValue, isRequired: p.isRequired })),
    checklistItems: s.checklistItems.map((c) => ({ text: c.text, requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
  };
}

describe("routings (US-3-02)", () => {
  let gbsRoutingId: string;
  beforeAll(async () => {
    const [r] = await db.select().from(routings).where(eq(routings.code, "R-GBS-01"));
    gbsRoutingId = r.id;
  });

  it("validates steps: clearance needs an area, numeric parameters need a unit, equipment steps need a type", async () => {
    await expectCode(createRoutingRevision(operator, { routingId: gbsRoutingId }), "forbidden");
    const { revisionId } = await createRoutingRevision(planner, { routingId: gbsRoutingId });
    const v = await getRoutingRevision(planner, revisionId);
    const steps = v!.steps.map(toStepInput);
    await expectCode(saveRoutingRevisionDraft(planner, { revisionId, steps: [{ ...steps[0], area: null }] }), "validation");
    await expectCode(
      saveRoutingRevisionDraft(planner, { revisionId, steps: [{ ...steps[3], parameters: [{ code: "temp", name: "T", valueKind: "numeric", uom: null, minValue: null, targetValue: null, maxValue: null, isRequired: true }] }] }),
      "validation",
    );
    await expectCode(
      saveRoutingRevisionDraft(planner, { revisionId, steps: [{ ...steps[3], parameters: [{ code: "temp", name: "T", valueKind: "numeric", uom: "°C", minValue: "60", targetValue: null, maxValue: "40", isRequired: true }] }] }),
      "validation",
    );
    await expectCode(saveRoutingRevisionDraft(planner, { revisionId, steps: [{ ...steps[3], requiresEquipment: true, equipmentKind: null }] }), "validation");
  });

  it("a sequencing-only change needs one site manager approval (A-PROC-41)", async () => {
    const [open] = await db.select().from(routingRevisions).where(and(eq(routingRevisions.routingId, gbsRoutingId), eq(routingRevisions.status, "draft")));
    const v = await getRoutingRevision(planner, open.id);
    const steps = v!.steps.map(toStepInput);
    [steps[4], steps[5]] = [steps[5], steps[4]]; // swap order only
    await saveRoutingRevisionDraft(planner, { revisionId: open.id, changeSummary: "Order change only (test)", steps });
    const r = await submitRoutingRevision(planner, open.id);
    expect(r.changeScope).toBe("sequencing_only");
    await expectCode(decideRoutingRevision(planner, { id: open.id, decision: "approved" }), "forbidden");
    const d = await decideRoutingRevision(manager, { id: open.id, decision: "approved", effectiveFrom: in20 });
    expect(d.status).toBe("approved");
    expect((await getEffectiveRouting(planner, (await db.select().from(routings).where(eq(routings.id, gbsRoutingId)))[0].productId, in20))?.steps[4].name).toBe("Packaging and labeling");
  });

  it("a quality-relevant change needs QA first, and the submitter cannot approve", async () => {
    const { revisionId } = await createRoutingRevision(manager, { routingId: gbsRoutingId });
    const v = await getRoutingRevision(manager, revisionId);
    const steps = v!.steps.map(toStepInput);
    steps[0].checklistItems.push({ text: "Extra clearance check (test)", requiresPhoto: true, isBlocking: true });
    await saveRoutingRevisionDraft(manager, { revisionId, changeSummary: "Add a check", steps });
    const r = await submitRoutingRevision(manager, revisionId);
    expect(r.changeScope).toBe("quality_relevant");
    await expectCode(decideRoutingRevision(owner, { id: revisionId, decision: "approved" }), "forbidden"); // step 1 is QA
    await decideRoutingRevision(qa, { id: revisionId, decision: "approved" });
    await expectCode(decideRoutingRevision(manager, { id: revisionId, decision: "approved" }), "separation_of_duties");
    const d = await decideRoutingRevision(owner, { id: revisionId, decision: "approved", effectiveFrom: manilaDate(30) });
    expect(d.status).toBe("approved");
  });

  it("approved steps cannot be edited directly in the database", async () => {
    const [r] = await db.select().from(routingRevisions).where(and(eq(routingRevisions.routingId, gbsRoutingId), eq(routingRevisions.revisionNo, 1)));
    await expectDbError(db.execute(sql`update routing_steps set name = 'x' where routing_revision_id = ${r.id}`), /only change while the revision is draft/);
  });
});

describe("work instructions", () => {
  it("are approved by someone other than the author", async () => {
    const { revisionId } = await createWorkInstruction(manager, { code: "WI-TEST-01", name: "Test instruction", bodyMarkdown: "Do the thing safely." });
    await submitWorkInstructionRevision(manager, revisionId);
    await expectCode(decideWorkInstructionRevision(manager, { id: revisionId, decision: "approved" }), "separation_of_duties");
    await expectCode(decideWorkInstructionRevision(planner, { id: revisionId, decision: "approved" }), "forbidden");
    const r = await decideWorkInstructionRevision(qa, { id: revisionId, decision: "approved" });
    expect(r.status).toBe("approved");
  });
});

describe("retire", () => {
  it("retires an approved revision with a reason; only holders of masterdata.formula.void", async () => {
    const [gbs] = await db.select().from(formulas).where(eq(formulas.code, "F-GBS-01"));
    const [rev1] = await db.select().from(formulaRevisions).where(and(eq(formulaRevisions.formulaId, gbs.id), eq(formulaRevisions.revisionNo, 1)));
    await expectCode(retireFormulaRevision(planner, { id: rev1.id, reason: "x" }), "forbidden");
    await expectCode(retireFormulaRevision(qa, { id: rev1.id, reason: "" }), "validation");
    const before = await getEffectiveFormulaRevision(planner, gbs.productId, today);
    expect(before?.rev.id).toBe(rev1.id);
    await retireFormulaRevision(qa, { id: rev1.id, reason: "Test retire" });
    expect(await getEffectiveFormulaRevision(planner, gbs.productId, today)).toBeNull();
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rev1.id), eq(auditEvents.action, "masterdata.formula_revision.retired"))).orderBy(desc(auditEvents.occurredAt));
    expect(ev.reason).toBe("Test retire");
  });
});

import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { type DbOrTx, type Tx, db } from "@/db/client";
import {
  products,
  routingRevisions,
  routingStepChecklistItems,
  routingStepParameters,
  routingSteps,
  routings,
  users,
  workInstructionRevisions,
  workInstructions,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { approverLabel } from "@/lib/auth/self-approval";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { type ApprovalRuleType, loadApprovalPolicy } from "./approval-policy";
import { CreateRoutingInput, DecisionInput, RetireInput, SaveRoutingDraftInput, parseInput } from "./schemas";
import {
  approvalState,
  assertDraft,
  assertVersionTransition,
  businessToday,
  approvalSodConflict,
  canDecideStep,
  effectiveLabel,
  isIsoDate,
  recordApprovalDecision,
  requireAny,
  supersedeOverlapping,
} from "./versioning";

/**
 * Routings (US-3-02): versioned step lists per product. Steps carry kind, area, checker
 * requirement, equipment class, parameters with limits, checklist items and a work-instruction
 * revision. Batches snapshot the routing revision effective on their planned start date.
 */
const lbl = (code: string, n: number) => `${code} revision ${n}`;

/** A sequencing-only change has its own approval rules (A-PROC-41), read from `approval_rules` (US-1-14). */
function ruleTypeFor(changeScope: string | null): ApprovalRuleType {
  return changeScope === "sequencing_only" ? "routing_revision_sequencing" : "routing_revision";
}

function policyFor(q: DbOrTx, organizationId: string, changeScope: string | null) {
  return loadApprovalPolicy(q, organizationId, ruleTypeFor(changeScope));
}

async function lockRevision(tx: Tx, ctx: AuthContext, revisionId: string) {
  const [r] = await tx
    .select({ rev: routingRevisions, routing: routings })
    .from(routingRevisions)
    .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
    .where(and(eq(routingRevisions.id, revisionId), eq(routings.organizationId, ctx.organizationId)))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Routing revision not found.");
  await tx.select({ id: routings.id }).from(routings).where(eq(routings.id, r.routing.id)).for("update");
  const [rev] = await tx.select().from(routingRevisions).where(eq(routingRevisions.id, revisionId)).for("update");
  return { rev, routing: r.routing };
}

/** Steps of a routing revision with parameters, checklist items and the linked instruction revision. */
export async function loadRoutingSteps(q: DbOrTx, routingRevisionId: string) {
  const steps = await q
    .select({ step: routingSteps, wiRev: workInstructionRevisions, wi: workInstructions })
    .from(routingSteps)
    .leftJoin(workInstructionRevisions, eq(workInstructionRevisions.id, routingSteps.workInstructionRevisionId))
    .leftJoin(workInstructions, eq(workInstructions.id, workInstructionRevisions.workInstructionId))
    .where(eq(routingSteps.routingRevisionId, routingRevisionId))
    .orderBy(asc(routingSteps.stepNo));
  const ids = steps.map((s) => s.step.id);
  const [params, items] = ids.length
    ? await Promise.all([
        q.select().from(routingStepParameters).where(inArray(routingStepParameters.routingStepId, ids)).orderBy(asc(routingStepParameters.sequence)),
        q.select().from(routingStepChecklistItems).where(inArray(routingStepChecklistItems.routingStepId, ids)).orderBy(asc(routingStepChecklistItems.itemNo)),
      ])
    : [[], []];
  return steps.map(({ step, wiRev, wi }) => ({
    ...step,
    parameters: params.filter((p) => p.routingStepId === step.id),
    checklistItems: items.filter((i) => i.routingStepId === step.id),
    workInstruction: wiRev && wi ? { revisionId: wiRev.id, code: wi.code, name: wi.name, revisionNo: wiRev.revisionNo, status: wiRev.status, bodyMarkdown: wiRev.bodyMarkdown } : null,
  }));
}
export type RoutingStepFull = Awaited<ReturnType<typeof loadRoutingSteps>>[number];

/** Canonical content of a step without its position, for the sequencing-only comparison (A-PROC-41). */
function canonicalStep(s: RoutingStepFull) {
  return JSON.stringify({
    code: s.code,
    name: s.name,
    kind: s.stepKind,
    area: s.area,
    instruction: s.instruction,
    wi: s.workInstructionRevisionId,
    ip: s.inspectionPlanId,
    checker: s.requiresChecker,
    blocks: s.blocksUntilComplete,
    eq: [s.requiresEquipment, s.equipmentKind],
    mode: s.recordMode,
    min: s.minDurationMinutes,
    params: s.parameters.map((p) => [p.code, p.name, p.valueKind, p.uom, p.minValue, p.targetValue, p.maxValue, p.isRequired]),
    items: s.checklistItems.map((i) => [i.text, i.requiresPhoto, i.isBlocking]),
  });
}

export function computeChangeScope(base: RoutingStepFull[] | null, next: RoutingStepFull[]): "sequencing_only" | "quality_relevant" {
  if (!base) return "quality_relevant";
  const a = base.map(canonicalStep).sort();
  const b = next.map(canonicalStep).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]) ? "sequencing_only" : "quality_relevant";
}

async function insertSteps(tx: Tx, revisionId: string, steps: ReturnType<typeof SaveRoutingDraftInput.parse>["steps"]) {
  for (const [i, s] of steps.entries()) {
    const [row] = await tx
      .insert(routingSteps)
      .values({
        routingRevisionId: revisionId,
        stepNo: i + 1,
        code: s.code,
        name: s.name,
        stepKind: s.stepKind,
        area: s.area,
        instruction: s.instruction,
        workInstructionRevisionId: s.workInstructionRevisionId,
        requiresChecker: s.requiresChecker,
        blocksUntilComplete: s.blocksUntilComplete,
        requiresEquipment: s.requiresEquipment,
        equipmentKind: s.equipmentKind,
        minDurationMinutes: s.minDurationMinutes,
      })
      .returning({ id: routingSteps.id });
    if (s.parameters.length) {
      await tx.insert(routingStepParameters).values(
        s.parameters.map((p, j) => ({ routingStepId: row.id, sequence: j + 1, code: p.code, name: p.name, valueKind: p.valueKind, uom: p.uom, minValue: p.minValue, targetValue: p.targetValue, maxValue: p.maxValue, isRequired: p.isRequired })),
      );
    }
    if (s.checklistItems.length) {
      await tx.insert(routingStepChecklistItems).values(s.checklistItems.map((c, j) => ({ routingStepId: row.id, itemNo: j + 1, text: c.text, requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })));
    }
  }
}

async function deleteSteps(tx: Tx, revisionId: string) {
  const ids = (await tx.select({ id: routingSteps.id }).from(routingSteps).where(eq(routingSteps.routingRevisionId, revisionId))).map((r) => r.id);
  if (!ids.length) return 0;
  await tx.delete(routingStepParameters).where(inArray(routingStepParameters.routingStepId, ids));
  await tx.delete(routingStepChecklistItems).where(inArray(routingStepChecklistItems.routingStepId, ids));
  await tx.delete(routingSteps).where(eq(routingSteps.routingRevisionId, revisionId));
  return ids.length;
}

/* ================================================================== commands */

export async function createRouting(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.routing.create");
  const input = parseInput(CreateRoutingInput, raw);
  return db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId)));
    if (!product) throw new DomainError("not_found", "Product not found.");
    const [dup] = await tx.select({ id: routings.id }).from(routings).where(and(eq(routings.organizationId, ctx.organizationId), eq(routings.code, input.code)));
    if (dup) throw new DomainError("conflict", `Routing code ${input.code} is already used.`, { fieldErrors: { code: "This code is already used." } });
    const [r] = await tx.insert(routings).values({ organizationId: ctx.organizationId, productId: product.id, code: input.code, name: input.name, createdBy: ctx.userId }).returning();
    const [rev] = await tx.insert(routingRevisions).values({ routingId: r.id, revisionNo: 1, status: "draft", changeSummary: input.changeSummary ?? "First revision", createdBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "masterdata.routing.created", entityType: "routing", entityId: r.id, entityNumber: r.code, siteId: null, after: { code: r.code, product: product.skuCode } });
    await audit(tx, ctx, { action: "masterdata.routing_revision.drafted", entityType: "routing_revision", entityId: rev.id, entityNumber: lbl(r.code, 1), siteId: null, after: { status: "draft", revisionNo: 1 } });
    return { routingId: r.id, revisionId: rev.id };
  });
}

export async function createRoutingRevision(ctx: AuthContext, input: { routingId: string; baseRevisionId?: string | null }) {
  ctx.require("masterdata.routing.create");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(routings).where(and(eq(routings.id, input.routingId), eq(routings.organizationId, ctx.organizationId))).for("update");
    if (!r) throw new DomainError("not_found", "Routing not found.");
    const revs = await tx.select().from(routingRevisions).where(eq(routingRevisions.routingId, r.id)).orderBy(desc(routingRevisions.revisionNo));
    const open = revs.find((x) => x.status === "draft" || x.status === "pending_approval");
    if (open) throw new DomainError("conflict", `${lbl(r.code, open.revisionNo)} is still ${open.status.replace(/_/g, " ")}. Finish or withdraw it first.`);
    const base = input.baseRevisionId ? revs.find((x) => x.id === input.baseRevisionId) : (revs.find((x) => effectiveLabel(x) === "effective") ?? revs[0]);
    if (input.baseRevisionId && !base) throw new DomainError("not_found", "Base revision not found on this routing.");
    const [rev] = await tx
      .insert(routingRevisions)
      .values({ routingId: r.id, revisionNo: (revs[0]?.revisionNo ?? 0) + 1, status: "draft", supersedesId: base?.id ?? null, notes: base?.notes ?? null, createdBy: ctx.userId })
      .returning();
    if (base) {
      const steps = await loadRoutingSteps(tx, base.id);
      await insertSteps(
        tx,
        rev.id,
        steps.map((s) => ({
          code: s.code,
          name: s.name,
          stepKind: s.stepKind as never,
          area: s.area as never,
          instruction: s.instruction,
          workInstructionRevisionId: s.workInstructionRevisionId,
          requiresChecker: s.requiresChecker,
          blocksUntilComplete: s.blocksUntilComplete,
          requiresEquipment: s.requiresEquipment,
          equipmentKind: s.equipmentKind as never,
          minDurationMinutes: s.minDurationMinutes,
          parameters: s.parameters.map((p) => ({ code: p.code, name: p.name, valueKind: p.valueKind as never, uom: p.uom, minValue: p.minValue, targetValue: p.targetValue, maxValue: p.maxValue, isRequired: p.isRequired })),
          checklistItems: s.checklistItems.map((c) => ({ text: c.text, requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
        })),
      );
      // inspection plan links are copied as-is
      const baseSteps = await tx.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, base.id));
      for (const bs of baseSteps.filter((x) => x.inspectionPlanId)) {
        await tx.update(routingSteps).set({ inspectionPlanId: bs.inspectionPlanId }).where(and(eq(routingSteps.routingRevisionId, rev.id), eq(routingSteps.stepNo, bs.stepNo)));
      }
    }
    await audit(tx, ctx, { action: "masterdata.routing_revision.drafted", entityType: "routing_revision", entityId: rev.id, entityNumber: lbl(r.code, rev.revisionNo), siteId: null, after: { status: "draft", revisionNo: rev.revisionNo, copiedFrom: base?.revisionNo ?? null } });
    return { revisionId: rev.id, revisionNo: rev.revisionNo };
  });
}

/** Replaces the steps (with parameters and checklist items) of a draft revision. */
export async function saveRoutingRevisionDraft(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.routing.edit");
  const input = parseInput(SaveRoutingDraftInput, raw);
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, input.revisionId);
    assertDraft(lbl(routing.code, rev.revisionNo), rev.status);
    if (input.effectiveFrom && input.effectiveFrom < businessToday()) throw new DomainError("validation", "The proposed effective date cannot be in the past.", { fieldErrors: { effectiveFrom: "Choose today or a later date." } });
    const wiIds = [...new Set(input.steps.map((s) => s.workInstructionRevisionId).filter((x): x is string => !!x))];
    if (wiIds.length) {
      const found = await tx
        .select({ id: workInstructionRevisions.id, status: workInstructionRevisions.status })
        .from(workInstructionRevisions)
        .innerJoin(workInstructions, eq(workInstructions.id, workInstructionRevisions.workInstructionId))
        .where(and(inArray(workInstructionRevisions.id, wiIds), eq(workInstructions.organizationId, ctx.organizationId)));
      if (found.length !== wiIds.length) throw new DomainError("validation", "A linked work instruction does not exist.");
    }
    const removed = await deleteSteps(tx, rev.id);
    await insertSteps(tx, rev.id, input.steps);
    await tx.update(routingRevisions).set({ effectiveFrom: input.effectiveFrom, changeSummary: input.changeSummary, notes: input.notes }).where(eq(routingRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.routing_revision.edited",
      entityType: "routing_revision",
      entityId: rev.id,
      entityNumber: lbl(routing.code, rev.revisionNo),
      siteId: null,
      before: { steps: removed },
      after: { steps: input.steps.length, effectiveFrom: input.effectiveFrom },
    });
    return { revisionId: rev.id, stepCount: input.steps.length };
  });
}

export async function submitRoutingRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.routing.submit");
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, revisionId);
    const name = lbl(routing.code, rev.revisionNo);
    assertVersionTransition(name, rev.status, "pending_approval");
    const steps = await loadRoutingSteps(tx, rev.id);
    if (!steps.length) throw new DomainError("validation", "Add at least one step before submitting.");
    const notApproved = steps.filter((s) => s.workInstruction && s.workInstruction.status !== "approved");
    if (notApproved.length) throw new DomainError("validation", `Step ${notApproved[0].stepNo} links work instruction ${notApproved[0].workInstruction!.code} revision ${notApproved[0].workInstruction!.revisionNo}, which is not approved.`);
    if (rev.revisionNo > 1 && !rev.changeSummary?.trim()) throw new DomainError("validation", "Describe what changes and why (change summary) before submitting.", { fieldErrors: { changeSummary: "Required for revision 2 onwards." } });
    const baseSteps = rev.supersedesId ? await loadRoutingSteps(tx, rev.supersedesId) : null;
    const changeScope = computeChangeScope(baseSteps, steps);
    await tx.update(routingRevisions).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: new Date(), changeScope }).where(eq(routingRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.routing_revision.submitted",
      entityType: "routing_revision",
      entityId: rev.id,
      entityNumber: name,
      siteId: null,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: { status: "pending_approval", revisionNo: rev.revisionNo, changeScope },
    });
    return { status: "pending_approval" as const, changeScope };
  });
}

export async function withdrawRoutingRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.routing.submit");
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, revisionId);
    assertVersionTransition(lbl(routing.code, rev.revisionNo), rev.status, "draft");
    if (rev.submittedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who submitted the revision can withdraw it.");
    const st = await approvalState(tx, ctx.organizationId, "routing_revision", rev.id, await policyFor(tx, ctx.organizationId, rev.changeScope));
    if (st.decisions.length) throw new DomainError("state", "An approver has already decided on this revision; it can no longer be withdrawn.");
    await tx.update(routingRevisions).set({ status: "draft", submittedBy: null, submittedAt: null, changeScope: null }).where(eq(routingRevisions.id, rev.id));
    await audit(tx, ctx, { action: "masterdata.routing_revision.withdrawn", entityType: "routing_revision", entityId: rev.id, entityNumber: lbl(routing.code, rev.revisionNo), siteId: null, before: { status: rev.status }, after: { status: "draft" } });
    return { status: "draft" as const };
  });
}

/**
 * Approval decision on a pending routing revision. Quality-relevant changes need qa_qc then
 * site_manager/owner_director; a sequencing-only change needs one site_manager/owner approval
 * (A-PROC-41). Neither approver may be the author or submitter.
 */
export async function decideRoutingRevision(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.routing.approve");
  const input = parseInput(DecisionInput, raw);
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, input.id);
    const name = lbl(routing.code, rev.revisionNo);
    if (rev.status !== "pending_approval") throw new DomainError("state", `${name} is ${rev.status.replace(/_/g, " ")}; only a revision pending approval can be decided.`);
    const today = businessToday();
    const effectiveFrom = input.effectiveFrom ?? rev.effectiveFrom ?? today;
    if (input.decision === "approved" && (!isIsoDate(effectiveFrom) || effectiveFrom < today)) throw new DomainError("validation", "The effective date cannot be in the past.", { fieldErrors: { effectiveFrom: "Choose today or a later date." } });
    const d = await recordApprovalDecision(tx, ctx, {
      recordType: "routing_revision",
      recordId: rev.id,
      excludedUserIds: [rev.createdBy, rev.submittedBy],
      decision: input.decision,
      note: input.note,
      ruleType: ruleTypeFor(rev.changeScope),
    });
    const base = { entityType: "routing_revision", entityId: rev.id, entityNumber: name, siteId: null } as const;
    if (d.rejected) {
      await tx.update(routingRevisions).set({ status: "rejected", approvalNote: input.note }).where(eq(routingRevisions.id, rev.id));
      await audit(tx, ctx, { ...base, action: "masterdata.routing_revision.rejected", reason: input.note, before: { status: rev.status, revisionNo: rev.revisionNo }, after: { status: "rejected", revisionNo: rev.revisionNo } });
      return { status: "rejected" as const, step: d.step.step };
    }
    if (!d.final) {
      await audit(tx, ctx, { ...base, action: "masterdata.routing_revision.reviewed", reason: input.note, after: { step: d.step.step, stepLabel: d.step.label, revisionNo: rev.revisionNo } });
      return { status: "pending_approval" as const, step: d.step.step };
    }
    const closed = await supersedeOverlapping(tx, "routing_revisions", sql`routing_id = ${routing.id}`, rev.id, effectiveFrom);
    await tx.update(routingRevisions).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note, effectiveFrom }).where(eq(routingRevisions.id, rev.id));
    const st = await approvalState(tx, ctx.organizationId, "routing_revision", rev.id, await policyFor(tx, ctx.organizationId, rev.changeScope));
    await audit(tx, ctx, {
      ...base,
      action: "masterdata.routing_revision.approved",
      reason: input.note,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: {
        status: "approved",
        revisionNo: rev.revisionNo,
        effectiveFrom,
        changeScope: rev.changeScope,
        approvers: st.decisions.filter((x) => x.decision === "approved").map((x) => `step ${x.step}: ${x.decidedByName}`),
        superseded: closed.map((c) => `revision ${c.revisionNo} until ${effectiveFrom}`),
      },
    });
    return { status: "approved" as const, step: d.step.step, effectiveFrom, superseded: closed };
  });
}

/** Retires an approved routing revision (approver permission; the catalogue has no routing .void). */
export async function retireRoutingRevision(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.routing.approve");
  const input = parseInput(RetireInput, raw);
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, input.id);
    assertVersionTransition(lbl(routing.code, rev.revisionNo), rev.status, "retired");
    await tx.update(routingRevisions).set({ status: "retired" }).where(eq(routingRevisions.id, rev.id));
    await audit(tx, ctx, { action: "masterdata.routing_revision.retired", entityType: "routing_revision", entityId: rev.id, entityNumber: lbl(routing.code, rev.revisionNo), siteId: null, reason: input.reason, before: { status: rev.status }, after: { status: "retired" } });
    return { status: "retired" as const };
  });
}

/* ================================================================== queries */

/**
 * Approved routing revision effective for a product on a date, with full step content; null when
 * none (V-REV). Used by batch creation and by Wave 2 work orders and process-step execution.
 */
export async function getEffectiveRouting(ctx: AuthContext, productId: string, date: string, opts: { tx?: DbOrTx } = {}) {
  requireAny(ctx, ["masterdata.routing.view", "production.batch.create", "production.batch.view"]);
  if (!isIsoDate(date)) throw new DomainError("validation", "Enter a valid date.");
  const q = opts.tx ?? db;
  const [row] = await q
    .select({ rev: routingRevisions, routing: routings })
    .from(routingRevisions)
    .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
    .where(
      and(
        eq(routings.organizationId, ctx.organizationId),
        eq(routings.productId, productId),
        eq(routingRevisions.status, "approved"),
        lte(routingRevisions.effectiveFrom, date),
        or(isNull(routingRevisions.effectiveTo), gt(routingRevisions.effectiveTo, date)),
      ),
    )
    .orderBy(desc(routingRevisions.effectiveFrom), desc(routingRevisions.revisionNo))
    .limit(1);
  if (!row) return null;
  return { ...row, steps: await loadRoutingSteps(q, row.rev.id) };
}
export type EffectiveRouting = NonNullable<Awaited<ReturnType<typeof getEffectiveRouting>>>;

export async function listRoutings(ctx: AuthContext) {
  ctx.require("masterdata.routing.view");
  const rows = await db
    .select({ routing: routings, product: products })
    .from(routings)
    .innerJoin(products, eq(products.id, routings.productId))
    .where(eq(routings.organizationId, ctx.organizationId))
    .orderBy(asc(routings.code));
  if (!rows.length) return [];
  const revs = await db
    // Spelled out (one-table select: Drizzle would write `= "id"`, the step's own id, so every routing showed 0 steps).
    .select({ rev: routingRevisions, stepCount: sql<number>`(select count(*)::int from routing_steps s where s.routing_revision_id = "routing_revisions"."id")` })
    .from(routingRevisions)
    .where(inArray(routingRevisions.routingId, rows.map((r) => r.routing.id)))
    .orderBy(desc(routingRevisions.revisionNo));
  return rows.map(({ routing, product }) => {
    const mine = revs.filter((r) => r.rev.routingId === routing.id);
    const eff = mine.find((r) => effectiveLabel(r.rev) === "effective");
    const open = mine.find((r) => r.rev.status === "draft" || r.rev.status === "pending_approval");
    return {
      id: routing.id,
      code: routing.code,
      name: routing.name,
      productId: product.id,
      productName: product.name,
      productSku: product.skuCode,
      effective: eff ? { id: eff.rev.id, revisionNo: eff.rev.revisionNo, effectiveFrom: eff.rev.effectiveFrom, stepCount: Number(eff.stepCount) } : null,
      open: open ? { id: open.rev.id, revisionNo: open.rev.revisionNo, status: open.rev.status } : null,
    };
  });
}

export async function getRouting(ctx: AuthContext, routingId: string) {
  ctx.require("masterdata.routing.view");
  const [r] = await db
    .select({ routing: routings, product: products })
    .from(routings)
    .innerJoin(products, eq(products.id, routings.productId))
    .where(and(eq(routings.id, routingId), eq(routings.organizationId, ctx.organizationId)));
  if (!r) return null;
  const revs = await db.select().from(routingRevisions).where(eq(routingRevisions.routingId, r.routing.id)).orderBy(desc(routingRevisions.revisionNo));
  const ids = [...new Set(revs.flatMap((x) => [x.createdBy, x.submittedBy, x.approvedBy]).filter((x): x is string => !!x))];
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  return {
    ...r,
    revisions: revs.map((x) => ({ ...x, label: effectiveLabel(x), submittedByName: x.submittedBy ? names.get(x.submittedBy) : null, approvedByName: x.approvedBy ? names.get(x.approvedBy) : null })),
    canCreateRevision: ctx.can("masterdata.routing.create") && !revs.some((x) => x.status === "draft" || x.status === "pending_approval"),
  };
}

export async function getRoutingRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.routing.view");
  const [r] = await db
    .select({ rev: routingRevisions, routing: routings, product: products })
    .from(routingRevisions)
    .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
    .innerJoin(products, eq(products.id, routings.productId))
    .where(and(eq(routingRevisions.id, revisionId), eq(routings.organizationId, ctx.organizationId)));
  if (!r) return null;
  const steps = await loadRoutingSteps(db, r.rev.id);
  const policy = await policyFor(db, ctx.organizationId, r.rev.changeScope);
  const approval = await approvalState(db, ctx.organizationId, "routing_revision", r.rev.id, policy);
  const ids = [r.rev.createdBy, r.rev.submittedBy, r.rev.approvedBy].filter((x): x is string => !!x);
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const nm = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const draftScope = r.rev.status === "draft" && r.rev.supersedesId ? computeChangeScope(await loadRoutingSteps(db, r.rev.supersedesId), steps) : null;
  return {
    ...r,
    revision: { ...r.rev, label: effectiveLabel(r.rev), createdByName: nm(r.rev.createdBy), submittedByName: nm(r.rev.submittedBy), approvedByName: approverLabel(nm(r.rev.approvedBy), r.rev.approvedBy, [r.rev.createdBy, r.rev.submittedBy]) },
    steps,
    draftScope,
    approval: {
      ...approval,
      canDecide:
        r.rev.status === "pending_approval" &&
        canDecideStep(ctx, approval.nextStep) &&
        ![r.rev.createdBy, r.rev.submittedBy].some((u) => approvalSodConflict(ctx, "routing_revision", approval.nextStep, u, null)) &&
        !approval.decisions.some((d) => approvalSodConflict(ctx, "routing_revision", approval.nextStep, d.decidedBy, null)),
    },
    can: {
      edit: r.rev.status === "draft" && ctx.can("masterdata.routing.edit"),
      submit: r.rev.status === "draft" && ctx.can("masterdata.routing.submit"),
      withdraw: r.rev.status === "pending_approval" && r.rev.submittedBy === ctx.userId && approval.decisions.length === 0,
      retire: r.rev.status === "approved" && ctx.can("masterdata.routing.approve"),
    },
  };
}
export type RoutingRevisionView = NonNullable<Awaited<ReturnType<typeof getRoutingRevision>>>;

export async function routingFormOptions(ctx: AuthContext) {
  requireAny(ctx, ["masterdata.routing.create", "masterdata.routing.edit"]);
  return db.select({ id: products.id, name: products.name, skuCode: products.skuCode }).from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.name));
}

/**
 * Deletes a routing revision that is a never-submitted draft (ADR-075), with its steps, step
 * parameters and checklist items. When it is the routing's only revision the routing goes too.
 * Creator (masterdata.routing.create) or masterdata.routing.edit. Audit
 * masterdata.routing_revision.deleted (and masterdata.routing.deleted). Returns the routing id, or
 * null when the routing was deleted.
 */
export async function deleteRoutingDraft(ctx: AuthContext, revisionId: string): Promise<{ routingId: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) throw new DomainError("not_found", "Routing revision not found.");
  return db.transaction(async (tx) => {
    const { rev, routing } = await lockRevision(tx, ctx, revisionId);
    const what = lbl(routing.code, rev.revisionNo);
    assertMayDeleteDraft(ctx, { create: "masterdata.routing.create", manage: ["masterdata.routing.edit"] }, rev.createdBy, null);
    assertNeverSubmittedDraft(what, rev.status === "draft", rev.submittedAt);
    const steps = await tx.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, rev.id));
    await hardDeleteDraft(tx, ctx, {
      table: "routing_revisions",
      id: rev.id,
      what,
      children: [
        { table: "routing_step_parameters", column: "routing_step_id", through: { table: "routing_steps", column: "routing_revision_id" } },
        { table: "routing_step_checklist_items", column: "routing_step_id", through: { table: "routing_steps", column: "routing_revision_id" } },
        { table: "routing_steps", column: "routing_revision_id" },
      ],
      audit: { action: "masterdata.routing_revision.deleted", entityType: "routing_revision", entityNumber: what, siteId: null, before: { ...rev, steps: steps.map((s) => ({ stepNo: s.stepNo, name: s.name })) } },
    });
    const others = await tx.select({ id: routingRevisions.id }).from(routingRevisions).where(eq(routingRevisions.routingId, routing.id)).limit(1);
    if (others.length) return { routingId: routing.id };
    await hardDeleteDraft(tx, ctx, { table: "routings", id: routing.id, what: `Routing ${routing.code}`, audit: { action: "masterdata.routing.deleted", entityType: "routing", entityNumber: routing.code, siteId: null, before: routing } });
    return { routingId: null };
  });
}

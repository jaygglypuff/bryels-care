import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { inspectionPlanTests, inspectionPlans, materials, products, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { CreateInspectionPlanInput, DecisionInput, SaveInspectionPlanDraftInput, parseInput } from "./schemas";
import { approvalState, assertDraft, assertVersionTransition, businessToday, canDecideStep, effectiveLabel, isIsoDate, recordApprovalDecision, requireAny, supersedeOverlapping } from "./versioning";

/**
 * Inspection plans (US-3-03, FR-quality-03 plans). A plan is a QA-controlled list of tests with
 * methods and specification limits stored as data; the system never asserts a limit of its own
 * (A-PROC-20). Versioned by code; approval by a second qa_qc user (approver ≠ author/submitter).
 * Draft editing and submission use quality.inspection_plan.edit (the catalogue has no .submit).
 */
const lbl = (code: string, n: number) => `${code} revision ${n}`;

async function lockPlan(tx: Tx, ctx: AuthContext, planId: string) {
  const [p] = await tx
    .select()
    .from(inspectionPlans)
    .where(and(eq(inspectionPlans.id, planId), eq(inspectionPlans.organizationId, ctx.organizationId)))
    .for("update");
  if (!p) throw new DomainError("not_found", "Inspection plan not found.");
  if (p.siteId) ctx.requireSite(p.siteId);
  // serialize all revisions of the code
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"inspection_plan:" + ctx.organizationId + ":" + p.code}))`);
  return p;
}

export async function createInspectionPlan(ctx: AuthContext, raw: unknown) {
  ctx.require("quality.inspection_plan.create");
  const input = parseInput(CreateInspectionPlanInput, raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: inspectionPlans.id }).from(inspectionPlans).where(and(eq(inspectionPlans.organizationId, ctx.organizationId), eq(inspectionPlans.code, input.code))).limit(1);
    if (dup) throw new DomainError("conflict", `Plan code ${input.code} already exists; start a new revision of it instead.`, { fieldErrors: { code: "This code is already used." } });
    if (input.productId) {
      const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId)));
      if (!p) throw new DomainError("not_found", "Product not found.");
    }
    if (input.materialId) {
      const [m] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.organizationId)));
      if (!m) throw new DomainError("not_found", "Material not found.");
    }
    const [plan] = await tx
      .insert(inspectionPlans)
      .values({ organizationId: ctx.organizationId, code: input.code, name: input.name, planKind: input.planKind, productId: input.productId, materialId: input.materialId, revisionNo: 1, status: "draft", changeSummary: "First revision", createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "quality.inspection_plan.drafted", entityType: "inspection_plan", entityId: plan.id, entityNumber: lbl(plan.code, 1), siteId: null, after: { status: "draft", planKind: plan.planKind } });
    return { planId: plan.id };
  });
}

export async function createInspectionPlanRevision(ctx: AuthContext, planId: string) {
  ctx.require("quality.inspection_plan.create");
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, planId);
    const revs = await tx.select().from(inspectionPlans).where(and(eq(inspectionPlans.organizationId, ctx.organizationId), eq(inspectionPlans.code, p.code))).orderBy(desc(inspectionPlans.revisionNo));
    const open = revs.find((r) => r.status === "draft" || r.status === "pending_approval");
    if (open) throw new DomainError("conflict", `${lbl(p.code, open.revisionNo)} is still ${open.status.replace(/_/g, " ")}.`);
    const base = revs.find((r) => effectiveLabel(r) === "effective") ?? revs[0];
    const [plan] = await tx
      .insert(inspectionPlans)
      .values({
        organizationId: ctx.organizationId,
        siteId: base.siteId,
        code: base.code,
        name: base.name,
        planKind: base.planKind,
        productId: base.productId,
        materialId: base.materialId,
        samplingInstructions: base.samplingInstructions,
        isPlaceholder: base.isPlaceholder,
        revisionNo: revs[0].revisionNo + 1,
        status: "draft",
        supersedesId: base.id,
        createdBy: ctx.userId,
      })
      .returning();
    const tests = await tx.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, base.id)).orderBy(asc(inspectionPlanTests.sequence));
    if (tests.length) await tx.insert(inspectionPlanTests).values(tests.map(({ id: _i, inspectionPlanId: _p, ...t }) => ({ ...t, inspectionPlanId: plan.id })));
    await audit(tx, ctx, { action: "quality.inspection_plan.drafted", entityType: "inspection_plan", entityId: plan.id, entityNumber: lbl(plan.code, plan.revisionNo), siteId: null, after: { status: "draft", revisionNo: plan.revisionNo, copiedFrom: base.revisionNo } });
    return { planId: plan.id, revisionNo: plan.revisionNo };
  });
}

export async function saveInspectionPlanDraft(ctx: AuthContext, raw: unknown) {
  ctx.require("quality.inspection_plan.edit");
  const input = parseInput(SaveInspectionPlanDraftInput, raw);
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, input.planId);
    assertDraft(lbl(p.code, p.revisionNo), p.status);
    if (input.effectiveFrom && input.effectiveFrom < businessToday()) throw new DomainError("validation", "The proposed effective date cannot be in the past.", { fieldErrors: { effectiveFrom: "Choose today or a later date." } });
    await tx.delete(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, p.id));
    if (input.tests.length) {
      await tx.insert(inspectionPlanTests).values(
        input.tests.map((t, i) => ({ inspectionPlanId: p.id, sequence: i + 1, testCode: t.testCode, name: t.name, method: t.method, valueKind: t.valueKind, uom: t.uom, specMin: t.specMin, specMax: t.specMax, specText: t.specText, isRequired: t.isRequired })),
      );
    }
    await tx
      .update(inspectionPlans)
      .set({ name: input.name, samplingInstructions: input.samplingInstructions, effectiveFrom: input.effectiveFrom, changeSummary: input.changeSummary, isPlaceholder: input.isPlaceholder })
      .where(eq(inspectionPlans.id, p.id));
    await audit(tx, ctx, { action: "quality.inspection_plan.edited", entityType: "inspection_plan", entityId: p.id, entityNumber: lbl(p.code, p.revisionNo), siteId: null, after: { tests: input.tests.length, isPlaceholder: input.isPlaceholder } });
    return { planId: p.id };
  });
}

export async function submitInspectionPlan(ctx: AuthContext, planId: string) {
  ctx.require("quality.inspection_plan.edit");
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, planId);
    assertVersionTransition(lbl(p.code, p.revisionNo), p.status, "pending_approval");
    const tests = await tx.select({ id: inspectionPlanTests.id }).from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, p.id));
    if (!tests.length) throw new DomainError("validation", "Add at least one test before submitting.");
    await tx.update(inspectionPlans).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: new Date() }).where(eq(inspectionPlans.id, p.id));
    await audit(tx, ctx, { action: "quality.inspection_plan.submitted", entityType: "inspection_plan", entityId: p.id, entityNumber: lbl(p.code, p.revisionNo), siteId: null, before: { status: p.status }, after: { status: "pending_approval", revisionNo: p.revisionNo } });
    return { status: "pending_approval" as const };
  });
}

export async function decideInspectionPlan(ctx: AuthContext, raw: unknown) {
  ctx.require("quality.inspection_plan.approve");
  const input = parseInput(DecisionInput, raw);
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, input.id);
    const name = lbl(p.code, p.revisionNo);
    if (p.status !== "pending_approval") throw new DomainError("state", `${name} is ${p.status.replace(/_/g, " ")}; only a pending plan can be decided.`);
    const today = businessToday();
    const effectiveFrom = input.effectiveFrom ?? p.effectiveFrom ?? today;
    if (input.decision === "approved" && (!isIsoDate(effectiveFrom) || effectiveFrom < today)) throw new DomainError("validation", "The effective date cannot be in the past.");
    const d = await recordApprovalDecision(tx, ctx, { recordType: "inspection_plan", recordId: p.id, siteId: p.siteId, excludedUserIds: [p.createdBy, p.submittedBy], decision: input.decision, note: input.note });
    const base = { entityType: "inspection_plan", entityId: p.id, entityNumber: name, siteId: p.siteId } as const;
    if (d.rejected) {
      await tx.update(inspectionPlans).set({ status: "rejected", approvalNote: input.note }).where(eq(inspectionPlans.id, p.id));
      await audit(tx, ctx, { ...base, action: "quality.inspection_plan.rejected", reason: input.note, before: { status: p.status }, after: { status: "rejected", revisionNo: p.revisionNo } });
      return { status: "rejected" as const };
    }
    await supersedeOverlapping(tx, "inspection_plans", sql`organization_id = ${ctx.organizationId} and code = ${p.code}`, p.id, effectiveFrom);
    await tx.update(inspectionPlans).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note, effectiveFrom }).where(eq(inspectionPlans.id, p.id));
    await audit(tx, ctx, { ...base, action: "quality.inspection_plan.approved", reason: input.note, before: { status: p.status, revisionNo: p.revisionNo }, after: { status: "approved", revisionNo: p.revisionNo, effectiveFrom, isPlaceholder: p.isPlaceholder } });
    return { status: "approved" as const, effectiveFrom };
  });
}

/**
 * The approved plan effective on a date for a product (in_process / finished_product) or a
 * material (incoming), with its tests; null when QA has not configured one.
 */
export async function getInspectionPlan(
  ctx: AuthContext,
  args: { planKind: "incoming" | "in_process" | "finished_product"; productId?: string | null; materialId?: string | null; date: string },
  opts: { tx?: DbOrTx } = {},
) {
  requireAny(ctx, ["quality.inspection_plan.view", "production.batch.create", "production.batch.view"]);
  if (!isIsoDate(args.date)) throw new DomainError("validation", "Enter a valid date.");
  if (!args.productId === !args.materialId) throw new DomainError("validation", "Give a product or a material.");
  const q = opts.tx ?? db;
  const [plan] = await q
    .select()
    .from(inspectionPlans)
    .where(
      and(
        eq(inspectionPlans.organizationId, ctx.organizationId),
        eq(inspectionPlans.planKind, args.planKind),
        args.productId ? eq(inspectionPlans.productId, args.productId) : eq(inspectionPlans.materialId, args.materialId!),
        eq(inspectionPlans.status, "approved"),
        lte(inspectionPlans.effectiveFrom, args.date),
        or(isNull(inspectionPlans.effectiveTo), gt(inspectionPlans.effectiveTo, args.date)),
        or(isNull(inspectionPlans.siteId), inArray(inspectionPlans.siteId, ctx.allowedSiteIds)),
      ),
    )
    .orderBy(desc(inspectionPlans.effectiveFrom), desc(inspectionPlans.revisionNo))
    .limit(1);
  if (!plan) return null;
  const tests = await q.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, plan.id)).orderBy(asc(inspectionPlanTests.sequence));
  return { plan, tests };
}

export async function listInspectionPlans(ctx: AuthContext) {
  ctx.require("quality.inspection_plan.view");
  const rows = await db
    .select({ plan: inspectionPlans, productName: products.name, materialName: materials.name, testCount: sql<number>`(select count(*)::int from ${inspectionPlanTests} where ${inspectionPlanTests.inspectionPlanId} = ${inspectionPlans.id})` })
    .from(inspectionPlans)
    .leftJoin(products, eq(products.id, inspectionPlans.productId))
    .leftJoin(materials, eq(materials.id, inspectionPlans.materialId))
    .where(and(eq(inspectionPlans.organizationId, ctx.organizationId), or(isNull(inspectionPlans.siteId), inArray(inspectionPlans.siteId, ctx.allowedSiteIds))))
    .orderBy(asc(inspectionPlans.code), desc(inspectionPlans.revisionNo));
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) byCode.set(r.plan.code, [...(byCode.get(r.plan.code) ?? []), r]);
  return [...byCode.values()].map((revs) => {
    const eff = revs.find((r) => effectiveLabel(r.plan) === "effective");
    const open = revs.find((r) => r.plan.status === "draft" || r.plan.status === "pending_approval");
    const show = eff ?? open ?? revs[0];
    return {
      id: show.plan.id,
      code: show.plan.code,
      name: show.plan.name,
      planKind: show.plan.planKind,
      appliesTo: show.productName ?? show.materialName ?? "—",
      isPlaceholder: show.plan.isPlaceholder,
      testCount: Number(show.testCount),
      effective: eff ? { id: eff.plan.id, revisionNo: eff.plan.revisionNo, effectiveFrom: eff.plan.effectiveFrom } : null,
      open: open ? { id: open.plan.id, revisionNo: open.plan.revisionNo, status: open.plan.status } : null,
    };
  });
}

export async function getInspectionPlanDetail(ctx: AuthContext, planId: string) {
  ctx.require("quality.inspection_plan.view");
  const [row] = await db
    .select({ plan: inspectionPlans, productName: products.name, productSku: products.skuCode, materialName: materials.name, materialCode: materials.code })
    .from(inspectionPlans)
    .leftJoin(products, eq(products.id, inspectionPlans.productId))
    .leftJoin(materials, eq(materials.id, inspectionPlans.materialId))
    .where(and(eq(inspectionPlans.id, planId), eq(inspectionPlans.organizationId, ctx.organizationId)));
  if (!row) return null;
  if (row.plan.siteId && !ctx.allowedSiteIds.includes(row.plan.siteId)) return null;
  const p = row.plan;
  const tests = await db.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, p.id)).orderBy(asc(inspectionPlanTests.sequence));
  const revisions = await db
    .select({ id: inspectionPlans.id, revisionNo: inspectionPlans.revisionNo, status: inspectionPlans.status, effectiveFrom: inspectionPlans.effectiveFrom, effectiveTo: inspectionPlans.effectiveTo, changeSummary: inspectionPlans.changeSummary })
    .from(inspectionPlans)
    .where(and(eq(inspectionPlans.organizationId, ctx.organizationId), eq(inspectionPlans.code, p.code)))
    .orderBy(desc(inspectionPlans.revisionNo));
  const approval = await approvalState(db, ctx.organizationId, "inspection_plan", p.id);
  const ids = [p.createdBy, p.submittedBy, p.approvedBy].filter((x): x is string => !!x);
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const nm = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    plan: { ...p, label: effectiveLabel(p), createdByName: nm(p.createdBy), submittedByName: nm(p.submittedBy), approvedByName: nm(p.approvedBy) },
    appliesTo: row.productName ? `${row.productName} (${row.productSku})` : row.materialName ? `${row.materialName} (${row.materialCode})` : "—",
    tests,
    revisions: revisions.map((r) => ({ ...r, label: effectiveLabel(r) })),
    approval: {
      ...approval,
      canDecide: p.status === "pending_approval" && canDecideStep(ctx, approval.nextStep) && ![p.createdBy, p.submittedBy].some((u) => ctx.sodConflict(u)) && !approval.decisions.some((d) => ctx.sodConflict(d.decidedBy)),
    },
    can: {
      edit: p.status === "draft" && ctx.can("quality.inspection_plan.edit"),
      newRevision: ctx.can("quality.inspection_plan.create") && !revisions.some((r) => r.status === "draft" || r.status === "pending_approval"),
    },
  };
}

export async function inspectionPlanFormOptions(ctx: AuthContext) {
  ctx.require("quality.inspection_plan.create");
  const [prods, mats] = await Promise.all([
    db.select({ id: products.id, name: products.name, skuCode: products.skuCode }).from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.name)),
    db.select({ id: materials.id, name: materials.name, code: materials.code }).from(materials).where(eq(materials.organizationId, ctx.organizationId)).orderBy(asc(materials.code)),
  ]);
  return { products: prods, materials: mats };
}

/**
 * Deletes an inspection plan revision that is a never-submitted draft (ADR-075), with its tests.
 * Creator (quality.inspection_plan.create) or quality.inspection_plan.edit; site-scoped plans
 * check the site. Audit quality.inspection_plan.deleted with the row and tests in `before`.
 * Returns the previous revision of the same code (to show next), or null.
 */
export async function deleteInspectionPlanDraft(ctx: AuthContext, planId: string): Promise<{ previousPlanId: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new DomainError("not_found", "Inspection plan not found.");
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, planId);
    const what = lbl(p.code, p.revisionNo);
    assertMayDeleteDraft(ctx, { create: "quality.inspection_plan.create", manage: ["quality.inspection_plan.edit"] }, p.createdBy, p.siteId);
    assertNeverSubmittedDraft(what, p.status === "draft", p.submittedAt);
    const tests = await tx.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, p.id));
    await hardDeleteDraft(tx, ctx, {
      table: "inspection_plans",
      id: p.id,
      what,
      children: [{ table: "inspection_plan_tests", column: "inspection_plan_id" }],
      audit: { action: "quality.inspection_plan.deleted", entityType: "inspection_plan", entityNumber: what, siteId: p.siteId, before: { ...p, tests } },
    });
    return { previousPlanId: p.supersedesId ?? null };
  });
}

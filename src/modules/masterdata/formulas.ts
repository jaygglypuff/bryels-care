import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, db } from "@/db/client";
import { bomLines, formulaRevisions, formulas, materials, products, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { approverLabel } from "@/lib/auth/self-approval";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assignMasterCode } from "@/lib/numbering";
import { z } from "zod";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { CreateFormulaInput, DecisionInput, RetireInput, SaveFormulaDraftInput, parseInput } from "./schemas";
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

type FormulaRevisionRow = typeof formulaRevisions.$inferSelect;

/**
 * Formula percentages (share of the reference batch) are hidden from operators (A-PM-16,
 * docs/permissions-matrix.md §6): visible to people who author, approve or export formulas and to
 * auditors. Masking happens here in the DTO, never only in the UI.
 */
export function canSeeFormulaPercentages(ctx: AuthContext) {
  return ctx.can("masterdata.formula.create") || ctx.can("masterdata.formula.approve") || ctx.can("masterdata.formula.export") || ctx.can("platform.audit.view");
}

async function userNames(dbx: DbOrTx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await dbx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Locks a formula header of the caller's organization (serializes revision approvals per formula). */
async function lockFormula(tx: DbOrTx, ctx: AuthContext, formulaId: string) {
  const [f] = await tx
    .select()
    .from(formulas)
    .where(and(eq(formulas.id, formulaId), eq(formulas.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!f) throw new DomainError("not_found", "Formula not found.");
  return f;
}

/** Loads a revision of the caller's organization with a row lock on revision and formula. */
async function lockRevision(tx: DbOrTx, ctx: AuthContext, revisionId: string) {
  const [r] = await tx
    .select({ rev: formulaRevisions, formula: formulas })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(and(eq(formulaRevisions.id, revisionId), eq(formulas.organizationId, ctx.organizationId)))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Formula revision not found.");
  await lockFormula(tx, ctx, r.formula.id);
  const [rev] = await tx.select().from(formulaRevisions).where(eq(formulaRevisions.id, revisionId)).for("update").limit(1);
  return { rev, formula: r.formula };
}

const label = (code: string, rev: { revisionNo: number }) => `${code} revision ${rev.revisionNo}`;

/* ================================================================== commands */

/** Creates a formula header for a product with an empty draft revision 1. */
export async function createFormula(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.formula.create");
  const input = parseInput(CreateFormulaInput, raw);
  return db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    if (!product) throw new DomainError("not_found", "Product not found.");
    const used = async (c: string) => (await tx.select({ id: formulas.id }).from(formulas).where(and(eq(formulas.organizationId, ctx.organizationId), eq(formulas.code, c))).limit(1)).length > 0;
    // ADR-093: a blank code gets the next F-nnnn in this transaction (typed codes stay unique).
    const code = input.code ?? (await assignMasterCode(tx, ctx.organizationId, "FRM", used));
    if (input.code && (await used(input.code))) throw new DomainError("conflict", `Formula code ${input.code} is already used.`, { fieldErrors: { code: "This code is already used." } });
    const name = (input.name ?? product.name).slice(0, 120);
    const [f] = await tx.insert(formulas).values({ organizationId: ctx.organizationId, productId: product.id, code, name }).returning();
    const [rev] = await tx
      .insert(formulaRevisions)
      .values({
        formulaId: f.id,
        revisionNo: 1,
        status: "draft",
        referenceBatchSizeG: input.referenceBatchSizeG,
        theoreticalYieldPct: input.theoreticalYieldPct,
        changeSummary: input.changeSummary ?? "First revision",
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "masterdata.formula.created", entityType: "formula", entityId: f.id, entityNumber: f.code, siteId: null, after: { code: f.code, codeAssigned: !input.code, name: f.name, product: product.skuCode } });
    await audit(tx, ctx, { action: "masterdata.formula_revision.drafted", entityType: "formula_revision", entityId: rev.id, entityNumber: label(f.code, rev), siteId: null, after: { status: "draft", revisionNo: 1 } });
    return { formulaId: f.id, revisionId: rev.id };
  });
}

/**
 * Starts revision n+1 as a draft copy of a base revision (default: the revision effective today,
 * else the latest). Only one open (draft or pending) revision per formula.
 */
export async function createFormulaRevision(ctx: AuthContext, input: { formulaId: string; baseRevisionId?: string | null }) {
  ctx.require("masterdata.formula.create");
  return db.transaction(async (tx) => {
    const f = await lockFormula(tx, ctx, input.formulaId);
    const revs = await tx.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, f.id)).orderBy(desc(formulaRevisions.revisionNo));
    const open = revs.find((r) => r.status === "draft" || r.status === "pending_approval");
    if (open) throw new DomainError("conflict", `${label(f.code, open)} is still ${open.status.replace(/_/g, " ")}. Finish or withdraw it before starting another revision.`);
    const today = businessToday();
    const base = input.baseRevisionId
      ? revs.find((r) => r.id === input.baseRevisionId)
      : (revs.find((r) => effectiveLabel(r, today) === "effective") ?? revs[0]);
    if (input.baseRevisionId && !base) throw new DomainError("not_found", "Base revision not found on this formula.");
    const nextNo = (revs[0]?.revisionNo ?? 0) + 1;
    const [rev] = await tx
      .insert(formulaRevisions)
      .values({
        formulaId: f.id,
        revisionNo: nextNo,
        status: "draft",
        referenceBatchSizeG: base?.referenceBatchSizeG ?? "1000",
        theoreticalYieldPct: base?.theoreticalYieldPct ?? "100",
        supersedesId: base?.id ?? null,
        notes: base?.notes ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    if (base) {
      const lines = await tx.select().from(bomLines).where(eq(bomLines.formulaRevisionId, base.id)).orderBy(asc(bomLines.lineNo));
      if (lines.length) {
        await tx.insert(bomLines).values(
          lines.map(({ id: _id, formulaRevisionId: _r, ...l }) => ({ ...l, formulaRevisionId: rev.id })),
        );
      }
    }
    await audit(tx, ctx, {
      action: "masterdata.formula_revision.drafted",
      entityType: "formula_revision",
      entityId: rev.id,
      entityNumber: label(f.code, rev),
      siteId: null,
      after: { status: "draft", revisionNo: rev.revisionNo, copiedFrom: base ? base.revisionNo : null },
    });
    return { revisionId: rev.id, revisionNo: rev.revisionNo };
  });
}

/** Saves header and lines of a draft revision (lines are replaced as a whole). */
export async function saveFormulaRevisionDraft(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.formula.edit");
  const input = parseInput(SaveFormulaDraftInput, raw);
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, input.revisionId);
    assertDraft(label(formula.code, rev), rev.status);
    if (input.effectiveFrom && input.effectiveFrom < businessToday()) {
      throw new DomainError("validation", "The proposed effective date cannot be in the past.", { fieldErrors: { effectiveFrom: "Choose today or a later date." } });
    }
    const matIds = [...new Set(input.lines.map((l) => l.materialId))];
    const mats = matIds.length
      ? await tx.select({ id: materials.id }).from(materials).where(and(inArray(materials.id, matIds), eq(materials.organizationId, ctx.organizationId)))
      : [];
    if (mats.length !== matIds.length) throw new DomainError("validation", "One of the materials does not exist.", { fieldErrors: { lines: "Choose materials from the list." } });

    const before = await tx.select().from(bomLines).where(eq(bomLines.formulaRevisionId, rev.id));
    await tx.delete(bomLines).where(eq(bomLines.formulaRevisionId, rev.id));
    if (input.lines.length) {
      await tx.insert(bomLines).values(
        input.lines.map((l, i) => ({
          formulaRevisionId: rev.id,
          lineNo: i + 1,
          materialId: l.materialId,
          quantityG: l.quantityG,
          tolerancePct: l.tolerancePct,
          toleranceAbsG: l.toleranceAbsG,
          phaseCode: l.phaseCode,
          scaling: l.scaling,
          isCritical: l.isCritical,
          requiresChecker: l.requiresChecker,
        })),
      );
    }
    await tx
      .update(formulaRevisions)
      .set({
        referenceBatchSizeG: input.referenceBatchSizeG,
        theoreticalYieldPct: input.theoreticalYieldPct,
        effectiveFrom: input.effectiveFrom,
        changeSummary: input.changeSummary,
        notes: input.notes,
      })
      .where(eq(formulaRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.formula_revision.edited",
      entityType: "formula_revision",
      entityId: rev.id,
      entityNumber: label(formula.code, rev),
      siteId: null,
      before: { referenceBatchSizeG: rev.referenceBatchSizeG, theoreticalYieldPct: rev.theoreticalYieldPct, lines: before.length },
      after: { referenceBatchSizeG: input.referenceBatchSizeG, theoreticalYieldPct: input.theoreticalYieldPct, lines: input.lines.length, effectiveFrom: input.effectiveFrom },
    });
    return { revisionId: rev.id, lineCount: input.lines.length };
  });
}

/** Author submits a complete draft for approval (draft → pending_approval). */
export async function submitFormulaRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.formula.submit");
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, revisionId);
    assertVersionTransition(label(formula.code, rev), rev.status, "pending_approval");
    const lines = await tx.select().from(bomLines).where(eq(bomLines.formulaRevisionId, rev.id));
    if (!lines.length) throw new DomainError("validation", "Add at least one ingredient line before submitting.");
    const missing = lines.filter((l) => (l.tolerancePct === null) === (l.toleranceAbsG === null));
    if (missing.length) throw new DomainError("validation", `Line ${missing[0].lineNo} needs exactly one tolerance (percentage or grams).`);
    if (rev.revisionNo > 1 && !rev.changeSummary?.trim()) {
      throw new DomainError("validation", "Describe what changes and why (change summary) before submitting.", { fieldErrors: { changeSummary: "Required for revision 2 onwards." } });
    }
    await tx.update(formulaRevisions).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: new Date() }).where(eq(formulaRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.formula_revision.submitted",
      entityType: "formula_revision",
      entityId: rev.id,
      entityNumber: label(formula.code, rev),
      siteId: null,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: { status: "pending_approval", revisionNo: rev.revisionNo },
    });
    return { status: "pending_approval" as const };
  });
}

/** The submitter withdraws a pending revision back to draft, only before anyone has decided on it. */
export async function withdrawFormulaRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.formula.submit");
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, revisionId);
    assertVersionTransition(label(formula.code, rev), rev.status, "draft");
    if (rev.submittedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who submitted the revision can withdraw it.");
    const st = await approvalState(tx, ctx.organizationId, "formula_revision", rev.id);
    if (st.decisions.length) throw new DomainError("state", "An approver has already decided on this revision; it can no longer be withdrawn.");
    await tx.update(formulaRevisions).set({ status: "draft", submittedBy: null, submittedAt: null }).where(eq(formulaRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.formula_revision.withdrawn",
      entityType: "formula_revision",
      entityId: rev.id,
      entityNumber: label(formula.code, rev),
      siteId: null,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: { status: "draft", revisionNo: rev.revisionNo },
    });
    return { status: "draft" as const };
  });
}

/**
 * Records an approval decision on a pending revision. Two steps by default (qa_qc, then
 * site_manager/owner_director), neither being the author or submitter. The final approval sets the
 * effective date (input, else the proposed date, else today; never in the past), supersedes the
 * overlapping approved revision on that date and makes this revision approved and immutable.
 */
export async function decideFormulaRevision(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.formula.approve");
  const input = parseInput(DecisionInput, raw);
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, input.id);
    const name = label(formula.code, rev);
    if (rev.status !== "pending_approval") throw new DomainError("state", `${name} is ${rev.status.replace(/_/g, " ")}; only a revision pending approval can be decided.`);
    const today = businessToday();
    const effectiveFrom = input.effectiveFrom ?? rev.effectiveFrom ?? today;
    if (input.decision === "approved" && (!isIsoDate(effectiveFrom) || effectiveFrom < today)) {
      throw new DomainError("validation", "The effective date cannot be in the past.", { fieldErrors: { effectiveFrom: "Choose today or a later date." } });
    }
    const d = await recordApprovalDecision(tx, ctx, {
      recordType: "formula_revision",
      recordId: rev.id,
      excludedUserIds: [rev.createdBy, rev.submittedBy],
      decision: input.decision,
      note: input.note,
    });
    const base = { entityType: "formula_revision", entityId: rev.id, entityNumber: name, siteId: null } as const;
    if (d.rejected) {
      assertVersionTransition(name, rev.status, "rejected");
      await tx.update(formulaRevisions).set({ status: "rejected", approvalNote: input.note }).where(eq(formulaRevisions.id, rev.id));
      await audit(tx, ctx, { ...base, action: "masterdata.formula_revision.rejected", reason: input.note, before: { status: rev.status, revisionNo: rev.revisionNo }, after: { status: "rejected", revisionNo: rev.revisionNo, step: d.step.step } });
      return { status: "rejected" as const, step: d.step.step };
    }
    if (!d.final) {
      await audit(tx, ctx, { ...base, action: "masterdata.formula_revision.reviewed", reason: input.note, after: { status: rev.status, revisionNo: rev.revisionNo, step: d.step.step, stepLabel: d.step.label } });
      return { status: "pending_approval" as const, step: d.step.step };
    }
    assertVersionTransition(name, rev.status, "approved");
    const closed = await supersedeOverlapping(tx, "formula_revisions", sql`formula_id = ${formula.id}`, rev.id, effectiveFrom);
    await tx
      .update(formulaRevisions)
      .set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note, effectiveFrom })
      .where(eq(formulaRevisions.id, rev.id));
    const st = await approvalState(tx, ctx.organizationId, "formula_revision", rev.id);
    await audit(tx, ctx, {
      ...base,
      action: "masterdata.formula_revision.approved",
      reason: input.note,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: {
        status: "approved",
        revisionNo: rev.revisionNo,
        effectiveFrom,
        approvers: st.decisions.filter((x) => x.decision === "approved").map((x) => `step ${x.step}: ${x.decidedByName}`),
        superseded: closed.map((c) => `revision ${c.revisionNo} until ${effectiveFrom}`),
      },
    });
    return { status: "approved" as const, step: d.step.step, effectiveFrom, superseded: closed };
  });
}

/** Retires an approved revision (masterdata.formula.void): never deleted; history keeps pointing at it. */
export async function retireFormulaRevision(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.formula.void");
  const input = parseInput(RetireInput, raw);
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, input.id);
    assertVersionTransition(label(formula.code, rev), rev.status, "retired");
    await tx.update(formulaRevisions).set({ status: "retired" }).where(eq(formulaRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.formula_revision.retired",
      entityType: "formula_revision",
      entityId: rev.id,
      entityNumber: label(formula.code, rev),
      siteId: null,
      reason: input.reason,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: { status: "retired", revisionNo: rev.revisionNo },
    });
    return { status: "retired" as const };
  });
}

/** Deletes a draft that was never submitted (only the draft and its lines; nothing references it). */
export async function discardFormulaDraft(ctx: AuthContext, revisionId: string) {
  return deleteFormulaDraft(ctx, revisionId);
}

/**
 * Deletes a formula revision that is a never-submitted draft (ADR-075), with its lines. When it is
 * the formula's only revision the formula goes too (a formula without revisions means nothing).
 * Creator (masterdata.formula.create) or masterdata.formula.edit. Audit
 * masterdata.formula_revision.deleted (and masterdata.formula.deleted) with the rows in `before`.
 * Returns the formula id, or null when the formula was deleted.
 */
export async function deleteFormulaDraft(ctx: AuthContext, revisionId: string): Promise<{ formulaId: string | null }> {
  if (!z.uuid().safeParse(revisionId).success) throw new DomainError("not_found", "Formula revision not found.");
  return db.transaction(async (tx) => {
    const { rev, formula } = await lockRevision(tx, ctx, revisionId);
    const what = label(formula.code, rev);
    assertMayDeleteDraft(ctx, { create: "masterdata.formula.create", manage: ["masterdata.formula.edit"] }, rev.createdBy, null);
    assertNeverSubmittedDraft(what, rev.status === "draft", rev.submittedAt);
    const lines = await tx.select().from(bomLines).where(eq(bomLines.formulaRevisionId, rev.id));
    await hardDeleteDraft(tx, ctx, {
      table: "formula_revisions",
      id: rev.id,
      what,
      children: [{ table: "bom_lines", column: "formula_revision_id" }],
      audit: { action: "masterdata.formula_revision.deleted", entityType: "formula_revision", entityNumber: what, siteId: null, before: { ...rev, lines } },
    });
    const others = await tx.select({ id: formulaRevisions.id }).from(formulaRevisions).where(eq(formulaRevisions.formulaId, formula.id)).limit(1);
    if (others.length) return { formulaId: formula.id };
    await hardDeleteDraft(tx, ctx, {
      table: "formulas",
      id: formula.id,
      what: `Formula ${formula.code}`,
      audit: { action: "masterdata.formula.deleted", entityType: "formula", entityNumber: formula.code, siteId: null, before: formula },
    });
    return { formulaId: null };
  });
}

/* ================================================================== queries */

/**
 * Approved formula revision effective for a product on a date (docs/data-model.md §4.3), with its
 * lines and materials; null when none. Used by batch creation (V-REV) and by Wave 2 work orders.
 * When a product has several formulas, the one whose effective revision started last wins.
 */
export async function getEffectiveFormulaRevision(ctx: AuthContext, productId: string, date: string, opts: { tx?: DbOrTx } = {}) {
  requireAny(ctx, ["masterdata.formula.view", "production.batch.create", "production.batch.view"]);
  if (!isIsoDate(date)) throw new DomainError("validation", "Enter a valid date.");
  const q = opts.tx ?? db;
  const [row] = await q
    .select({ rev: formulaRevisions, formula: formulas })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(
      and(
        eq(formulas.organizationId, ctx.organizationId),
        eq(formulas.productId, productId),
        eq(formulaRevisions.status, "approved"),
        lte(formulaRevisions.effectiveFrom, date),
        or(isNull(formulaRevisions.effectiveTo), gt(formulaRevisions.effectiveTo, date)),
      ),
    )
    .orderBy(desc(formulaRevisions.effectiveFrom), desc(formulaRevisions.revisionNo))
    .limit(1);
  if (!row) return null;
  return { ...row, lines: await revisionLines(q, row.rev.id) };
}

/** True when the revision is approved and effective on the date (batch creation guard, V-REV). */
export function isEffectiveOn(rev: Pick<FormulaRevisionRow, "status" | "effectiveFrom" | "effectiveTo">, date: string) {
  return rev.status === "approved" && !!rev.effectiveFrom && rev.effectiveFrom <= date && (!rev.effectiveTo || rev.effectiveTo > date);
}

async function revisionLines(q: DbOrTx, revisionId: string) {
  return q
    .select({ line: bomLines, material: materials })
    .from(bomLines)
    .innerJoin(materials, eq(materials.id, bomLines.materialId))
    .where(eq(bomLines.formulaRevisionId, revisionId))
    .orderBy(asc(bomLines.lineNo));
}

/** Loads a revision with formula, product and lines for snapshotting (no permission check: callers check). */
export async function loadFormulaRevisionForSnapshot(q: DbOrTx, organizationId: string, revisionId: string) {
  const [row] = await q
    .select({ rev: formulaRevisions, formula: formulas, product: products })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulaRevisions.id, revisionId), eq(formulas.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return { ...row, lines: await revisionLines(q, row.rev.id) };
}

/** Formula list: per formula the revision effective today, the open revision and the latest. */
export async function listFormulas(ctx: AuthContext) {
  ctx.require("masterdata.formula.view");
  const today = businessToday();
  const rows = await db
    .select({ formula: formulas, product: products })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(eq(formulas.organizationId, ctx.organizationId))
    .orderBy(asc(formulas.code));
  if (!rows.length) return [];
  const revs = await db
    .select({
      rev: formulaRevisions,
      // Spelled out: in a one-table select Drizzle writes columns without the table name, so `= ${formulaRevisions.id}`
      // became `= "id"` (the line's own id) and every recipe showed 0 ingredients.
      lineCount: sql<number>`(select count(*)::int from bom_lines b where b.formula_revision_id = "formula_revisions"."id")`,
    })
    .from(formulaRevisions)
    .where(inArray(formulaRevisions.formulaId, rows.map((r) => r.formula.id)))
    .orderBy(desc(formulaRevisions.revisionNo));
  return rows.map(({ formula, product }) => {
    const mine = revs.filter((r) => r.rev.formulaId === formula.id);
    const effective = mine.find((r) => effectiveLabel(r.rev, today) === "effective") ?? null;
    const open = mine.find((r) => r.rev.status === "draft" || r.rev.status === "pending_approval") ?? null;
    const scheduled = mine.find((r) => effectiveLabel(r.rev, today) === "scheduled") ?? null;
    return {
      formulaId: formula.id,
      code: formula.code,
      name: formula.name,
      productId: product.id,
      productName: product.name,
      productSku: product.skuCode,
      effective: effective ? { ...pickRev(effective.rev), lineCount: Number(effective.lineCount) } : null,
      open: open ? pickRev(open.rev) : null,
      scheduled: scheduled ? pickRev(scheduled.rev) : null,
      revisionCount: mine.length,
    };
  });
}
export type FormulaListRow = Awaited<ReturnType<typeof listFormulas>>[number];

const pickRev = (r: FormulaRevisionRow) => ({
  id: r.id,
  revisionNo: r.revisionNo,
  status: r.status,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  referenceBatchSizeG: r.referenceBatchSizeG,
  theoreticalYieldPct: r.theoreticalYieldPct,
});

/** Formula header with all revisions (status, effective range, people). */
export async function getFormula(ctx: AuthContext, formulaId: string) {
  ctx.require("masterdata.formula.view");
  const [f] = await db
    .select({ formula: formulas, product: products })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulas.id, formulaId), eq(formulas.organizationId, ctx.organizationId)))
    .limit(1);
  if (!f) return null;
  const today = businessToday();
  const revisions = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, f.formula.id)).orderBy(desc(formulaRevisions.revisionNo));
  const names = await userNames(db, revisions.flatMap((r) => [r.createdBy, r.submittedBy, r.approvedBy]));
  const nm = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : null);
  return {
    ...f,
    revisions: revisions.map((r) => ({
      ...pickRev(r),
      label: effectiveLabel(r, today),
      changeSummary: r.changeSummary,
      createdByName: nm(r.createdBy),
      submittedByName: nm(r.submittedBy),
      approvedByName: approverLabel(nm(r.approvedBy), r.approvedBy, [r.createdBy, r.submittedBy]),
      createdAt: r.createdAt,
    })),
    effectiveRevisionId: revisions.find((r) => effectiveLabel(r, today) === "effective")?.id ?? null,
    openRevisionId: revisions.find((r) => r.status === "draft" || r.status === "pending_approval")?.id ?? null,
  };
}

/** One revision with lines, totals, approval progress and a redline against its base revision. */
export async function getFormulaRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.formula.view");
  const loaded = await loadFormulaRevisionForSnapshot(db, ctx.organizationId, revisionId);
  if (!loaded) return null;
  const { rev, formula, product, lines } = loaded;
  const showPct = canSeeFormulaPercentages(ctx);
  const ref = new Decimal(rev.referenceBatchSizeG);
  // Packaging lines (material kind packaging, ADR-094) hold pieces, not grams: they are outside the gram total.
  const { sumG: total, packaging } = formulaTotals(lines.map(({ line, material }) => ({ quantityG: line.quantityG, materialKind: material.materialKind, materialName: material.name })));
  const dtoLines = lines.map(({ line, material }) => {
    const q = new Decimal(line.quantityG);
    const band = line.toleranceAbsG !== null ? new Decimal(line.toleranceAbsG) : q.mul(line.tolerancePct ?? 0).div(100);
    return {
      id: line.id,
      lineNo: line.lineNo,
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      materialKind: material.materialKind,
      isPackaging: material.materialKind === "packaging",
      inciName: material.inciName,
      baseUom: material.baseUom,
      quantityG: line.quantityG,
      tolerancePct: line.tolerancePct,
      toleranceAbsG: line.toleranceAbsG,
      minG: q.minus(band).toString(),
      maxG: q.plus(band).toString(),
      phaseCode: line.phaseCode,
      scaling: line.scaling,
      isCritical: line.isCritical,
      requiresChecker: line.requiresChecker,
      ...(showPct ? { percentOfBatch: ref.gt(0) ? q.div(ref).mul(100).toDecimalPlaces(4).toString() : null } : {}),
    };
  });

  // Redline against the revision this one supersedes (or the effective one).
  const today = businessToday();
  const all = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, formula.id)).orderBy(desc(formulaRevisions.revisionNo));
  const baseRev = all.find((r) => r.id === rev.supersedesId) ?? (rev.status !== "approved" ? all.find((r) => effectiveLabel(r, today) === "effective" && r.id !== rev.id) : undefined) ?? null;
  const baseLines = baseRev ? await revisionLines(db, baseRev.id) : [];
  const redline = baseRev ? diffLines(baseLines.map((b) => b.line), lines.map((l) => l.line), new Map([...baseLines, ...lines].map((x) => [x.material.id, `${x.material.code} ${x.material.name}`]))) : [];
  const headerChanges: string[] = [];
  if (baseRev) {
    if (!new Decimal(baseRev.referenceBatchSizeG).eq(rev.referenceBatchSizeG)) headerChanges.push(`Reference batch size ${baseRev.referenceBatchSizeG} g → ${rev.referenceBatchSizeG} g`);
    if (!new Decimal(baseRev.theoreticalYieldPct).eq(rev.theoreticalYieldPct)) headerChanges.push(`Theoretical yield ${baseRev.theoreticalYieldPct} % → ${rev.theoreticalYieldPct} %`);
  }

  const approval = await approvalState(db, ctx.organizationId, "formula_revision", rev.id);
  const names = await userNames(db, [rev.createdBy, rev.submittedBy, rev.approvedBy]);
  const nm = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : null);
  const excluded = [rev.createdBy, rev.submittedBy];
  return {
    formula,
    product: { id: product.id, name: product.name, skuCode: product.skuCode },
    revision: { ...rev, label: effectiveLabel(rev, today), createdByName: nm(rev.createdBy), submittedByName: nm(rev.submittedBy), approvedByName: approverLabel(nm(rev.approvedBy), rev.approvedBy, [rev.createdBy, rev.submittedBy]) },
    lines: dtoLines,
    showPercentages: showPct,
    totals: { sumG: total.toString(), referenceBatchSizeG: rev.referenceBatchSizeG, differenceG: total.minus(ref).toString(), packaging },
    baseRevision: baseRev ? { id: baseRev.id, revisionNo: baseRev.revisionNo } : null,
    redline,
    headerChanges,
    approval: {
      ...approval,
      canDecide: rev.status === "pending_approval" && canDecideStep(ctx, approval.nextStep) && !excluded.some((u) => approvalSodConflict(ctx, "formula_revision", approval.nextStep, u, null)) && !approval.decisions.some((d) => approvalSodConflict(ctx, "formula_revision", approval.nextStep, d.decidedBy, null)),
    },
    can: {
      edit: rev.status === "draft" && ctx.can("masterdata.formula.edit"),
      submit: rev.status === "draft" && ctx.can("masterdata.formula.submit"),
      withdraw: rev.status === "pending_approval" && rev.submittedBy === ctx.userId && approval.decisions.length === 0,
      retire: rev.status === "approved" && ctx.can("masterdata.formula.void"),
      newRevision: ctx.can("masterdata.formula.create") && !all.some((r) => r.status === "draft" || r.status === "pending_approval"),
    },
  };
}
export type FormulaRevisionView = NonNullable<Awaited<ReturnType<typeof getFormulaRevision>>>;

/**
 * Gram total of a recipe version and its packaging per batch (ADR-094): ingredient lines add up in
 * grams; packaging lines (material kind packaging) hold pieces, so they are listed separately and
 * never added to the grams. Pure; decimal.js.
 */
export function formulaTotals(lines: { quantityG: string; materialKind: string; materialName: string }[]) {
  let sumG = new Decimal(0);
  const packaging: { materialName: string; pieces: string }[] = [];
  for (const l of lines) {
    if (l.materialKind === "packaging") packaging.push({ materialName: l.materialName, pieces: new Decimal(l.quantityG).toString() });
    else sumG = sumG.plus(l.quantityG);
  }
  return { sumG, packaging };
}

type LineLike = { materialId: string; lineNo: number; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string };
const tolText = (l: LineLike) => (l.toleranceAbsG !== null ? `±${new Decimal(l.toleranceAbsG).toString()} g` : `±${new Decimal(l.tolerancePct ?? 0).toString()} %`);

/** Line-level comparison by material (and occurrence), used for the redline view. */
export function diffLines(base: LineLike[], next: LineLike[], names: Map<string, string>) {
  const key = (ls: LineLike[]) => {
    const seen = new Map<string, number>();
    return ls.map((l) => {
      const n = (seen.get(l.materialId) ?? 0) + 1;
      seen.set(l.materialId, n);
      return [`${l.materialId}#${n}`, l] as const;
    });
  };
  const a = new Map(key(base));
  const b = new Map(key(next));
  const out: { kind: "added" | "removed" | "changed"; material: string; detail: string }[] = [];
  for (const [k, l] of b) {
    const o = a.get(k);
    const material = names.get(l.materialId) ?? l.materialId;
    if (!o) {
      out.push({ kind: "added", material, detail: `${new Decimal(l.quantityG).toString()} g ${tolText(l)}` });
      continue;
    }
    const changes: string[] = [];
    if (!new Decimal(o.quantityG).eq(l.quantityG)) changes.push(`quantity ${new Decimal(o.quantityG).toString()} g → ${new Decimal(l.quantityG).toString()} g`);
    if (tolText(o) !== tolText(l)) changes.push(`tolerance ${tolText(o)} → ${tolText(l)}`);
    if ((o.phaseCode ?? "") !== (l.phaseCode ?? "")) changes.push(`phase ${o.phaseCode ?? "—"} → ${l.phaseCode ?? "—"}`);
    if (o.scaling !== l.scaling) changes.push(`scaling ${o.scaling} → ${l.scaling}`);
    if (changes.length) out.push({ kind: "changed", material, detail: changes.join("; ") });
  }
  for (const [k, l] of a) if (!b.has(k)) out.push({ kind: "removed", material: names.get(l.materialId) ?? l.materialId, detail: `${new Decimal(l.quantityG).toString()} g` });
  return out;
}

/** Products and materials for formula forms. */
export async function formulaFormOptions(ctx: AuthContext) {
  requireAny(ctx, ["masterdata.formula.create", "masterdata.formula.edit"]);
  const [prods, mats] = await Promise.all([
    db.select({ id: products.id, name: products.name, skuCode: products.skuCode }).from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.name)),
    db
      .select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom, kind: materials.materialKind })
      .from(materials)
      .where(eq(materials.organizationId, ctx.organizationId))
      .orderBy(asc(materials.code)),
  ]);
  return { products: prods, materials: mats };
}

/** Approved revisions usable for a new batch: approved and not ended by today (scheduled ones included with their date). */
export async function approvedFormulaRevisionOptions(ctx: AuthContext) {
  requireAny(ctx, ["production.batch.create", "masterdata.formula.view"]);
  const today = businessToday();
  const rows = await db
    .select({
      revisionId: formulaRevisions.id,
      revisionNo: formulaRevisions.revisionNo,
      referenceBatchSizeG: formulaRevisions.referenceBatchSizeG,
      theoreticalYieldPct: formulaRevisions.theoreticalYieldPct,
      effectiveFrom: formulaRevisions.effectiveFrom,
      effectiveTo: formulaRevisions.effectiveTo,
      formulaCode: formulas.code,
      formulaName: formulas.name,
      productId: products.id,
      productName: products.name,
      productSku: products.skuCode,
      lineCount: sql<number>`(select count(*)::int from ${bomLines} where ${bomLines.formulaRevisionId} = ${formulaRevisions.id})`,
    })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulas.organizationId, ctx.organizationId), eq(formulaRevisions.status, "approved"), or(isNull(formulaRevisions.effectiveTo), gt(formulaRevisions.effectiveTo, today))))
    .orderBy(asc(products.name), asc(formulaRevisions.effectiveFrom), desc(formulaRevisions.revisionNo));
  return rows;
}

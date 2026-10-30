import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, workInstructionRevisions, workInstructions } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { CreateWorkInstructionInput, DecisionInput, SaveWorkInstructionDraftInput, parseInput } from "./schemas";
import { approvalState, assertDraft, assertVersionTransition, businessToday, canDecideStep, effectiveLabel, isIsoDate, recordApprovalDecision, supersedeOverlapping } from "./versioning";

/**
 * Work instructions (US-3-02): controlled step text, versioned like formulas. One approval by a
 * holder of masterdata.work_instruction.approve other than the author/submitter. Routing steps
 * point at a specific approved revision, so a batch keeps the instruction text it was created with.
 * Drafts are edited under masterdata.work_instruction.create (the catalogue has no .edit string).
 */
const lbl = (code: string, n: number) => `${code} revision ${n}`;

async function lockRevision(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ctx: AuthContext, revisionId: string) {
  const [r] = await tx
    .select({ rev: workInstructionRevisions, wi: workInstructions })
    .from(workInstructionRevisions)
    .innerJoin(workInstructions, eq(workInstructions.id, workInstructionRevisions.workInstructionId))
    .where(and(eq(workInstructionRevisions.id, revisionId), eq(workInstructions.organizationId, ctx.organizationId)))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Work instruction revision not found.");
  await tx.select({ id: workInstructions.id }).from(workInstructions).where(eq(workInstructions.id, r.wi.id)).for("update");
  const [rev] = await tx.select().from(workInstructionRevisions).where(eq(workInstructionRevisions.id, revisionId)).for("update");
  return { rev, wi: r.wi };
}

export async function createWorkInstruction(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.work_instruction.create");
  const input = parseInput(CreateWorkInstructionInput, raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: workInstructions.id }).from(workInstructions).where(and(eq(workInstructions.organizationId, ctx.organizationId), eq(workInstructions.code, input.code)));
    if (dup) throw new DomainError("conflict", `Instruction code ${input.code} is already used.`, { fieldErrors: { code: "This code is already used." } });
    const [wi] = await tx.insert(workInstructions).values({ organizationId: ctx.organizationId, code: input.code, name: input.name, createdBy: ctx.userId }).returning();
    const [rev] = await tx
      .insert(workInstructionRevisions)
      .values({ workInstructionId: wi.id, revisionNo: 1, status: "draft", bodyMarkdown: input.bodyMarkdown, changeSummary: "First revision", createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "masterdata.work_instruction.created", entityType: "work_instruction", entityId: wi.id, entityNumber: wi.code, siteId: null, after: { code: wi.code, name: wi.name } });
    return { workInstructionId: wi.id, revisionId: rev.id };
  });
}

export async function createWorkInstructionRevision(ctx: AuthContext, workInstructionId: string) {
  ctx.require("masterdata.work_instruction.create");
  return db.transaction(async (tx) => {
    const [wi] = await tx
      .select()
      .from(workInstructions)
      .where(and(eq(workInstructions.id, workInstructionId), eq(workInstructions.organizationId, ctx.organizationId)))
      .for("update");
    if (!wi) throw new DomainError("not_found", "Work instruction not found.");
    const revs = await tx.select().from(workInstructionRevisions).where(eq(workInstructionRevisions.workInstructionId, wi.id)).orderBy(desc(workInstructionRevisions.revisionNo));
    const open = revs.find((r) => r.status === "draft" || r.status === "pending_approval");
    if (open) throw new DomainError("conflict", `${lbl(wi.code, open.revisionNo)} is still ${open.status.replace(/_/g, " ")}.`);
    const base = revs.find((r) => effectiveLabel(r) === "effective") ?? revs[0];
    const [rev] = await tx
      .insert(workInstructionRevisions)
      .values({ workInstructionId: wi.id, revisionNo: (revs[0]?.revisionNo ?? 0) + 1, status: "draft", bodyMarkdown: base?.bodyMarkdown ?? "", supersedesId: base?.id ?? null, createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "masterdata.work_instruction_revision.drafted", entityType: "work_instruction_revision", entityId: rev.id, entityNumber: lbl(wi.code, rev.revisionNo), siteId: null, after: { status: "draft", revisionNo: rev.revisionNo } });
    return { revisionId: rev.id };
  });
}

export async function saveWorkInstructionDraft(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.work_instruction.create");
  const input = parseInput(SaveWorkInstructionDraftInput, raw);
  return db.transaction(async (tx) => {
    const { rev, wi } = await lockRevision(tx, ctx, input.revisionId);
    assertDraft(lbl(wi.code, rev.revisionNo), rev.status);
    await tx.update(workInstructionRevisions).set({ bodyMarkdown: input.bodyMarkdown, changeSummary: input.changeSummary }).where(eq(workInstructionRevisions.id, rev.id));
    await audit(tx, ctx, { action: "masterdata.work_instruction_revision.edited", entityType: "work_instruction_revision", entityId: rev.id, entityNumber: lbl(wi.code, rev.revisionNo), siteId: null, after: { length: input.bodyMarkdown.length } });
    return { revisionId: rev.id };
  });
}

export async function submitWorkInstructionRevision(ctx: AuthContext, revisionId: string) {
  ctx.require("masterdata.work_instruction.submit");
  return db.transaction(async (tx) => {
    const { rev, wi } = await lockRevision(tx, ctx, revisionId);
    assertVersionTransition(lbl(wi.code, rev.revisionNo), rev.status, "pending_approval");
    if (!rev.bodyMarkdown.trim()) throw new DomainError("validation", "Write the instruction text before submitting.");
    await tx.update(workInstructionRevisions).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: new Date() }).where(eq(workInstructionRevisions.id, rev.id));
    await audit(tx, ctx, {
      action: "masterdata.work_instruction_revision.submitted",
      entityType: "work_instruction_revision",
      entityId: rev.id,
      entityNumber: lbl(wi.code, rev.revisionNo),
      siteId: null,
      before: { status: rev.status, revisionNo: rev.revisionNo },
      after: { status: "pending_approval", revisionNo: rev.revisionNo },
    });
    return { status: "pending_approval" as const };
  });
}

export async function decideWorkInstructionRevision(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.work_instruction.approve");
  const input = parseInput(DecisionInput, raw);
  return db.transaction(async (tx) => {
    const { rev, wi } = await lockRevision(tx, ctx, input.id);
    const name = lbl(wi.code, rev.revisionNo);
    if (rev.status !== "pending_approval") throw new DomainError("state", `${name} is ${rev.status.replace(/_/g, " ")}; only a pending revision can be decided.`);
    const today = businessToday();
    const effectiveFrom = input.effectiveFrom ?? today;
    if (input.decision === "approved" && (!isIsoDate(effectiveFrom) || effectiveFrom < today)) throw new DomainError("validation", "The effective date cannot be in the past.");
    const d = await recordApprovalDecision(tx, ctx, { recordType: "work_instruction_revision", recordId: rev.id, excludedUserIds: [rev.createdBy, rev.submittedBy], decision: input.decision, note: input.note });
    const base = { entityType: "work_instruction_revision", entityId: rev.id, entityNumber: name, siteId: null } as const;
    if (d.rejected) {
      await tx.update(workInstructionRevisions).set({ status: "rejected", approvalNote: input.note }).where(eq(workInstructionRevisions.id, rev.id));
      await audit(tx, ctx, { ...base, action: "masterdata.work_instruction_revision.rejected", reason: input.note, before: { status: rev.status }, after: { status: "rejected", revisionNo: rev.revisionNo } });
      return { status: "rejected" as const };
    }
    await supersedeOverlapping(tx, "work_instruction_revisions", sql`work_instruction_id = ${wi.id}`, rev.id, effectiveFrom);
    await tx.update(workInstructionRevisions).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note, effectiveFrom }).where(eq(workInstructionRevisions.id, rev.id));
    await audit(tx, ctx, { ...base, action: "masterdata.work_instruction_revision.approved", reason: input.note, before: { status: rev.status, revisionNo: rev.revisionNo }, after: { status: "approved", revisionNo: rev.revisionNo, effectiveFrom } });
    return { status: "approved" as const, effectiveFrom };
  });
}

export async function listWorkInstructions(ctx: AuthContext) {
  ctx.require("masterdata.work_instruction.view");
  const wis = await db.select().from(workInstructions).where(eq(workInstructions.organizationId, ctx.organizationId)).orderBy(asc(workInstructions.code));
  if (!wis.length) return [];
  const revs = await db.select().from(workInstructionRevisions).where(inArray(workInstructionRevisions.workInstructionId, wis.map((w) => w.id))).orderBy(desc(workInstructionRevisions.revisionNo));
  return wis.map((w) => {
    const mine = revs.filter((r) => r.workInstructionId === w.id);
    const effective = mine.find((r) => effectiveLabel(r) === "effective") ?? null;
    const open = mine.find((r) => r.status === "draft" || r.status === "pending_approval") ?? null;
    return { id: w.id, code: w.code, name: w.name, effective: effective && { id: effective.id, revisionNo: effective.revisionNo, effectiveFrom: effective.effectiveFrom }, open: open && { id: open.id, revisionNo: open.revisionNo, status: open.status } };
  });
}

export async function getWorkInstruction(ctx: AuthContext, id: string) {
  ctx.require("masterdata.work_instruction.view");
  const [wi] = await db.select().from(workInstructions).where(and(eq(workInstructions.id, id), eq(workInstructions.organizationId, ctx.organizationId)));
  if (!wi) return null;
  const revs = await db.select().from(workInstructionRevisions).where(eq(workInstructionRevisions.workInstructionId, wi.id)).orderBy(desc(workInstructionRevisions.revisionNo));
  const ids = revs.flatMap((r) => [r.createdBy, r.submittedBy, r.approvedBy]).filter((x): x is string => !!x);
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, [...new Set(ids)]))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const revisions = await Promise.all(
    revs.map(async (r) => {
      const approval = await approvalState(db, ctx.organizationId, "work_instruction_revision", r.id);
      return {
        ...r,
        label: effectiveLabel(r),
        createdByName: r.createdBy ? names.get(r.createdBy) : null,
        submittedByName: r.submittedBy ? names.get(r.submittedBy) : null,
        approvedByName: r.approvedBy ? names.get(r.approvedBy) : null,
        approval,
        canDecide:
          r.status === "pending_approval" && canDecideStep(ctx, approval.nextStep) && ![r.createdBy, r.submittedBy].some((u) => ctx.sodConflict(u)),
      };
    }),
  );
  return {
    wi,
    revisions,
    can: {
      edit: ctx.can("masterdata.work_instruction.create"),
      submit: ctx.can("masterdata.work_instruction.submit"),
      newRevision: ctx.can("masterdata.work_instruction.create") && !revs.some((r) => r.status === "draft" || r.status === "pending_approval"),
    },
  };
}

/** Approved instruction revisions (not retired) for the routing step picker. */
export async function approvedWorkInstructionOptions(ctx: AuthContext) {
  ctx.require("masterdata.routing.view");
  return db
    .select({ id: workInstructionRevisions.id, code: workInstructions.code, name: workInstructions.name, revisionNo: workInstructionRevisions.revisionNo, effectiveTo: workInstructionRevisions.effectiveTo })
    .from(workInstructionRevisions)
    .innerJoin(workInstructions, eq(workInstructions.id, workInstructionRevisions.workInstructionId))
    .where(and(eq(workInstructions.organizationId, ctx.organizationId), eq(workInstructionRevisions.status, "approved")))
    .orderBy(asc(workInstructions.code), desc(workInstructionRevisions.revisionNo));
}

/**
 * Deletes a work-instruction revision that is a never-submitted draft (ADR-075). When it is the
 * only revision the instruction goes too. Creator or another holder of
 * masterdata.work_instruction.create (drafts are edited under .create; the catalogue has no .edit).
 * Audit masterdata.work_instruction_revision.deleted (and masterdata.work_instruction.deleted).
 */
export async function deleteWorkInstructionDraft(ctx: AuthContext, revisionId: string): Promise<{ workInstructionId: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) throw new DomainError("not_found", "Work instruction revision not found.");
  return db.transaction(async (tx) => {
    const { rev, wi } = await lockRevision(tx, ctx, revisionId);
    const what = lbl(wi.code, rev.revisionNo);
    assertMayDeleteDraft(ctx, { create: "masterdata.work_instruction.create", manage: ["masterdata.work_instruction.create"] }, rev.createdBy, null);
    assertNeverSubmittedDraft(what, rev.status === "draft", rev.submittedAt);
    await hardDeleteDraft(tx, ctx, { table: "work_instruction_revisions", id: rev.id, what, audit: { action: "masterdata.work_instruction_revision.deleted", entityType: "work_instruction_revision", entityNumber: what, siteId: null, before: rev } });
    const others = await tx.select({ id: workInstructionRevisions.id }).from(workInstructionRevisions).where(eq(workInstructionRevisions.workInstructionId, wi.id)).limit(1);
    if (others.length) return { workInstructionId: wi.id };
    await hardDeleteDraft(tx, ctx, { table: "work_instructions", id: wi.id, what: `Work instruction ${wi.code}`, audit: { action: "masterdata.work_instruction.deleted", entityType: "work_instruction", entityNumber: wi.code, siteId: null, before: wi } });
    return { workInstructionId: null };
  });
}

import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import { expenseClaims, fileAttachments, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { getStorage, objectKey, requireStorage, validateUpload } from "@/lib/storage";
import { requireReauthentication } from "@/modules/governance";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { approvalProgress, assertPosterAllowed, canDecide, decisionsOf, evaluateAtSubmit, notifyNextStep, recordDecision, type Progress } from "./approvals";
import { D, DATE_RE, businessDate, isUuid, logTransition, m4, money, namesOf, parseAmount, postFinancial, postingsOf, requireReason, reverseDocumentPosting, transitionsOf } from "./shared";

/**
 * Expense claims with approval limits (US-6-12, FR-finance-03, docs/modules/finance.md §3.3).
 *
 *   draft → submitted → approved → posted → paid; submitted → rejected | draft (returned); draft | submitted
 *   | approved → cancelled; posted → voided (reversal, before payment)
 *
 * Any employee with `finance.expense_claim.create/submit` claims for themselves (self-service, own records
 * only); a receipt is mandatory above `finance.expense.receipt_required_above` (A-FIN-21). Approval steps
 * come from approval_rules `expense_claim` (site manager up to PHP 5,000; site manager then finance above,
 * A-PM-15). The claimant never approves (409); one person never approves two steps (409); the poster is
 * never the claimant and is not an approver unless every matched step allows it (A-PM-10). Posting writes
 * the `expense` row dated on the approval date; an outbound payment to the claimant pays the claim.
 */

export type ExpenseClaimRow = typeof expenseClaims.$inferSelect;

export const EXPENSE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  posted: "Posted (to pay)",
  paid: "Paid",
  cancelled: "Cancelled",
  voided: "Voided",
};

const label = (c: Pick<ExpenseClaimRow, "claimNumber">) => `Expense claim ${c.claimNumber}`;
const doc = (c: ExpenseClaimRow) => ({ type: "expense_claim" as const, id: c.id, siteId: c.siteId, label: label(c) });

/** Own claims always; others' need `finance.expense_claim.view` (or approve / post) at the claim's site. */
function canSeeOthers(ctx: AuthContext, siteId: string) {
  return ctx.canAt("finance.expense_claim.view", siteId) || ctx.canAt("finance.expense_claim.approve", siteId) || ctx.canAt("finance.expense_claim.post", siteId);
}

async function lockClaim(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Expense claim not found.");
  const [c] = await tx.select().from(expenseClaims).where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, ctx.organizationId), inArray(expenseClaims.siteId, ctx.allowedSiteIds))).for("update").limit(1);
  if (!c || (c.claimantUserId !== ctx.userId && !canSeeOthers(ctx, c.siteId))) throw new DomainError("not_found", "Expense claim not found.");
  ctx.requireSite(c.siteId);
  return c;
}

export async function expenseCategories(organizationId: string) {
  return getSetting(db, organizationId, "finance.expense.categories");
}

export type CreateExpenseInput = { categoryCode: string; description: string; expenseDate: string; amount: string; siteId?: string | null; idempotencyKey?: string | null };

export async function createExpenseClaim(ctx: AuthContext, input: CreateExpenseInput) {
  ctx.require("finance.expense_claim.create");
  const siteId = input.siteId || ctx.currentSiteId;
  ctx.requireAt("finance.expense_claim.create", siteId);
  const cats = await expenseCategories(ctx.organizationId);
  if (!cats.some((c) => c.code === input.categoryCode)) throw new DomainError("validation", "Choose a category.", { field: "categoryCode" });
  const description = (input.description ?? "").trim();
  if (description.length < 3 || description.length > 500) throw new DomainError("validation", "Describe the expense (3–500 characters).", { field: "description" });
  if (!DATE_RE.test(input.expenseDate) || input.expenseDate > businessDate()) throw new DomainError("validation", "Choose the date of the expense (not in the future).", { field: "expenseDate" });
  const amount = parseAmount(input.amount, "amount");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ claimId: string; claimNumber: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.expense_claim.create", { ...input, idempotencyKey: undefined });
      if (replay) return replay.replay;
    }
    const number = await nextNumber(tx, ctx.organizationId, "EXP");
    const currency = await getSetting(tx, ctx.organizationId, "finance.currency");
    const [c] = await tx
      .insert(expenseClaims)
      .values({ organizationId: ctx.organizationId, siteId, claimNumber: number, claimantUserId: ctx.userId, categoryCode: input.categoryCode, description, expenseDate: input.expenseDate, amount: m4(amount), currency, idempotencyKey: input.idempotencyKey ?? null })
      .returning();
    await logTransition(tx, ctx, doc(c), null, "draft");
    await audit(tx, ctx, { action: "finance.expense_claim.created", entityType: "expense_claim", entityId: c.id, entityNumber: number, siteId, after: { amount: c.amount, category: c.categoryCode, expenseDate: c.expenseDate } });
    const result = { claimId: c.id, claimNumber: number };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { ...input, idempotencyKey: undefined }, result);
    return result;
  });
}

/** Receipt photo or PDF (validated per docs/security.md §4.6, stored privately). Claimant, draft only. */
export async function uploadExpenseReceipt(ctx: AuthContext, input: { claimId: string; fileName: string; declaredType: string; bytes: Uint8Array; idempotencyKey: string }) {
  ctx.require("finance.expense_claim.create");
  ctx.require("documents.file_attachment.create");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The upload is missing its key. Reload the page and try again.");
  const [pre] = await db.select().from(expenseClaims).where(and(eq(expenseClaims.id, input.claimId), eq(expenseClaims.organizationId, ctx.organizationId))).limit(1);
  if (!pre || pre.claimantUserId !== ctx.userId || !ctx.allowedSiteIds.includes(pre.siteId)) throw new DomainError("not_found", "Expense claim not found.");
  if (pre.status !== "draft") throw new DomainError("state", "A receipt can be attached while the claim is a draft.");
  const storage = requireStorage();
  const file = validateUpload({ fileName: input.fileName, declaredType: input.declaredType, bytes: input.bytes });
  const attachmentId = uuidv7();
  const key = objectKey(ctx.organizationId, attachmentId);
  const checksum = createHash("sha256").update(file.bytes).digest("hex");
  const [dup] = await db.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, input.idempotencyKey))).limit(1);
  if (dup) return { attachmentId: dup.id, replayed: true };
  await storage.put(key, file.bytes, file.contentType);
  return db.transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, input.claimId);
    if (c.status !== "draft" || c.claimantUserId !== ctx.userId) throw new DomainError("state", "A receipt can be attached by the claimant while the claim is a draft.");
    await tx.insert(fileAttachments).values({
      id: attachmentId,
      organizationId: ctx.organizationId,
      siteId: c.siteId,
      storageDriver: storage.driver,
      bucketKey: key,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      checksumSha256: checksum,
      entityType: "expense_claim",
      entityId: c.id,
      attachmentKind: file.contentType.startsWith("image/") ? "photo" : "other",
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    });
    await tx.update(expenseClaims).set({ receiptAttachmentId: attachmentId, updatedAt: new Date() }).where(eq(expenseClaims.id, c.id));
    await audit(tx, ctx, { action: "documents.file_attachment.uploaded", entityType: "file_attachment", entityId: attachmentId, entityNumber: c.claimNumber, siteId: c.siteId, after: { parent: "expense_claim", parentId: c.id, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, sha256: checksum } });
    return { attachmentId, replayed: false };
  });
}

export async function submitExpenseClaim(ctx: AuthContext, id: string) {
  ctx.require("finance.expense_claim.submit");
  return db.transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    if (c.claimantUserId !== ctx.userId) throw new DomainError("forbidden", "Only the claimant submits a claim.");
    if (c.status !== "draft") throw new DomainError("state", `${label(c)} is ${EXPENSE_STATUS_LABEL[c.status].toLowerCase()}; only a draft can be submitted.`);
    const limit = await getSetting(tx, ctx.organizationId, "finance.expense.receipt_required_above");
    if (D(c.amount).gt(limit) && !c.receiptAttachmentId) throw new DomainError("validation", `Attach the receipt: claims above ${money(limit)} need one.`, { field: "receipt" });
    const ev = await evaluateAtSubmit(tx, ctx, { recordType: "expense_claim", recordId: c.id, recordNumber: c.claimNumber, siteId: c.siteId, basis: { amount: c.amount } });
    const now = new Date();
    if (!ev.steps.length) throw new DomainError("setup_required", "No approval rule applies to expense claims; ask the owner to configure one (Management → System → Approval rules).");
    await tx.update(expenseClaims).set({ status: "submitted", submittedAt: now, updatedAt: now }).where(eq(expenseClaims.id, c.id));
    await logTransition(tx, ctx, doc(c), "draft", "submitted");
    await notifyNextStep(tx, ctx, ev.steps[0], { siteId: c.siteId, kind: "finance.expense_claim.approval", title: `Expense claim ${c.claimNumber} to approve`, body: `${ctx.displayName} claims ${money(c.amount)} ${c.currency}.`, entityType: "expense_claim", entityId: c.id, link: `/finance/expenses/${c.id}` });
    await audit(tx, ctx, { action: "finance.expense_claim.submitted", entityType: "expense_claim", entityId: c.id, entityNumber: c.claimNumber, siteId: c.siteId, after: { amount: c.amount, steps: ev.steps.length } });
    return { status: "submitted" };
  });
}

/** Approve (one step) or reject with a reason. The claimant never decides on their own claim. */
export async function decideExpenseClaim(ctx: AuthContext, id: string, input: { decision: "approved" | "rejected" | "returned"; note?: string | null }) {
  ctx.require("finance.expense_claim.approve");
  return db.transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    if (c.status !== "submitted") throw new DomainError("state", `${label(c)} is ${EXPENSE_STATUS_LABEL[c.status].toLowerCase()}; only a claim waiting for approval can be decided.`);
    const r = await recordDecision(tx, ctx, {
      recordType: "expense_claim",
      recordId: c.id,
      recordNumber: c.claimNumber,
      siteId: c.siteId,
      basis: { amount: c.amount },
      pendingSince: c.submittedAt,
      excludedUserIds: [c.claimantUserId],
      decision: input.decision,
      note: input.note,
    });
    const now = new Date();
    if (input.decision === "rejected") {
      const why = requireReason(input.note);
      await tx.update(expenseClaims).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: now, rejectionReason: why, updatedAt: now }).where(eq(expenseClaims.id, c.id));
      await logTransition(tx, ctx, doc(c), "submitted", "rejected", why);
    } else if (input.decision === "returned") {
      await tx.update(expenseClaims).set({ status: "draft", submittedAt: null, updatedAt: now }).where(eq(expenseClaims.id, c.id));
      await logTransition(tx, ctx, doc(c), "submitted", "draft", input.note ?? null);
    } else if (r.final) {
      await tx.update(expenseClaims).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null, updatedAt: now }).where(eq(expenseClaims.id, c.id));
      await logTransition(tx, ctx, doc(c), "submitted", "approved", input.note?.trim() || null);
    } else {
      const p = await approvalProgress(tx, ctx.organizationId, { recordType: "expense_claim", recordId: c.id, siteId: c.siteId, basis: { amount: c.amount } });
      await notifyNextStep(tx, ctx, p.next, { siteId: c.siteId, kind: "finance.expense_claim.approval", title: `Expense claim ${c.claimNumber}: your approval`, body: `Step ${p.next?.step}: ${p.next?.label}.`, entityType: "expense_claim", entityId: c.id, link: `/finance/expenses/${c.id}` });
    }
    await audit(tx, ctx, { action: `finance.expense_claim.${input.decision === "approved" ? "approved" : input.decision === "rejected" ? "rejected" : "returned"}`, entityType: "expense_claim", entityId: c.id, entityNumber: c.claimNumber, siteId: c.siteId, reason: input.note?.trim() || null, after: { step: r.step?.step ?? 1, final: r.final } });
    return { status: input.decision === "approved" ? (r.final ? "approved" : "submitted") : input.decision === "rejected" ? "rejected" : "draft" };
  });
}

export async function cancelExpenseClaim(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.expense_claim.create");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    if (c.claimantUserId !== ctx.userId) throw new DomainError("forbidden", "Only the claimant withdraws a claim.");
    if (!["draft", "submitted", "approved"].includes(c.status)) throw new DomainError("state", `${label(c)} is ${EXPENSE_STATUS_LABEL[c.status].toLowerCase()} and can no longer be withdrawn.`);
    await tx.update(expenseClaims).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(expenseClaims.id, c.id));
    await logTransition(tx, ctx, doc(c), c.status, "cancelled", why);
    await audit(tx, ctx, { action: "finance.expense_claim.cancelled", entityType: "expense_claim", entityId: c.id, entityNumber: c.claimNumber, siteId: c.siteId, reason: why });
    return { status: "cancelled" };
  });
}

/** X-04: post (restricted); the claim becomes payable to the claimant. */
export async function postExpenseClaim(ctx: AuthContext, id: string, input: { password?: string | null; idempotencyKey?: string | null } = {}) {
  ctx.require("finance.expense_claim.post");
  await requireReauthentication(ctx, input.password, "finance.expense_claim.post");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ status: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.expense_claim.post", { id });
      if (replay) return replay.replay;
    }
    const c = await lockClaim(tx, ctx, id);
    ctx.requireAt("finance.expense_claim.post", c.siteId);
    if (c.status !== "approved") throw new DomainError("state", `${label(c)} is ${EXPENSE_STATUS_LABEL[c.status].toLowerCase()}; only an approved claim can be posted.`);
    ctx.assertSeparation(c.claimantUserId === ctx.userId, "You cannot post your own expense claim.", { code: "SEPARATION_OF_DUTIES" });
    await assertPosterAllowed(tx, ctx, { recordType: "expense_claim", recordId: c.id, siteId: c.siteId, basis: { amount: c.amount } });
    const postingDate = businessDate(c.approvedAt ?? new Date());
    await postFinancial(tx, ctx, { siteId: c.siteId, postingType: "expense", documentType: "expense_claim", documentId: c.id, documentNumber: c.claimNumber, postingDate, amount: c.amount, currency: c.currency, direction: "debit", counterpartyUserId: c.claimantUserId, idempotencyKey: input.idempotencyKey ?? null });
    const now = new Date();
    await tx.update(expenseClaims).set({ status: "posted", postedBy: ctx.userId, postedAt: now, updatedAt: now }).where(eq(expenseClaims.id, c.id));
    await logTransition(tx, ctx, doc(c), "approved", "posted");
    await audit(tx, ctx, { action: "finance.expense_claim.posted", entityType: "expense_claim", entityId: c.id, entityNumber: c.claimNumber, siteId: c.siteId, after: { amount: c.amount, postingDate } });
    const result = { status: "posted" };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
    return result;
  });
}

/** Reversal before payment (after payment, void the payment first). */
export async function voidExpenseClaim(ctx: AuthContext, id: string, input: { reason: string; password?: string | null }) {
  ctx.require("finance.expense_claim.void");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.expense_claim.void");
  return db.transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    ctx.requireAt("finance.expense_claim.void", c.siteId);
    if (c.status !== "posted" || D(c.paidAmount).gt(0)) throw new DomainError("state", "Only a posted claim that is not paid can be reversed; void its payment first.");
    await reverseDocumentPosting(tx, ctx, "expense_claim", c.id, reason);
    const now = new Date();
    await tx.update(expenseClaims).set({ status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(expenseClaims.id, c.id));
    await logTransition(tx, ctx, doc(c), "posted", "voided", reason);
    await audit(tx, ctx, { action: "finance.expense_claim.reversed", entityType: "expense_claim", entityId: c.id, entityNumber: c.claimNumber, siteId: c.siteId, reason, before: { status: c.status }, after: { status: "voided" } });
    return { status: "voided" };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listExpenseClaims(ctx: AuthContext, f: { scope?: "mine" | "to_approve" | "all"; status?: string } = {}) {
  if (!ctx.can("finance.expense_claim.create") && !ctx.can("finance.expense_claim.view") && !ctx.can("finance.expense_claim.approve")) ctx.require("finance.expense_claim.view");
  if (!ctx.allowedSiteIds.length) return [];
  const where = [eq(expenseClaims.organizationId, ctx.organizationId), inArray(expenseClaims.siteId, ctx.allowedSiteIds)];
  const othersSites = ctx.allowedSiteIds.filter((s) => canSeeOthers(ctx, s));
  const scope = f.scope ?? "mine";
  if (scope === "mine" || othersSites.length === 0) where.push(eq(expenseClaims.claimantUserId, ctx.userId));
  else where.push(or(eq(expenseClaims.claimantUserId, ctx.userId), inArray(expenseClaims.siteId, othersSites))!);
  if (scope === "to_approve") where.push(eq(expenseClaims.status, "submitted"), sql`${expenseClaims.claimantUserId} <> ${ctx.userId}`);
  if (f.status && EXPENSE_STATUS_LABEL[f.status]) where.push(eq(expenseClaims.status, f.status));
  const rows = await db
    .select({ c: expenseClaims, claimant: users.displayName, siteCode: sites.code })
    .from(expenseClaims)
    .innerJoin(users, eq(users.id, expenseClaims.claimantUserId))
    .innerJoin(sites, eq(sites.id, expenseClaims.siteId))
    .where(and(...where))
    .orderBy(desc(expenseClaims.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r.c, claimantName: r.claimant, siteCode: r.siteCode }));
}

export async function getExpenseClaim(ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Expense claim not found.");
  const [c] = await db.select().from(expenseClaims).where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, ctx.organizationId), inArray(expenseClaims.siteId, ctx.allowedSiteIds))).limit(1);
  if (!c || (c.claimantUserId !== ctx.userId && !canSeeOthers(ctx, c.siteId))) throw new DomainError("not_found", "Expense claim not found.");
  ctx.requireSite(c.siteId);
  const progress: Progress | null = c.status === "submitted" || c.status === "approved" ? await approvalProgress(db, ctx.organizationId, { recordType: "expense_claim", recordId: c.id, siteId: c.siteId, basis: { amount: c.amount }, requesterIds: [c.claimantUserId] }) : null;
  const [receipt] = c.receiptAttachmentId ? await db.select({ id: fileAttachments.id, fileName: fileAttachments.fileName, sizeBytes: fileAttachments.sizeBytes, contentType: fileAttachments.contentType }).from(fileAttachments).where(eq(fileAttachments.id, c.receiptAttachmentId)).limit(1) : [];
  const cats = await expenseCategories(ctx.organizationId);
  const limit = await getSetting(db, ctx.organizationId, "finance.expense.receipt_required_above");
  return {
    claim: c,
    categoryLabel: cats.find((x) => x.code === c.categoryCode)?.label ?? c.categoryCode,
    receipt: receipt ?? null,
    receiptRequired: D(c.amount).gt(limit),
    storageReady: getStorage() !== null,
    receiptLimit: String(limit),
    isClaimant: c.claimantUserId === ctx.userId,
    progress,
    canApprove: c.status === "submitted" && canDecide(ctx, "expense_claim", progress, c.submittedAt, [c.claimantUserId], c.siteId),
    posterBlocked: c.status === "approved" && (ctx.sodConflict(c.claimantUserId) || (!!progress && !progress.posterMayEqualApprover && progress.approvers.some((u) => ctx.sodConflict(u)))),
    decisions: await decisionsOf(db, ctx.organizationId, "expense_claim", c.id),
    names: Object.fromEntries(await namesOf(db, [c.claimantUserId, c.approvedBy, c.rejectedBy, c.postedBy, c.voidedBy])),
    postings: await postingsOf(db, ctx.organizationId, "expense_claim", [c.id]),
    history: await transitionsOf(db, "expense_claim", c.id),
  };
}

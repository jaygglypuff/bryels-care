import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, batches, dispositionRequests, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { conditionalReleaseBlockers, decideBatchInTx } from "./dispositions";
import { BATCH_TRANSITIONS } from "./rules";
import { assertUuid, isIsoDate, manilaToday, reasonText, requiredText } from "./shared";
import { queueStatusLabel } from "./status-labels";

/**
 * Conditional release of a batch (W06-05 exception path, US-3-15): only when the company's QA policy
 * allows it (setting quality.conditional_release.enabled, Q-QA-03, default off). A qa_qc user with
 * quality.disposition.approve requests it with conditions and a review date; a different user holding
 * quality.conditional_release.approve decides. Both decisions are recorded in approval_decisions.
 * It may precede a complete inspection review, but never bypasses deviations, holds, failed results,
 * missing steps or separation of duties.
 */

const RECORD_TYPE = "conditional_release";

async function assertEnabled(ctx: AuthContext, siteId: string) {
  if (!(await getSetting(db, ctx.organizationId, "quality.conditional_release.enabled", siteId))) {
    throw new DomainError("state", "Conditional release is turned off for this site. The company's QA policy must allow it first (Q-QA-03).");
  }
}

export async function conditionalReleaseState(ctx: AuthContext, batchId: string) {
  ctx.require("quality.disposition.view");
  assertUuid(batchId, "Batch");
  const [b] = await db.select({ siteId: batches.siteId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found in your sites.");
  ctx.requireSite(b.siteId);
  const enabled = await getSetting(db, ctx.organizationId, "quality.conditional_release.enabled", b.siteId);
  const [pending] = await db
    .select({ r: dispositionRequests, requestedByName: users.displayName })
    .from(dispositionRequests)
    .innerJoin(users, eq(users.id, dispositionRequests.requestedBy))
    .where(and(eq(dispositionRequests.batchId, batchId), eq(dispositionRequests.status, "pending")))
    .limit(1);
  return {
    enabled,
    pending: pending ? { ...pending.r, requestedByName: pending.requestedByName } : null,
    canRequest: enabled && !pending && ctx.can("quality.disposition.approve"),
    canDecide: !!pending && ctx.can("quality.conditional_release.approve") && pending.r.requestedBy !== ctx.userId,
  };
}

export async function requestConditionalRelease(ctx: AuthContext, input: { batchId: string; conditions: string; reviewDate: string; reason: string }) {
  ctx.require("quality.disposition.approve");
  assertUuid(input.batchId, "Batch");
  const conditions = requiredText(input.conditions, "conditions", "Conditions", 2000);
  const reason = reasonText(input.reason);
  if (!isIsoDate(input.reviewDate) || input.reviewDate <= manilaToday()) throw new DomainError("validation", "The review date must be a valid date after today.", { field: "reviewDate" });
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batches).where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!batch || !ctx.allowedSiteIds.includes(batch.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
    ctx.requireSite(batch.siteId);
    await assertEnabled(ctx, batch.siteId);
    if (!BATCH_TRANSITIONS.release.from.includes(batch.status)) throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; it cannot be released.`);
    const blockers = await conditionalReleaseBlockers(tx, ctx, batch);
    const sod = blockers.find((b) => b.code === "separation_of_duties");
    if (sod) throw new DomainError("separation_of_duties", sod.message);
    if (blockers.length) throw new DomainError("state", blockers.map((b) => b.message).join(" "));
    const [open] = await tx.select({ id: dispositionRequests.id }).from(dispositionRequests).where(and(eq(dispositionRequests.batchId, batch.id), eq(dispositionRequests.status, "pending"))).limit(1);
    if (open) throw new DomainError("conflict", "A conditional release request is already waiting for this batch.");
    const [r] = await tx
      .insert(dispositionRequests)
      .values({ organizationId: ctx.organizationId, siteId: batch.siteId, batchId: batch.id, conditions, reviewDate: input.reviewDate, reason, requestedBy: ctx.userId })
      .returning();
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: batch.siteId, recordType: RECORD_TYPE, recordId: r.id, step: 1, decision: "approved", decidedBy: ctx.userId, note: reason });
    await audit(tx, ctx, {
      action: "quality.disposition.conditional_release_requested",
      entityType: "batch",
      entityId: batch.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      after: { requestId: r.id, conditions, reviewDate: input.reviewDate },
    });
    return { requestId: r.id };
  });
}

export async function decideConditionalRelease(ctx: AuthContext, input: { requestId: string; decision: "approve" | "reject"; note: string }) {
  ctx.require("quality.conditional_release.approve");
  assertUuid(input.requestId, "Request");
  if (!["approve", "reject"].includes(input.decision)) throw new DomainError("validation", "Choose approve or reject.", { field: "decision" });
  const note = reasonText(input.note, "note");
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(dispositionRequests).where(and(eq(dispositionRequests.id, input.requestId), eq(dispositionRequests.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!r || !ctx.allowedSiteIds.includes(r.siteId)) throw new DomainError("not_found", "Request not found in your sites.");
    ctx.requireSite(r.siteId);
    if (r.status !== "pending") throw new DomainError("state", `This request is already ${r.status}.`);
    if (r.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You requested this conditional release; a second approver must decide it (separation of duties).");
    await assertEnabled(ctx, r.siteId);
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: r.siteId, recordType: RECORD_TYPE, recordId: r.id, step: 2, decision: input.decision === "approve" ? "approved" : "rejected", decidedBy: ctx.userId, note });
    if (input.decision === "reject") {
      await tx.update(dispositionRequests).set({ status: "rejected", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note }).where(eq(dispositionRequests.id, r.id));
      await audit(tx, ctx, { action: "quality.disposition.conditional_release_rejected", entityType: "batch", entityId: r.batchId, siteId: r.siteId, reason: note, after: { requestId: r.id } });
      return { status: "rejected" as const, release: null };
    }
    const release = await decideBatchInTx(tx, ctx, {
      batchId: r.batchId,
      decision: "release",
      reason: `${r.reason} (conditional release approved: ${note})`,
      conditional: { requestedBy: r.requestedBy, conditions: r.conditions, reviewDate: r.reviewDate },
    });
    await tx.update(dispositionRequests).set({ status: "approved", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note, dispositionId: release.lotDispositionId }).where(eq(dispositionRequests.id, r.id));
    return { status: "approved" as const, release };
  });
  if (out.release?.lotId) await queueStatusLabel(ctx, { id: out.release.lotId, siteId: out.release.siteId, lotNumber: out.release.lotNumber! }, out.release.lotDispositionId);
  return out;
}

export async function cancelConditionalRelease(ctx: AuthContext, input: { requestId: string; reason: string }) {
  ctx.require("quality.disposition.approve");
  assertUuid(input.requestId, "Request");
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(dispositionRequests).where(and(eq(dispositionRequests.id, input.requestId), eq(dispositionRequests.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!r || !ctx.allowedSiteIds.includes(r.siteId)) throw new DomainError("not_found", "Request not found in your sites.");
    ctx.requireSite(r.siteId);
    if (r.status !== "pending") throw new DomainError("state", `This request is already ${r.status}.`);
    await tx.update(dispositionRequests).set({ status: "cancelled", decidedBy: null, decidedAt: new Date(), decisionNote: reason }).where(eq(dispositionRequests.id, r.id));
    await audit(tx, ctx, { action: "quality.disposition.conditional_release_cancelled", entityType: "batch", entityId: r.batchId, siteId: r.siteId, reason, after: { requestId: r.id } });
    return { status: "cancelled" as const };
  });
}

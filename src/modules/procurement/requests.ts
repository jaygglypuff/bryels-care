import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { materials, purchaseRequestLines, purchaseRequestStateTransitions, purchaseRequests, sites, suppliers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { nextNumber } from "@/lib/numbering";
import { notifyRoles } from "@/modules/platform";
import { approvalProgress, canDecide, decisionsOf, recordDecision } from "./approvals";
import { PR_STATUS_LABEL, type PrStatus, logCreation, transitionPr } from "./state";
import { assertInScope, canSeePrices, cleanText, idempotent, isUuid, money4, optDate, optDecimal, parseDecimal, requireReason, toBase } from "./shared";

/**
 * Purchase requests (US-6-02, W04-02..03): a requester names materials, quantities and a needed-by date;
 * an approver per `approval_rules` (`purchase_request`, default site_manager, A-PM-15) approves or
 * rejects; the creator and the submitter never approve (SoD). Approved lines are converted into PO
 * lines by procurement (`createPurchaseOrder` with `fromRequestLineIds`).
 */

export type PrLineInput = { materialId: string; qty: string; uom?: string | null; estimatedUnitAmount?: string | null; suggestedSupplierId?: string | null; note?: string | null };
export type PrInput = { neededByDate?: string | null; justification?: string | null; lines: PrLineInput[]; reorderSuggestionId?: string | null };

type PrRow = typeof purchaseRequests.$inferSelect;

async function normalizeLines(tx: Tx, ctx: AuthContext, lines: PrLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0) throw new DomainError("validation", "Add at least one material.", { field: "lines" });
  if (lines.length > 50) throw new DomainError("validation", "A request can have at most 50 lines.", { field: "lines" });
  const ids = [...new Set(lines.map((l) => l.materialId).filter(isUuid))];
  const mats = ids.length ? await tx.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), inArray(materials.id, ids))) : [];
  const out = [];
  for (const [i, l] of lines.entries()) {
    const f = (k: string) => `lines.${i}.${k}`;
    const mat = mats.find((m) => m.id === l.materialId);
    if (!mat) throw new DomainError("validation", `Line ${i + 1}: choose a material.`, { field: f("materialId") });
    if (mat.status !== "active") throw new DomainError("validation", `Line ${i + 1}: ${mat.code} is ${mat.status} and cannot be requested.`, { field: f("materialId") });
    const qty = parseDecimal(l.qty, f("qty"), `Line ${i + 1} quantity`);
    const uom = (l.uom || mat.baseUom).trim();
    const qtyBase = await toBase(tx, ctx.organizationId, mat, qty, uom);
    if (!qtyBase) throw new DomainError("validation", `Line ${i + 1}: ${uom} cannot be converted to ${mat.code}'s base unit ${mat.baseUom} (V-UOM).`, { field: f("uom") });
    const est = optDecimal(l.estimatedUnitAmount, f("estimatedUnitAmount"), `Line ${i + 1} estimated price`, { dp: 4, allowZero: true });
    let supplierId: string | null = null;
    if (l.suggestedSupplierId) {
      if (!isUuid(l.suggestedSupplierId)) throw new DomainError("validation", `Line ${i + 1}: choose a supplier from the list.`, { field: f("suggestedSupplierId") });
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, l.suggestedSupplierId), eq(suppliers.organizationId, ctx.organizationId)));
      if (!s) throw new DomainError("validation", `Line ${i + 1}: choose a supplier from the list.`, { field: f("suggestedSupplierId") });
      supplierId = s.id;
    }
    out.push({ mat, qty, uom, qtyBase, est, supplierId, note: cleanText(l.note, 500, f("note"), `Line ${i + 1} note`) });
  }
  return out;
}

function estimateTotal(lines: { qty: Decimal; est: Decimal | null }[]): string | null {
  const priced = lines.filter((l) => l.est);
  if (!priced.length) return null;
  return money4(priced.reduce((s, l) => s.plus(l.qty.mul(l.est!)), new Decimal(0)));
}

async function writeLines(tx: Tx, ctx: AuthContext, pr: PrRow, lines: Awaited<ReturnType<typeof normalizeLines>>) {
  await tx.delete(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, pr.id));
  for (const [i, l] of lines.entries()) {
    await tx.insert(purchaseRequestLines).values({
      organizationId: ctx.organizationId,
      siteId: pr.siteId,
      purchaseRequestId: pr.id,
      lineNo: i + 1,
      materialId: l.mat.id,
      qtyEntered: l.qty.toString(),
      uomEntered: l.uom,
      qtyBase: l.qtyBase.toString(),
      baseUom: l.mat.baseUom,
      estimatedUnitAmount: l.est ? money4(l.est) : null,
      suggestedSupplierId: l.supplierId,
      note: l.note,
    });
  }
}

/** Creates a draft request at the caller's current site (number PR-YY-nnnnn). Repeat key → same request. */
export async function createPurchaseRequest(ctx: AuthContext, input: PrInput & { idempotencyKey?: string | null }, opts: { tx?: Tx } = {}) {
  const siteId = ctx.currentSiteId;
  ctx.requireAt("procurement.purchase_request.create", siteId);
  ctx.assertWritable();
  const run = async (tx: Tx) => {
    const r = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.purchase_request.create", async () => {
      const lines = await normalizeLines(tx, ctx, input.lines);
      const neededByDate = optDate(input.neededByDate, "neededByDate", "Needed by");
      const justification = cleanText(input.justification, 1000, "justification", "Justification");
      const requestNumber = await nextNumber(tx, ctx.organizationId, "PR");
      const [pr] = await tx
        .insert(purchaseRequests)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          requestNumber,
          status: "draft",
          requestedBy: ctx.userId,
          neededByDate,
          justification,
          estimatedTotalAmount: estimateTotal(lines),
          reorderSuggestionId: input.reorderSuggestionId ?? null,
          createdBy: ctx.userId,
          statusChangedBy: ctx.userId,
        })
        .returning();
      await writeLines(tx, ctx, pr, lines);
      await logCreation(tx, ctx, "pr", pr);
      await audit(tx, ctx, {
        action: "procurement.purchase_request.created",
        entityType: "purchase_request",
        entityId: pr.id,
        entityNumber: requestNumber,
        siteId,
        after: { neededByDate, lines: lines.map((l) => ({ material: l.mat.code, qty: l.qty.toString(), uom: l.uom })), fromSuggestion: input.reorderSuggestionId ?? null },
      });
      return { requestId: pr.id, requestNumber };
    });
    return { ...r.result, replayed: r.replayed };
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

async function lockPr(tx: Tx, ctx: AuthContext, requestId: string) {
  if (!isUuid(requestId)) throw new DomainError("not_found", "Purchase request not found in your sites.");
  const [pr] = await tx.select().from(purchaseRequests).where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!pr) throw new DomainError("not_found", "Purchase request not found in your sites.");
  assertInScope(ctx, pr.siteId, "Purchase request");
  return pr;
}

/** The requester (own draft, `.create`) or procurement (`.edit`) replaces a draft's header and lines. */
export async function updatePurchaseRequest(ctx: AuthContext, requestId: string, input: PrInput) {
  return db.transaction(async (tx) => {
    const pr = await lockPr(tx, ctx, requestId);
    if (pr.requestedBy === ctx.userId) ctx.requireAt("procurement.purchase_request.create", pr.siteId);
    else ctx.requireAt("procurement.purchase_request.edit", pr.siteId);
    if (pr.status !== "draft") throw new DomainError("state", `Purchase request ${pr.requestNumber} is ${PR_STATUS_LABEL[pr.status as PrStatus].toLowerCase()}; only drafts can be changed.`);
    const lines = await normalizeLines(tx, ctx, input.lines);
    const neededByDate = optDate(input.neededByDate, "neededByDate", "Needed by");
    const justification = cleanText(input.justification, 1000, "justification", "Justification");
    await writeLines(tx, ctx, pr, lines);
    await tx.update(purchaseRequests).set({ neededByDate, justification, estimatedTotalAmount: estimateTotal(lines), updatedAt: new Date() }).where(eq(purchaseRequests.id, pr.id));
    await audit(tx, ctx, { action: "procurement.purchase_request.updated", entityType: "purchase_request", entityId: pr.id, entityNumber: pr.requestNumber, siteId: pr.siteId, before: { neededByDate: pr.neededByDate }, after: { neededByDate, lines: lines.length } });
    return { requestId: pr.id };
  });
}

const basisOf = (pr: PrRow) => ({ amount: pr.estimatedTotalAmount ?? ("unbounded" as const) });

/** Submits a draft for approval (W04-02 → W04-03); approvers per approval_rules are notified. */
export async function submitPurchaseRequest(ctx: AuthContext, input: { requestId: string }) {
  return db.transaction(async (tx) => {
    const pr = await lockPr(tx, ctx, input.requestId);
    ctx.requireAt("procurement.purchase_request.submit", pr.siteId);
    const n = await tx.select({ id: purchaseRequestLines.id }).from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, pr.id));
    if (!n.length) throw new DomainError("validation", "Add at least one material before submitting.", { field: "lines" });
    const now = new Date();
    await transitionPr(tx, ctx, pr, "submitted", { set: { submittedBy: ctx.userId, submittedAt: now } });
    await audit(tx, ctx, { action: "procurement.purchase_request.submitted", entityType: "purchase_request", entityId: pr.id, entityNumber: pr.requestNumber, siteId: pr.siteId, after: { status: "submitted", estimatedTotalAmount: pr.estimatedTotalAmount } });
    const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "purchase_request", recordId: pr.id, siteId: pr.siteId, basis: basisOf(pr) });
    const roles = progress.next?.roleCodes.length ? progress.next.roleCodes : ["site_manager"];
    await notifyRoles(tx, { roleCodes: roles, siteId: pr.siteId }, { organizationId: ctx.organizationId, siteId: pr.siteId, kind: "purchase_request_submitted", severity: "info", title: `Purchase request ${pr.requestNumber} waits for approval`, body: "Review the materials and quantities.", entityType: "purchase_request", entityId: pr.id, link: `/procurement/requests/${pr.id}` });
    return { requestId: pr.id, status: "submitted" as const };
  });
}

/**
 * Approver decision (W04-03): approve (step by step per approval_rules), reject (final, reason) or
 * return to draft (reason). The creator/submitter never decides (409 SEPARATION_OF_DUTIES).
 */
export async function decidePurchaseRequest(ctx: AuthContext, input: { requestId: string; decision: "approve" | "reject" | "return"; note?: string | null }) {
  if (!["approve", "reject", "return"].includes(input.decision)) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  return db.transaction(async (tx) => {
    const pr = await lockPr(tx, ctx, input.requestId);
    ctx.requireAt("procurement.purchase_request.approve", pr.siteId);
    if (pr.status !== "submitted") throw new DomainError("state", `Purchase request ${pr.requestNumber} is ${PR_STATUS_LABEL[pr.status as PrStatus].toLowerCase()}; only submitted requests are decided.`);
    const decision = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "returned";
    const r = await recordDecision(tx, ctx, {
      recordType: "purchase_request",
      recordId: pr.id,
      recordNumber: pr.requestNumber,
      siteId: pr.siteId,
      basis: basisOf(pr),
      pendingSince: pr.submittedAt,
      excludedUserIds: [pr.createdBy, pr.requestedBy, pr.submittedBy],
      decision,
      note: input.note,
    });
    const now = new Date();
    if (decision === "approved" && r.final) {
      await transitionPr(tx, ctx, pr, "approved", { set: { approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null } });
      await notifyRoles(tx, { roleCodes: ["procurement"], siteId: pr.siteId }, { organizationId: ctx.organizationId, siteId: pr.siteId, kind: "purchase_request_approved", severity: "info", title: `Purchase request ${pr.requestNumber} approved`, body: "Convert it into a purchase order.", entityType: "purchase_request", entityId: pr.id, link: `/procurement/requests/${pr.id}` });
    } else if (decision === "rejected") {
      await transitionPr(tx, ctx, pr, "rejected", { reason: input.note, set: { rejectReason: input.note?.trim() ?? null } });
    } else if (decision === "returned") {
      await transitionPr(tx, ctx, pr, "draft", { reason: input.note });
    }
    await audit(tx, ctx, {
      action: decision === "approved" ? (r.final ? "procurement.purchase_request.approved" : "procurement.purchase_request.step_approved") : decision === "rejected" ? "procurement.purchase_request.rejected" : "procurement.purchase_request.returned",
      entityType: "purchase_request",
      entityId: pr.id,
      entityNumber: pr.requestNumber,
      siteId: pr.siteId,
      reason: input.note?.trim() || null,
      after: { status: pr.status, step: r.step?.step ?? 1, final: r.final },
    });
    return { requestId: pr.id, status: pr.status as PrStatus, final: r.final };
  });
}

/** Cancels a request (procurement/site manager with `.void`; the requester may cancel their own draft). */
export async function cancelPurchaseRequest(ctx: AuthContext, input: { requestId: string; reason: string }) {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const pr = await lockPr(tx, ctx, input.requestId);
    const own = pr.requestedBy === ctx.userId && pr.status === "draft" && ctx.canAt("procurement.purchase_request.create", pr.siteId);
    if (!own) ctx.requireAt("procurement.purchase_request.void", pr.siteId);
    await transitionPr(tx, ctx, pr, "cancelled", { reason, set: { cancelReason: reason } });
    await audit(tx, ctx, { action: "procurement.purchase_request.cancelled", entityType: "purchase_request", entityId: pr.id, entityNumber: pr.requestNumber, siteId: pr.siteId, reason });
    return { requestId: pr.id };
  });
}

export type PrFilter = { status?: string; q?: string };

export async function listPurchaseRequests(ctx: AuthContext, f: PrFilter = {}) {
  ctx.require("procurement.purchase_request.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.purchase_request.view", s));
  if (!siteIds.length) return [];
  const conds = [eq(purchaseRequests.organizationId, ctx.organizationId), inArray(purchaseRequests.siteId, siteIds)];
  if (f.status === "open") conds.push(inArray(purchaseRequests.status, ["draft", "submitted", "approved"]));
  else if (f.status && f.status !== "all") conds.push(eq(purchaseRequests.status, f.status));
  const rows = await db
    .select({ pr: purchaseRequests, siteCode: sites.code, requestedByName: users.displayName, lines: sql<number>`(select count(*)::int from purchase_request_lines l where l.purchase_request_id = ${purchaseRequests.id})` })
    .from(purchaseRequests)
    .innerJoin(sites, eq(sites.id, purchaseRequests.siteId))
    .innerJoin(users, eq(users.id, purchaseRequests.requestedBy))
    .where(and(...conds))
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(300);
  const q = f.q?.trim().toLowerCase();
  const prices = canSeePrices(ctx);
  return rows
    .filter((r) => !q || r.pr.requestNumber.toLowerCase().includes(q) || (r.pr.justification ?? "").toLowerCase().includes(q))
    .map((r) => ({ id: r.pr.id, number: r.pr.requestNumber, status: r.pr.status as PrStatus, siteCode: r.siteCode, requestedByName: r.requestedByName, neededByDate: r.pr.neededByDate, lines: Number(r.lines), estimatedTotalAmount: prices ? r.pr.estimatedTotalAmount : undefined, createdAt: r.pr.createdAt, submittedAt: r.pr.submittedAt }));
}

export async function getPurchaseRequest(ctx: AuthContext, requestId: string) {
  ctx.require("procurement.purchase_request.view");
  if (!isUuid(requestId)) throw new DomainError("not_found", "Purchase request not found in your sites.");
  const [pr] = await db.select().from(purchaseRequests).where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.organizationId, ctx.organizationId))).limit(1);
  if (!pr || !ctx.allowedSiteIds.includes(pr.siteId)) throw new DomainError("not_found", "Purchase request not found in your sites.");
  const prices = canSeePrices(ctx);
  const lines = await db
    .select({ l: purchaseRequestLines, code: materials.code, name: materials.name, supplierName: suppliers.name })
    .from(purchaseRequestLines)
    .innerJoin(materials, eq(materials.id, purchaseRequestLines.materialId))
    .leftJoin(suppliers, eq(suppliers.id, purchaseRequestLines.suggestedSupplierId))
    .where(eq(purchaseRequestLines.purchaseRequestId, pr.id))
    .orderBy(asc(purchaseRequestLines.lineNo));
  const transitions = await db
    .select({ t: purchaseRequestStateTransitions, actorName: users.displayName })
    .from(purchaseRequestStateTransitions)
    .innerJoin(users, eq(users.id, purchaseRequestStateTransitions.actorId))
    .where(eq(purchaseRequestStateTransitions.purchaseRequestId, pr.id))
    .orderBy(asc(purchaseRequestStateTransitions.occurredAt));
  const [site] = await db.select({ code: sites.code, name: sites.name }).from(sites).where(eq(sites.id, pr.siteId));
  const [requester] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, pr.requestedBy));
  const progress = await approvalProgress(db, ctx.organizationId, { recordType: "purchase_request", recordId: pr.id, siteId: pr.siteId, basis: basisOf(pr), requesterIds: [pr.createdBy, pr.requestedBy, pr.submittedBy] });
  const decisions = await decisionsOf(db, ctx.organizationId, "purchase_request", pr.id);
  const excluded = [pr.createdBy, pr.requestedBy, pr.submittedBy];
  return {
    request: { ...pr, estimatedTotalAmount: prices ? pr.estimatedTotalAmount : null, status: pr.status as PrStatus },
    site,
    requestedByName: requester?.name ?? "",
    lines: lines.map((r) => ({ ...r.l, materialCode: r.code, materialName: r.name, supplierName: r.supplierName, estimatedUnitAmount: prices ? r.l.estimatedUnitAmount : null })),
    transitions: transitions.map((t) => ({ ...t.t, actorName: t.actorName })),
    progress,
    decisions,
    can: {
      edit: pr.status === "draft" && (pr.requestedBy === ctx.userId ? ctx.canAt("procurement.purchase_request.create", pr.siteId) : ctx.canAt("procurement.purchase_request.edit", pr.siteId)),
      submit: pr.status === "draft" && ctx.canAt("procurement.purchase_request.submit", pr.siteId),
      decide: pr.status === "submitted" && canDecide(ctx, "purchase_request", progress, pr.siteId, pr.submittedAt, excluded),
      cancel: ["draft", "submitted", "approved"].includes(pr.status) && (ctx.canAt("procurement.purchase_request.void", pr.siteId) || (pr.status === "draft" && pr.requestedBy === ctx.userId)),
      convert: pr.status === "approved" && ctx.canAt("procurement.purchase_order.create", pr.siteId),
      seePrices: prices,
    },
  };
}

/** Approved request lines not yet converted (PO builder). */
export async function convertibleRequestLines(ctx: AuthContext) {
  ctx.require("procurement.purchase_order.create");
  const siteId = ctx.currentSiteId;
  const rows = await db
    .select({ l: purchaseRequestLines, number: purchaseRequests.requestNumber, neededBy: purchaseRequests.neededByDate, code: materials.code, name: materials.name })
    .from(purchaseRequestLines)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.purchaseRequestId))
    .innerJoin(materials, eq(materials.id, purchaseRequestLines.materialId))
    .where(and(eq(purchaseRequests.organizationId, ctx.organizationId), eq(purchaseRequests.siteId, siteId), eq(purchaseRequests.status, "approved"), sql`${purchaseRequestLines.convertedPoLineId} is null`))
    .orderBy(asc(purchaseRequests.requestNumber), asc(purchaseRequestLines.lineNo));
  return rows.map((r) => ({ id: r.l.id, requestId: r.l.purchaseRequestId, requestNumber: r.number, neededByDate: r.neededBy, lineNo: r.l.lineNo, materialId: r.l.materialId, materialCode: r.code, materialName: r.name, qty: r.l.qtyEntered, uom: r.l.uomEntered, suggestedSupplierId: r.l.suggestedSupplierId }));
}

/** Pickers of the request form: active materials and active suppliers (organization master data). */
export async function requestFormOptions(ctx: AuthContext) {
  ctx.require("procurement.purchase_request.create");
  const mats = await db.select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom }).from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.status, "active"))).orderBy(asc(materials.code));
  const sups = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true))).orderBy(asc(suppliers.name));
  return { materials: mats, suppliers: sups };
}

/**
 * Deletes a purchase request that is a never-submitted draft (ADR-075), with its lines and its
 * state history. The requester (procurement.purchase_request.create) or a holder of
 * procurement.purchase_request.edit at the site. Audit procurement.purchase_request.deleted.
 */
export async function deletePurchaseRequestDraft(ctx: AuthContext, input: { requestId: string }) {
  return db.transaction(async (tx) => {
    const pr = await lockPr(tx, ctx, input.requestId);
    const what = `Purchase request ${pr.requestNumber}`;
    assertMayDeleteDraft(ctx, { create: "procurement.purchase_request.create", manage: ["procurement.purchase_request.edit"] }, pr.requestedBy ?? pr.createdBy, pr.siteId);
    assertNeverSubmittedDraft(what, pr.status === "draft", pr.submittedAt);
    const lines = await tx.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, pr.id));
    await hardDeleteDraft(tx, ctx, {
      table: "purchase_requests",
      id: pr.id,
      what,
      children: [
        { table: "purchase_request_lines", column: "purchase_request_id" },
        { table: "purchase_request_state_transitions", column: "purchase_request_id" },
      ],
      audit: { action: "procurement.purchase_request.deleted", entityType: "purchase_request", entityNumber: pr.requestNumber, siteId: pr.siteId, before: { ...pr, lines } },
    });
    return { deleted: pr.requestNumber };
  });
}

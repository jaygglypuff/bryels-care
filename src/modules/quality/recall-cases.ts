import "server-only";
import { and, asc, desc, eq, exists, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  RECALL_KINDS,
  complaints,
  containers,
  customers,
  inventoryLots,
  recallCaseContainers,
  recallCaseCustomers,
  recallCaseLots,
  recallCaseStateTransitions,
  recallCases,
  shipments,
  sites,
  users,
} from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { notifyRoles } from "@/modules/platform";
import { returnedQtyByLot } from "@/modules/sales";
import { RECALLABLE_LOT_STATUSES, RECALL_CASE_STATUS_LABEL, RECALL_KIND_LABEL, type RecallCaseStatus, type RecallKind, canMoveRecallCase } from "./capa-rules";
import { decideLot } from "./dispositions";
import { recallScope, type RecallMode, type RecallQuery } from "./recall";
import { canDecideQualityStep, qualityApprovalProgress, recordQualityDecision } from "./recall-cases-approvals";
import { assertUuid, isUuid, optionalText, reasonText, requiredText } from "./shared";

/**
 * Recall / withdrawal / mock recall cases (US-6-18, FR-quality-08, process map W07-08..W07-10,
 * ux-system §9.14). Opened by QA from the W3F recall explorer: the forward (or reverse) trace is copied
 * into the case (lots, boxes, customer × shipment × lot lines) at opening. Approval: approval_rules
 * `recall_case` (default qa_qc, then owner_director; the opener and the submitter never approve; R:
 * re-authentication). "Mark recalled" (quality.recall_case.admin, R) writes one `recall` disposition per
 * lot through the normal lot disposition service (decideLot), each in its own transaction with one shared
 * correlation id; boxes inherit the lot's status, and the existing V-REC checks then block allocation,
 * picking, packing and dispatch. A mock recall (drill) never marks stock. Closure requires the
 * reconciliation shipped − returned − accounted per line, with an explanation for any gap.
 *
 * Classification, notification obligations and the notice wording are the company's regulatory
 * responsibility: free text on the case and setting `quality.recall_case.notice_text` (placeholder).
 */

type CaseRow = typeof recallCases.$inferSelect;
const DOCUMENT_TYPE = "recall_case" as const;

/* ------------------------------------------------------------------ scope helpers */

/** A case is visible when its origin site, or any of its lots, is at one of the caller's sites. */
async function visibleTo(q: DbOrTx, ctx: AuthContext, c: { id: string; originSiteId: string | null }) {
  if (!c.originSiteId || ctx.allowedSiteIds.includes(c.originSiteId)) return true;
  const [l] = await q.select({ id: recallCaseLots.id }).from(recallCaseLots).where(and(eq(recallCaseLots.recallCaseId, c.id), inArray(recallCaseLots.siteId, ctx.allowedSiteIds))).limit(1);
  return !!l;
}

async function lockCase(tx: Tx, ctx: AuthContext, id: string): Promise<CaseRow> {
  assertUuid(id, "Recall case");
  const [c] = await tx.select().from(recallCases).where(and(eq(recallCases.id, id), eq(recallCases.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!c || !(await visibleTo(tx, ctx, c))) throw new DomainError("not_found", "Recall case not found in your sites.");
  return c;
}

async function move(tx: Tx, ctx: AuthContext, c: CaseRow, to: RecallCaseStatus, reason: string | null, set: Partial<typeof recallCases.$inferInsert> = {}) {
  if (!canMoveRecallCase(c.status, to)) throw new DomainError("state", `Recall case ${c.recallNumber} is ${RECALL_CASE_STATUS_LABEL[c.status as RecallCaseStatus]?.toLowerCase() ?? c.status}; it cannot move to ${RECALL_CASE_STATUS_LABEL[to].toLowerCase()}.`);
  await tx.update(recallCases).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(recallCases.id, c.id));
  await tx.insert(recallCaseStateTransitions).values({ organizationId: ctx.organizationId, recallCaseId: c.id, fromState: c.status, toState: to, actorId: ctx.userId, reason });
  const from = c.status;
  Object.assign(c, set, { status: to });
  return from;
}

function siteIdOf(ctx: AuthContext, code: string): string {
  const s = ctx.allowedSites.find((x) => x.code === code);
  if (!s) throw new DomainError("not_found", "A traced record is outside your sites.");
  return s.id;
}

/** Copies the explorer's trace into the case (lots: start + downstream; boxes; customer × shipment × lot). */
async function captureScope(tx: Tx, ctx: AuthContext, caseId: string, q: RecallQuery) {
  const r = await recallScope(ctx, q);
  if (!r.subject) throw new DomainError("validation", r.notFoundMessage, { field: "code" });
  const lots = r.lots.filter((l) => l.role === "start" || l.role === "downstream");
  if (!lots.length) throw new DomainError("validation", "The trace found no lot to recall.", { field: "code" });
  await tx.insert(recallCaseLots).values(
    lots.map((l) => ({ organizationId: ctx.organizationId, recallCaseId: caseId, lotId: l.id, siteId: siteIdOf(ctx, l.siteCode), traceRole: l.role, statusAtOpening: l.status, onHandAtOpening: l.onHand, uomBase: l.uom })),
  );
  const boxes = r.boxes.filter((b) => b.containerId);
  if (boxes.length) {
    const shipByBox = new Map<string, string>();
    for (const s of r.shipments) for (const b of s.boxes) shipByBox.set(b, s.shipmentId);
    await tx
      .insert(recallCaseContainers)
      .values(boxes.map((b) => ({ organizationId: ctx.organizationId, recallCaseId: caseId, containerId: b.containerId, siteId: siteIdOf(ctx, b.siteCode), shipmentId: shipByBox.get(b.number) ?? null, statusAtOpening: b.status })))
      .onConflictDoNothing();
  }
  if (r.shipments.length) {
    await tx
      .insert(recallCaseCustomers)
      .values(
        r.shipments.map((s) => ({
          organizationId: ctx.organizationId,
          recallCaseId: caseId,
          customerId: s.customerId,
          shipmentId: s.shipmentId,
          lotId: s.lotId,
          siteId: siteIdOf(ctx, s.siteCode),
          drNumber: s.drNumber,
          qtyShippedBase: s.qtyShipped,
          qtyReturnedBase: s.qtyReturned,
          uomBase: s.uom,
        })),
      )
      .onConflictDoNothing();
  }
  return { scope: r, lots: lots.length, boxes: boxes.length, lines: r.shipments.length, customers: r.customers.length };
}

/* ------------------------------------------------------------------ open, edit, submit */

export type OpenRecallCaseInput = {
  code?: string | null;
  supplierLot?: string | null;
  complaintId?: string | null;
  mode?: RecallMode | null;
  recallKind: string;
  title: string;
  description: string;
  classification?: string | null;
  regulatoryNotes?: string | null;
  idempotencyKey?: string | null;
};

export async function openRecallCase(ctx: AuthContext, input: OpenRecallCaseInput) {
  ctx.require("quality.recall_case.create");
  ctx.require("quality.genealogy.view");
  if (!(RECALL_KINDS as readonly string[]).includes(input.recallKind)) throw new DomainError("validation", "Choose recall, withdrawal or mock recall.", { field: "recallKind" });
  const title = requiredText(input.title, "title", "A title", 200);
  const description = reasonText(input.description, "description", 4000);
  const classification = optionalText(input.classification, "classification", 300);
  const regulatoryNotes = optionalText(input.regulatoryNotes, "regulatoryNotes", 4000);
  const mode: RecallMode = input.mode === "reverse" ? "reverse" : "forward";
  const query: RecallQuery = input.complaintId ? { complaintId: input.complaintId, mode } : input.supplierLot?.trim() ? { supplierLot: input.supplierLot.trim(), mode } : { code: input.code?.trim() || undefined, mode };
  if (!query.code && !query.supplierLot && !query.complaintId) throw new DomainError("validation", "Scan or type the lot, box, batch or complaint the recall starts from.", { field: "code" });
  if (input.idempotencyKey && input.idempotencyKey.length > 200) throw new DomainError("validation", "The request key is too long.");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"rc:" + input.idempotencyKey}))`);
      const [dup] = await tx.select({ id: recallCases.id, n: recallCases.recallNumber }).from(recallCases).where(and(eq(recallCases.organizationId, ctx.organizationId), eq(recallCases.idempotencyKey, input.idempotencyKey))).limit(1);
      if (dup) return { recallCaseId: dup.id, recallNumber: dup.n, replayed: true };
    }
    const id = uuidv7();
    const recallNumber = await nextNumber(tx, ctx.organizationId, "RC");
    // The case row first (the scope rows reference it); the scope is captured in the same transaction.
    const asOf = new Date();
    await tx.insert(recallCases).values({
      id,
      organizationId: ctx.organizationId,
      originSiteId: ctx.currentSiteId,
      recallNumber,
      status: "draft",
      recallKind: input.recallKind,
      title,
      description,
      classification,
      regulatoryNotes,
      complaintId: input.complaintId && isUuid(input.complaintId) ? input.complaintId : null,
      subjectCode: query.code ?? query.supplierLot ?? "complaint",
      subjectKind: "lot",
      traceMode: mode,
      scopeAsOf: asOf,
      openedBy: ctx.userId,
      statusChangedBy: ctx.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    const cap = await captureScope(tx, ctx, id, query);
    const start = cap.scope.lots.find((l) => l.role === "start");
    await tx
      .update(recallCases)
      .set({
        subjectCode: cap.scope.subject!.number,
        subjectKind: cap.scope.subject!.kind,
        traceMode: cap.scope.mode,
        hiddenAtOpening: cap.scope.hiddenCount,
        originSiteId: start ? siteIdOf(ctx, start.siteCode) : ctx.currentSiteId,
        complaintId: cap.scope.subject!.kind === "complaint" ? cap.scope.subject!.id : input.complaintId && isUuid(input.complaintId) ? input.complaintId : null,
      })
      .where(eq(recallCases.id, id));
    await tx.insert(recallCaseStateTransitions).values({ organizationId: ctx.organizationId, recallCaseId: id, fromState: null, toState: "draft", actorId: ctx.userId, reason: title });
    await audit(tx, ctx, {
      action: "quality.recall_case.opened",
      entityType: "recall_case",
      entityId: id,
      entityNumber: recallNumber,
      siteId: null,
      reason: description,
      after: { kind: input.recallKind, subject: cap.scope.subject, mode: cap.scope.mode, lots: cap.lots, boxes: cap.boxes, customerLines: cap.lines, customers: cap.customers, hiddenAtOpening: cap.scope.hiddenCount, classification },
    });
    return { recallCaseId: id, recallNumber, lots: cap.lots, boxes: cap.boxes, customers: cap.customers, hiddenCount: cap.scope.hiddenCount, replayed: false };
  });
}

/** Re-runs the trace for a draft case (new shipments or batches since opening) and replaces its stored scope. */
export async function refreshRecallScope(ctx: AuthContext, input: { recallCaseId: string }) {
  ctx.require("quality.recall_case.create");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.status !== "draft") throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}; the scope is frozen once submitted.`);
    const before = await tx.select({ n: sql<number>`count(*)::int` }).from(recallCaseLots).where(eq(recallCaseLots.recallCaseId, c.id));
    await tx.delete(recallCaseCustomers).where(eq(recallCaseCustomers.recallCaseId, c.id));
    await tx.delete(recallCaseContainers).where(eq(recallCaseContainers.recallCaseId, c.id));
    await tx.delete(recallCaseLots).where(eq(recallCaseLots.recallCaseId, c.id));
    const q: RecallQuery = c.subjectKind === "complaint" && c.complaintId ? { complaintId: c.complaintId, mode: c.traceMode as RecallMode } : c.subjectKind === "supplier_lot" ? { supplierLot: c.subjectCode, mode: c.traceMode as RecallMode } : { code: c.subjectCode, mode: c.traceMode as RecallMode };
    const cap = await captureScope(tx, ctx, c.id, q);
    await tx.update(recallCases).set({ scopeAsOf: new Date(), hiddenAtOpening: cap.scope.hiddenCount }).where(eq(recallCases.id, c.id));
    await audit(tx, ctx, { action: "quality.recall_case.scope_refreshed", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, before: { lots: before[0]?.n ?? 0 }, after: { lots: cap.lots, boxes: cap.boxes, customerLines: cap.lines, hiddenCount: cap.scope.hiddenCount } });
    return { lots: cap.lots, boxes: cap.boxes, customers: cap.customers };
  });
}

/** Edits the case text. Title and description while draft; classification and regulatory notes until closed. */
export async function updateRecallCase(ctx: AuthContext, input: { recallCaseId: string; title?: string | null; description?: string | null; classification?: string | null; regulatoryNotes?: string | null }) {
  ctx.require("quality.recall_case.create");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (["closed", "cancelled"].includes(c.status)) throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}.`);
    const set: Partial<typeof recallCases.$inferInsert> = {};
    if ((input.title != null || input.description != null) && c.status !== "draft") throw new DomainError("state", "Title and description can change only while the case is a draft.");
    if (input.title != null) set.title = requiredText(input.title, "title", "A title", 200);
    if (input.description != null) set.description = reasonText(input.description, "description", 4000);
    if (input.classification !== undefined) set.classification = optionalText(input.classification, "classification", 300);
    if (input.regulatoryNotes !== undefined) set.regulatoryNotes = optionalText(input.regulatoryNotes, "regulatoryNotes", 4000);
    if (Object.keys(set).length === 0) throw new DomainError("validation", "Nothing changed.");
    await tx.update(recallCases).set(set).where(eq(recallCases.id, c.id));
    await audit(tx, ctx, { action: "quality.recall_case.updated", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, before: Object.fromEntries(Object.keys(set).map((k) => [k, (c as Record<string, unknown>)[k]])), after: set });
    return { recallCaseId: c.id };
  });
}

/** QA proposes the case (draft → submitted); the approvers of the first step are notified. */
export async function submitRecallCase(ctx: AuthContext, input: { recallCaseId: string }) {
  ctx.require("quality.recall_case.create");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.status !== "draft") throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}; only a draft can be submitted.`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(recallCaseLots).where(eq(recallCaseLots.recallCaseId, c.id));
    if (!n) throw new DomainError("state", "The case has no lots in scope. Refresh the scope first.");
    await move(tx, ctx, c, "submitted", null, { submittedBy: ctx.userId, submittedAt: new Date() });
    await audit(tx, ctx, { action: "quality.recall_case.submitted", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, before: { status: "draft" }, after: { status: "submitted", lots: n } });
    const p = await qualityApprovalProgress(tx, ctx.organizationId, { recordType: DOCUMENT_TYPE, recordId: c.id, siteId: null });
    await notifyRoles(tx, { roleCodes: p.next?.roleCodes.length ? p.next.roleCodes : ["qa_qc"], siteId: c.originSiteId }, {
      organizationId: ctx.organizationId,
      siteId: c.originSiteId,
      kind: "quality.recall_case.submitted",
      severity: "critical",
      title: `${RECALL_KIND_LABEL[c.recallKind as RecallKind]} ${c.recallNumber} waits for approval`,
      body: c.title,
      entityType: "recall_case",
      entityId: c.id,
      link: `/quality/recalls/${c.id}`,
      dedupeKey: `rc-submitted:${c.id}:${p.cycle}:${p.next?.step ?? 1}`,
    });
    return { status: "submitted" as const };
  });
}

/**
 * One approval decision (quality.recall_case.approve, R: re-authentication). Default steps: qa_qc, then
 * owner_director (`quality.recall_two_approvals`). The opener and the submitter never decide. Rejection or
 * return sends the case back to draft (a new approval cycle starts at the next submission).
 */
export async function decideRecallCase(ctx: AuthContext, input: { recallCaseId: string; decision: "approved" | "rejected" | "returned"; note?: string | null; password?: string | null }) {
  ctx.require("quality.recall_case.approve");
  if (!["approved", "rejected", "returned"].includes(input.decision)) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  await requireReauthentication(ctx, input.password, "quality.recall_case.approve");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.status !== "submitted") throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}; only a submitted case can be decided.`);
    const d = await recordQualityDecision(tx, ctx, { recordType: DOCUMENT_TYPE, recordId: c.id, recordNumber: c.recallNumber, siteId: null, pendingSince: c.submittedAt, excludedUserIds: [c.openedBy, c.submittedBy], decision: input.decision, note: input.note });
    const base = { entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null } as const;
    if (input.decision !== "approved") {
      await move(tx, ctx, c, "draft", input.note ?? null, { submittedBy: null, submittedAt: null });
      await audit(tx, ctx, { ...base, action: input.decision === "rejected" ? "quality.recall_case.rejected" : "quality.recall_case.returned", reason: input.note, before: { status: "submitted" }, after: { status: "draft", step: d.step?.step } });
      return { status: "draft" as const };
    }
    if (!d.final) {
      await audit(tx, ctx, { ...base, action: "quality.recall_case.reviewed", reason: input.note, after: { step: d.step?.step, stepLabel: d.step?.label } });
      const p = await qualityApprovalProgress(tx, ctx.organizationId, { recordType: DOCUMENT_TYPE, recordId: c.id, siteId: null });
      if (p.next) {
        await notifyRoles(tx, { roleCodes: p.next.roleCodes.length ? p.next.roleCodes : ["owner_director"], siteId: c.originSiteId }, {
          organizationId: ctx.organizationId,
          siteId: c.originSiteId,
          kind: "quality.recall_case.submitted",
          severity: "critical",
          title: `${RECALL_KIND_LABEL[c.recallKind as RecallKind]} ${c.recallNumber}: ${p.next.label} needed`,
          body: c.title,
          entityType: "recall_case",
          entityId: c.id,
          link: `/quality/recalls/${c.id}`,
          dedupeKey: `rc-submitted:${c.id}:${p.cycle}:${p.next.step}`,
        });
      }
      return { status: "submitted" as const, step: d.step?.step };
    }
    await move(tx, ctx, c, "approved", input.note ?? null, { approvedAt: new Date() });
    await audit(tx, ctx, { ...base, action: "quality.recall_case.approved", reason: input.note, before: { status: "submitted" }, after: { status: "approved", step: d.step?.step } });
    await notifyRoles(tx, { roleCodes: ["qa_qc"], siteId: c.originSiteId }, {
      organizationId: ctx.organizationId,
      siteId: c.originSiteId,
      kind: "quality.recall_case.approved",
      severity: "critical",
      title: `${RECALL_KIND_LABEL[c.recallKind as RecallKind]} ${c.recallNumber} approved`,
      body: c.recallKind === "mock" ? "Start the drill: notify customers on the list (mock recall, no stock is marked)." : "Mark the affected lots recalled, then notify the customers on the list.",
      entityType: "recall_case",
      entityId: c.id,
      link: `/quality/recalls/${c.id}`,
      dedupeKey: `rc-approved:${c.id}`,
    });
    return { status: "approved" as const };
  });
}

/* ------------------------------------------------------------------ mark recalled / drill */

export type MarkOutcome = { lotId: string; lotNumber: string; outcome: "recalled" | "already_recalled" | "not_marked" | "failed" | "other_site"; message?: string; labelNote?: string | null };

/**
 * "Mark recalled" (quality.recall_case.admin, R): every pending lot of the case at the caller's sites gets
 * a `recall` disposition through decideLot (same lot lock, state machine, audit and label reprint as any QA
 * decision), each in its own transaction, sharing one correlation id. Lots at other sites stay pending for
 * a QA user there (the case stays in notifying, and closure waits for them). Repeatable: already-marked lots
 * are skipped.
 */
export async function markRecallCaseLots(ctx: AuthContext, input: { recallCaseId: string; password?: string | null }) {
  ctx.require("quality.recall_case.admin");
  ctx.require("quality.disposition.approve");
  await requireReauthentication(ctx, input.password, "quality.recall_case.admin");
  const c = await db.transaction(async (tx) => {
    const row = await lockCase(tx, ctx, input.recallCaseId);
    if (row.recallKind === "mock") throw new DomainError("state", "A mock recall never marks stock. Start the drill instead.");
    if (!["approved", "notifying"].includes(row.status)) throw new DomainError("state", `Recall case ${row.recallNumber} is ${row.status}; lots are marked after both approvals.`);
    return row;
  });
  const correlationId = uuidv7();
  const bulk = new AuthContext(ctx.userId, ctx.organizationId, ctx.displayName, ctx.email, ctx.roleCodes, ctx.permissions, ctx.allowedSites, ctx.currentSiteId, { ...ctx.options, correlationId });
  const lines = await db
    .select({ id: recallCaseLots.id, lotId: recallCaseLots.lotId, siteId: recallCaseLots.siteId, outcome: recallCaseLots.outcome, lotNumber: inventoryLots.lotNumber, status: inventoryLots.qualityStatus })
    .from(recallCaseLots)
    .innerJoin(inventoryLots, eq(inventoryLots.id, recallCaseLots.lotId))
    .where(and(eq(recallCaseLots.recallCaseId, c.id), eq(recallCaseLots.outcome, "pending")))
    .orderBy(asc(inventoryLots.lotNumber));
  const outcomes: MarkOutcome[] = [];
  const reason = `Recall case ${c.recallNumber}: ${c.title}`.slice(0, 1000);
  for (const l of lines) {
    if (!ctx.allowedSiteIds.includes(l.siteId) || !ctx.canAt("quality.recall_case.admin", l.siteId)) {
      outcomes.push({ lotId: l.lotId, lotNumber: l.lotNumber, outcome: "other_site", message: "At a site outside your access; a QA user there must mark it." });
      continue;
    }
    if (l.status === "recalled" || l.status === "rejected") {
      const outcome = l.status === "recalled" ? "already_recalled" : "not_marked";
      await db
        .update(recallCaseLots)
        .set({ outcome, markedBy: ctx.userId, markedAt: new Date(), note: l.status === "rejected" ? "Already rejected; stays rejected (blocked)." : "Already recalled by another case or decision." })
        .where(eq(recallCaseLots.id, l.id));
      outcomes.push({ lotId: l.lotId, lotNumber: l.lotNumber, outcome });
      continue;
    }
    try {
      const r = await decideLot(bulk, { lotId: l.lotId, decision: "recall", reason, recallCaseId: c.id }, { statusLabel: true });
      await db.update(recallCaseLots).set({ outcome: "recalled", dispositionId: r.dispositionId, markedBy: ctx.userId, markedAt: new Date() }).where(eq(recallCaseLots.id, l.id));
      outcomes.push({ lotId: l.lotId, lotNumber: l.lotNumber, outcome: "recalled", labelNote: r.labelNote });
    } catch (e) {
      if (e instanceof DomainError) outcomes.push({ lotId: l.lotId, lotNumber: l.lotNumber, outcome: "failed", message: e.message });
      else throw e;
    }
  }
  const done = outcomes.filter((o) => o.outcome === "recalled").length;
  await db.transaction(async (tx) => {
    const row = await lockCase(tx, bulk, c.id);
    if (row.status === "approved") await move(tx, bulk, row, "notifying", `Lots marked recalled: ${done}`, { markedBy: ctx.userId, markedAt: new Date() });
    await audit(tx, bulk, {
      action: "quality.recall_case.lots_marked",
      entityType: "recall_case",
      entityId: c.id,
      entityNumber: c.recallNumber,
      siteId: null,
      reason,
      after: { recalled: done, skipped: outcomes.filter((o) => o.outcome === "already_recalled" || o.outcome === "not_marked").length, otherSite: outcomes.filter((o) => o.outcome === "other_site").map((o) => o.lotNumber), failed: outcomes.filter((o) => o.outcome === "failed").map((o) => ({ lot: o.lotNumber, message: o.message })) },
    });
    await notifyRoles(tx, { roleCodes: ["sales_cs"], siteId: row.originSiteId }, {
      organizationId: ctx.organizationId,
      siteId: row.originSiteId,
      kind: "quality.recall_case.notify_customers",
      severity: "critical",
      title: `${RECALL_KIND_LABEL[row.recallKind as RecallKind]} ${row.recallNumber}: notify the customers on the list`,
      body: row.title,
      entityType: "recall_case",
      entityId: row.id,
      link: `/quality/recalls/${row.id}`,
      dedupeKey: `rc-notify:${row.id}`,
    });
  });
  return { correlationId, total: outcomes.length, recalled: done, outcomes };
}

/** A mock recall (drill): approved → notifying without marking any stock (quality.recall_case.admin). */
export async function startRecallDrill(ctx: AuthContext, input: { recallCaseId: string }) {
  ctx.require("quality.recall_case.admin");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.recallKind !== "mock") throw new DomainError("state", "Only a mock recall is run as a drill; mark the lots recalled instead.");
    await move(tx, ctx, c, "notifying", "Drill started: no stock marked", { markedBy: ctx.userId, markedAt: new Date() });
    await tx.update(recallCaseLots).set({ outcome: "not_marked", note: "Mock recall: stock is not marked." }).where(and(eq(recallCaseLots.recallCaseId, c.id), eq(recallCaseLots.outcome, "pending")));
    await audit(tx, ctx, { action: "quality.recall_case.drill_started", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, before: { status: "approved" }, after: { status: "notifying" } });
    return { status: "notifying" as const };
  });
}

/* ------------------------------------------------------------------ notifications, recovery, reconciliation */

const NOTIFY_METHODS = ["phone", "email", "letter", "visit", "other"] as const;

/**
 * sales_cs (or QA) records that a customer was notified, or acknowledged the notice (quality.recall_case.edit).
 * Applies to every line of that customer in the case at the caller's sites.
 */
export async function recordRecallNotification(ctx: AuthContext, input: { recallCaseId: string; customerId: string; event: "notified" | "acknowledged"; method?: string | null; note?: string | null }) {
  ctx.require("quality.recall_case.edit");
  assertUuid(input.customerId, "Customer");
  const note = optionalText(input.note, "note", 1000);
  if (input.event === "notified" && !(NOTIFY_METHODS as readonly string[]).includes(input.method ?? "")) throw new DomainError("validation", "Choose how the customer was notified.", { field: "method" });
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (!["notifying", "recovering"].includes(c.status)) throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}; customers are notified after approval${c.recallKind === "mock" ? " and the drill start" : " and marking"}.`);
    const lines = await tx.select().from(recallCaseCustomers).where(and(eq(recallCaseCustomers.recallCaseId, c.id), eq(recallCaseCustomers.customerId, input.customerId), inArray(recallCaseCustomers.siteId, ctx.allowedSiteIds))).for("update");
    if (!lines.length) throw new DomainError("not_found", "This customer is not on the case's list at your sites.");
    const now = new Date();
    if (input.event === "notified") {
      const todo = lines.filter((l) => !l.notifiedAt);
      if (!todo.length) throw new DomainError("state", "This customer was already recorded as notified.");
      await tx.update(recallCaseCustomers).set({ notifiedAt: now, notifiedBy: ctx.userId, notificationMethod: input.method!, note }).where(inArray(recallCaseCustomers.id, todo.map((l) => l.id)));
    } else {
      const todo = lines.filter((l) => l.notifiedAt && !l.acknowledgedAt);
      if (!todo.length) throw new DomainError("state", lines.some((l) => !l.notifiedAt) ? "Record the notification first." : "The acknowledgement is already recorded.");
      await tx.update(recallCaseCustomers).set({ acknowledgedAt: now, note: note ?? undefined }).where(inArray(recallCaseCustomers.id, todo.map((l) => l.id)));
    }
    await audit(tx, ctx, { action: input.event === "notified" ? "quality.recall_case.customer_notified" : "quality.recall_case.customer_acknowledged", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: lines[0].siteId, reason: note, after: { customerId: input.customerId, lines: lines.length, method: input.method ?? null } });
    return { lines: lines.length };
  });
}

/** notifying → recovering once every customer line visible to the case is notified (QA). */
export async function startRecallRecovery(ctx: AuthContext, input: { recallCaseId: string }) {
  ctx.require("quality.recall_case.create");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    const pending = await tx.select({ n: sql<number>`count(distinct ${recallCaseCustomers.customerId})::int` }).from(recallCaseCustomers).where(and(eq(recallCaseCustomers.recallCaseId, c.id), isNull(recallCaseCustomers.notifiedAt)));
    if (Number(pending[0]?.n ?? 0) > 0) throw new DomainError("state", `${pending[0].n} customer(s) on the list are not notified yet.`);
    await move(tx, ctx, c, "recovering", null, { recoveryStartedAt: new Date() });
    await audit(tx, ctx, { action: "quality.recall_case.recovery_started", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, before: { status: "notifying" }, after: { status: "recovering" } });
    return { status: "recovering" as const };
  });
}

/**
 * Quantity accounted for without a return (destroyed at the customer, consumed, confirmed never sold),
 * with a note (quality.recall_case.edit). accounted ≤ shipped − returned (returns from posted customer returns).
 */
export async function recordRecallAccounted(ctx: AuthContext, input: { lineId: string; qty: string; note: string }) {
  ctx.require("quality.recall_case.edit");
  assertUuid(input.lineId, "Customer line");
  const note = reasonText(input.note, "note", 1000);
  let qty: Decimal;
  try {
    qty = new Decimal(String(input.qty ?? "").trim());
  } catch {
    throw new DomainError("validation", "Enter a quantity.", { field: "qty" });
  }
  if (!qty.isFinite() || qty.lt(0)) throw new DomainError("validation", "Enter a quantity of zero or more.", { field: "qty" });
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(recallCaseCustomers).where(and(eq(recallCaseCustomers.id, input.lineId), eq(recallCaseCustomers.organizationId, ctx.organizationId))).limit(1);
    if (!line || !ctx.allowedSiteIds.includes(line.siteId)) throw new DomainError("not_found", "Customer line not found in your sites.");
    const c = await lockCase(tx, ctx, line.recallCaseId);
    if (!["notifying", "recovering"].includes(c.status)) throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}.`);
    const returned = (await returnedQtyByLot(tx, [line.shipmentId], { postedOnly: true })).get(`${line.shipmentId}:${line.lotId}`) ?? new Decimal(0);
    const room = new Decimal(line.qtyShippedBase).minus(returned);
    if (qty.gt(room)) throw new DomainError("validation", `At most ${room.toString()} ${line.uomBase} can be accounted (shipped ${line.qtyShippedBase}, returned ${returned.toString()}).`, { field: "qty" });
    await tx.update(recallCaseCustomers).set({ qtyAccountedBase: qty.toString(), qtyReturnedBase: returned.toString(), accountedNote: qty.isZero() ? null : note }).where(eq(recallCaseCustomers.id, line.id));
    await audit(tx, ctx, { action: "quality.recall_case.accounted", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: line.siteId, reason: note, before: { lineId: line.id, accounted: line.qtyAccountedBase }, after: { lineId: line.id, accounted: qty.toString(), returned: returned.toString() } });
    return { accounted: qty.toString() };
  });
}

/** Lines with live returned quantities and the outstanding remainder (shipped − returned − accounted). */
async function reconciliation(q: DbOrTx, caseId: string, siteIds?: string[]) {
  const lines = await q
    .select({ l: recallCaseCustomers, customerName: customers.name, customerCode: customers.code, lotNumber: inventoryLots.lotNumber, siteCode: sites.code })
    .from(recallCaseCustomers)
    .innerJoin(customers, eq(customers.id, recallCaseCustomers.customerId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, recallCaseCustomers.lotId))
    .innerJoin(sites, eq(sites.id, recallCaseCustomers.siteId))
    .where(and(eq(recallCaseCustomers.recallCaseId, caseId), siteIds ? inArray(recallCaseCustomers.siteId, siteIds) : undefined))
    .orderBy(asc(customers.name), asc(recallCaseCustomers.drNumber), asc(inventoryLots.lotNumber));
  const returned = await returnedQtyByLot(q, [...new Set(lines.map((x) => x.l.shipmentId))], { postedOnly: true });
  return lines.map(({ l, ...rest }) => {
    const ret = returned.get(`${l.shipmentId}:${l.lotId}`) ?? new Decimal(0);
    const outstanding = new Decimal(l.qtyShippedBase).minus(ret).minus(l.qtyAccountedBase);
    return { ...l, ...rest, qtyReturnedLive: ret.toString(), outstanding: outstanding.toString(), reconciled: outstanding.isZero() };
  });
}

/**
 * Closes the case (quality.recall_case.approve, R: re-authentication) with the closure report (W07-10):
 * every lot of a real recall marked (or explained), returned quantities stored from posted returns, and an
 * explanation when shipped − returned − accounted is not zero on any line.
 */
export async function closeRecallCase(ctx: AuthContext, input: { recallCaseId: string; closureReport: string; reconciliationExplanation?: string | null; password?: string | null }) {
  ctx.require("quality.recall_case.approve");
  const report = reasonText(input.closureReport, "closureReport", 6000);
  const explanation = optionalText(input.reconciliationExplanation, "reconciliationExplanation", 4000);
  await requireReauthentication(ctx, input.password, "quality.recall_case.close");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.status !== "recovering") throw new DomainError("state", `Recall case ${c.recallNumber} is ${c.status}; start recovery before closing.`);
    const pendingLots = await tx.select({ n: inventoryLots.lotNumber }).from(recallCaseLots).innerJoin(inventoryLots, eq(inventoryLots.id, recallCaseLots.lotId)).where(and(eq(recallCaseLots.recallCaseId, c.id), eq(recallCaseLots.outcome, "pending")));
    if (pendingLots.length) throw new DomainError("state", `Lot(s) ${pendingLots.map((p) => p.n).join(", ")} are not marked yet (some may be at another site).`);
    const lines = await reconciliation(tx, c.id);
    const gaps = lines.filter((l) => !l.reconciled);
    if (gaps.length && (!explanation || explanation.length < 5)) {
      throw new DomainError("validation", `${gaps.length} line(s) are not reconciled (shipped − returned − accounted ≠ 0). Explain the gap to close the case.`, { field: "reconciliationExplanation" });
    }
    for (const l of lines) await tx.update(recallCaseCustomers).set({ qtyReturnedBase: l.qtyReturnedLive }).where(eq(recallCaseCustomers.id, l.id));
    const totals = summarize(lines);
    await move(tx, ctx, c, "closed", report.slice(0, 500), { closedBy: ctx.userId, closedAt: new Date(), closureReport: report, reconciliationExplanation: gaps.length ? explanation : null });
    await audit(tx, ctx, { action: "quality.recall_case.closed", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, reason: report, before: { status: "recovering" }, after: { status: "closed", lines: lines.length, unreconciledLines: gaps.length, totals } });
    return { status: "closed" as const, unreconciled: gaps.length };
  });
}

function summarize(lines: { uomBase: string; qtyShippedBase: string; qtyReturnedLive: string; qtyAccountedBase: string; outstanding: string }[]) {
  const by = new Map<string, { shipped: Decimal; returned: Decimal; accounted: Decimal; outstanding: Decimal }>();
  for (const l of lines) {
    const t = by.get(l.uomBase) ?? { shipped: new Decimal(0), returned: new Decimal(0), accounted: new Decimal(0), outstanding: new Decimal(0) };
    t.shipped = t.shipped.plus(l.qtyShippedBase);
    t.returned = t.returned.plus(l.qtyReturnedLive);
    t.accounted = t.accounted.plus(l.qtyAccountedBase);
    t.outstanding = t.outstanding.plus(l.outstanding);
    by.set(l.uomBase, t);
  }
  return [...by.entries()].map(([uom, t]) => ({ uom, shipped: t.shipped.toString(), returned: t.returned.toString(), accounted: t.accounted.toString(), outstanding: t.outstanding.toString(), pct: t.shipped.isZero() ? "100" : t.shipped.minus(t.outstanding).div(t.shipped).times(100).toDecimalPlaces(1).toString() }));
}

/** Cancels a case before any stock is marked (opener or an approver), with a reason. */
export async function cancelRecallCase(ctx: AuthContext, input: { recallCaseId: string; reason: string }) {
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, input.recallCaseId);
    if (c.openedBy === ctx.userId) ctx.require("quality.recall_case.create");
    else ctx.require("quality.recall_case.approve");
    const from = await move(tx, ctx, c, "cancelled", reason, { cancelReason: reason });
    await audit(tx, ctx, { action: "quality.recall_case.cancelled", entityType: "recall_case", entityId: c.id, entityNumber: c.recallNumber, siteId: null, reason, before: { status: from }, after: { status: "cancelled" } });
    return { status: "cancelled" as const };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listRecallCases(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("quality.recall_case.view");
  const conds = [
    eq(recallCases.organizationId, ctx.organizationId),
    or(isNull(recallCases.originSiteId), inArray(recallCases.originSiteId, ctx.allowedSiteIds), exists(db.select({ x: sql`1` }).from(recallCaseLots).where(and(eq(recallCaseLots.recallCaseId, recallCases.id), inArray(recallCaseLots.siteId, ctx.allowedSiteIds)))))!,
  ];
  if (!f.status || f.status === "active") conds.push(notInArray(recallCases.status, ["closed", "cancelled"]));
  else if (f.status !== "all" && (Object.keys(RECALL_CASE_STATUS_LABEL) as string[]).includes(f.status)) conds.push(eq(recallCases.status, f.status));
  const rows = await db
    .select({
      id: recallCases.id,
      number: recallCases.recallNumber,
      status: recallCases.status,
      kind: recallCases.recallKind,
      title: recallCases.title,
      subjectCode: recallCases.subjectCode,
      openedAt: recallCases.openedAt,
      openedByName: users.displayName,
      lots: sql<number>`(select count(*)::int from ${recallCaseLots} l where l.recall_case_id = ${recallCases.id})`,
      customers: sql<number>`(select count(distinct customer_id)::int from ${recallCaseCustomers} x where x.recall_case_id = ${recallCases.id})`,
      notified: sql<number>`(select count(distinct customer_id)::int from ${recallCaseCustomers} x where x.recall_case_id = ${recallCases.id} and x.notified_at is not null)`,
    })
    .from(recallCases)
    .innerJoin(users, eq(users.id, recallCases.openedBy))
    .where(and(...conds))
    .orderBy(desc(recallCases.openedAt))
    .limit(200);
  return rows.map((r) => ({ ...r, kindLabel: RECALL_KIND_LABEL[r.kind as RecallKind] ?? r.kind, statusLabel: RECALL_CASE_STATUS_LABEL[r.status as RecallCaseStatus] ?? r.status }));
}

export async function getRecallCase(ctx: AuthContext, id: string) {
  ctx.require("quality.recall_case.view");
  assertUuid(id, "Recall case");
  const [c] = await db.select().from(recallCases).where(and(eq(recallCases.id, id), eq(recallCases.organizationId, ctx.organizationId))).limit(1);
  if (!c || !(await visibleTo(db, ctx, c))) throw new DomainError("not_found", "Recall case not found in your sites.");
  const lots = await db
    .select({ l: recallCaseLots, lotNumber: inventoryLots.lotNumber, status: inventoryLots.qualityStatus, itemKind: inventoryLots.itemKind, siteCode: sites.code, expiresOn: inventoryLots.expiresOn })
    .from(recallCaseLots)
    .innerJoin(inventoryLots, eq(inventoryLots.id, recallCaseLots.lotId))
    .innerJoin(sites, eq(sites.id, recallCaseLots.siteId))
    .where(eq(recallCaseLots.recallCaseId, c.id))
    .orderBy(asc(recallCaseLots.traceRole), asc(inventoryLots.lotNumber));
  const boxes = await db
    .select({ id: recallCaseContainers.id, containerId: recallCaseContainers.containerId, number: containers.containerNumber, status: containers.status, statusAtOpening: recallCaseContainers.statusAtOpening, siteId: recallCaseContainers.siteId, drNumber: shipments.deliveryReceiptNumber })
    .from(recallCaseContainers)
    .innerJoin(containers, eq(containers.id, recallCaseContainers.containerId))
    .leftJoin(shipments, eq(shipments.id, recallCaseContainers.shipmentId))
    .where(eq(recallCaseContainers.recallCaseId, c.id))
    .orderBy(asc(containers.containerNumber));
  const lines = await reconciliation(db, c.id, ctx.allowedSiteIds);
  const allLines = await db.select({ n: sql<number>`count(*)::int` }).from(recallCaseCustomers).where(eq(recallCaseCustomers.recallCaseId, c.id));
  const ids = [...new Set([c.openedBy, c.submittedBy, c.markedBy, c.closedBy, ...lines.map((l) => l.notifiedBy)].filter((x): x is string => !!x))];
  const names = new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n]));
  const nm = (x: string | null) => (x ? (names.get(x) ?? "Unknown user") : null);
  const timeline = await db
    .select({ from: recallCaseStateTransitions.fromState, to: recallCaseStateTransitions.toState, reason: recallCaseStateTransitions.reason, at: recallCaseStateTransitions.occurredAt, by: users.displayName })
    .from(recallCaseStateTransitions)
    .innerJoin(users, eq(users.id, recallCaseStateTransitions.actorId))
    .where(eq(recallCaseStateTransitions.recallCaseId, c.id))
    .orderBy(asc(recallCaseStateTransitions.occurredAt));
  const approval = await qualityApprovalProgress(db, ctx.organizationId, { recordType: DOCUMENT_TYPE, recordId: c.id, siteId: null });
  const complaint = c.complaintId && ctx.can("quality.complaint.view") ? ((await db.select({ id: complaints.id, number: complaints.complaintNumber }).from(complaints).where(eq(complaints.id, c.complaintId)).limit(1))[0] ?? null) : null;
  // Customers (one entry per customer, lines inside) for the notification list.
  const byCustomer = new Map<string, { customerId: string; name: string; code: string; notifiedAt: Date | null; notifiedBy: string | null; method: string | null; acknowledgedAt: Date | null; lines: typeof lines }>();
  for (const l of lines) {
    const e = byCustomer.get(l.customerId) ?? { customerId: l.customerId, name: l.customerName, code: l.customerCode, notifiedAt: l.notifiedAt, notifiedBy: nm(l.notifiedBy), method: l.notificationMethod, acknowledgedAt: l.acknowledgedAt, lines: [] };
    if (!l.notifiedAt) e.notifiedAt = null;
    if (!l.acknowledgedAt) e.acknowledgedAt = null;
    e.lines.push(l);
    byCustomer.set(l.customerId, e);
  }
  const pendingLots = lots.filter((x) => x.l.outcome === "pending");
  const markableHere = pendingLots.filter((x) => ctx.canAt("quality.recall_case.admin", x.l.siteId));
  const live = !["closed", "cancelled"].includes(c.status);
  return {
    recall: { ...c, openedByName: nm(c.openedBy), submittedByName: nm(c.submittedBy), markedByName: nm(c.markedBy), closedByName: nm(c.closedBy), kindLabel: RECALL_KIND_LABEL[c.recallKind as RecallKind] ?? c.recallKind, statusLabel: RECALL_CASE_STATUS_LABEL[c.status as RecallCaseStatus] ?? c.status },
    complaint,
    lots: lots.map((x) => ({ ...x.l, lotNumber: x.lotNumber, status: x.status, itemKind: x.itemKind, siteCode: x.siteCode, expiresOn: x.expiresOn, visible: ctx.allowedSiteIds.includes(x.l.siteId) })).filter((x) => x.visible),
    hiddenLots: lots.filter((x) => !ctx.allowedSiteIds.includes(x.l.siteId)).length,
    boxes: boxes.filter((b) => ctx.allowedSiteIds.includes(b.siteId)),
    customers: [...byCustomer.values()],
    hiddenLines: Number(allLines[0]?.n ?? 0) - lines.length,
    totals: summarize(lines),
    timeline,
    approval,
    noticeText: await getSetting(db, ctx.organizationId, "quality.recall_case.notice_text"),
    can: {
      edit: live && ctx.can("quality.recall_case.create"),
      refresh: c.status === "draft" && ctx.can("quality.recall_case.create"),
      submit: c.status === "draft" && ctx.can("quality.recall_case.create"),
      decide: c.status === "submitted" && canDecideQualityStep(ctx, DOCUMENT_TYPE, approval, c.submittedAt, [c.openedBy, c.submittedBy]),
      mark: c.recallKind !== "mock" && ["approved", "notifying"].includes(c.status) && ctx.can("quality.recall_case.admin") && ctx.can("quality.disposition.approve") && markableHere.length > 0,
      drill: c.recallKind === "mock" && c.status === "approved" && ctx.can("quality.recall_case.admin"),
      notify: ["notifying", "recovering"].includes(c.status) && ctx.can("quality.recall_case.edit"),
      account: ["notifying", "recovering"].includes(c.status) && ctx.can("quality.recall_case.edit"),
      startRecovery: c.status === "notifying" && ctx.can("quality.recall_case.create") && [...byCustomer.values()].every((x) => x.notifiedAt),
      close: c.status === "recovering" && ctx.can("quality.recall_case.approve") && pendingLots.length === 0,
      cancel: ["draft", "submitted", "approved"].includes(c.status) && (c.openedBy === ctx.userId ? ctx.can("quality.recall_case.create") : ctx.can("quality.recall_case.approve")),
      export: ctx.can("quality.recall_case.export"),
    },
    pendingLotCount: pendingLots.length,
    notifyMethods: NOTIFY_METHODS,
  };
}

/** Open cases for the action centre (`open_recall_case`) and submitted ones (`approval.recall_case`). */
export async function recallCaseCandidates(organizationId: string) {
  const rows = await db.select().from(recallCases).where(and(eq(recallCases.organizationId, organizationId), notInArray(recallCases.status, ["closed", "cancelled"])));
  return rows.map((r) => ({
    kind: r.status === "submitted" ? "approval.recall_case" : "open_recall_case",
    siteId: r.originSiteId,
    entityType: "recall_case",
    entityId: r.id,
    recordNumber: r.recallNumber,
    title: r.status === "submitted" ? `${RECALL_KIND_LABEL[r.recallKind as RecallKind]} ${r.recallNumber} waits for approval` : `${RECALL_KIND_LABEL[r.recallKind as RecallKind]} ${r.recallNumber} is ${RECALL_CASE_STATUS_LABEL[r.status as RecallCaseStatus].toLowerCase()}`,
    detail: r.title,
    link: `/quality/recalls/${r.id}`,
    openedAt: r.status === "submitted" ? (r.submittedAt ?? r.statusChangedAt) : r.openedAt,
  }));
}

type NoticeRow = Awaited<ReturnType<typeof reconciliation>>[number] & { recallNumber: string; kind: string };

/** Customer notification list (CSV/XLSX; quality.recall_case.export, S; audited by runExport). */
export const recallNotificationExport: ExportDefinition<{ recallCaseId: string }, NoticeRow> = {
  code: "quality.recall_case.notification_list",
  title: "Recall customer notification list",
  permission: "quality.recall_case.export",
  sensitivity: "S",
  columns: [
    { header: "Case", value: (r) => r.recallNumber },
    { header: "Kind", value: (r) => r.kind },
    { header: "Customer code", value: (r) => r.customerCode },
    { header: "Customer", value: (r) => r.customerName },
    { header: "DR", value: (r) => r.drNumber },
    { header: "Lot", value: (r) => r.lotNumber },
    { header: "Site", value: (r) => r.siteCode },
    { header: "Shipped", value: (r) => r.qtyShippedBase, numeric: true },
    { header: "Returned", value: (r) => r.qtyReturnedLive, numeric: true },
    { header: "Accounted", value: (r) => r.qtyAccountedBase, numeric: true },
    { header: "Outstanding", value: (r) => r.outstanding, numeric: true },
    { header: "Unit", value: (r) => r.uomBase },
    { header: "Notified at", value: (r) => r.notifiedAt?.toISOString() ?? "" },
    { header: "Method", value: (r) => r.notificationMethod },
    { header: "Acknowledged at", value: (r) => r.acknowledgedAt?.toISOString() ?? "" },
  ],
  fetch: async (ctx, f, limit) => {
    const v = await getRecallCase(ctx, f.recallCaseId);
    const lines = await reconciliation(db, v.recall.id, ctx.allowedSiteIds);
    return lines.slice(0, limit).map((l) => ({ ...l, recallNumber: v.recall.recallNumber, kind: v.recall.recallKind }));
  },
  siteScope: (ctx) => ctx.allowedSiteIds,
  fileName: () => "recall-notification-list",
};

/** Recall cases naming a lot (lot page, scan card hints). */
export async function recallCasesForLot(q: DbOrTx, lotId: string) {
  return q
    .select({ id: recallCases.id, number: recallCases.recallNumber, status: recallCases.status, kind: recallCases.recallKind, outcome: recallCaseLots.outcome })
    .from(recallCaseLots)
    .innerJoin(recallCases, eq(recallCases.id, recallCaseLots.recallCaseId))
    .where(eq(recallCaseLots.lotId, lotId))
    .orderBy(desc(recallCases.openedAt));
}

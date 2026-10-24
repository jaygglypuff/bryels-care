import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  COMPLAINT_CHANNELS,
  complaintLinks,
  complaintStateTransitions,
  complaints,
  containers,
  customerReturns,
  customers,
  deviations,
  inventoryLots,
  organizations,
  products,
  salesOrders,
  shipments,
  sites,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { notifyRoles } from "@/modules/platform";
import { lotsOfBox, shipmentsOfBox, shipmentsOfCustomer } from "@/modules/sales";
import { openDeviation } from "./deviations";
import {
  COMPLAINT_CHANNEL_LABEL,
  COMPLAINT_STATUS_LABEL,
  TRACE_MATCH_LABEL,
  canMoveComplaint,
  parseTraceCode,
  toCustomerFacing,
  type ComplaintChannel,
  type ComplaintStatus,
  type ComplaintTraceMatch,
} from "./complaints-rules";
import { assertUuid, isUuid, optionalText, reasonText, requiredText, withIdempotency } from "./shared";

/**
 * Customer complaints (US-4-15, process map W07-06, ux-system §9.14). Logged by sales_cs or qa_qc
 * from the label's lot or box; the code is validated against the shipments recorded for that customer
 * (setting quality.complaint.require_shipment_match). State machine open → investigating → resolved →
 * closed (resolved → investigating to reopen); closing needs quality.complaint.approve (qa_qc) and a
 * severity classified by QA. Categories, severities and the recall-review severities are the company's
 * QA configuration (A-W3F-01..03): the system never decides that a recall is needed, it only prompts.
 */

type ComplaintRow = typeof complaints.$inferSelect;
const receiver = alias(users, "complaint_receiver");
const closer = alias(users, "complaint_closer");
const classifier = alias(users, "complaint_classifier");
const resolver = alias(users, "complaint_resolver");

async function categories(q: DbOrTx, organizationId: string) {
  return getSetting(q, organizationId, "quality.complaint.categories");
}

async function categoryLabel(q: DbOrTx, organizationId: string, code: string) {
  return (await categories(q, organizationId)).find((c) => c.code === code)?.label ?? code;
}

async function writeTransition(tx: Tx, ctx: AuthContext, c: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(complaintStateTransitions).values({ organizationId: ctx.organizationId, siteId: c.siteId, complaintId: c.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

async function lockComplaint(tx: Tx, ctx: AuthContext, complaintId: string) {
  assertUuid(complaintId, "Complaint");
  const [c] = await tx.select().from(complaints).where(and(eq(complaints.id, complaintId), eq(complaints.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!c || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("not_found", "Complaint not found in your sites.");
  ctx.requireSite(c.siteId);
  return c;
}

async function move(tx: Tx, ctx: AuthContext, c: ComplaintRow, to: ComplaintStatus, reason: string | null, set: Partial<typeof complaints.$inferInsert> = {}) {
  if (!canMoveComplaint(c.status, to)) {
    throw new DomainError("state", `Complaint ${c.complaintNumber} is ${COMPLAINT_STATUS_LABEL[c.status as ComplaintStatus]?.toLowerCase() ?? c.status}; it cannot become ${COMPLAINT_STATUS_LABEL[to].toLowerCase()}.`, { machine: "complaint", from: c.status, to });
  }
  await tx.update(complaints).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(complaints.id, c.id));
  await writeTransition(tx, ctx, c, c.status, to, reason);
  const from = c.status;
  Object.assign(c, set, { status: to });
  return from;
}

/* ------------------------------------------------------------------ code resolution and shipment check */

type Resolved = { container: { id: string; number: string; siteId: string } | null; lots: (typeof inventoryLots.$inferSelect)[] };

/** A typed or scanned lot/box code → the box (if any) and the lot(s), at the user's sites only. */
async function resolveCode(q: DbOrTx, ctx: AuthContext, raw: string): Promise<Resolved> {
  const p = parseTraceCode(raw);
  if (!p) return { container: null, lots: [] };
  const notFound = () =>
    new DomainError("validation", `No lot or box with the code ${p.value} at your sites. Check the label, or leave the code empty if the customer does not have it.`, { field: "code" });
  if (p.kind !== "lot") {
    const [box] = await q
      .select({ id: containers.id, number: containers.containerNumber, siteId: containers.siteId })
      .from(containers)
      .where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, p.value), inArray(containers.siteId, ctx.allowedSiteIds)))
      .limit(1);
    if (box) {
      const ids = await lotsOfBox(q, ctx.organizationId, box.id);
      const lots = ids.length ? await q.select().from(inventoryLots).where(and(inArray(inventoryLots.id, ids), inArray(inventoryLots.siteId, ctx.allowedSiteIds))).orderBy(asc(inventoryLots.lotNumber)) : [];
      return { container: box, lots };
    }
    if (p.kind === "box") throw notFound();
  }
  const [lot] = await q
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, p.value), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!lot) throw notFound();
  return { container: null, lots: [lot] };
}

type Match = { traceMatch: ComplaintTraceMatch; shipment: { id: string; siteId: string; orderId: string } | null; lotId: string | null };

/** W07-06: the code is checked against the shipments recorded for the customer at the user's sites. */
async function matchShipments(q: DbOrTx, ctx: AuthContext, customerId: string, r: Resolved, explicitShipmentId: string | null): Promise<Match> {
  const custShipments = await shipmentsOfCustomer(q, ctx.organizationId, customerId, ctx.allowedSiteIds);
  let candidates = custShipments;
  if (explicitShipmentId) {
    candidates = custShipments.filter((s) => s.shipmentId === explicitShipmentId);
    if (!candidates.length) throw new DomainError("validation", "That delivery receipt did not go to this customer (or is not at your sites).", { field: "shipmentId" });
  }
  if (!r.lots.length && !r.container) {
    const s = explicitShipmentId ? candidates[0] : null;
    return { traceMatch: "not_given", shipment: s ? { id: s.shipmentId, siteId: s.siteId, orderId: s.orderId } : null, lotId: null };
  }
  if (r.container) {
    const linked = (await shipmentsOfBox(q, ctx.organizationId, r.container.id)).filter((b) => candidates.some((s) => s.shipmentId === b.shipmentId));
    if (linked.length) {
      const s = candidates.find((x) => x.shipmentId === linked[0].shipmentId)!;
      return { traceMatch: "verified", shipment: { id: s.shipmentId, siteId: s.siteId, orderId: s.orderId }, lotId: linked[0].lotId };
    }
  }
  const lotIds = r.lots.map((l) => l.id);
  const hit = candidates.find((s) => s.lotIds.some((id) => lotIds.includes(id)));
  if (hit) return { traceMatch: "verified", shipment: { id: hit.shipmentId, siteId: hit.siteId, orderId: hit.orderId }, lotId: hit.lotIds.find((id) => lotIds.includes(id))! };
  if (!custShipments.length) return { traceMatch: "unverified", shipment: null, lotId: r.lots[0]?.id ?? null };
  if (await getSetting(q, ctx.organizationId, "quality.complaint.require_shipment_match")) {
    const what = r.container ? `Box ${r.container.number}` : `Lot ${r.lots[0].lotNumber}`;
    throw new DomainError("validation", `${what} was not shipped to this customer according to the recorded shipments. Check the code on the label or the customer chosen.`, { field: "code" });
  }
  return { traceMatch: "mismatch", shipment: null, lotId: r.lots[0]?.id ?? null };
}

/* ------------------------------------------------------------------ log */

export type LogComplaintInput = {
  customerId: string;
  /** Lot or box code from the label (typed, or a BC:LOT: / BC:BOX: scan payload). */
  code?: string | null;
  shipmentId?: string | null;
  productId?: string | null;
  category: string;
  channel?: string | null;
  description: string;
  customerReference?: string | null;
  qtyAffected?: string | null;
  sampleReturned?: boolean;
  internalNotes?: string | null;
  receivedAt?: Date | null;
  idempotencyKey?: string | null;
};

/** Logs a complaint (W07-06); QA is notified ("Complaint to assess"). Retry-safe with an idempotency key. */
export async function logComplaint(ctx: AuthContext, input: LogComplaintInput) {
  ctx.require("quality.complaint.create");
  const description = requiredText(input.description, "description", "What the customer reports", 4000);
  if (description.length < 5) throw new DomainError("validation", "Describe the complaint in at least 5 characters.", { field: "description" });
  const channel = (input.channel || "phone") as ComplaintChannel;
  if (!(COMPLAINT_CHANNELS as readonly string[]).includes(channel)) throw new DomainError("validation", "Choose how the complaint was received.", { field: "channel" });
  const customerReference = optionalText(input.customerReference, "customerReference", 100);
  const internalNotes = optionalText(input.internalNotes, "internalNotes", 4000);
  let qtyAffected: string | null = null;
  if (input.qtyAffected && String(input.qtyAffected).trim()) {
    const v = String(input.qtyAffected).trim();
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(v) || new Decimal(v).lte(0)) throw new DomainError("validation", "Enter the affected quantity as a number greater than zero.", { field: "qtyAffected" });
    qtyAffected = new Decimal(v).toString();
  }
  const receivedAt = input.receivedAt ?? new Date();
  if (Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError("validation", "The received time cannot be in the future.", { field: "receivedAt" });
  if (!isUuid(input.customerId)) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });
  if (input.shipmentId && !isUuid(input.shipmentId)) throw new DomainError("validation", "That delivery receipt was not found.", { field: "shipmentId" });

  return db.transaction(async (tx) => {
    if (input.idempotencyKey) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"cmp:" + input.idempotencyKey}))`);
    return withIdempotency(tx, ctx, input.idempotencyKey ? `complaint:${input.idempotencyKey}` : null, "quality.complaint.create", async () => {
      const cats = await categories(tx, ctx.organizationId);
      if (!cats.some((c) => c.code === input.category)) throw new DomainError("validation", "Choose a category from the list.", { field: "category" });
      const [cust] = await tx.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
      if (!cust) throw new DomainError("validation", "Choose the customer.", { field: "customerId" });

      const resolved = input.code ? await resolveCode(tx, ctx, input.code) : { container: null, lots: [] };
      const m = await matchShipments(tx, ctx, cust.id, resolved, input.shipmentId ?? null);
      const lot = resolved.lots.find((l) => l.id === m.lotId) ?? resolved.lots[0] ?? null;
      let productId = lot?.productId ?? null;
      if (!productId && input.productId) {
        if (!isUuid(input.productId)) throw new DomainError("validation", "Choose the product.", { field: "productId" });
        const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
        if (!p) throw new DomainError("validation", "Choose the product.", { field: "productId" });
        productId = p.id;
      }
      const siteId = m.shipment?.siteId ?? lot?.siteId ?? resolved.container?.siteId ?? ctx.currentSiteId;
      ctx.requireAt("quality.complaint.create", siteId);

      const complaintNumber = await nextNumber(tx, ctx.organizationId, "CMP");
      const [c] = await tx
        .insert(complaints)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          complaintNumber,
          status: "open",
          category: input.category,
          channel,
          customerId: cust.id,
          customerReference,
          productId,
          lotId: lot?.id ?? null,
          containerId: resolved.container?.id ?? null,
          salesOrderId: m.shipment?.orderId ?? null,
          shipmentId: m.shipment?.id ?? null,
          reportedCode: input.code ? input.code.trim().slice(0, 120) : null,
          traceMatch: m.traceMatch,
          description,
          qtyAffected,
          sampleReturned: !!input.sampleReturned,
          internalNotes,
          receivedAt,
          receivedBy: ctx.userId,
          statusChangedBy: ctx.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      // Further lots in a mixed box are kept as links so the trace can start from all of them.
      const extra = resolved.lots.filter((l) => l.id !== lot?.id);
      if (extra.length) {
        await tx.insert(complaintLinks).values(extra.map((l) => ({ organizationId: ctx.organizationId, complaintId: c.id, linkKind: "lot", entityId: l.id, entityNumber: l.lotNumber, createdBy: ctx.userId })));
      }
      await writeTransition(tx, ctx, c, null, "open", null);
      await audit(tx, ctx, {
        action: "quality.complaint.opened",
        entityType: "complaint",
        entityId: c.id,
        entityNumber: complaintNumber,
        siteId,
        after: { customer: cust.code, category: c.category, channel, lot: lot?.lotNumber ?? null, box: resolved.container?.number ?? null, traceMatch: m.traceMatch, shipmentId: c.shipmentId, sampleReturned: c.sampleReturned, qtyAffected },
      });
      await notifyRoles(
        tx,
        { roleCodes: ["qa_qc"], siteId },
        {
          organizationId: ctx.organizationId,
          siteId,
          kind: "quality.complaint.opened",
          severity: "warning",
          title: `Complaint ${complaintNumber} to assess (${cust.name})`,
          body: description,
          entityType: "complaint",
          entityId: c.id,
          link: `/quality/complaints/${c.id}`,
          dedupeKey: `complaint-opened:${c.id}`,
        },
      );
      return { complaintId: c.id, complaintNumber, traceMatch: m.traceMatch, shipmentId: c.shipmentId, replayed: false };
    });
  });
}

/* ------------------------------------------------------------------ classify, investigate, resolve, close */

async function applySeverity(tx: Tx, ctx: AuthContext, c: ComplaintRow, severity: string) {
  ctx.require("quality.complaint.approve");
  const levels = await getSetting(tx, ctx.organizationId, "quality.complaint.severity_levels");
  if (!levels.includes(severity)) throw new DomainError("validation", "Choose a severity from the list.", { field: "severity" });
  const review = await getSetting(tx, ctx.organizationId, "quality.complaint.recall_review_severities");
  const flagged = review.includes(severity);
  const before = { severity: c.severity, recallReviewFlagged: c.recallReviewFlagged };
  await tx.update(complaints).set({ severity, classifiedBy: ctx.userId, classifiedAt: new Date(), recallReviewFlagged: flagged || c.recallReviewFlagged }).where(eq(complaints.id, c.id));
  await audit(tx, ctx, { action: "quality.complaint.classified", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, before, after: { severity, recallReviewFlagged: flagged || c.recallReviewFlagged } });
  if (flagged && !c.recallReviewFlagged) {
    await notifyRoles(
      tx,
      { roleCodes: ["qa_qc", "owner_director"], siteId: c.siteId },
      {
        organizationId: ctx.organizationId,
        siteId: c.siteId,
        kind: "quality.complaint.recall_review",
        severity: "critical",
        title: `Recall assessment prompted by complaint ${c.complaintNumber}`,
        body: `Severity "${severity}" is configured to prompt a recall assessment. Review the trace in the recall explorer; the decision is the company's.`,
        entityType: "complaint",
        entityId: c.id,
        link: `/quality/recall?complaintId=${c.id}`,
        dedupeKey: `complaint-recall-review:${c.id}`,
      },
    );
  }
  c.severity = severity;
  c.recallReviewFlagged = flagged || c.recallReviewFlagged;
  return c.recallReviewFlagged;
}

/** QA classification of severity (G-W07-A analogue); allowed until the complaint is closed. */
export async function classifyComplaint(ctx: AuthContext, input: { complaintId: string; severity: string }) {
  ctx.require("quality.complaint.approve");
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    if (c.status === "closed") throw new DomainError("state", `Complaint ${c.complaintNumber} is closed.`);
    const recallReviewFlagged = await applySeverity(tx, ctx, c, input.severity);
    return { severity: input.severity, recallReviewFlagged };
  });
}

/** open → investigating, with the investigation plan; an optional severity needs QA's classification right. */
export async function startComplaintInvestigation(ctx: AuthContext, input: { complaintId: string; investigation: string; severity?: string | null }) {
  ctx.require("quality.complaint.submit");
  if (input.severity) ctx.require("quality.complaint.approve");
  const investigation = requiredText(input.investigation, "investigation", "The investigation plan", 4000);
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    await move(tx, ctx, c, "investigating", investigation, { investigation });
    await audit(tx, ctx, { action: "quality.complaint.updated", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, before: { status: "open" }, after: { status: "investigating", investigation } });
    const flagged = input.severity ? await applySeverity(tx, ctx, c, input.severity) : c.recallReviewFlagged;
    return { status: c.status, recallReviewFlagged: flagged };
  });
}

/** Updates the record while not closed. Internal fields stay internal; `customerResponse` is customer-facing. */
export async function updateComplaint(ctx: AuthContext, input: { complaintId: string; investigation?: string | null; rootCause?: string | null; internalNotes?: string | null; customerResponse?: string | null }) {
  ctx.require("quality.complaint.submit");
  const set: Partial<typeof complaints.$inferInsert> = {};
  if (input.investigation !== undefined) set.investigation = optionalText(input.investigation, "investigation", 4000);
  if (input.rootCause !== undefined) set.rootCause = optionalText(input.rootCause, "rootCause", 4000);
  if (input.internalNotes !== undefined) set.internalNotes = optionalText(input.internalNotes, "internalNotes", 4000);
  if (input.customerResponse !== undefined) set.customerResponse = optionalText(input.customerResponse, "customerResponse", 4000);
  if (!Object.keys(set).length) throw new DomainError("validation", "Nothing to update.");
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    if (c.status === "closed") throw new DomainError("state", `Complaint ${c.complaintNumber} is closed; log a new complaint for new information.`);
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, c[k as keyof ComplaintRow]]));
    await tx.update(complaints).set(set).where(eq(complaints.id, c.id));
    await audit(tx, ctx, { action: "quality.complaint.updated", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, before, after: set });
    return { status: c.status };
  });
}

/** investigating → resolved with the (internal) resolution; optional root cause and customer reply. */
export async function resolveComplaint(ctx: AuthContext, input: { complaintId: string; resolution: string; rootCause?: string | null; customerResponse?: string | null }) {
  ctx.require("quality.complaint.submit");
  const resolution = reasonText(input.resolution, "resolution", 4000);
  const rootCause = optionalText(input.rootCause, "rootCause", 4000);
  const customerResponse = optionalText(input.customerResponse, "customerResponse", 4000);
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    const set: Partial<typeof complaints.$inferInsert> = { resolution, resolvedBy: ctx.userId, resolvedAt: new Date() };
    if (rootCause) set.rootCause = rootCause;
    if (customerResponse) set.customerResponse = customerResponse;
    await move(tx, ctx, c, "resolved", resolution, set);
    await audit(tx, ctx, { action: "quality.complaint.resolved", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, before: { status: "investigating" }, after: { status: "resolved", resolution, rootCause, customerResponse } });
    return { status: c.status };
  });
}

/** resolved → investigating (new information before closure). */
export async function reopenComplaint(ctx: AuthContext, input: { complaintId: string; reason: string }) {
  ctx.require("quality.complaint.submit");
  const reason = reasonText(input.reason, "reason");
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    await move(tx, ctx, c, "investigating", reason);
    await audit(tx, ctx, { action: "quality.complaint.reopened", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, reason, before: { status: "resolved" }, after: { status: "investigating" } });
    return { status: c.status };
  });
}

/** resolved → closed by qa_qc (quality.complaint.approve); the severity must be classified. */
export async function closeComplaint(ctx: AuthContext, input: { complaintId: string; note?: string | null }) {
  ctx.require("quality.complaint.approve");
  const note = optionalText(input.note, "note", 2000);
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    if (!canMoveComplaint(c.status, "closed")) throw new DomainError("state", `Complaint ${c.complaintNumber} is ${c.status}; resolve it before closing.`, { machine: "complaint", from: c.status, to: "closed" });
    if (!c.severity) throw new DomainError("validation", "Classify the severity before closing the complaint.", { field: "severity" });
    await move(tx, ctx, c, "closed", note, { closedBy: ctx.userId, closedAt: new Date() });
    await audit(tx, ctx, { action: "quality.complaint.closed", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, reason: note, before: { status: "resolved" }, after: { status: "closed", severity: c.severity, resolution: c.resolution } });
    return { status: c.status };
  });
}

/** "Raise deviation" from the complaint (W07 flow: complaint → deviation), linked both ways; once per complaint. */
export async function raiseComplaintDeviation(ctx: AuthContext, input: { complaintId: string; description: string }) {
  ctx.require("quality.complaint.view");
  ctx.require("quality.deviation.create");
  const description = reasonText(input.description, "description", 4000);
  return db.transaction(async (tx) => {
    const c = await lockComplaint(tx, ctx, input.complaintId);
    if (c.deviationId) {
      const [d] = await tx.select({ n: deviations.deviationNumber }).from(deviations).where(eq(deviations.id, c.deviationId)).limit(1);
      throw new DomainError("state", `Deviation ${d?.n ?? "(linked)"} was already raised from this complaint.`);
    }
    if (c.status === "closed") throw new DomainError("state", `Complaint ${c.complaintNumber} is closed.`);
    if (!c.lotId) throw new DomainError("validation", "The complaint names no lot of ours; record the lot or box code first (log a new complaint with the code).", { field: "code" });
    // The deviation names the complaint's lot; QA links the batch while investigating (an open deviation on a
    // batch blocks its release, which a complaint about shipped goods should not do by itself).
    const r = await openDeviation(ctx, { lotId: c.lotId, source: "complaint", description: `${c.complaintNumber}: ${description}`, idempotencyKey: `cmp-dev:${c.id}` }, { tx });
    await tx.update(complaints).set({ deviationId: r.deviationId }).where(eq(complaints.id, c.id));
    await tx.insert(complaintLinks).values({ organizationId: ctx.organizationId, complaintId: c.id, linkKind: "deviation", entityId: r.deviationId, entityNumber: r.deviationNumber, createdBy: ctx.userId }).onConflictDoNothing();
    await audit(tx, ctx, { action: "quality.complaint.updated", entityType: "complaint", entityId: c.id, entityNumber: c.complaintNumber, siteId: c.siteId, after: { deviationRaised: r.deviationNumber } });
    return { deviationId: r.deviationId, deviationNumber: r.deviationNumber };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listComplaints(ctx: AuthContext, f: { status?: string; q?: string; customerId?: string } = {}) {
  ctx.require("quality.complaint.view");
  const conds = [eq(complaints.organizationId, ctx.organizationId), inArray(complaints.siteId, ctx.allowedSiteIds)];
  if (f.customerId) conds.push(eq(complaints.customerId, f.customerId));
  if (!f.status || f.status === "active") conds.push(inArray(complaints.status, ["open", "investigating", "resolved"]));
  else if (f.status !== "all" && (["open", "investigating", "resolved", "closed"] as string[]).includes(f.status)) conds.push(eq(complaints.status, f.status));
  const q = f.q?.trim();
  if (q) conds.push(or(ilike(complaints.complaintNumber, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(inventoryLots.lotNumber, `%${q}%`), ilike(complaints.reportedCode, `%${q}%`))!);
  const rows = await db
    .select({
      id: complaints.id,
      number: complaints.complaintNumber,
      status: complaints.status,
      category: complaints.category,
      severity: complaints.severity,
      traceMatch: complaints.traceMatch,
      recallReviewFlagged: complaints.recallReviewFlagged,
      description: complaints.description,
      receivedAt: complaints.receivedAt,
      customerName: customers.name,
      lotNumber: inventoryLots.lotNumber,
      productName: products.name,
      siteCode: sites.code,
    })
    .from(complaints)
    .innerJoin(customers, eq(customers.id, complaints.customerId))
    .innerJoin(sites, eq(sites.id, complaints.siteId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, complaints.lotId))
    .leftJoin(products, eq(products.id, complaints.productId))
    .where(and(...conds))
    .orderBy(desc(complaints.receivedAt))
    .limit(300);
  const cats = await categories(db, ctx.organizationId);
  return rows.map((r) => ({ ...r, categoryLabel: cats.find((c) => c.code === r.category)?.label ?? r.category }));
}

export async function getComplaint(ctx: AuthContext, complaintId: string) {
  ctx.require("quality.complaint.view");
  assertUuid(complaintId, "Complaint");
  const [row] = await db
    .select({
      c: complaints,
      customerName: customers.name,
      customerCode: customers.code,
      siteCode: sites.code,
      receivedByName: receiver.displayName,
      closedByName: closer.displayName,
      classifiedByName: classifier.displayName,
      resolvedByName: resolver.displayName,
      productName: products.name,
      productSku: products.skuCode,
      lotNumber: inventoryLots.lotNumber,
      lotStatus: inventoryLots.qualityStatus,
      lotExpiresOn: inventoryLots.expiresOn,
      lotSourceBatchId: inventoryLots.sourceBatchId,
      containerNumber: containers.containerNumber,
      orderNumber: salesOrders.orderNumber,
      drNumber: shipments.deliveryReceiptNumber,
      dispatchedAt: shipments.dispatchedAt,
    })
    .from(complaints)
    .innerJoin(customers, eq(customers.id, complaints.customerId))
    .innerJoin(sites, eq(sites.id, complaints.siteId))
    .innerJoin(receiver, eq(receiver.id, complaints.receivedBy))
    .leftJoin(closer, eq(closer.id, complaints.closedBy))
    .leftJoin(classifier, eq(classifier.id, complaints.classifiedBy))
    .leftJoin(resolver, eq(resolver.id, complaints.resolvedBy))
    .leftJoin(products, eq(products.id, complaints.productId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, complaints.lotId))
    .leftJoin(containers, eq(containers.id, complaints.containerId))
    .leftJoin(salesOrders, eq(salesOrders.id, complaints.salesOrderId))
    .leftJoin(shipments, eq(shipments.id, complaints.shipmentId))
    .where(and(eq(complaints.id, complaintId), eq(complaints.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.c.siteId)) throw new DomainError("not_found", "Complaint not found in your sites.");
  ctx.requireSite(row.c.siteId);
  const c = row.c;
  const deviation = c.deviationId ? ((await db.select({ id: deviations.id, number: deviations.deviationNumber, status: deviations.status }).from(deviations).where(eq(deviations.id, c.deviationId)).limit(1))[0] ?? null) : null;
  const links = await db.select().from(complaintLinks).where(eq(complaintLinks.complaintId, c.id)).orderBy(asc(complaintLinks.createdAt));
  const returns = await db
    .select({ id: customerReturns.id, number: customerReturns.returnNumber, status: customerReturns.status })
    .from(customerReturns)
    .where(and(eq(customerReturns.complaintId, c.id), inArray(customerReturns.siteId, ctx.allowedSiteIds)))
    .orderBy(asc(customerReturns.createdAt));
  const timeline = await db
    .select({ from: complaintStateTransitions.fromState, to: complaintStateTransitions.toState, reason: complaintStateTransitions.reason, at: complaintStateTransitions.occurredAt, by: users.displayName })
    .from(complaintStateTransitions)
    .innerJoin(users, eq(users.id, complaintStateTransitions.actorId))
    .where(eq(complaintStateTransitions.complaintId, c.id))
    .orderBy(asc(complaintStateTransitions.occurredAt));
  const severityLevels = await getSetting(db, ctx.organizationId, "quality.complaint.severity_levels");
  const active = c.status !== "closed";
  return {
    complaint: {
      ...c,
      customerName: row.customerName,
      customerCode: row.customerCode,
      siteCode: row.siteCode,
      receivedByName: row.receivedByName,
      closedByName: row.closedByName,
      classifiedByName: row.classifiedByName,
      resolvedByName: row.resolvedByName,
      categoryLabel: await categoryLabel(db, ctx.organizationId, c.category),
      channelLabel: COMPLAINT_CHANNEL_LABEL[c.channel as ComplaintChannel] ?? c.channel,
      traceMatchLabel: TRACE_MATCH_LABEL[c.traceMatch as ComplaintTraceMatch] ?? c.traceMatch,
    },
    product: c.productId ? { id: c.productId, name: row.productName!, sku: row.productSku! } : null,
    lot: c.lotId ? { id: c.lotId, number: row.lotNumber!, status: row.lotStatus!, expiresOn: row.lotExpiresOn, sourceBatchId: row.lotSourceBatchId } : null,
    box: c.containerId ? { id: c.containerId, number: row.containerNumber! } : null,
    shipment: c.shipmentId ? { id: c.shipmentId, drNumber: row.drNumber!, dispatchedAt: row.dispatchedAt!, orderId: c.salesOrderId, orderNumber: row.orderNumber } : null,
    deviation,
    extraLots: links.filter((l) => l.linkKind === "lot").map((l) => ({ id: l.entityId, number: l.entityNumber })),
    returns,
    timeline,
    severityLevels,
    can: {
      investigate: c.status === "open" && ctx.can("quality.complaint.submit"),
      classify: active && ctx.can("quality.complaint.approve"),
      update: active && ctx.can("quality.complaint.submit"),
      resolve: c.status === "investigating" && ctx.can("quality.complaint.submit"),
      reopen: c.status === "resolved" && ctx.can("quality.complaint.submit"),
      close: c.status === "resolved" && ctx.can("quality.complaint.approve") && !!c.severity,
      closeBlockedReason:
        c.status !== "resolved" ? null : !ctx.can("quality.complaint.approve") ? "Closing needs quality.complaint.approve, held by QA." : !c.severity ? "Classify the severity before closing." : null,
      raiseDeviation: active && !c.deviationId && !!c.lotId && ctx.can("quality.deviation.create"),
      startReturn: active && !!c.shipmentId && ctx.can("sales.customer_return.create"),
      trace: !!c.lotId && ctx.can("quality.genealogy.view"),
    },
  };
}

/** Options for the "Log complaint" form. */
export async function complaintFormContext(ctx: AuthContext) {
  ctx.require("quality.complaint.create");
  const custs = await db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.organizationId, ctx.organizationId)).orderBy(asc(customers.name));
  const prods = await db.select({ id: products.id, sku: products.skuCode, name: products.name }).from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.skuCode));
  return {
    customers: custs,
    products: prods,
    categories: await categories(db, ctx.organizationId),
    channels: COMPLAINT_CHANNELS.map((c) => ({ code: c, label: COMPLAINT_CHANNEL_LABEL[c] })),
  };
}

/**
 * Data for the complaint acknowledgement to the customer (docs/reports-and-templates.md, W07-06).
 * Only the whitelisted customer-facing fields leave this function (toCustomerFacing).
 */
export async function getComplaintAcknowledgement(ctx: AuthContext, complaintId: string) {
  const v = await getComplaint(ctx, complaintId);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const [cust] = await db.select({ address: customers.shipToAddress, contactName: customers.contactName }).from(customers).where(eq(customers.id, v.complaint.customerId)).limit(1);
  const [site] = await db.select({ code: sites.code, name: sites.name }).from(sites).where(eq(sites.id, v.complaint.siteId)).limit(1);
  return {
    organizationName: org?.name ?? "",
    site,
    contactName: cust?.contactName ?? null,
    generatedAt: new Date(),
    document: toCustomerFacing({
      complaintNumber: v.complaint.complaintNumber,
      receivedAt: v.complaint.receivedAt,
      status: v.complaint.status,
      customerName: v.complaint.customerName,
      customerAddress: cust?.address ?? "",
      customerReference: v.complaint.customerReference,
      productName: v.product?.name ?? null,
      reportedCode: v.complaint.reportedCode,
      lotNumber: v.lot?.number ?? null,
      categoryLabel: v.complaint.categoryLabel,
      description: v.complaint.description,
      qtyAffected: v.complaint.qtyAffected,
      sampleReturned: v.complaint.sampleReturned,
      customerResponse: v.complaint.customerResponse,
    }),
  };
}

/** Lots a complaint names (its lot and box, plus linked lots), at the user's sites; the recall explorer starts here. */
export async function complaintStartLots(ctx: AuthContext, complaintId: string) {
  const v = await getComplaint(ctx, complaintId);
  const ids = new Set<string>();
  if (v.lot) ids.add(v.lot.id);
  for (const l of v.extraLots) ids.add(l.id);
  if (v.box) for (const id of await lotsOfBox(db, ctx.organizationId, v.box.id)) ids.add(id);
  return { complaint: { id: v.complaint.id, number: v.complaint.complaintNumber, customerName: v.complaint.customerName }, lotIds: [...ids] };
}

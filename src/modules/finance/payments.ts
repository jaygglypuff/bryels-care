import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { PAYMENT_METHODS, customers, expenseClaims, invoices, paymentApplications, paymentRecords, supplierBills, suppliers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { approvalProgress, assertPosterAllowed, canDecide, decisionsOf, evaluateAtSubmit, notifyNextStep, recordDecision, type Progress } from "./approvals";
import { billOpenAmount } from "./bills";
import { openAmountOf } from "./invoices";
import { D, DATE_RE, businessDate, isUuid, logTransition, m4, money, namesOf, parseAmount, postFinancial, postingsOf, requireReason, reverseDocumentPosting, settlementState, transitionsOf } from "./shared";

/**
 * Payments in and out with applications (US-6-12, FR-finance-02, docs/modules/finance.md §3.1 R-06, §3.2
 * P-06/P-07, §3.3 X-05). The system never moves money: a payment record is the evidence of a receipt or a
 * disbursement made outside (bank, cash, cheque, e-wallet).
 *
 *   draft → submitted → approved → recorded (posting) → reconciled (Phase 6c reconciliation)
 *   draft → approved when no approval rule applies; draft | submitted | approved → cancelled; recorded → voided
 *
 * Counterparty: exactly one of a customer (inbound), a supplier or a claimant (outbound). Recording
 * (`finance.payment_record.post`, restricted) applies the payment to the chosen documents or, by default,
 * to the counterparty's open documents oldest due date first (A-FIN-07); the remainder stays unapplied on
 * account. V-FIN-APPLY: applications never exceed the payment (amount + withheld) nor a document's open
 * amount (422 OVER_APPLICATION). A void reverses the posting and every application (negative rows) in one
 * transaction and recomputes the documents' balances and states.
 */

export type PaymentRow = typeof paymentRecords.$inferSelect;
type TargetType = "invoice" | "supplier_bill" | "expense_claim";
export type PlanItem = { documentType: TargetType; documentId: string; amount: string };

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  recorded: "Recorded",
  reconciled: "Reconciled",
  voided: "Voided",
  cancelled: "Cancelled",
};
export const PAYMENT_METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  gcash: "E-wallet (GCash)",
  provider: "Payment provider",
  other: "Other",
};

const label = (p: Pick<PaymentRow, "paymentNumber">) => `Payment ${p.paymentNumber}`;
const doc = (p: PaymentRow) => ({ type: "payment_record" as const, id: p.id, siteId: p.siteId, label: label(p) });

function visibleWhere(ctx: AuthContext) {
  // Organization-wide payments (site null) are visible to organization-wide roles only.
  return ctx.isOrganizationWide || !ctx.options.access
    ? or(isNull(paymentRecords.siteId), inArray(paymentRecords.siteId, ctx.allowedSiteIds))!
    : inArray(paymentRecords.siteId, ctx.allowedSiteIds);
}

async function lockPayment(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Payment not found in your sites.");
  const [p] = await tx.select().from(paymentRecords).where(and(eq(paymentRecords.id, id), eq(paymentRecords.organizationId, ctx.organizationId), visibleWhere(ctx))).for("update").limit(1);
  if (!p) throw new DomainError("not_found", "Payment not found in your sites.");
  if (p.siteId) ctx.requireSite(p.siteId);
  return p;
}

const can = (ctx: AuthContext, p: Parameters<AuthContext["can"]>[0], siteId: string | null) => (siteId ? ctx.requireAt(p, siteId) : ctx.require(p));

/* ------------------------------------------------------------------ open documents */

export type OpenDocument = { documentType: TargetType; documentId: string; number: string; siteId: string; dueDate: string | null; date: string | null; open: string; total: string };

/** The counterparty's open documents in the caller's sites, oldest due first (A-FIN-07). */
export async function openDocumentsFor(q: DbOrTx, ctx: AuthContext, party: { customerId?: string | null; supplierId?: string | null; claimantUserId?: string | null }, forUpdate = false): Promise<OpenDocument[]> {
  if (!ctx.allowedSiteIds.length) return [];
  if (party.customerId) {
    const base = q.select().from(invoices).where(and(eq(invoices.organizationId, ctx.organizationId), eq(invoices.customerId, party.customerId), inArray(invoices.siteId, ctx.allowedSiteIds), inArray(invoices.status, ["issued", "partially_paid"]))).orderBy(asc(invoices.dueDate), asc(invoices.issueDate), asc(invoices.invoiceNumber));
    const rows = forUpdate ? await base.for("update") : await base;
    return rows.map((i) => ({ documentType: "invoice", documentId: i.id, number: i.invoiceNumber!, siteId: i.siteId, dueDate: i.dueDate, date: i.issueDate, open: m4(openAmountOf(i)), total: i.totalAmount }));
  }
  if (party.supplierId) {
    const base = q.select().from(supplierBills).where(and(eq(supplierBills.organizationId, ctx.organizationId), eq(supplierBills.supplierId, party.supplierId), inArray(supplierBills.siteId, ctx.allowedSiteIds), inArray(supplierBills.status, ["posted", "partially_paid"]), eq(supplierBills.billKind, "bill"))).orderBy(asc(supplierBills.dueDate), asc(supplierBills.billDate), asc(supplierBills.billNumber));
    const rows = forUpdate ? await base.for("update") : await base;
    return rows.map((b) => ({ documentType: "supplier_bill", documentId: b.id, number: `${b.billNumber} (${b.supplierReference})`, siteId: b.siteId, dueDate: b.dueDate, date: b.billDate, open: m4(billOpenAmount(b)), total: b.totalAmount }));
  }
  if (party.claimantUserId) {
    const base = q.select().from(expenseClaims).where(and(eq(expenseClaims.organizationId, ctx.organizationId), eq(expenseClaims.claimantUserId, party.claimantUserId), inArray(expenseClaims.siteId, ctx.allowedSiteIds), eq(expenseClaims.status, "posted"))).orderBy(asc(expenseClaims.expenseDate), asc(expenseClaims.claimNumber));
    const rows = forUpdate ? await base.for("update") : await base;
    return rows.map((c) => ({ documentType: "expense_claim", documentId: c.id, number: c.claimNumber, siteId: c.siteId, dueDate: c.expenseDate, date: c.expenseDate, open: m4(D(c.amount).minus(c.paidAmount)), total: c.amount }));
  }
  return [];
}

/** Oldest-due-first allocation of `available` over the open documents. */
export function allocateOldestFirst(open: OpenDocument[], available: Decimal.Value): PlanItem[] {
  let left = D(available);
  const out: PlanItem[] = [];
  for (const d of open) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, d.open);
    if (take.lte(0)) continue;
    out.push({ documentType: d.documentType, documentId: d.documentId, amount: m4(take) });
    left = left.minus(take);
  }
  return out;
}

function validatePlan(plan: PlanItem[], open: OpenDocument[], available: Decimal) {
  let sum = D(0);
  const seen = new Set<string>();
  for (const [i, a] of plan.entries()) {
    const d = open.find((o) => o.documentType === a.documentType && o.documentId === a.documentId);
    if (!d) throw new DomainError("validation", "A chosen document is not open for this counterparty (or not in your sites).", { field: `applications.${i}` });
    if (seen.has(a.documentId)) throw new DomainError("validation", "A document is listed twice.", { field: `applications.${i}` });
    seen.add(a.documentId);
    const amt = parseAmount(a.amount, `applications.${i}.amount`);
    if (amt.gt(d.open)) throw new DomainError("validation", `OVER_APPLICATION: ${d.number} has only ${money(d.open)} open.`, { code: "OVER_APPLICATION", field: `applications.${i}.amount` });
    sum = sum.plus(amt);
  }
  if (sum.gt(available)) throw new DomainError("validation", `OVER_APPLICATION: the applications (${money(sum)}) exceed the payment (${money(available)}).`, { code: "OVER_APPLICATION", field: "applications" });
}

/* ------------------------------------------------------------------ commands */

export type CreatePaymentInput = {
  direction: "inbound" | "outbound";
  customerId?: string | null;
  supplierId?: string | null;
  claimantUserId?: string | null;
  method: (typeof PAYMENT_METHODS)[number];
  reference?: string | null;
  bankReference?: string | null;
  paidOn: string;
  amount: string;
  withheldAmount?: string | null;
  /** Manual allocation; empty/undefined = oldest due first at recording. */
  applications?: PlanItem[] | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

export async function createPayment(ctx: AuthContext, input: CreatePaymentInput) {
  ctx.require("finance.payment_record.create");
  if (!["inbound", "outbound"].includes(input.direction)) throw new DomainError("validation", "Choose money in or money out.", { field: "direction" });
  const parties = [input.customerId, input.supplierId, input.claimantUserId].filter(Boolean);
  if (parties.length !== 1) throw new DomainError("validation", "Choose exactly one counterparty.", { field: "counterparty" });
  if (input.direction === "inbound" && !input.customerId) throw new DomainError("validation", "Money in comes from a customer.", { field: "counterparty" });
  if (input.direction === "outbound" && input.customerId) throw new DomainError("validation", "Refunds to customers are not available yet (Phase 8); money out goes to a supplier or a claimant.", { field: "counterparty" });
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new DomainError("validation", "Choose the method.", { field: "method" });
  if (!DATE_RE.test(input.paidOn) || input.paidOn > businessDate()) throw new DomainError("validation", "Choose the date the money moved (not in the future).", { field: "paidOn" });
  const amount = parseAmount(input.amount, "amount");
  const withheld = input.withheldAmount ? parseAmount(input.withheldAmount, "withheldAmount", { allowZero: true }) : D(0);
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ paymentId: string; paymentNumber: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.payment_record.create", { ...input, idempotencyKey: undefined });
      if (replay) return replay.replay;
    }
    const partyId = (input.customerId ?? input.supplierId ?? input.claimantUserId)!;
    if (!isUuid(partyId)) throw new DomainError("validation", "Choose the counterparty.", { field: "counterparty" });
    if (input.customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, partyId), eq(customers.organizationId, ctx.organizationId))).limit(1);
      if (!c) throw new DomainError("validation", "Customer not found.", { field: "counterparty" });
    } else if (input.supplierId) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, partyId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
      if (!s) throw new DomainError("validation", "Supplier not found.", { field: "counterparty" });
    } else {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, partyId), eq(users.organizationId, ctx.organizationId))).limit(1);
      if (!u) throw new DomainError("validation", "Claimant not found.", { field: "counterparty" });
    }
    const open = await openDocumentsFor(tx, ctx, input);
    const plan = input.applications?.length ? input.applications : null;
    if (plan) validatePlan(plan, open, amount.plus(withheld));
    const preview = plan ?? allocateOldestFirst(open, amount.plus(withheld));
    const firstDoc = preview.length ? open.find((o) => o.documentId === preview[0].documentId) : undefined;
    const siteId = firstDoc?.siteId ?? (ctx.isOrganizationWide || !ctx.options.access ? null : ctx.currentSiteId);
    if (siteId) ctx.requireAt("finance.payment_record.create", siteId);
    const number = await nextNumber(tx, ctx.organizationId, "PAY");
    const currency = await getSetting(tx, ctx.organizationId, "finance.currency");
    const [p] = await tx
      .insert(paymentRecords)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        paymentNumber: number,
        direction: input.direction,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        claimantUserId: input.claimantUserId ?? null,
        method: input.method,
        reference: input.reference?.trim() || null,
        bankReference: input.bankReference?.trim() || null,
        paidOn: input.paidOn,
        amount: m4(amount),
        withheldAmount: m4(withheld),
        currency,
        applicationPlan: plan,
        notes: input.notes?.trim() || null,
        createdBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await logTransition(tx, ctx, doc(p), null, "draft");
    await audit(tx, ctx, { action: "finance.payment_record.created", entityType: "payment_record", entityId: p.id, entityNumber: number, siteId, after: { direction: p.direction, amount: p.amount, withheld: p.withheldAmount, method: p.method, plan: plan ? "manual" : "oldest_first" } });
    const result = { paymentId: p.id, paymentNumber: number };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { ...input, idempotencyKey: undefined }, result);
    return result;
  });
}

export async function submitPayment(ctx: AuthContext, id: string) {
  ctx.require("finance.payment_record.create");
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    can(ctx, "finance.payment_record.create", p.siteId);
    if (p.status !== "draft") throw new DomainError("state", `${label(p)} is ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}; only a draft can be submitted.`);
    const ev = await evaluateAtSubmit(tx, ctx, { recordType: "payment_record", recordId: p.id, recordNumber: p.paymentNumber, siteId: p.siteId, basis: { amount: p.amount } });
    const now = new Date();
    if (!ev.steps.length) {
      await tx.update(paymentRecords).set({ status: "approved", submittedBy: ctx.userId, submittedAt: now, approvedAt: now, updatedAt: now }).where(eq(paymentRecords.id, p.id));
      await logTransition(tx, ctx, doc(p), "draft", "approved", "No approval rule applies");
    } else {
      await tx.update(paymentRecords).set({ status: "submitted", submittedBy: ctx.userId, submittedAt: now, updatedAt: now }).where(eq(paymentRecords.id, p.id));
      await logTransition(tx, ctx, doc(p), "draft", "submitted");
      await notifyNextStep(tx, ctx, ev.steps[0], { siteId: p.siteId, kind: "finance.payment_record.approval", title: `Payment ${p.paymentNumber} to approve`, body: `${money(p.amount)} ${p.currency} ${p.direction === "inbound" ? "received" : "paid"}.`, entityType: "payment_record", entityId: p.id, link: `/finance/payments/${p.id}` });
    }
    await audit(tx, ctx, { action: "finance.payment_record.submitted", entityType: "payment_record", entityId: p.id, entityNumber: p.paymentNumber, siteId: p.siteId, after: { steps: ev.steps.length } });
    return { status: ev.steps.length ? "submitted" : "approved" };
  });
}

export async function decidePayment(ctx: AuthContext, id: string, input: { decision: "approved" | "returned"; note?: string | null }) {
  ctx.require("finance.payment_record.approve");
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    if (p.status !== "submitted") throw new DomainError("state", `${label(p)} is ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}; only a submitted payment can be decided.`);
    const r = await recordDecision(tx, ctx, { recordType: "payment_record", recordId: p.id, recordNumber: p.paymentNumber, siteId: p.siteId, basis: { amount: p.amount }, pendingSince: p.submittedAt, excludedUserIds: [p.createdBy, p.submittedBy], decision: input.decision, note: input.note });
    const now = new Date();
    if (input.decision === "returned") {
      await tx.update(paymentRecords).set({ status: "draft", submittedBy: null, submittedAt: null, updatedAt: now }).where(eq(paymentRecords.id, p.id));
      await logTransition(tx, ctx, doc(p), "submitted", "draft", input.note ?? null);
    } else if (r.final) {
      await tx.update(paymentRecords).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null, updatedAt: now }).where(eq(paymentRecords.id, p.id));
      await logTransition(tx, ctx, doc(p), "submitted", "approved", input.note?.trim() || null);
    }
    await audit(tx, ctx, { action: input.decision === "approved" ? "finance.payment_record.approved" : "finance.payment_record.returned", entityType: "payment_record", entityId: p.id, entityNumber: p.paymentNumber, siteId: p.siteId, reason: input.note?.trim() || null, after: { final: r.final } });
    return { approved: input.decision === "approved" && r.final };
  });
}

export async function cancelPayment(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.payment_record.create");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    if (!["draft", "submitted", "approved"].includes(p.status)) throw new DomainError("state", `${label(p)} is ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}; a recorded payment is voided, not cancelled.`);
    await tx.update(paymentRecords).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(paymentRecords.id, p.id));
    await logTransition(tx, ctx, doc(p), p.status, "cancelled", why);
    await audit(tx, ctx, { action: "finance.payment_record.cancelled", entityType: "payment_record", entityId: p.id, entityNumber: p.paymentNumber, siteId: p.siteId, reason: why });
    return { status: "cancelled" };
  });
}

/** Applies `delta` (positive or negative) to a document's settled amount and moves its state. */
async function settle(tx: Tx, ctx: AuthContext, type: TargetType, id: string, delta: Decimal, reason: string) {
  const now = new Date();
  if (type === "invoice") {
    const [i] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update").limit(1);
    const paid = D(i.paidAmount).plus(delta);
    const to = settlementState("issued", i.totalAmount, paid.plus(i.creditedAmount));
    await tx.update(invoices).set({ paidAmount: m4(paid), status: to, updatedAt: now }).where(eq(invoices.id, i.id));
    if (to !== i.status) await logTransition(tx, ctx, { type: "invoice", id: i.id, siteId: i.siteId, label: `Invoice ${i.invoiceNumber}` }, i.status, to, reason);
  } else if (type === "supplier_bill") {
    const [b] = await tx.select().from(supplierBills).where(eq(supplierBills.id, id)).for("update").limit(1);
    const paid = D(b.paidAmount).plus(delta);
    const to = settlementState("posted", b.totalAmount, paid);
    await tx.update(supplierBills).set({ paidAmount: m4(paid), status: to, updatedAt: now }).where(eq(supplierBills.id, b.id));
    if (to !== b.status) await logTransition(tx, ctx, { type: "supplier_bill", id: b.id, siteId: b.siteId, label: `Bill ${b.billNumber}` }, b.status, to, reason);
  } else {
    const [c] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, id)).for("update").limit(1);
    const paid = D(c.paidAmount).plus(delta);
    const to = paid.gte(c.amount) ? "paid" : "posted";
    await tx.update(expenseClaims).set({ paidAmount: m4(paid), status: to, updatedAt: now }).where(eq(expenseClaims.id, c.id));
    if (to !== c.status) await logTransition(tx, ctx, { type: "expense_claim", id: c.id, siteId: c.siteId, label: `Expense claim ${c.claimNumber}` }, c.status, to, reason);
  }
}

/**
 * R-06 / P-07 / X-05: record the payment (restricted). Lock order: payment row, the counterparty's open
 * documents (FOR UPDATE, oldest first), the period (FOR SHARE, paid-on date).
 */
export async function recordPayment(ctx: AuthContext, id: string, input: { password?: string | null; idempotencyKey?: string | null } = {}) {
  ctx.require("finance.payment_record.post");
  await requireReauthentication(ctx, input.password, "finance.payment_record.post");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ applied: string; unapplied: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.payment_record.post", { id });
      if (replay) return replay.replay;
    }
    const p = await lockPayment(tx, ctx, id);
    can(ctx, "finance.payment_record.post", p.siteId);
    if (p.status !== "approved") throw new DomainError("state", `${label(p)} is ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}; only an approved payment can be recorded.`);
    await assertPosterAllowed(tx, ctx, { recordType: "payment_record", recordId: p.id, siteId: p.siteId, basis: { amount: p.amount } });
    const open = await openDocumentsFor(tx, ctx, p, true);
    const available = D(p.amount).plus(p.withheldAmount);
    const oldestFirst = await getSetting(tx, ctx.organizationId, "finance.payment.apply_oldest_first");
    const plan = p.applicationPlan?.length ? p.applicationPlan : oldestFirst ? allocateOldestFirst(open, available) : [];
    validatePlan(plan, open, available);
    await postFinancial(tx, ctx, {
      siteId: p.siteId,
      postingType: "payment",
      documentType: "payment_record",
      documentId: p.id,
      documentNumber: p.paymentNumber,
      postingDate: p.paidOn,
      amount: p.amount,
      currency: p.currency,
      direction: p.direction === "inbound" ? "debit" : "credit",
      customerId: p.customerId,
      supplierId: p.supplierId,
      counterpartyUserId: p.claimantUserId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    let applied = D(0);
    for (const a of plan) {
      const d = open.find((o) => o.documentId === a.documentId)!;
      await tx.insert(paymentApplications).values({
        organizationId: ctx.organizationId,
        siteId: d.siteId,
        paymentRecordId: p.id,
        invoiceId: a.documentType === "invoice" ? a.documentId : null,
        supplierBillId: a.documentType === "supplier_bill" ? a.documentId : null,
        expenseClaimId: a.documentType === "expense_claim" ? a.documentId : null,
        appliedAmount: m4(a.amount),
        currency: p.currency,
        appliedOn: p.paidOn,
        createdBy: ctx.userId,
      });
      await settle(tx, ctx, a.documentType, a.documentId, D(a.amount), `Payment ${p.paymentNumber}`);
      applied = applied.plus(a.amount);
    }
    const now = new Date();
    await tx.update(paymentRecords).set({ status: "recorded", appliedAmount: m4(applied), applicationPlan: plan, postedBy: ctx.userId, postedAt: now, updatedAt: now }).where(eq(paymentRecords.id, p.id));
    await logTransition(tx, ctx, doc(p), "approved", "recorded");
    await audit(tx, ctx, { action: "finance.payment_record.posted", entityType: "payment_record", entityId: p.id, entityNumber: p.paymentNumber, siteId: p.siteId, after: { amount: p.amount, applied: m4(applied), unapplied: m4(available.minus(applied)), applications: plan } });
    const result = { applied: m4(applied), unapplied: m4(available.minus(applied)) };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
    return result;
  });
}

/** Reverses a recorded payment and every application (restricted, §2.5 cascade). */
export async function voidPayment(ctx: AuthContext, id: string, input: { reason: string; password?: string | null }) {
  ctx.require("finance.payment_record.void");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.payment_record.void");
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    can(ctx, "finance.payment_record.void", p.siteId);
    if (p.status !== "recorded") throw new DomainError("state", `${label(p)} is ${PAYMENT_STATUS_LABEL[p.status].toLowerCase()}; only a recorded (not reconciled) payment can be voided.`);
    await reverseDocumentPosting(tx, ctx, "payment_record", p.id, reason);
    const apps = await tx.select().from(paymentApplications).where(eq(paymentApplications.paymentRecordId, p.id)).orderBy(asc(paymentApplications.createdAt));
    const reversed = new Set(apps.filter((a) => a.reversalOfId).map((a) => a.reversalOfId));
    const today = businessDate();
    for (const a of apps.filter((x) => !x.reversalOfId && !reversed.has(x.id))) {
      await tx.insert(paymentApplications).values({
        organizationId: ctx.organizationId,
        siteId: a.siteId,
        paymentRecordId: p.id,
        invoiceId: a.invoiceId,
        supplierBillId: a.supplierBillId,
        expenseClaimId: a.expenseClaimId,
        appliedAmount: m4(D(a.appliedAmount).neg()),
        currency: a.currency,
        appliedOn: today,
        reversalOfId: a.id,
        createdBy: ctx.userId,
      });
      const type: TargetType = a.invoiceId ? "invoice" : a.supplierBillId ? "supplier_bill" : "expense_claim";
      await settle(tx, ctx, type, (a.invoiceId ?? a.supplierBillId ?? a.expenseClaimId)!, D(a.appliedAmount).neg(), `Payment ${p.paymentNumber} voided: ${reason}`);
    }
    const now = new Date();
    await tx.update(paymentRecords).set({ status: "voided", appliedAmount: "0", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(paymentRecords.id, p.id));
    await logTransition(tx, ctx, doc(p), "recorded", "voided", reason);
    await audit(tx, ctx, { action: "finance.payment_record.reversed", entityType: "payment_record", entityId: p.id, entityNumber: p.paymentNumber, siteId: p.siteId, reason, before: { status: p.status, applied: p.appliedAmount }, after: { status: "voided", applicationsReversed: apps.filter((x) => !x.reversalOfId).length } });
    return { status: "voided" };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listPayments(ctx: AuthContext, f: { status?: string; direction?: string } = {}) {
  ctx.require("finance.payment_record.view");
  const where = [eq(paymentRecords.organizationId, ctx.organizationId), visibleWhere(ctx)];
  if (f.status && PAYMENT_STATUS_LABEL[f.status]) where.push(eq(paymentRecords.status, f.status));
  if (f.direction === "inbound" || f.direction === "outbound") where.push(eq(paymentRecords.direction, f.direction));
  const rows = await db
    .select({ p: paymentRecords, customerName: customers.name, supplierName: suppliers.name, claimantName: users.displayName })
    .from(paymentRecords)
    .leftJoin(customers, eq(customers.id, paymentRecords.customerId))
    .leftJoin(suppliers, eq(suppliers.id, paymentRecords.supplierId))
    .leftJoin(users, eq(users.id, paymentRecords.claimantUserId))
    .where(and(...where))
    .orderBy(desc(paymentRecords.paidOn), desc(paymentRecords.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r.p, counterpartyName: r.customerName ?? r.supplierName ?? r.claimantName ?? "—", unapplied: m4(D(r.p.amount).plus(r.p.withheldAmount).minus(r.p.appliedAmount)) }));
}

export async function getPayment(ctx: AuthContext, id: string) {
  ctx.require("finance.payment_record.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Payment not found in your sites.");
  const [row] = await db
    .select({ p: paymentRecords, customerName: customers.name, supplierName: suppliers.name, claimantName: users.displayName })
    .from(paymentRecords)
    .leftJoin(customers, eq(customers.id, paymentRecords.customerId))
    .leftJoin(suppliers, eq(suppliers.id, paymentRecords.supplierId))
    .leftJoin(users, eq(users.id, paymentRecords.claimantUserId))
    .where(and(eq(paymentRecords.id, id), eq(paymentRecords.organizationId, ctx.organizationId), visibleWhere(ctx)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Payment not found in your sites.");
  const p = row.p;
  if (p.siteId) ctx.requireSite(p.siteId);
  const apps = await db
    .select({ a: paymentApplications, invoiceNumber: invoices.invoiceNumber, billNumber: supplierBills.billNumber, claimNumber: expenseClaims.claimNumber })
    .from(paymentApplications)
    .leftJoin(invoices, eq(invoices.id, paymentApplications.invoiceId))
    .leftJoin(supplierBills, eq(supplierBills.id, paymentApplications.supplierBillId))
    .leftJoin(expenseClaims, eq(expenseClaims.id, paymentApplications.expenseClaimId))
    .where(eq(paymentApplications.paymentRecordId, p.id))
    .orderBy(asc(paymentApplications.createdAt));
  const progress: Progress | null = ["submitted", "approved"].includes(p.status) ? await approvalProgress(db, ctx.organizationId, { recordType: "payment_record", recordId: p.id, siteId: p.siteId, basis: { amount: p.amount } }) : null;
  const open = ["draft", "submitted", "approved"].includes(p.status) ? await openDocumentsFor(db, ctx, p) : [];
  const oldestFirst = await getSetting(db, ctx.organizationId, "finance.payment.apply_oldest_first");
  const preview = ["draft", "submitted", "approved"].includes(p.status) ? (p.applicationPlan?.length ? p.applicationPlan : oldestFirst ? allocateOldestFirst(open, D(p.amount).plus(p.withheldAmount)) : []) : [];
  return {
    payment: { ...p, unapplied: m4(D(p.amount).plus(p.withheldAmount).minus(p.appliedAmount)) },
    counterpartyName: row.customerName ?? row.supplierName ?? row.claimantName ?? "—",
    counterpartyKind: p.customerId ? "customer" : p.supplierId ? "supplier" : "claimant",
    applications: apps.map((a) => ({ ...a.a, documentNumber: a.invoiceNumber ?? a.billNumber ?? a.claimNumber, documentHref: a.a.invoiceId ? `/finance/invoices/${a.a.invoiceId}` : a.a.supplierBillId ? `/finance/bills/${a.a.supplierBillId}` : `/finance/expenses/${a.a.expenseClaimId}` })),
    preview: preview.map((x) => ({ ...x, number: open.find((o) => o.documentId === x.documentId)?.number ?? "—" })),
    progress,
    canApprove: p.status === "submitted" && canDecide(ctx, "payment_record", progress, p.submittedAt, [p.createdBy, p.submittedBy]),
    posterBlocked: p.status === "approved" && !!progress && !progress.posterMayEqualApprover && progress.approvers.some((u) => ctx.sodConflict(u)),
    decisions: await decisionsOf(db, ctx.organizationId, "payment_record", p.id),
    names: Object.fromEntries(await namesOf(db, [p.createdBy, p.submittedBy, p.approvedBy, p.postedBy, p.voidedBy])),
    postings: await postingsOf(db, ctx.organizationId, "payment_record", [p.id]),
    history: await transitionsOf(db, "payment_record", p.id),
  };
}

/** Counterparty options for the payment form (customers and suppliers with open documents, claimants with posted claims). */
export async function paymentFormOptions(ctx: AuthContext) {
  ctx.require("finance.payment_record.create");
  if (!ctx.allowedSiteIds.length) return { customers: [], suppliers: [], claimants: [] };
  const cust = await db
    .selectDistinct({ id: customers.id, code: customers.code, name: customers.name })
    .from(customers)
    .innerJoin(invoices, eq(invoices.customerId, customers.id))
    .where(and(eq(customers.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds), inArray(invoices.status, ["issued", "partially_paid"])))
    .orderBy(asc(customers.name));
  const supp = await db
    .selectDistinct({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
    .from(suppliers)
    .innerJoin(supplierBills, eq(supplierBills.supplierId, suppliers.id))
    .where(and(eq(suppliers.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds), inArray(supplierBills.status, ["posted", "partially_paid"])))
    .orderBy(asc(suppliers.name));
  const claim = await db
    .selectDistinct({ id: users.id, name: users.displayName })
    .from(users)
    .innerJoin(expenseClaims, eq(expenseClaims.claimantUserId, users.id))
    .where(and(eq(users.organizationId, ctx.organizationId), inArray(expenseClaims.siteId, ctx.allowedSiteIds), eq(expenseClaims.status, "posted")))
    .orderBy(asc(users.displayName));
  const open: Record<string, OpenDocument[]> = {};
  for (const c of cust) open[c.id] = await openDocumentsFor(db, ctx, { customerId: c.id });
  for (const s of supp) open[s.id] = await openDocumentsFor(db, ctx, { supplierId: s.id });
  for (const u of claim) open[u.id] = await openDocumentsFor(db, ctx, { claimantUserId: u.id });
  return { customers: cust, suppliers: supp, claimants: claim, open, today: businessDate() };
}

/** Payables overview for the finance landing page. */
export async function payablesSummary(ctx: AuthContext) {
  if (!ctx.can("finance.supplier_bill.view") || !ctx.allowedSiteIds.length) return null;
  const [r] = await db
    .select({ open: sql<string>`coalesce(sum(${supplierBills.totalAmount} - ${supplierBills.paidAmount}), 0)::text`, n: sql<number>`count(*)::int`, overdue: sql<string>`coalesce(sum(case when ${supplierBills.dueDate} < ${businessDate()} then ${supplierBills.totalAmount} - ${supplierBills.paidAmount} else 0 end), 0)::text` })
    .from(supplierBills)
    .where(and(eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds), inArray(supplierBills.status, ["posted", "partially_paid"]), eq(supplierBills.billKind, "bill")));
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(supplierBills).where(and(eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds), eq(supplierBills.status, "disputed")));
  return { outstanding: m4(r?.open ?? 0), overdue: m4(r?.overdue ?? 0), openCount: r?.n ?? 0, disputed: d?.n ?? 0 };
}

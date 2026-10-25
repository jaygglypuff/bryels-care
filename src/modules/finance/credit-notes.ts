import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { creditNotes, customerReturnLines, customerReturns, customers, invoiceLines, invoices } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { approvalProgress, assertPosterAllowed, canDecide, decisionsOf, evaluateAtSubmit, notifyNextStep, recordDecision, type Progress } from "./approvals";
import { INVOICE_STATUS_LABEL, openAmountOf, revertOrderInvoiced } from "./invoices";
import { D, businessDate, isUuid, logTransition, m4, money, namesOf, openPeriodForPosting, parseAmount, postFinancial, postingsOf, requireReason, reverseDocumentPosting, settlementState, transitionsOf } from "./shared";

/**
 * Credit notes (US-6-12, docs/modules/finance.md §3.1 R-07/R-08). A credit note reduces what a customer
 * owes on one issued invoice: a return (from an approved W3F customer return), a pricing error, or the void
 * of the whole open amount. draft → submitted → approved → issued → applied; draft | submitted | approved →
 * cancelled; issued | applied → voided (reversal). Issue (`finance.credit_note.post`, restricted) posts the
 * `credit_note` row, allocates the CN number and applies the amount to the invoice in the same transaction
 * (invoice credited_amount, status partially_paid/paid, or voided for a full void). The amount never exceeds
 * the invoice's open amount (422 OVER_APPLICATION); refunds of overpaid invoices are Phase 8 (`finance.refund.*`).
 */

export type CreditNoteRow = typeof creditNotes.$inferSelect;

export const CREDIT_NOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  issued: "Issued",
  applied: "Applied",
  voided: "Voided",
  cancelled: "Cancelled",
};

/** Approved-or-later customer return states (V-FIN-SRC for return-based notes). */
const RETURN_APPROVED_STATES = ["approved", "received", "inspected", "closed"] as const;

const label = (c: Pick<CreditNoteRow, "creditNoteNumber">) => (c.creditNoteNumber ? `Credit note ${c.creditNoteNumber}` : "This credit note draft");
const doc = (c: CreditNoteRow) => ({ type: "credit_note" as const, id: c.id, siteId: c.siteId, label: label(c) });

async function lockCreditNote(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Credit note not found in your sites.");
  const [c] = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.id, id), eq(creditNotes.organizationId, ctx.organizationId), inArray(creditNotes.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!c) throw new DomainError("not_found", "Credit note not found in your sites.");
  ctx.requireSite(c.siteId);
  return c;
}

async function lockInvoiceRow(tx: Tx, ctx: AuthContext, invoiceId: string) {
  const [i] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!i) throw new DomainError("not_found", "Invoice not found in your sites.");
  return i;
}

/** Credit already reserved by live notes of the invoice that are not applied yet (drafts to approved). */
async function pendingCredits(tx: Tx, invoiceId: string, excludeId?: string) {
  const where = [eq(creditNotes.invoiceId, invoiceId), inArray(creditNotes.status, ["draft", "submitted", "approved"])];
  if (excludeId) where.push(sql`${creditNotes.id} <> ${excludeId}`);
  const [r] = await tx.select({ v: sql<string>`coalesce(sum(${creditNotes.amount}), 0)::text` }).from(creditNotes).where(and(...where));
  return D(r?.v ?? 0);
}

export async function creditNoteReasons(organizationId: string) {
  return getSetting(db, organizationId, "finance.credit_note.reasons");
}

/** Suggested gross credit for a customer return: returned qty × the invoice line's gross unit amount per product. */
async function returnValue(tx: Tx, invoiceId: string, returnId: string) {
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  const ret = await tx.select().from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, returnId));
  let total = D(0);
  for (const r of ret) {
    const l = lines.find((x) => x.productId === r.productId);
    if (!l || D(l.qty).lte(0)) continue;
    total = total.plus(D(l.totalAmount).div(l.qty).times(r.qtyBase));
  }
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export type CreateCreditNoteInput = {
  invoiceId: string;
  amount?: string | null;
  customerReturnId?: string | null;
  reasonCode: string;
  reason: string;
  voidsInvoice?: boolean;
  idempotencyKey?: string | null;
};

/** R-07: credit note draft against an issued invoice (optionally from an approved customer return). */
export async function createCreditNote(ctx: AuthContext, input: CreateCreditNoteInput) {
  ctx.require("finance.credit_note.create");
  if (!isUuid(input.invoiceId)) throw new DomainError("not_found", "Invoice not found in your sites.");
  const reason = requireReason(input.reason);
  const reasons = await creditNoteReasons(ctx.organizationId);
  if (!reasons.some((r) => r.code === input.reasonCode)) throw new DomainError("validation", "Choose a reason.", { field: "reasonCode" });
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ creditNoteId: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.credit_note.create", { ...input, idempotencyKey: undefined });
      if (replay) return replay.replay;
    }
    const inv = await lockInvoiceRow(tx, ctx, input.invoiceId);
    ctx.requireAt("finance.credit_note.create", inv.siteId);
    if (!["issued", "partially_paid"].includes(inv.status)) {
      throw new DomainError("validation", `SOURCE_NOT_POSTABLE: the invoice is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; a credit note needs an issued invoice with an open amount.`, { code: "SOURCE_NOT_POSTABLE", field: "invoiceId" });
    }
    const available = openAmountOf(inv).minus(await pendingCredits(tx, inv.id));
    let returnId: string | null = null;
    if (input.customerReturnId) {
      if (!isUuid(input.customerReturnId)) throw new DomainError("validation", "Choose a valid customer return.", { field: "customerReturnId" });
      const [r] = await tx.select().from(customerReturns).where(and(eq(customerReturns.id, input.customerReturnId), eq(customerReturns.organizationId, ctx.organizationId))).limit(1);
      if (!r || r.customerId !== inv.customerId || r.shipmentId !== inv.shipmentId) throw new DomainError("validation", "The return must be of this invoice's shipment and customer.", { field: "customerReturnId" });
      if (!(RETURN_APPROVED_STATES as readonly string[]).includes(r.status)) throw new DomainError("validation", `SOURCE_NOT_POSTABLE: return ${r.returnNumber} is ${r.status}; a credit needs an approved return.`, { code: "SOURCE_NOT_POSTABLE", field: "customerReturnId" });
      const [other] = await tx.select({ id: creditNotes.id }).from(creditNotes).where(and(eq(creditNotes.customerReturnId, r.id), notInArray(creditNotes.status, ["cancelled", "voided"]))).limit(1);
      if (other) throw new DomainError("conflict", "DUPLICATE_DOCUMENT: this return already has a credit note.", { code: "DUPLICATE_DOCUMENT" });
      returnId = r.id;
    }
    let amount: Decimal;
    const voids = !!input.voidsInvoice;
    if (voids) {
      if (D(inv.paidAmount).gt(0) || D(inv.creditedAmount).gt(0)) throw new DomainError("validation", "A full void is only possible while nothing is applied to the invoice; credit the open amount instead.", { field: "voidsInvoice" });
      amount = openAmountOf(inv);
    } else if (input.amount) amount = parseAmount(input.amount, "amount");
    else if (returnId) amount = await returnValue(tx, inv.id, returnId);
    else throw new DomainError("validation", "Enter the amount to credit.", { field: "amount" });
    if (amount.lte(0)) throw new DomainError("validation", "The amount must be more than zero.", { field: "amount" });
    if (amount.gt(available)) throw new DomainError("validation", `OVER_APPLICATION: the invoice has ${money(available)} open (after other pending credits); the credit cannot be larger.`, { code: "OVER_APPLICATION", field: "amount" });
    // Tax share pro rata to the invoice (A-W4B-07, for accountant review).
    const taxShare = D(inv.totalAmount).gt(0) ? amount.times(inv.taxAmount).div(inv.totalAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : D(0);
    const [cn] = await tx
      .insert(creditNotes)
      .values({
        organizationId: ctx.organizationId,
        siteId: inv.siteId,
        invoiceId: inv.id,
        customerId: inv.customerId,
        customerReturnId: returnId,
        reasonCode: input.reasonCode,
        reason,
        amount: m4(amount),
        taxAmount: m4(taxShare),
        currency: inv.currency,
        voidsInvoice: voids,
        createdBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await logTransition(tx, ctx, doc(cn), null, "draft");
    await audit(tx, ctx, { action: "finance.credit_note.created", entityType: "credit_note", entityId: cn.id, entityNumber: inv.invoiceNumber, siteId: inv.siteId, reason, after: { invoiceNumber: inv.invoiceNumber, amount: cn.amount, voidsInvoice: voids, customerReturnId: returnId } });
    const result = { creditNoteId: cn.id };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { ...input, idempotencyKey: undefined }, result);
    return result;
  });
}

export async function submitCreditNote(ctx: AuthContext, id: string) {
  ctx.require("finance.credit_note.submit");
  return db.transaction(async (tx) => {
    const cn = await lockCreditNote(tx, ctx, id);
    ctx.requireAt("finance.credit_note.submit", cn.siteId);
    if (cn.status !== "draft") throw new DomainError("state", `${label(cn)} is ${CREDIT_NOTE_STATUS_LABEL[cn.status].toLowerCase()}; only a draft can be submitted.`);
    const ev = await evaluateAtSubmit(tx, ctx, { recordType: "credit_note", recordId: cn.id, recordNumber: cn.id.slice(0, 8), siteId: cn.siteId, basis: { amount: cn.amount } });
    const to = ev.steps.length ? "submitted" : "approved";
    const now = new Date();
    await tx.update(creditNotes).set({ status: to, submittedBy: ctx.userId, submittedAt: now, ...(to === "approved" ? { approvedAt: now } : {}), updatedAt: now }).where(eq(creditNotes.id, cn.id));
    await logTransition(tx, ctx, doc(cn), "draft", "submitted");
    if (to === "approved") await logTransition(tx, ctx, doc(cn), "submitted", "approved", "No approval rule applies");
    else await notifyNextStep(tx, ctx, ev.steps[0] ?? null, { siteId: cn.siteId, kind: "finance.credit_note.approval", title: "Credit note waiting for approval", body: `A credit of ${money(cn.amount)} ${cn.currency} waits for approval.`, entityType: "credit_note", entityId: cn.id, link: `/finance/credit-notes/${cn.id}` });
    await audit(tx, ctx, { action: "finance.credit_note.submitted", entityType: "credit_note", entityId: cn.id, siteId: cn.siteId, after: { status: to } });
    return { status: to };
  });
}

export async function decideCreditNote(ctx: AuthContext, id: string, input: { decision: "approved" | "returned"; note?: string | null }) {
  ctx.require("finance.credit_note.approve");
  return db.transaction(async (tx) => {
    const cn = await lockCreditNote(tx, ctx, id);
    if (cn.status !== "submitted") throw new DomainError("state", `${label(cn)} is ${CREDIT_NOTE_STATUS_LABEL[cn.status].toLowerCase()}; only a submitted credit note can be decided.`);
    const r = await recordDecision(tx, ctx, {
      recordType: "credit_note",
      recordId: cn.id,
      recordNumber: cn.id.slice(0, 8),
      siteId: cn.siteId,
      basis: { amount: cn.amount },
      pendingSince: cn.submittedAt,
      excludedUserIds: [cn.createdBy, cn.submittedBy],
      decision: input.decision,
      note: input.note,
    });
    const now = new Date();
    if (input.decision === "returned") {
      await tx.update(creditNotes).set({ status: "draft", submittedBy: null, submittedAt: null, updatedAt: now }).where(eq(creditNotes.id, cn.id));
      await logTransition(tx, ctx, doc(cn), "submitted", "draft", input.note ?? null);
    } else if (r.final) {
      await tx.update(creditNotes).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null, updatedAt: now }).where(eq(creditNotes.id, cn.id));
      await logTransition(tx, ctx, doc(cn), "submitted", "approved", input.note?.trim() || null);
    }
    await audit(tx, ctx, { action: input.decision === "approved" ? "finance.credit_note.approved" : "finance.credit_note.returned", entityType: "credit_note", entityId: cn.id, siteId: cn.siteId, reason: input.note?.trim() || null, after: { final: r.final, step: r.step?.step ?? 1 } });
    return { approved: input.decision === "approved" && r.final };
  });
}

export async function cancelCreditNote(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.credit_note.create");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const cn = await lockCreditNote(tx, ctx, id);
    if (!["draft", "submitted", "approved"].includes(cn.status)) throw new DomainError("state", `${label(cn)} is ${CREDIT_NOTE_STATUS_LABEL[cn.status].toLowerCase()}; an issued credit note is voided, not cancelled.`);
    await tx.update(creditNotes).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(creditNotes.id, cn.id));
    await logTransition(tx, ctx, doc(cn), cn.status, "cancelled", why);
    await audit(tx, ctx, { action: "finance.credit_note.cancelled", entityType: "credit_note", entityId: cn.id, siteId: cn.siteId, reason: why });
    return { status: "cancelled" };
  });
}

/** Issue = post + apply to the invoice (restricted). */
export async function issueCreditNote(ctx: AuthContext, id: string, input: { password?: string | null; idempotencyKey?: string | null; now?: Date } = {}) {
  ctx.require("finance.credit_note.post");
  await requireReauthentication(ctx, input.password, "finance.credit_note.post");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ creditNoteNumber: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.credit_note.post", { id });
      if (replay) return replay.replay;
    }
    const cn = await lockCreditNote(tx, ctx, id);
    ctx.requireAt("finance.credit_note.post", cn.siteId);
    if (cn.status !== "approved") throw new DomainError("state", `${label(cn)} is ${CREDIT_NOTE_STATUS_LABEL[cn.status].toLowerCase()}; only an approved credit note can be issued.`);
    await assertPosterAllowed(tx, ctx, { recordType: "credit_note", recordId: cn.id, siteId: cn.siteId, basis: { amount: cn.amount } });
    const inv = await lockInvoiceRow(tx, ctx, cn.invoiceId);
    if (!["issued", "partially_paid"].includes(inv.status)) throw new DomainError("state", `The invoice is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; the credit can no longer be applied.`);
    if (D(cn.amount).gt(openAmountOf(inv))) throw new DomainError("validation", `OVER_APPLICATION: the invoice has only ${money(openAmountOf(inv))} open now.`, { code: "OVER_APPLICATION" });
    if (cn.voidsInvoice && (D(inv.paidAmount).gt(0) || D(inv.creditedAmount).gt(0))) throw new DomainError("conflict", "Something was applied to the invoice since; a full void is no longer possible.");
    const issueDate = businessDate(now);
    await openPeriodForPosting(tx, ctx.organizationId, issueDate);
    const number = await nextNumber(tx, ctx.organizationId, "CN", now);
    await postFinancial(tx, ctx, {
      siteId: cn.siteId,
      postingType: "credit_note",
      documentType: "credit_note",
      documentId: cn.id,
      documentNumber: number,
      postingDate: issueDate,
      amount: cn.amount,
      taxAmount: cn.taxAmount,
      currency: cn.currency,
      direction: "credit",
      customerId: cn.customerId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await tx.update(creditNotes).set({ status: "applied", creditNoteNumber: number, issueDate, postedBy: ctx.userId, postedAt: now, updatedAt: now }).where(eq(creditNotes.id, cn.id));
    const cnDoc = { ...doc(cn), label: `Credit note ${number}` };
    await logTransition(tx, ctx, cnDoc, "approved", "issued");
    await logTransition(tx, ctx, cnDoc, "issued", "applied", `Applied to invoice ${inv.invoiceNumber}`);
    const credited = D(inv.creditedAmount).plus(cn.amount);
    const invDoc = { type: "invoice" as const, id: inv.id, siteId: inv.siteId, label: `Invoice ${inv.invoiceNumber}` };
    if (cn.voidsInvoice) {
      await tx.update(invoices).set({ creditedAmount: m4(credited), status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: `Voided by credit note ${number}: ${cn.reason}`, voidedByCreditNoteId: cn.id, updatedAt: now }).where(eq(invoices.id, inv.id));
      await logTransition(tx, ctx, invDoc, inv.status, "voided", `Credit note ${number}`);
      await revertOrderInvoiced(tx, ctx, inv.salesOrderId, `Invoice ${inv.invoiceNumber} voided by credit note ${number}`);
      await audit(tx, ctx, { action: "finance.invoice.reversed", entityType: "invoice", entityId: inv.id, entityNumber: inv.invoiceNumber, siteId: inv.siteId, reason: cn.reason, after: { status: "voided", creditNoteNumber: number } });
    } else {
      const to = settlementState("issued", inv.totalAmount, D(inv.paidAmount).plus(credited));
      await tx.update(invoices).set({ creditedAmount: m4(credited), status: to, updatedAt: now }).where(eq(invoices.id, inv.id));
      if (to !== inv.status) await logTransition(tx, ctx, invDoc, inv.status, to, `Credit note ${number}`);
    }
    await audit(tx, ctx, { action: "finance.credit_note.posted", entityType: "credit_note", entityId: cn.id, entityNumber: number, siteId: cn.siteId, after: { creditNoteNumber: number, invoiceNumber: inv.invoiceNumber, amount: cn.amount, voidsInvoice: cn.voidsInvoice } });
    const result = { creditNoteNumber: number };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
    return result;
  });
}

/** Reverses an applied credit note (restricted): the invoice's open amount comes back. A void-credit cannot be reversed. */
export async function voidCreditNote(ctx: AuthContext, id: string, input: { reason: string; password?: string | null }) {
  ctx.require("finance.credit_note.void");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.credit_note.void");
  return db.transaction(async (tx) => {
    const cn = await lockCreditNote(tx, ctx, id);
    ctx.requireAt("finance.credit_note.void", cn.siteId);
    if (!["issued", "applied"].includes(cn.status)) throw new DomainError("state", `${label(cn)} is ${CREDIT_NOTE_STATUS_LABEL[cn.status].toLowerCase()}; only an issued credit note can be voided.`);
    if (cn.voidsInvoice) throw new DomainError("conflict", "This credit note voided its invoice. Invoice the shipment again instead of reversing the credit.");
    const inv = await lockInvoiceRow(tx, ctx, cn.invoiceId);
    await reverseDocumentPosting(tx, ctx, "credit_note", cn.id, reason);
    const now = new Date();
    await tx.update(creditNotes).set({ status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(creditNotes.id, cn.id));
    await logTransition(tx, ctx, doc(cn), cn.status, "voided", reason);
    const credited = D(inv.creditedAmount).minus(cn.amount);
    if (!["voided", "closed"].includes(inv.status)) {
      const to = settlementState("issued", inv.totalAmount, D(inv.paidAmount).plus(credited));
      await tx.update(invoices).set({ creditedAmount: m4(credited), status: to, updatedAt: now }).where(eq(invoices.id, inv.id));
      if (to !== inv.status) await logTransition(tx, ctx, { type: "invoice", id: inv.id, siteId: inv.siteId, label: `Invoice ${inv.invoiceNumber}` }, inv.status, to, `Credit note ${cn.creditNoteNumber} voided`);
    }
    await audit(tx, ctx, { action: "finance.credit_note.reversed", entityType: "credit_note", entityId: cn.id, entityNumber: cn.creditNoteNumber, siteId: cn.siteId, reason, before: { status: cn.status }, after: { status: "voided" } });
    return { status: "voided" };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listCreditNotes(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("finance.credit_note.view");
  if (!ctx.allowedSiteIds.length) return [];
  const where = [eq(creditNotes.organizationId, ctx.organizationId), inArray(creditNotes.siteId, ctx.allowedSiteIds)];
  if (f.status && CREDIT_NOTE_STATUS_LABEL[f.status]) where.push(eq(creditNotes.status, f.status));
  const rows = await db
    .select({ cn: creditNotes, customerName: customers.name, invoiceNumber: invoices.invoiceNumber })
    .from(creditNotes)
    .innerJoin(customers, eq(customers.id, creditNotes.customerId))
    .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
    .where(and(...where))
    .orderBy(desc(creditNotes.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r.cn, customerName: r.customerName, invoiceNumber: r.invoiceNumber }));
}

export async function getCreditNote(ctx: AuthContext, id: string) {
  ctx.require("finance.credit_note.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Credit note not found in your sites.");
  const [row] = await db
    .select({ cn: creditNotes, c: customers, i: invoices })
    .from(creditNotes)
    .innerJoin(customers, eq(customers.id, creditNotes.customerId))
    .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
    .where(and(eq(creditNotes.id, id), eq(creditNotes.organizationId, ctx.organizationId), inArray(creditNotes.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Credit note not found in your sites.");
  ctx.requireSite(row.cn.siteId);
  const cn = row.cn;
  const progress: Progress | null = ["submitted", "approved"].includes(cn.status) ? await approvalProgress(db, ctx.organizationId, { recordType: "credit_note", recordId: cn.id, siteId: cn.siteId, basis: { amount: cn.amount } }) : null;
  const [ret] = cn.customerReturnId ? await db.select({ id: customerReturns.id, number: customerReturns.returnNumber, status: customerReturns.status }).from(customerReturns).where(eq(customerReturns.id, cn.customerReturnId)).limit(1) : [];
  const reasons = await creditNoteReasons(ctx.organizationId);
  return {
    creditNote: cn,
    reasonLabel: reasons.find((r) => r.code === cn.reasonCode)?.label ?? cn.reasonCode,
    customer: { id: row.c.id, code: row.c.code, name: row.c.name, address: row.c.shipToAddress },
    invoice: { id: row.i.id, invoiceNumber: row.i.invoiceNumber, status: row.i.status, totalAmount: row.i.totalAmount, openAmount: m4(openAmountOf(row.i)), issueDate: row.i.issueDate },
    customerReturn: ret ?? null,
    progress,
    canApprove: cn.status === "submitted" && canDecide(ctx, "credit_note", progress, cn.submittedAt, [cn.createdBy, cn.submittedBy]),
    posterBlocked: cn.status === "approved" && !!progress && !progress.posterMayEqualApprover && progress.approvers.some((u) => ctx.sodConflict(u)),
    decisions: await decisionsOf(db, ctx.organizationId, "credit_note", cn.id),
    names: Object.fromEntries(await namesOf(db, [cn.createdBy, cn.submittedBy, cn.approvedBy, cn.postedBy, cn.voidedBy])),
    postings: await postingsOf(db, ctx.organizationId, "credit_note", [cn.id]),
    history: await transitionsOf(db, "credit_note", cn.id),
  };
}

/** Approved customer returns of an invoice's shipment without a live credit note (form options). */
export async function creditableReturns(ctx: AuthContext, invoiceId: string) {
  ctx.require("finance.credit_note.create");
  if (!isUuid(invoiceId)) return [];
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds))).limit(1);
  if (!inv) return [];
  return db
    .select({ id: customerReturns.id, returnNumber: customerReturns.returnNumber, status: customerReturns.status })
    .from(customerReturns)
    .where(
      and(
        eq(customerReturns.shipmentId, inv.shipmentId),
        inArray(customerReturns.status, [...RETURN_APPROVED_STATES]),
        sql`not exists (select 1 from ${creditNotes} c where c.customer_return_id = ${customerReturns.id} and c.status not in ('cancelled','voided'))`,
      ),
    )
    .orderBy(asc(customerReturns.returnNumber));
}

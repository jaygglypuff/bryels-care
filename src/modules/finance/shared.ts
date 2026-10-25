import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { DbOrTx, Tx } from "@/db/client";
import { accountingPeriods, financeStateTransitions, financialPostings, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { stateMachine } from "@/modules/inventory";

/**
 * Shared building blocks of the finance services (ADR-020; docs/modules/finance.md §2): money and date
 * helpers, the five document state machines, the transition log, the posting ledger and the open-period
 * check. Every posting runs inside the caller's transaction after the document row lock; the period row is
 * taken FOR SHARE (a lock takes it FOR UPDATE), numbering is the last lock (docs/data-model.md §5.4).
 */

export type FinanceDocumentType = "invoice" | "supplier_bill" | "payment_record" | "credit_note" | "expense_claim";

/* ------------------------------------------------------------------ money and dates */

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
/** Money rounded half-up to 2 decimals (display and document totals; storage is numeric(18,4), A-DM-01). */
export const round2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const money = (v: Decimal.Value) => round2(v).toFixed(2);
/** 4-decimal storage string. */
export const m4 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Today's business date (Asia/Manila, YYYY-MM-DD). */
export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const AMOUNT_RE = /^\d{1,14}(\.\d{1,4})?$/;

/** Parses a positive (or zero, when allowed) money input; field errors name `field`. */
export function parseAmount(v: unknown, field: string, opts: { allowZero?: boolean } = {}): Decimal {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(/,/g, "") : "";
  if (!AMOUNT_RE.test(s)) throw new DomainError("validation", "Enter an amount (up to 4 decimals).", { field });
  const d = new Decimal(s);
  if (d.lt(0) || (!opts.allowZero && d.lte(0))) throw new DomainError("validation", "The amount must be more than zero.", { field });
  return d;
}

export function requireReason(reason: string | null | undefined, field = "reason"): string {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new DomainError("validation", "Give a reason (at least 3 characters).", { field });
  if (r.length > 500) throw new DomainError("validation", "Keep the reason under 500 characters.", { field });
  return r;
}

export const correlationOf = (ctx: AuthContext) => (ctx.correlationId && isUuid(ctx.correlationId) ? ctx.correlationId : uuidv7());

/* ------------------------------------------------------------------ tax arithmetic */

export type TaxedLineInput = { qty: Decimal.Value; unitAmount: Decimal.Value; ratePct: Decimal.Value; inclusive: boolean; rounding: "line" | "document" };
export type TaxedLine = { lineAmount: string; taxAmount: string; totalAmount: string };

/**
 * Line and document amounts (docs/modules/finance.md §2.4 rule 7): the line value is qty × unit amount
 * rounded to 2 decimals; tax per line is rounded to 2 decimals (`line` rounding, default) or kept at
 * 4 decimals and rounded once on the document total (`document` rounding). Inclusive rates take the tax
 * out of the line value (gross × rate / (100 + rate)). Rates come from the reviewed tax configuration.
 */
export function computeTaxedLines(lines: TaxedLineInput[]): { lines: TaxedLine[]; subtotal: string; tax: string; total: string } {
  // Values: inclusive lines carry gross values, exclusive lines net values.
  let grossIncl = new Decimal(0);
  let netExcl = new Decimal(0);
  const taxLine = { incl: new Decimal(0), excl: new Decimal(0) };
  const taxDoc = { incl: new Decimal(0), excl: new Decimal(0) };
  const out: TaxedLine[] = lines.map((l) => {
    const value = round2(D(l.qty).times(l.unitAmount));
    const rate = D(l.ratePct);
    const rawTax = l.inclusive ? value.times(rate).div(new Decimal(100).plus(rate)) : value.times(rate).div(100);
    const tax = l.rounding === "line" ? round2(rawTax) : rawTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const side = l.inclusive ? "incl" : "excl";
    if (l.inclusive) grossIncl = grossIncl.plus(value);
    else netExcl = netExcl.plus(value);
    if (l.rounding === "line") taxLine[side] = taxLine[side].plus(tax);
    else taxDoc[side] = taxDoc[side].plus(tax);
    const net = l.inclusive ? value.minus(tax) : value;
    return { lineAmount: m4(net), taxAmount: m4(tax), totalAmount: m4(net.plus(tax)) };
  });
  const docIncl = round2(taxDoc.incl);
  const docExcl = round2(taxDoc.excl);
  const tax = taxLine.incl.plus(taxLine.excl).plus(docIncl).plus(docExcl);
  const total = grossIncl.plus(netExcl).plus(taxLine.excl).plus(docExcl);
  return { lines: out, subtotal: m4(total.minus(tax)), tax: m4(tax), total: m4(total) };
}

/* ------------------------------------------------------------------ state machines */

export const invoiceMachine = stateMachine<"draft" | "submitted" | "approved" | "issued" | "partially_paid" | "paid" | "closed" | "voided" | "cancelled">("invoice", {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["issued", "cancelled"],
  issued: ["partially_paid", "paid", "voided"],
  partially_paid: ["paid", "issued", "voided"],
  paid: ["partially_paid", "issued", "closed"],
  closed: [],
  voided: [],
  cancelled: [],
});

export const creditNoteMachine = stateMachine<"draft" | "submitted" | "approved" | "issued" | "applied" | "voided" | "cancelled">("credit_note", {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["issued", "cancelled"],
  issued: ["applied", "voided"],
  applied: ["voided"],
  voided: [],
  cancelled: [],
});

export const supplierBillMachine = stateMachine<"draft" | "submitted" | "disputed" | "approved" | "posted" | "partially_paid" | "paid" | "closed" | "voided" | "cancelled">("supplier_bill", {
  draft: ["submitted", "disputed", "approved", "cancelled"],
  submitted: ["approved", "draft", "disputed", "cancelled"],
  disputed: ["submitted", "approved", "draft", "cancelled"],
  approved: ["posted", "cancelled"],
  posted: ["partially_paid", "paid", "voided"],
  partially_paid: ["paid", "posted", "voided"],
  paid: ["partially_paid", "posted", "closed"],
  closed: [],
  voided: [],
  cancelled: [],
});

export const paymentMachine = stateMachine<"draft" | "submitted" | "approved" | "recorded" | "reconciled" | "voided" | "cancelled">("payment_record", {
  draft: ["submitted", "approved", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["recorded", "cancelled"],
  recorded: ["reconciled", "voided"],
  reconciled: [],
  voided: [],
  cancelled: [],
});

export const expenseClaimMachine = stateMachine<"draft" | "submitted" | "approved" | "rejected" | "posted" | "paid" | "cancelled" | "voided">("expense_claim", {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "draft", "cancelled"],
  approved: ["posted", "cancelled"],
  rejected: [],
  posted: ["paid", "voided"],
  paid: ["posted"],
  cancelled: [],
  voided: [],
});

export const MACHINES = {
  invoice: invoiceMachine,
  credit_note: creditNoteMachine,
  supplier_bill: supplierBillMachine,
  payment_record: paymentMachine,
  expense_claim: expenseClaimMachine,
} as const;

/** Writes one transition row (append-only) after asserting the move is in the machine's table. */
export async function logTransition(
  tx: Tx,
  ctx: AuthContext,
  doc: { type: FinanceDocumentType; id: string; siteId: string | null; label: string },
  from: string | null,
  to: string,
  reason?: string | null,
) {
  if (from !== null) (MACHINES[doc.type] as { assert: (f: string, t: never, l: string) => void }).assert(from, to as never, doc.label);
  await tx.insert(financeStateTransitions).values({
    organizationId: ctx.organizationId,
    siteId: doc.siteId,
    documentType: doc.type,
    documentId: doc.id,
    fromState: from,
    toState: to,
    actorId: ctx.userId,
    reason: reason ?? null,
    correlationId: correlationOf(ctx),
  });
}

export async function transitionsOf(q: DbOrTx, documentType: FinanceDocumentType, documentId: string) {
  return q
    .select({ t: financeStateTransitions, name: users.displayName })
    .from(financeStateTransitions)
    .innerJoin(users, eq(users.id, financeStateTransitions.actorId))
    .where(and(eq(financeStateTransitions.documentType, documentType), eq(financeStateTransitions.documentId, documentId)))
    .orderBy(financeStateTransitions.occurredAt)
    .then((rows) => rows.map((r) => ({ ...r.t, actorName: r.name })));
}

/* ------------------------------------------------------------------ periods */

export const periodCodeOf = (date: string) => date.slice(0, 7);

function periodBounds(code: string) {
  const [y, m] = code.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${code}-01`, end: `${code}-${String(last).padStart(2, "0")}` };
}

/** Creates the calendar-month period of `date` when it does not exist yet (A-FIN-02), returns its row. */
export async function ensurePeriod(tx: DbOrTx, organizationId: string, date: string) {
  if (!DATE_RE.test(date)) throw new DomainError("validation", "Choose a valid date.", { field: "date" });
  const code = periodCodeOf(date);
  const b = periodBounds(code);
  await tx.insert(accountingPeriods).values({ organizationId, periodCode: code, periodStart: b.start, periodEnd: b.end }).onConflictDoNothing();
  const [p] = await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.organizationId, organizationId), eq(accountingPeriods.periodCode, code))).limit(1);
  return p;
}

/**
 * V-FIN-PERIOD: the period of `date` must be open. Takes the period row FOR SHARE, so a concurrent lock
 * waits for this posting (and a posting started after the lock sees `locked`). 409 PERIOD_LOCKED.
 */
export async function openPeriodForPosting(tx: Tx, organizationId: string, date: string) {
  await ensurePeriod(tx, organizationId, date);
  const [p] = await tx
    .select()
    .from(accountingPeriods)
    .where(and(eq(accountingPeriods.organizationId, organizationId), eq(accountingPeriods.periodCode, periodCodeOf(date))))
    .for("share")
    .limit(1);
  if (p.status !== "open") {
    throw new DomainError("conflict", `PERIOD_LOCKED: the accounting period ${p.periodCode} is locked, so nothing can be posted or reversed into it. Ask finance to unlock it (two approvals) or use a date in an open period.`, {
      code: "PERIOD_LOCKED",
      period: p.periodCode,
    });
  }
  return p;
}

/* ------------------------------------------------------------------ ledger */

export type PostingInput = {
  siteId: string | null;
  postingType: "invoice_issue" | "bill_post" | "payment" | "credit_note" | "expense";
  documentType: FinanceDocumentType;
  documentId: string;
  documentNumber: string;
  postingDate: string;
  amount: Decimal.Value;
  taxAmount?: Decimal.Value;
  currency: string;
  direction: "debit" | "credit";
  customerId?: string | null;
  supplierId?: string | null;
  counterpartyUserId?: string | null;
  idempotencyKey?: string | null;
};

/** Writes one posting row in an open period (the caller holds the document row lock). */
export async function postFinancial(tx: Tx, ctx: AuthContext, p: PostingInput) {
  const period = await openPeriodForPosting(tx, ctx.organizationId, p.postingDate);
  const [row] = await tx
    .insert(financialPostings)
    .values({
      organizationId: ctx.organizationId,
      siteId: p.siteId,
      postingType: p.postingType,
      documentType: p.documentType,
      documentId: p.documentId,
      documentNumber: p.documentNumber,
      accountingPeriodId: period.id,
      postingDate: p.postingDate,
      amount: m4(p.amount),
      taxAmount: m4(p.taxAmount ?? 0),
      currency: p.currency,
      direction: p.direction,
      customerId: p.customerId ?? null,
      supplierId: p.supplierId ?? null,
      counterpartyUserId: p.counterpartyUserId ?? null,
      idempotencyKey: p.idempotencyKey ?? null,
      correlationId: correlationOf(ctx),
      postedBy: ctx.userId,
    })
    .returning();
  return { posting: row, period };
}

/**
 * Reverses the live (not yet reversed) posting of a document: a `reversal` row with the opposite
 * direction, dated today in the current open period (A-FIN-24: the original period stays on the original
 * row). One reversal per posting (unique index). Returns the reversal row.
 */
export async function reverseDocumentPosting(tx: Tx, ctx: AuthContext, documentType: FinanceDocumentType, documentId: string, reason: string, now = new Date()) {
  const rows = await tx
    .select()
    .from(financialPostings)
    .where(and(eq(financialPostings.organizationId, ctx.organizationId), eq(financialPostings.documentType, documentType), eq(financialPostings.documentId, documentId)));
  const reversedIds = new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId));
  const live = rows.filter((r) => r.postingType !== "reversal" && !reversedIds.has(r.id));
  if (live.length !== 1) throw new DomainError("state", "This document has no posting that can be reversed.");
  const original = live[0];
  const date = businessDate(now);
  const period = await openPeriodForPosting(tx, ctx.organizationId, date);
  const [row] = await tx
    .insert(financialPostings)
    .values({
      organizationId: ctx.organizationId,
      siteId: original.siteId,
      postingType: "reversal",
      documentType,
      documentId,
      documentNumber: original.documentNumber,
      accountingPeriodId: period.id,
      postingDate: date,
      amount: original.amount,
      taxAmount: original.taxAmount,
      currency: original.currency,
      direction: original.direction === "debit" ? "credit" : "debit",
      customerId: original.customerId,
      supplierId: original.supplierId,
      counterpartyUserId: original.counterpartyUserId,
      reversalOfId: original.id,
      reason,
      correlationId: correlationOf(ctx),
      postedBy: ctx.userId,
    })
    .returning();
  return { reversal: row, original };
}

export async function postingsOf(q: DbOrTx, organizationId: string, documentType: FinanceDocumentType, documentIds: string[]) {
  if (!documentIds.length) return [];
  return q
    .select({ p: financialPostings, periodCode: accountingPeriods.periodCode })
    .from(financialPostings)
    .innerJoin(accountingPeriods, eq(accountingPeriods.id, financialPostings.accountingPeriodId))
    .where(and(eq(financialPostings.organizationId, organizationId), eq(financialPostings.documentType, documentType), inArray(financialPostings.documentId, documentIds)))
    .orderBy(financialPostings.postedAt)
    .then((rows) => rows.map((r) => ({ ...r.p, periodCode: r.periodCode })));
}

/* ------------------------------------------------------------------ settlement */

/**
 * Settlement state of an issued receivable or a posted payable from its amounts: fully settled → paid,
 * partly → partially_paid, nothing → the base state (`issued` for invoices, `posted` for bills).
 */
export function settlementState(base: "issued" | "posted", total: Decimal.Value, settled: Decimal.Value): string {
  const open = D(total).minus(settled);
  if (open.lte(0)) return "paid";
  if (D(settled).gt(0)) return "partially_paid";
  return base;
}

/** Display names of users. */
export async function namesOf(q: DbOrTx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await q.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

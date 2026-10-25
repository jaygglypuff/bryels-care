import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { creditNotes, customerAddresses, customers, invoiceLines, invoices, paymentApplications, paymentRecords, products, salesOrderLines, salesOrders, shipmentLines, shipments, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { type InTx, runInTx } from "@/lib/tx";
import { requireReauthentication } from "@/modules/governance";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { formatAddress, lockOrder, shippedLotsOf, transitionOrder } from "@/modules/sales";
import { type Progress, approvalProgress, assertPosterAllowed, canDecide, decisionsOf, evaluateAtSubmit, notifyNextStep, recordDecision } from "./approvals";
import { D, addDays, businessDate, computeTaxedLines, isUuid, logTransition, m4, money, namesOf, openPeriodForPosting, postFinancial, postingsOf, requireReason, reverseDocumentPosting, transitionsOf } from "./shared";
import { type TaxConfigRow, defaultTaxCode, requireTaxConfiguration } from "./tax";

/**
 * Invoices from dispatched shipments (US-6-10, FR-finance-02/07, docs/modules/finance.md §3.1 R-01..R-08).
 *
 *   draft → submitted → approved → issued → partially_paid → paid → closed
 *   submitted → draft (returned, reason); draft | submitted | approved → cancelled (reason)
 *   issued | partially_paid → voided (reversal when nothing is applied, or a full credit note)
 *
 * - Create: only from a `dispatched` (or delivered) shipment (422 SOURCE_NOT_POSTABLE), once per shipment
 *   (409 DUPLICATE_DOCUMENT). Lines = shipped quantity per order line × the order's unit price (W3D price
 *   snapshot); the tax code is the configured sales code (reviewed tax configuration, US-6-14).
 * - Submit / approve: approval_rules `invoice` by total (finance ≠ submitter; owner above PHP 100,000).
 * - Issue (`finance.invoice.post`, restricted): the posting date is the issue date and must be in an open
 *   period (409 PERIOD_LOCKED); the tax rates are re-checked; the gapless INV number is allocated inside the
 *   posting transaction (last lock), so a failed issue consumes no number; due date = issue date + the
 *   customer's terms (A-FIN-04); the sales order moves shipped → invoiced once every dispatched shipment of
 *   the order is invoiced. Poster ≠ approver above the threshold (A-PM-10).
 * - Void (`finance.invoice.void`, restricted): a `reversal` posting with reason, only while nothing is
 *   applied (otherwise use a credit note); the order moves invoiced → shipped.
 */

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceStatus = InvoiceRow["status"];

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  closed: "Closed",
  voided: "Voided",
  cancelled: "Cancelled",
};

/** Invoice states that count as receivable (posted and not voided). */
export const OPEN_INVOICE_STATUSES = ["issued", "partially_paid"] as const;
export const POSTED_INVOICE_STATUSES = ["issued", "partially_paid", "paid", "closed"] as const;

const label = (i: Pick<InvoiceRow, "invoiceNumber">) => (i.invoiceNumber ? `Invoice ${i.invoiceNumber}` : "This invoice draft");
const doc = (i: InvoiceRow) => ({ type: "invoice" as const, id: i.id, siteId: i.siteId, label: label(i) });
export const openAmountOf = (i: Pick<InvoiceRow, "totalAmount" | "paidAmount" | "creditedAmount">) => D(i.totalAmount).minus(i.paidAmount).minus(i.creditedAmount);

async function lockInvoice(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Invoice not found in your sites.");
  const [i] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!i) throw new DomainError("not_found", "Invoice not found in your sites.");
  ctx.requireSite(i.siteId);
  return i;
}

/* ------------------------------------------------------------------ shipped quantities */

/**
 * Quantity shipped per sales order line. W3E shipments carry `shipment_lines` (posted when the stock
 * movement is set); shipments from before Wave 3 have none, so the ledger (`shippedLotsOf`, shipment
 * movements not reversed) is read per product and assigned to the order line of that product.
 */
export async function shippedQtyByOrderLine(q: DbOrTx, shipmentId: string, orderLines: { id: string; productId: string; lineNo: number }[]) {
  const out = new Map<string, Decimal>();
  const lines = await q
    .select({ orderLineId: shipmentLines.salesOrderLineId, qty: sql<string>`sum(${shipmentLines.qtyBase})::text` })
    .from(shipmentLines)
    .where(and(eq(shipmentLines.shipmentId, shipmentId), sql`${shipmentLines.stockMovementId} is not null`))
    .groupBy(shipmentLines.salesOrderLineId);
  if (lines.length) {
    for (const l of lines) out.set(l.orderLineId, D(l.qty));
    return out;
  }
  const lots = await shippedLotsOf(q, shipmentId);
  const sorted = [...orderLines].sort((a, b) => a.lineNo - b.lineNo);
  for (const lot of lots) {
    const line = sorted.find((l) => l.productId === lot.productId);
    if (!line) continue;
    out.set(line.id, (out.get(line.id) ?? D(0)).plus(lot.qtyBase));
  }
  return out;
}

/** Dispatched shipments of the caller's sites without a live invoice ("No shipments awaiting invoice"). */
export async function shipmentsAwaitingInvoice(ctx: AuthContext) {
  ctx.require("finance.invoice.view");
  if (!ctx.allowedSiteIds.length) return [];
  const rows = await db
    .select({
      id: shipments.id,
      siteId: shipments.siteId,
      shipmentNumber: shipments.shipmentNumber,
      drNumber: shipments.deliveryReceiptNumber,
      dispatchedAt: shipments.dispatchedAt,
      status: shipments.status,
      orderId: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      customerName: customers.name,
    })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(shipments.organizationId, ctx.organizationId),
        inArray(shipments.siteId, ctx.allowedSiteIds),
        inArray(shipments.status, ["dispatched", "delivered"]),
        sql`not exists (select 1 from ${invoices} i where i.shipment_id = ${shipments.id} and i.status not in ('cancelled','voided'))`,
      ),
    )
    .orderBy(asc(shipments.dispatchedAt));
  return rows;
}

async function billToText(q: DbOrTx, order: typeof salesOrders.$inferSelect, customer: typeof customers.$inferSelect) {
  const id = order.billToAddressId;
  const [a] = id
    ? await q.select().from(customerAddresses).where(eq(customerAddresses.id, id)).limit(1)
    : await q.select().from(customerAddresses).where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.isDefaultBillTo, true), isNull(customerAddresses.deletedAt))).limit(1);
  return a ? formatAddress(a) : customer.shipToAddress;
}

/** Resolves the tax configuration of a sales code on a date (null code = untaxed line). */
async function salesTax(q: DbOrTx, organizationId: string, code: string | null, onDate: string): Promise<TaxConfigRow | null> {
  return code ? requireTaxConfiguration(q, organizationId, code, "sales", onDate) : null;
}

/* ------------------------------------------------------------------ commands */

/** R-01: invoice draft from a dispatched shipment. */
export async function createInvoiceFromShipment(ctx: AuthContext, input: { shipmentId: string; notes?: string | null; idempotencyKey?: string | null }, opts?: InTx) {
  ctx.require("finance.invoice.create");
  if (!isUuid(input.shipmentId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  return runInTx(opts, async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ invoiceId: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.invoice.create", { shipmentId: input.shipmentId });
      if (replay) return replay.replay;
    }
    const [s] = await tx
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, input.shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
      .for("update")
      .limit(1);
    if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
    ctx.requireAt("finance.invoice.create", s.siteId);
    if (!["dispatched", "delivered"].includes(s.status)) {
      throw new DomainError("validation", `SOURCE_NOT_POSTABLE: shipment ${s.shipmentNumber ?? s.deliveryReceiptNumber ?? ""} is ${s.status.replace(/_/g, " ")}; only a dispatched shipment can be invoiced.`, { code: "SOURCE_NOT_POSTABLE", field: "shipmentId" });
    }
    const [dup] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.shipmentId, s.id), notInArray(invoices.status, ["cancelled", "voided"]))).limit(1);
    if (dup) throw new DomainError("conflict", "DUPLICATE_DOCUMENT: this shipment already has an invoice.", { code: "DUPLICATE_DOCUMENT", invoiceId: dup.id });
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, s.salesOrderId)).limit(1);
    const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
    const currency = await getSetting(tx, ctx.organizationId, "finance.currency");
    if (order.currency !== currency) throw new DomainError("validation", `The order is in ${order.currency}; invoices are in ${currency} only (A-FIN-26).`);
    const orderLines = await tx
      .select({ l: salesOrderLines, sku: products.skuCode, name: products.name })
      .from(salesOrderLines)
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(eq(salesOrderLines.salesOrderId, order.id))
      .orderBy(asc(salesOrderLines.lineNo));
    const shipped = await shippedQtyByOrderLine(tx, s.id, orderLines.map((r) => ({ id: r.l.id, productId: r.l.productId, lineNo: r.l.lineNo })));
    const today = businessDate();
    const code = await defaultTaxCode(tx, ctx.organizationId, "sales");
    const tax = await salesTax(tx, ctx.organizationId, code, today);
    const picked = orderLines.filter((r) => (shipped.get(r.l.id) ?? D(0)).gt(0));
    if (!picked.length) throw new DomainError("validation", "SOURCE_NOT_POSTABLE: nothing was shipped on this shipment.", { code: "SOURCE_NOT_POSTABLE" });
    const calc = computeTaxedLines(picked.map((r) => ({ qty: shipped.get(r.l.id)!, unitAmount: r.l.unitPrice, ratePct: tax?.ratePct ?? 0, inclusive: tax?.inclusive ?? false, rounding: (tax?.rounding ?? "line") as "line" | "document" })));
    const [inv] = await tx
      .insert(invoices)
      .values({
        organizationId: ctx.organizationId,
        siteId: s.siteId,
        status: "draft",
        customerId: customer.id,
        salesOrderId: order.id,
        shipmentId: s.id,
        billToText: await billToText(tx, order, customer),
        customerPoNumber: order.customerPoNumber,
        currency,
        paymentTermsDays: customer.paymentTermsDays,
        subtotalAmount: calc.subtotal,
        taxAmount: calc.tax,
        totalAmount: calc.total,
        notes: input.notes?.trim() || null,
        createdBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await tx.insert(invoiceLines).values(
      picked.map((r, i) => ({
        invoiceId: inv.id,
        lineNo: i + 1,
        salesOrderLineId: r.l.id,
        productId: r.l.productId,
        description: `${r.sku} · ${r.name}`,
        qty: shipped.get(r.l.id)!.toString(),
        uom: "pcs",
        unitAmount: r.l.unitPrice,
        taxCode: tax?.code ?? null,
        taxConfigurationId: tax?.id ?? null,
        taxRatePct: tax?.ratePct ?? "0",
        taxInclusive: tax?.inclusive ?? false,
        lineAmount: calc.lines[i].lineAmount,
        taxAmount: calc.lines[i].taxAmount,
        totalAmount: calc.lines[i].totalAmount,
        currency,
      })),
    );
    await logTransition(tx, ctx, doc(inv), null, "draft");
    await audit(tx, ctx, { action: "finance.invoice.created", entityType: "invoice", entityId: inv.id, entityNumber: s.shipmentNumber ?? s.deliveryReceiptNumber, siteId: s.siteId, after: { shipmentId: s.id, orderNumber: order.orderNumber, total: calc.total, taxCode: tax?.code ?? null } });
    const result = { invoiceId: inv.id };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { shipmentId: input.shipmentId }, result);
    return result;
  });
}

/** Recomputes the draft lines with a tax code (null = untaxed). */
async function retax(tx: Tx, ctx: AuthContext, inv: InvoiceRow, code: string | null) {
  const tax = await salesTax(tx, ctx.organizationId, code, businessDate());
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const calc = computeTaxedLines(lines.map((l) => ({ qty: l.qty, unitAmount: l.unitAmount, ratePct: tax?.ratePct ?? 0, inclusive: tax?.inclusive ?? false, rounding: (tax?.rounding ?? "line") as "line" | "document" })));
  for (const [i, l] of lines.entries()) {
    await tx
      .update(invoiceLines)
      .set({ taxCode: tax?.code ?? null, taxConfigurationId: tax?.id ?? null, taxRatePct: tax?.ratePct ?? "0", taxInclusive: tax?.inclusive ?? false, lineAmount: calc.lines[i].lineAmount, taxAmount: calc.lines[i].taxAmount, totalAmount: calc.lines[i].totalAmount })
      .where(eq(invoiceLines.id, l.id));
  }
  await tx.update(invoices).set({ subtotalAmount: calc.subtotal, taxAmount: calc.tax, totalAmount: calc.total, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  return calc;
}

/** Draft edits: notes and the tax code of the lines (configuration codes only). */
export async function editInvoiceDraft(ctx: AuthContext, id: string, input: { notes?: string | null; taxCode?: string | null }) {
  ctx.require("finance.invoice.edit");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    ctx.requireAt("finance.invoice.edit", inv.siteId);
    if (inv.status !== "draft") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only a draft can be edited.`);
    const before = { notes: inv.notes, totalAmount: inv.totalAmount };
    if (input.notes !== undefined) await tx.update(invoices).set({ notes: input.notes?.trim() || null, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    let calc: { total: string } | null = null;
    if (input.taxCode !== undefined) calc = await retax(tx, ctx, inv, input.taxCode?.trim() || null);
    await audit(tx, ctx, { action: "finance.invoice.edited", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, before, after: { notes: input.notes ?? inv.notes, taxCode: input.taxCode, totalAmount: calc?.total ?? inv.totalAmount } });
    return { ok: true };
  });
}

/** R-02: submit for approval (edits locked). No matching rule → approved at once. */
export async function submitInvoice(ctx: AuthContext, id: string) {
  ctx.require("finance.invoice.submit");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    ctx.requireAt("finance.invoice.submit", inv.siteId);
    if (inv.status !== "draft") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only a draft can be submitted.`);
    const now = new Date();
    const ev = await evaluateAtSubmit(tx, ctx, { recordType: "invoice", recordId: inv.id, recordNumber: inv.invoiceNumber ?? inv.id.slice(0, 8), siteId: inv.siteId, basis: { amount: inv.totalAmount } });
    const to = ev.steps.length ? "submitted" : "approved";
    await tx.update(invoices).set({ status: to, submittedBy: ctx.userId, submittedAt: now, ...(to === "approved" ? { approvedAt: now } : {}), updatedAt: now }).where(eq(invoices.id, inv.id));
    await logTransition(tx, ctx, doc(inv), "draft", "submitted");
    if (to === "approved") await logTransition(tx, ctx, doc(inv), "submitted", "approved", "No approval rule applies");
    await audit(tx, ctx, { action: "finance.invoice.submitted", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, after: { status: to, total: inv.totalAmount } });
    if (to === "submitted") {
      await notifyNextStep(tx, ctx, ev.steps[0] ?? null, { siteId: inv.siteId, kind: "finance.invoice.approval", title: "Invoice waiting for approval", body: `An invoice of ${money(inv.totalAmount)} ${inv.currency} waits for step 1.`, entityType: "invoice", entityId: inv.id, link: `/finance/invoices/${inv.id}` });
    }
    return { status: to };
  });
}

/** R-03: approval (finance ≠ submitter; owner above the threshold). */
export async function approveInvoice(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("finance.invoice.approve");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    if (inv.status !== "submitted") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only a submitted invoice can be approved.`);
    const r = await recordDecision(tx, ctx, {
      recordType: "invoice",
      recordId: inv.id,
      recordNumber: inv.id.slice(0, 8),
      siteId: inv.siteId,
      basis: { amount: inv.totalAmount },
      pendingSince: inv.submittedAt,
      excludedUserIds: [inv.createdBy, inv.submittedBy],
      decision: "approved",
      note,
    });
    if (r.final) {
      const now = new Date();
      await tx.update(invoices).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: note?.trim() || null, updatedAt: now }).where(eq(invoices.id, inv.id));
      await logTransition(tx, ctx, doc(inv), "submitted", "approved", note?.trim() || null);
    } else {
      const p = await approvalProgress(tx, ctx.organizationId, { recordType: "invoice", recordId: inv.id, siteId: inv.siteId, basis: { amount: inv.totalAmount } });
      await notifyNextStep(tx, ctx, p.next, { siteId: inv.siteId, kind: "finance.invoice.approval", title: "Invoice waiting for your approval", body: `Step ${p.next?.step}: ${p.next?.label}.`, entityType: "invoice", entityId: inv.id, link: `/finance/invoices/${inv.id}` });
    }
    await audit(tx, ctx, { action: "finance.invoice.approved", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, reason: note?.trim() || null, after: { step: r.step?.step ?? 1, final: r.final } });
    return { approved: r.final };
  });
}

/** Return to draft with a reason (closes the approval cycle). */
export async function returnInvoice(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.invoice.approve");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    if (inv.status !== "submitted") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only a submitted invoice can be returned.`);
    await recordDecision(tx, ctx, { recordType: "invoice", recordId: inv.id, recordNumber: inv.id.slice(0, 8), siteId: inv.siteId, basis: { amount: inv.totalAmount }, pendingSince: inv.submittedAt, excludedUserIds: [inv.createdBy, inv.submittedBy], decision: "returned", note: why });
    await tx.update(invoices).set({ status: "draft", submittedBy: null, submittedAt: null, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    await logTransition(tx, ctx, doc(inv), "submitted", "draft", why);
    await audit(tx, ctx, { action: "finance.invoice.returned", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, reason: why });
    return { status: "draft" };
  });
}

export async function cancelInvoice(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.invoice.create");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    ctx.requireAt("finance.invoice.create", inv.siteId);
    if (!["draft", "submitted", "approved"].includes(inv.status)) throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; an issued invoice is voided, not cancelled.`);
    await tx.update(invoices).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    await logTransition(tx, ctx, doc(inv), inv.status, "cancelled", why);
    await audit(tx, ctx, { action: "finance.invoice.cancelled", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, reason: why });
    return { status: "cancelled" };
  });
}

/** Moves the order shipped → invoiced when every dispatched shipment of the order has a posted invoice. */
async function maybeMarkOrderInvoiced(tx: Tx, ctx: AuthContext, orderId: string) {
  const o = await lockOrder(tx, ctx, orderId);
  if (o.status !== "shipped") return;
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shipments)
    .where(
      and(
        eq(shipments.salesOrderId, orderId),
        inArray(shipments.status, ["dispatched", "delivered"]),
        sql`not exists (select 1 from ${invoices} i where i.shipment_id = ${shipments.id} and i.status in ('issued','partially_paid','paid','closed'))`,
      ),
    );
  if ((open?.n ?? 0) === 0) await transitionOrder(tx, ctx, o, "invoiced");
}

/**
 * R-04: issue = the financial posting (restricted). Idempotent on the key (a repeat returns the first
 * result). Lock order: invoice row, order row, period (FOR SHARE), numbering (last).
 */
export async function issueInvoice(ctx: AuthContext, id: string, input: { password?: string | null; idempotencyKey?: string | null; now?: Date } = {}, opts?: InTx) {
  ctx.require("finance.invoice.post");
  await requireReauthentication(ctx, input.password, "finance.invoice.post");
  const now = input.now ?? new Date();
  return runInTx(opts, async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ invoiceNumber: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.invoice.post", { id });
      if (replay) return replay.replay;
    }
    const inv = await lockInvoice(tx, ctx, id);
    ctx.requireAt("finance.invoice.post", inv.siteId);
    if (inv.status !== "approved") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only an approved invoice can be issued.`);
    await assertPosterAllowed(tx, ctx, { recordType: "invoice", recordId: inv.id, siteId: inv.siteId, basis: { amount: inv.totalAmount } });
    const [customer] = await tx.select().from(customers).where(eq(customers.id, inv.customerId)).limit(1);
    if (customer.status === "inactive") throw new DomainError("validation", "The customer is inactive; reactivate the customer before issuing.");
    const issueDate = businessDate(now);
    // V-FIN-TAX: every taxed line still resolves to the same reviewed rate on the issue date.
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    const refs = new Set<string>();
    for (const l of lines) {
      if (!l.taxCode) continue;
      const t = await requireTaxConfiguration(tx, ctx.organizationId, l.taxCode, "sales", issueDate);
      if (!D(t.ratePct).eq(l.taxRatePct) || t.inclusive !== l.taxInclusive) {
        throw new DomainError("conflict", `TAX_CONFIG_CHANGED: the reviewed rate of ${l.taxCode} changed since this invoice was prepared. Return it to draft, update the tax and submit again.`, { code: "TAX_CONFIG_CHANGED" });
      }
      refs.add(`${t.code} v${t.versionNo} ${Number(t.ratePct)}%${t.inclusive ? " incl" : ""}`);
    }
    await lockOrder(tx, ctx, inv.salesOrderId);
    const terms = inv.paymentTermsDays ?? customer.paymentTermsDays ?? (await getSetting(tx, ctx.organizationId, "finance.invoice.default_terms_days"));
    // Period check before the number: PERIOD_LOCKED refuses without consuming anything.
    await openPeriodForPosting(tx, ctx.organizationId, issueDate);
    const number = await nextNumber(tx, ctx.organizationId, "INV", now);
    await postFinancial(tx, ctx, {
      siteId: inv.siteId,
      postingType: "invoice_issue",
      documentType: "invoice",
      documentId: inv.id,
      documentNumber: number,
      postingDate: issueDate,
      amount: inv.totalAmount,
      taxAmount: inv.taxAmount,
      currency: inv.currency,
      direction: "debit",
      customerId: inv.customerId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await tx
      .update(invoices)
      .set({ status: "issued", invoiceNumber: number, issueDate, dueDate: addDays(issueDate, terms), paymentTermsDays: terms, taxConfigurationRef: [...refs].join("; ") || null, postedBy: ctx.userId, postedAt: now, updatedAt: now })
      .where(eq(invoices.id, inv.id));
    await logTransition(tx, ctx, { ...doc(inv), label: `Invoice ${number}` }, "approved", "issued");
    await maybeMarkOrderInvoiced(tx, ctx, inv.salesOrderId);
    await audit(tx, ctx, { action: "finance.invoice.posted", entityType: "invoice", entityId: inv.id, entityNumber: number, siteId: inv.siteId, after: { invoiceNumber: number, issueDate, dueDate: addDays(issueDate, terms), total: inv.totalAmount, tax: inv.taxAmount, taxConfigurationRef: [...refs] } });
    const result = { invoiceNumber: number };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
    return result;
  });
}

/** R-08 (reversal path): void an issued invoice with nothing applied. With applications, use a credit note. */
export async function voidInvoice(ctx: AuthContext, id: string, input: { reason: string; password?: string | null; now?: Date }) {
  ctx.require("finance.invoice.void");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.invoice.void");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, ctx, id);
    ctx.requireAt("finance.invoice.void", inv.siteId);
    if (inv.status !== "issued") throw new DomainError("state", `${label(inv)} is ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}; only an issued invoice with nothing applied can be voided by reversal.`);
    if (D(inv.paidAmount).gt(0) || D(inv.creditedAmount).gt(0)) throw new DomainError("conflict", "Payments or credits are applied to this invoice. Void those first, or credit the open amount with a credit note.");
    await reverseDocumentPosting(tx, ctx, "invoice", inv.id, reason, input.now);
    const now = new Date();
    await tx.update(invoices).set({ status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(invoices.id, inv.id));
    await logTransition(tx, ctx, doc(inv), "issued", "voided", reason);
    await revertOrderInvoiced(tx, ctx, inv.salesOrderId, `Invoice ${inv.invoiceNumber} voided: ${reason}`);
    await audit(tx, ctx, { action: "finance.invoice.reversed", entityType: "invoice", entityId: inv.id, entityNumber: inv.invoiceNumber, siteId: inv.siteId, reason, before: { status: inv.status }, after: { status: "voided" } });
    return { status: "voided" };
  });
}

/** Downstream of a void (§2.5): the order moves invoiced → shipped; stock is untouched. */
export async function revertOrderInvoiced(tx: Tx, ctx: AuthContext, orderId: string, reason: string) {
  const o = await lockOrder(tx, ctx, orderId);
  if (o.status === "invoiced") await transitionOrder(tx, ctx, o, "shipped", { reason });
}

/* ------------------------------------------------------------------ queries */

export async function listInvoices(ctx: AuthContext, f: { status?: string; customerId?: string; overdue?: boolean } = {}) {
  ctx.require("finance.invoice.view");
  if (!ctx.allowedSiteIds.length) return [];
  const where = [eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)];
  if (f.status && INVOICE_STATUS_LABEL[f.status]) where.push(eq(invoices.status, f.status));
  if (f.customerId && isUuid(f.customerId)) where.push(eq(invoices.customerId, f.customerId));
  const today = businessDate();
  if (f.overdue) where.push(inArray(invoices.status, [...OPEN_INVOICE_STATUSES]), sql`${invoices.dueDate} < ${today}`);
  const rows = await db
    .select({ i: invoices, customerName: customers.name, orderNumber: salesOrders.orderNumber, shipmentNumber: shipments.shipmentNumber, drNumber: shipments.deliveryReceiptNumber })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(salesOrders, eq(salesOrders.id, invoices.salesOrderId))
    .innerJoin(shipments, eq(shipments.id, invoices.shipmentId))
    .where(and(...where))
    .orderBy(desc(invoices.createdAt))
    .limit(500);
  return rows.map((r) => ({
    ...r.i,
    customerName: r.customerName,
    orderNumber: r.orderNumber,
    shipmentNumber: r.shipmentNumber ?? r.drNumber,
    openAmount: m4(openAmountOf(r.i)),
    overdue: (OPEN_INVOICE_STATUSES as readonly string[]).includes(r.i.status) && !!r.i.dueDate && r.i.dueDate < today,
  }));
}

export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;

export async function getInvoice(ctx: AuthContext, id: string) {
  ctx.require("finance.invoice.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Invoice not found in your sites.");
  const [row] = await db
    .select({ i: invoices, c: customers, o: salesOrders, s: shipments })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(salesOrders, eq(salesOrders.id, invoices.salesOrderId))
    .innerJoin(shipments, eq(shipments.id, invoices.shipmentId))
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Invoice not found in your sites.");
  ctx.requireSite(row.i.siteId);
  const inv = row.i;
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const basis = { amount: inv.totalAmount };
  const progress: Progress | null = inv.status === "submitted" || inv.status === "approved" ? await approvalProgress(db, ctx.organizationId, { recordType: "invoice", recordId: inv.id, siteId: inv.siteId, basis }) : null;
  const decisions = await decisionsOf(db, ctx.organizationId, "invoice", inv.id);
  const names = await namesOf(db, [inv.createdBy, inv.submittedBy, inv.approvedBy, inv.postedBy, inv.voidedBy]);
  const postings = await postingsOf(db, ctx.organizationId, "invoice", [inv.id]);
  const history = await transitionsOf(db, "invoice", inv.id);
  const applications = await db
    .select({ a: paymentApplications, number: paymentRecords.paymentNumber, method: paymentRecords.method, paidOn: paymentRecords.paidOn })
    .from(paymentApplications)
    .innerJoin(paymentRecords, eq(paymentRecords.id, paymentApplications.paymentRecordId))
    .where(eq(paymentApplications.invoiceId, inv.id))
    .orderBy(asc(paymentApplications.createdAt));
  const credits = await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id)).orderBy(asc(creditNotes.createdAt));
  const today = businessDate();
  return {
    invoice: { ...inv, openAmount: m4(openAmountOf(inv)), overdue: (OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status) && !!inv.dueDate && inv.dueDate < today },
    customer: { id: row.c.id, code: row.c.code, name: row.c.name, taxIdentifier: ctx.can("finance.credit_terms.view") ? row.c.taxIdentifier : undefined },
    order: { id: row.o.id, orderNumber: row.o.orderNumber, status: row.o.status },
    shipment: { id: row.s.id, number: row.s.shipmentNumber ?? row.s.deliveryReceiptNumber, drNumber: row.s.deliveryReceiptNumber, dispatchedAt: row.s.dispatchedAt, status: row.s.status },
    lines,
    progress,
    canApprove: inv.status === "submitted" && canDecide(ctx, "invoice", progress, inv.submittedAt, [inv.createdBy, inv.submittedBy]),
    posterBlocked: inv.status === "approved" && !!progress && !progress.posterMayEqualApprover && progress.approvers.includes(ctx.userId),
    decisions,
    names: Object.fromEntries(names),
    postings,
    history,
    applications: applications.map((a) => ({ ...a.a, paymentNumber: a.number, method: a.method, paidOn: a.paidOn })),
    credits,
  };
}

/* ------------------------------------------------------------------ statement and aging */

export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABEL: Record<AgingBucket, string> = { current: "Current", "1_30": "1–30 days", "31_60": "31–60 days", "61_90": "61–90 days", over_90: "Over 90 days" };

export function agingBucket(dueDate: string | null, asOf: string): AgingBucket {
  if (!dueDate || dueDate >= asOf) return "current";
  const days = Math.round((Date.parse(asOf + "T00:00:00Z") - Date.parse(dueDate + "T00:00:00Z")) / 86_400_000);
  return days <= 30 ? "1_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90";
}

/**
 * R-05: open-item statement of account (A-FIN-06) for one customer across the caller's sites: open
 * invoices with aging buckets as of a date, payments and credit notes of the last 90 days, unapplied
 * payments on account. Read-only.
 */
export async function customerStatement(ctx: AuthContext, customerId: string, opts: { asOf?: string } = {}) {
  ctx.require("finance.invoice.view");
  if (!isUuid(customerId)) throw new DomainError("not_found", "Customer not found.");
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("not_found", "Customer not found.");
  const asOf = opts.asOf && /^\d{4}-\d{2}-\d{2}$/.test(opts.asOf) ? opts.asOf : businessDate();
  const from = addDays(asOf, -90);
  if (!ctx.allowedSiteIds.length) throw new DomainError("not_found", "Customer not found.");
  const open = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.customerId, c.id), inArray(invoices.siteId, ctx.allowedSiteIds), inArray(invoices.status, [...OPEN_INVOICE_STATUSES]), sql`${invoices.issueDate} <= ${asOf}`))
    .orderBy(asc(invoices.dueDate));
  const payments = await db
    .select()
    .from(paymentRecords)
    .where(and(eq(paymentRecords.customerId, c.id), eq(paymentRecords.organizationId, ctx.organizationId), inArray(paymentRecords.status, ["recorded", "reconciled"]), sql`${paymentRecords.paidOn} >= ${from} and ${paymentRecords.paidOn} <= ${asOf}`, sql`(${paymentRecords.siteId} is null or ${inArray(paymentRecords.siteId, ctx.allowedSiteIds)})`))
    .orderBy(asc(paymentRecords.paidOn));
  const credits = await db
    .select({ cn: creditNotes, invoiceNumber: invoices.invoiceNumber })
    .from(creditNotes)
    .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
    .where(and(eq(creditNotes.customerId, c.id), inArray(creditNotes.siteId, ctx.allowedSiteIds), inArray(creditNotes.status, ["issued", "applied"]), sql`${creditNotes.issueDate} >= ${from} and ${creditNotes.issueDate} <= ${asOf}`))
    .orderBy(asc(creditNotes.issueDate));
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, D(0)])) as Record<AgingBucket, Decimal>;
  const items = open.map((i) => {
    const amt = openAmountOf(i);
    const b = agingBucket(i.dueDate, asOf);
    buckets[b] = buckets[b].plus(amt);
    return { id: i.id, invoiceNumber: i.invoiceNumber!, issueDate: i.issueDate!, dueDate: i.dueDate!, total: i.totalAmount, paid: m4(D(i.paidAmount).plus(i.creditedAmount)), open: m4(amt), bucket: b, daysOverdue: i.dueDate && i.dueDate < asOf ? Math.round((Date.parse(asOf) - Date.parse(i.dueDate)) / 86_400_000) : 0 };
  });
  const unapplied = payments.reduce((s, p) => s.plus(D(p.amount).plus(p.withheldAmount).minus(p.appliedAmount)), D(0));
  const totalOpen = items.reduce((s, i) => s.plus(i.open), D(0));
  return {
    customer: { id: c.id, code: c.code, name: c.name, address: c.shipToAddress, contactName: c.contactName, paymentTermsDays: ctx.can("finance.credit_terms.view") ? c.paymentTermsDays : undefined },
    asOf,
    from,
    items,
    buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, m4(buckets[b])])) as Record<AgingBucket, string>,
    payments: payments.map((p) => ({ id: p.id, paymentNumber: p.paymentNumber, paidOn: p.paidOn, method: p.method, reference: p.reference, amount: p.amount, withheld: p.withheldAmount, unapplied: m4(D(p.amount).plus(p.withheldAmount).minus(p.appliedAmount)) })),
    credits: credits.map((r) => ({ id: r.cn.id, creditNoteNumber: r.cn.creditNoteNumber, issueDate: r.cn.issueDate, amount: r.cn.amount, invoiceNumber: r.invoiceNumber })),
    totalOpen: m4(totalOpen),
    unappliedOnAccount: m4(unapplied),
    balanceDue: m4(totalOpen.minus(unapplied)),
    currency: open[0]?.currency ?? (await getSetting(db, ctx.organizationId, "finance.currency")),
  };
}

/** Customers with posted invoices in the caller's sites (statement picker). */
export async function statementCustomers(ctx: AuthContext) {
  ctx.require("finance.invoice.view");
  if (!ctx.allowedSiteIds.length) return [];
  return db
    .select({ id: customers.id, code: customers.code, name: customers.name, open: sql<string>`coalesce(sum(case when ${invoices.status} in ('issued','partially_paid') then ${invoices.totalAmount} - ${invoices.paidAmount} - ${invoices.creditedAmount} else 0 end), 0)::text` })
    .from(customers)
    .innerJoin(invoices, eq(invoices.customerId, customers.id))
    .where(and(eq(customers.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds), inArray(invoices.status, [...POSTED_INVOICE_STATUSES])))
    .groupBy(customers.id, customers.code, customers.name)
    .orderBy(asc(customers.name));
}

/** Receivables overview (finance landing page): outstanding, overdue, aging and counts per status. */
export async function receivablesSummary(ctx: AuthContext) {
  ctx.require("finance.invoice.view");
  if (!ctx.allowedSiteIds.length) return { outstanding: "0", overdue: "0", buckets: {} as Record<AgingBucket, string>, counts: {} as Record<string, number> };
  const today = businessDate();
  const rows = await db.select().from(invoices).where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)));
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, D(0)])) as Record<AgingBucket, Decimal>;
  let outstanding = D(0);
  let overdue = D(0);
  const counts: Record<string, number> = {};
  for (const i of rows) {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status)) continue;
    const amt = openAmountOf(i);
    outstanding = outstanding.plus(amt);
    const b = agingBucket(i.dueDate, today);
    buckets[b] = buckets[b].plus(amt);
    if (b !== "current") overdue = overdue.plus(amt);
  }
  return { outstanding: m4(outstanding), overdue: m4(overdue), buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, m4(buckets[b])])) as Record<AgingBucket, string>, counts };
}

/** Name of a user (for print pages). */
export async function userName(q: DbOrTx, id: string | null) {
  if (!id) return null;
  const [u] = await q.select({ n: users.displayName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.n ?? null;
}

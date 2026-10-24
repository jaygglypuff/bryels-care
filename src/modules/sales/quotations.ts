import "server-only";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { QUOTE_STATUSES, customerAddresses, customers, products, quoteLines, quotes, salesOrders, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { nextNumber } from "@/lib/numbering";
import { D } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { evaluateApprovalRulesAudited, sodRequired } from "@/modules/governance";
import { notifyRoles, notifyUsers } from "@/modules/platform";
import { approvalProgress, canDecide, decisionsOf, recordDecision, stepRoles } from "./crm-approvals";
import { addDaysIso, businessDate, canSeePrices, discountPct, formatAddress, idempotent, isUuid, money, totals } from "./crm-support";
import { createOrderInTx } from "./orders";
import { resolvePrice } from "./price-lists";

/**
 * Quotations convertible to orders (US-4-04, W09-01; docs/data-model.md §3.7, numbering QT).
 *
 *   draft → sent (within the discount threshold) | pending_approval → sent (approved)
 *   pending_approval → draft (returned, reason)
 *   sent → accepted | rejected (reason) | expired (valid_until passed, daily job)
 *   accepted → converted (a draft sales order linked both ways)
 *   draft | pending_approval | sent | accepted → voided (reason, sales.quote.void)
 *
 * Prices come from the approved price list (customer, else general); a line priced below the list
 * has a discount, and the largest line discount is the `discount_pct` basis of the `quote` approval
 * rules (default: above 10 % needs site_manager then finance, A-PM-15). The creator or submitter
 * cannot approve while `approvals.sod.quote` is on. Conversion copies the quoted lines and prices
 * (price source "quote") into a draft order at the quote's site. Amounts are masked for users without
 * `sales.price_list.view`.
 */

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["pending_approval", "sent", "voided"],
  pending_approval: ["sent", "draft", "voided"],
  sent: ["accepted", "rejected", "expired", "voided"],
  accepted: ["converted", "voided"],
  rejected: [],
  expired: [],
  converted: [],
  voided: [],
};
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted: "Converted",
  voided: "Voided",
};

type QuoteRow = typeof quotes.$inferSelect;

export function assertQuoteTransition(q: Pick<QuoteRow, "status" | "quoteNumber">, to: QuoteStatus) {
  if (!(QUOTE_TRANSITIONS[q.status as QuoteStatus] ?? []).includes(to)) {
    throw new DomainError("state", `Quotation ${q.quoteNumber} is ${QUOTE_STATUS_LABEL[q.status as QuoteStatus]?.toLowerCase() ?? q.status} and cannot become ${QUOTE_STATUS_LABEL[to].toLowerCase()}.`, { machine: "quote", from: q.status, to });
  }
}

async function setQuoteStatus(tx: Tx, ctx: AuthContext, q: QuoteRow, to: QuoteStatus, set: Partial<typeof quotes.$inferInsert> = {}) {
  assertQuoteTransition(q, to);
  const now = new Date();
  await tx
    .update(quotes)
    .set({ ...set, status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId })
    .where(eq(quotes.id, q.id));
  const from = q.status;
  q.status = to;
  return from;
}

async function lockQuote(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Quotation not found in your sites.");
  const [q] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!q) throw new DomainError("not_found", "Quotation not found in your sites.");
  ctx.requireSite(q.siteId);
  return q;
}

const maskQuoteMoney = <T extends { subtotalAmount: string; taxAmount: string; totalAmount: string; maxDiscountPct: string }>(ctx: AuthContext, q: T) => {
  if (canSeePrices(ctx)) return q as T & { _masked?: string[] };
  const { subtotalAmount, taxAmount, totalAmount, maxDiscountPct, ...rest } = q;
  void subtotalAmount;
  void taxAmount;
  void totalAmount;
  void maxDiscountPct;
  return { ...rest, _masked: ["subtotalAmount", "taxAmount", "totalAmount", "maxDiscountPct"] } as Omit<T, "subtotalAmount" | "taxAmount" | "totalAmount" | "maxDiscountPct"> & Partial<T> & { _masked?: string[] };
};

export async function listQuotes(ctx: AuthContext, filters: { status?: string; customerId?: string } = {}) {
  ctx.require("sales.quote.view");
  ctx.requireSite(ctx.currentSiteId);
  const where = [eq(quotes.organizationId, ctx.organizationId), eq(quotes.siteId, ctx.currentSiteId)];
  if (filters.status && (QUOTE_STATUSES as readonly string[]).includes(filters.status)) where.push(eq(quotes.status, filters.status));
  if (filters.customerId && isUuid(filters.customerId)) where.push(eq(quotes.customerId, filters.customerId));
  const rows = await db
    .select({ q: quotes, customerName: customers.name, customerCode: customers.code })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(...where))
    .orderBy(desc(quotes.quoteNumber));
  return rows.map((r) => ({ ...maskQuoteMoney(ctx, r.q), customerName: r.customerName, customerCode: r.customerCode }));
}

/** Quotes of one customer in the user's sites (customer 360). */
export async function listCustomerQuotes(ctx: AuthContext, customerId: string) {
  ctx.require("sales.quote.view");
  if (!isUuid(customerId)) return [];
  const rows = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.organizationId, ctx.organizationId), eq(quotes.customerId, customerId), inArray(quotes.siteId, ctx.allowedSiteIds)))
    .orderBy(desc(quotes.quoteNumber));
  return rows.map((q) => maskQuoteMoney(ctx, q));
}

export async function getQuote(ctx: AuthContext, id: string) {
  ctx.require("sales.quote.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Quotation not found in your sites.");
  const [row] = await db
    .select({ q: quotes, c: customers })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.id, id), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Quotation not found in your sites.");
  const q = row.q;
  const [lines, shipTo, order, people, decisions] = await Promise.all([
    db
      .select({ l: quoteLines, sku: products.skuCode, productName: products.name })
      .from(quoteLines)
      .innerJoin(products, eq(products.id, quoteLines.productId))
      .where(eq(quoteLines.quoteId, q.id))
      .orderBy(asc(quoteLines.lineNo)),
    q.shipToAddressId ? db.select().from(customerAddresses).where(eq(customerAddresses.id, q.shipToAddressId)).limit(1) : Promise.resolve([]),
    q.convertedSalesOrderId ? db.select({ id: salesOrders.id, orderNumber: salesOrders.orderNumber, status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, q.convertedSalesOrderId)).limit(1) : Promise.resolve([]),
    db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [q.createdBy, q.submittedBy, q.approvedBy].filter((x): x is string => !!x))),
    decisionsOf(db, ctx.organizationId, "quote", q.id),
  ]);
  const prices = canSeePrices(ctx);
  const progress = q.status === "pending_approval" ? await approvalProgress(db, ctx.organizationId, { recordType: "quote", recordId: q.id, siteId: q.siteId, basis: { discount_pct: q.maxDiscountPct } }) : null;
  const sod = await sodRequired(db, ctx.organizationId, "quote");
  const name = (u: string | null) => (u ? (people.find((p) => p.id === u)?.name ?? "") : null);
  const { creditLimitAmount, paymentTermsDays, taxIdentifier, ...customer } = row.c;
  void creditLimitAmount;
  void paymentTermsDays;
  void taxIdentifier;
  return {
    quote: { ...maskQuoteMoney(ctx, q), createdByName: name(q.createdBy), submittedByName: name(q.submittedBy), approvedByName: name(q.approvedBy) },
    customer,
    shipTo: shipTo[0] ? { ...shipTo[0], text: formatAddress(shipTo[0]) } : null,
    order: order[0] ?? null,
    lines: lines.map(({ l, sku, productName }) =>
      prices
        ? { id: l.id, lineNo: l.lineNo, productId: l.productId, sku, productName, qtyUnits: l.qtyUnits, unitAmount: l.unitAmount as string | undefined, listUnitAmount: l.listUnitAmount as string | null | undefined, discountPct: l.discountPct as string | undefined, value: D(l.qtyUnits).times(l.unitAmount).toFixed(2) as string | undefined }
        : { id: l.id, lineNo: l.lineNo, productId: l.productId, sku, productName, qtyUnits: l.qtyUnits, unitAmount: undefined, listUnitAmount: undefined, discountPct: undefined, value: undefined, _masked: ["unitAmount", "listUnitAmount", "discountPct", "value"] },
    ),
    decisions,
    approval: progress ? { ...progress, canApprove: canDecide(ctx, "quote", progress.next, q.submittedAt, [q.createdBy, q.submittedBy], sod) && ctx.canAt("sales.quote.approve", q.siteId) } : null,
    expiredByDate: q.validUntil < businessDate(),
  };
}
export type QuoteDetail = Awaited<ReturnType<typeof getQuote>>;

export type QuoteInput = {
  customerId: string;
  validUntil?: string | null;
  shipToAddressId?: string | null;
  notesCustomer?: string | null;
  notesInternal?: string | null;
  lines: { productId: string; qtyUnits: string; unitPrice?: string | null }[];
  idempotencyKey?: string | null;
};

async function priceQuoteLines(tx: DbOrTx, ctx: AuthContext, customerId: string, lines: QuoteInput["lines"]) {
  if (lines.length === 0) throw new DomainError("validation", "Add at least one line.", { field: "lines" });
  if (lines.length > 50) throw new DomainError("validation", "At most 50 lines.", { field: "lines" });
  const ids = [...new Set(lines.map((l) => l.productId))];
  if (ids.length !== lines.length) throw new DomainError("validation", "Each product may appear only once.", { field: "lines" });
  const prods = await tx.select({ id: products.id, name: products.name, status: products.status }).from(products).where(and(inArray(products.id, ids), eq(products.organizationId, ctx.organizationId)));
  if (prods.length !== ids.length) throw new DomainError("validation", "One of the products was not found.", { field: "lines" });
  const notSold = prods.filter((p) => p.status !== "active");
  if (notSold.length) throw new DomainError("validation", `Not available for sale: ${notSold.map((p) => p.name).join(", ")}.`, { field: "lines" });
  const allowManual = await getSetting(tx, ctx.organizationId, "sales.order.allow_manual_price");
  const fieldErrors: Record<string, string> = {};
  const out: { productId: string; qtyUnits: string; unitAmount: string; listUnitAmount: string | null; discountPct: string; priceListLineId: string | null; priceListId: string | null }[] = [];
  for (const [i, l] of lines.entries()) {
    if (!/^\d{1,7}$/.test(l.qtyUnits?.trim() ?? "") || Number(l.qtyUnits) <= 0) {
      fieldErrors[`lines.${i}.qtyUnits`] = "Whole pieces, at least 1.";
      continue;
    }
    const list = await resolvePrice(tx, ctx.organizationId, customerId, l.productId, l.qtyUnits);
    const manual = l.unitPrice && String(l.unitPrice).trim() ? String(l.unitPrice).trim() : null;
    let price: string;
    if (manual !== null && (!list || !D(manual).eq(list.unitAmount))) {
      if (!canSeePrices(ctx)) throw new DomainError("forbidden", "Only users who may see prices can enter a price (sales.price_list.view).");
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(manual)) {
        fieldErrors[`lines.${i}.unitPrice`] = "Price in pesos, up to 2 decimals.";
        continue;
      }
      if (!list && !allowManual) {
        fieldErrors[`lines.${i}.unitPrice`] = "No approved price for this product.";
        continue;
      }
      price = money(manual);
    } else if (list) price = list.unitAmount;
    else {
      fieldErrors[`lines.${i}.unitPrice`] = "No approved price for this customer and product. Enter the quoted price.";
      continue;
    }
    out.push({ productId: l.productId, qtyUnits: String(Number(l.qtyUnits)), unitAmount: price, listUnitAmount: list?.unitAmount ?? null, discountPct: discountPct(list?.unitAmount ?? null, price), priceListLineId: list?.priceListLineId ?? null, priceListId: list?.priceListId ?? null });
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", Object.values(fieldErrors)[0], { fieldErrors });
  return out;
}

async function quoteHeader(tx: DbOrTx, ctx: AuthContext, input: QuoteInput) {
  if (!isUuid(input.customerId)) throw new DomainError("validation", "Choose a customer.", { field: "customerId" });
  const [c] = await tx.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("validation", "Choose a customer.", { field: "customerId" });
  if (c.status === "inactive") throw new DomainError("validation", `${c.name} is inactive.`, { field: "customerId" });
  const today = businessDate();
  const validUntil = input.validUntil || addDaysIso(today, await getSetting(tx, ctx.organizationId, "sales.quote.validity_days"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < today) throw new DomainError("validation", "Valid until must be today or later.", { field: "validUntil" });
  let shipToAddressId: string | null = null;
  if (input.shipToAddressId) {
    const [a] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(and(eq(customerAddresses.id, input.shipToAddressId), eq(customerAddresses.customerId, c.id))).limit(1);
    if (!a) throw new DomainError("validation", "Choose one of the customer's addresses.", { field: "shipToAddressId" });
    shipToAddressId = a.id;
  } else {
    const [a] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(and(eq(customerAddresses.customerId, c.id), eq(customerAddresses.isDefaultShipTo, true))).limit(1);
    shipToAddressId = a?.id ?? null;
  }
  return { c, validUntil, shipToAddressId };
}

async function writeLines(tx: Tx, quoteId: string, currency: string, lines: Awaited<ReturnType<typeof priceQuoteLines>>) {
  await tx.insert(quoteLines).values(lines.map((l, i) => ({ quoteId, lineNo: i + 1, productId: l.productId, qtyUnits: l.qtyUnits, listUnitAmount: l.listUnitAmount, unitAmount: l.unitAmount, discountPct: l.discountPct, currency, priceListLineId: l.priceListLineId })));
  const maxDiscount = lines.reduce((m, l) => Decimal.max(m, l.discountPct), new Decimal(0)).toString();
  return { maxDiscount, priceListId: lines.find((l) => l.priceListId)?.priceListId ?? null };
}

export async function createQuote(ctx: AuthContext, input: QuoteInput) {
  ctx.require("sales.quote.create");
  ctx.requireAt("sales.quote.create", ctx.currentSiteId);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "sales.quote.create", async () => {
      const { c, validUntil, shipToAddressId } = await quoteHeader(tx, ctx, input);
      const lines = await priceQuoteLines(tx, ctx, c.id, input.lines);
      const rate = await getSetting(tx, ctx.organizationId, "sales.tax.rate_pct");
      const t = totals(lines.map((l) => ({ qty: l.qtyUnits, price: l.unitAmount })), rate);
      const quoteNumber = await nextNumber(tx, ctx.organizationId, "QT");
      const [q] = await tx
        .insert(quotes)
        .values({
          organizationId: ctx.organizationId,
          siteId: ctx.currentSiteId,
          quoteNumber,
          status: "draft",
          customerId: c.id,
          shipToAddressId,
          validUntil,
          currency: c.currency || "PHP",
          subtotalAmount: t.subtotal,
          taxAmount: t.tax,
          totalAmount: t.total,
          notesCustomer: input.notesCustomer?.trim() || null,
          notesInternal: input.notesInternal?.trim() || null,
          statusChangedBy: ctx.userId,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      const { maxDiscount, priceListId } = await writeLines(tx, q.id, q.currency, lines);
      await tx.update(quotes).set({ maxDiscountPct: maxDiscount, priceListId }).where(eq(quotes.id, q.id));
      await audit(tx, ctx, { action: "sales.quote.created", entityType: "quote", entityId: q.id, entityNumber: quoteNumber, siteId: q.siteId, after: { ...q, maxDiscountPct: maxDiscount, lines } });
      return { id: q.id, quoteNumber };
    });
    return result;
  });
}

export async function editQuote(ctx: AuthContext, id: string, input: Omit<QuoteInput, "idempotencyKey">) {
  ctx.require("sales.quote.edit");
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, ctx, id);
    if (q.status !== "draft") throw new DomainError("state", `Quotation ${q.quoteNumber} is ${QUOTE_STATUS_LABEL[q.status as QuoteStatus].toLowerCase()}; only a draft can be changed.`);
    if (input.customerId !== q.customerId) throw new DomainError("validation", "The customer of a quotation cannot change.", { field: "customerId" });
    const { validUntil, shipToAddressId } = await quoteHeader(tx, ctx, input);
    const lines = await priceQuoteLines(tx, ctx, q.customerId, input.lines);
    const rate = await getSetting(tx, ctx.organizationId, "sales.tax.rate_pct");
    const t = totals(lines.map((l) => ({ qty: l.qtyUnits, price: l.unitAmount })), rate);
    const before = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id));
    await tx.delete(quoteLines).where(eq(quoteLines.quoteId, q.id));
    const { maxDiscount, priceListId } = await writeLines(tx, q.id, q.currency, lines);
    await tx
      .update(quotes)
      .set({ validUntil, shipToAddressId, subtotalAmount: t.subtotal, taxAmount: t.tax, totalAmount: t.total, maxDiscountPct: maxDiscount, priceListId, notesCustomer: input.notesCustomer?.trim() || null, notesInternal: input.notesInternal?.trim() || null, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(quotes.id, q.id));
    await audit(tx, ctx, { action: "sales.quote.updated", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { lines: before, validUntil: q.validUntil }, after: { lines, validUntil, maxDiscountPct: maxDiscount } });
  });
}

/**
 * Submits a draft (US-4-04 AC1): no matching `quote` rule → sent (`sales.quote.sent`); otherwise
 * pending_approval and the approvers are notified.
 */
export async function submitQuote(ctx: AuthContext, id: string, opts: { idempotencyKey?: string | null } = {}) {
  ctx.require("sales.quote.submit");
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, opts.idempotencyKey, "sales.quote.submit", async () => {
      const q = await lockQuote(tx, ctx, id);
      if (q.status !== "draft") throw new DomainError("state", `Quotation ${q.quoteNumber} is ${QUOTE_STATUS_LABEL[q.status as QuoteStatus]?.toLowerCase() ?? q.status}; only a draft can be submitted.`, { machine: "quote", from: q.status, to: "sent" });
      if (q.validUntil < businessDate()) throw new DomainError("validation", "The validity date has passed. Edit the quotation and choose a new date.", { field: "validUntil" });
      const basis = { discount_pct: q.maxDiscountPct };
      const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: "quote", siteId: q.siteId, basis, recordId: q.id, recordNumber: q.quoteNumber });
      const now = new Date();
      if (ev.steps.length === 0) {
        await setQuoteStatus(tx, ctx, q, "sent", { submittedBy: ctx.userId, submittedAt: now, sentAt: now });
        await audit(tx, ctx, { action: "sales.quote.sent", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "draft" }, after: { status: "sent" } });
        return { quoteNumber: q.quoteNumber, status: "sent" as const };
      }
      await setQuoteStatus(tx, ctx, q, "pending_approval", { submittedBy: ctx.userId, submittedAt: now });
      await audit(tx, ctx, { action: "sales.quote.submitted", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "draft" }, after: { status: "pending_approval", maxDiscountPct: q.maxDiscountPct } });
      const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "quote", recordId: q.id, siteId: q.siteId, basis });
      const roles = stepRoles(progress.next);
      if (roles.length) {
        await notifyRoles(tx, { roleCodes: roles, siteId: q.siteId }, { organizationId: ctx.organizationId, siteId: q.siteId, kind: "approval_requested", severity: "info", title: `Quotation ${q.quoteNumber} needs approval`, body: `Discount of ${new Decimal(q.maxDiscountPct).toDecimalPlaces(1)} % below the price list.`, entityType: "quote", entityId: q.id, link: `/sales/quotations/${q.id}` });
      }
      return { quoteNumber: q.quoteNumber, status: "pending_approval" as const };
    });
    return result;
  });
}

/** Approves the next step of a pending quote (≠ creator/submitter per approvals.sod.quote); the last step sends it. */
export async function approveQuote(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("sales.quote.approve");
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, ctx, id);
    if (q.status !== "pending_approval") throw new DomainError("state", `Quotation ${q.quoteNumber} is not waiting for approval.`);
    const sod = await sodRequired(tx, ctx.organizationId, "quote");
    const r = await recordDecision(tx, ctx, { recordType: "quote", recordId: q.id, recordNumber: q.quoteNumber, siteId: q.siteId, basis: { discount_pct: q.maxDiscountPct }, pendingSince: q.submittedAt, excludedUserIds: [q.createdBy, q.submittedBy], sod, decision: "approved", note });
    await audit(tx, ctx, { action: "sales.quote.approved", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, after: { step: r.step?.step ?? 1, final: r.final } });
    if (!r.final) {
      const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "quote", recordId: q.id, siteId: q.siteId, basis: { discount_pct: q.maxDiscountPct } });
      const roles = stepRoles(progress.next);
      if (roles.length) await notifyRoles(tx, { roleCodes: roles, siteId: q.siteId }, { organizationId: ctx.organizationId, siteId: q.siteId, kind: "approval_requested", severity: "info", title: `Quotation ${q.quoteNumber} needs the next approval`, body: `Step ${r.step?.step ?? 1} approved by ${ctx.displayName}.`, entityType: "quote", entityId: q.id, link: `/sales/quotations/${q.id}` });
      return { sent: false };
    }
    const now = new Date();
    await setQuoteStatus(tx, ctx, q, "sent", { approvedBy: ctx.userId, approvedAt: now, approvalNote: note?.trim() || null, sentAt: now });
    await audit(tx, ctx, { action: "sales.quote.sent", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "pending_approval" }, after: { status: "sent" } });
    if (q.submittedBy) await notifyUsers(tx, [q.submittedBy], { organizationId: ctx.organizationId, siteId: q.siteId, kind: "quote_approved", severity: "info", title: `Quotation ${q.quoteNumber} approved`, body: "It can be sent to the customer.", entityType: "quote", entityId: q.id, link: `/sales/quotations/${q.id}` });
    return { sent: true };
  });
}

export async function returnQuoteToDraft(ctx: AuthContext, id: string, reason: string) {
  ctx.require("sales.quote.approve");
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, ctx, id);
    assertQuoteTransition(q, "draft");
    const sod = await sodRequired(tx, ctx.organizationId, "quote");
    await recordDecision(tx, ctx, { recordType: "quote", recordId: q.id, recordNumber: q.quoteNumber, siteId: q.siteId, basis: { discount_pct: q.maxDiscountPct }, pendingSince: q.submittedAt, excludedUserIds: [q.createdBy, q.submittedBy], sod, decision: "returned", note: reason });
    await setQuoteStatus(tx, ctx, q, "draft", { decisionReason: reason.trim() });
    await audit(tx, ctx, { action: "sales.quote.returned", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, reason: reason.trim(), before: { status: "pending_approval" }, after: { status: "draft" } });
  });
}

/** Records the customer's answer: accepted, or rejected with the reason given by the customer. */
export async function recordQuoteDecision(ctx: AuthContext, id: string, decision: "accepted" | "rejected", reason?: string | null) {
  ctx.require("sales.quote.edit");
  if (decision === "rejected" && (!reason?.trim() || reason.trim().length < 3)) throw new DomainError("validation", "Give the customer's reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, ctx, id);
    if (decision === "accepted" && q.validUntil < businessDate()) throw new DomainError("state", `Quotation ${q.quoteNumber} expired on ${q.validUntil}. Issue a new quotation.`);
    const from = await setQuoteStatus(tx, ctx, q, decision, { decidedAt: new Date(), decisionReason: reason?.trim() || null });
    await audit(tx, ctx, { action: `sales.quote.${decision}`, entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, reason: reason?.trim() || null, before: { status: from }, after: { status: decision } });
  });
}

/**
 * Converts an accepted (or sent, accepting it now) quotation into a draft sales order at the quote's
 * site with the quoted lines and prices, linked both ways, in one transaction (`sales.quote.converted`).
 */
export async function convertQuote(ctx: AuthContext, id: string, input: { requestedDeliveryOn: string; customerPoNumber?: string | null; idempotencyKey?: string | null }) {
  ctx.require("sales.sales_order.create");
  ctx.require("sales.quote.edit");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDeliveryOn) || input.requestedDeliveryOn < businessDate()) {
    throw new DomainError("validation", "The requested delivery date cannot be in the past.", { field: "requestedDeliveryOn" });
  }
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "sales.quote.convert", async () => {
      const q = await lockQuote(tx, ctx, id);
      if (q.validUntil < businessDate()) throw new DomainError("state", `Quotation ${q.quoteNumber} expired on ${q.validUntil}. Issue a new quotation.`);
      if (q.status === "sent") {
        await setQuoteStatus(tx, ctx, q, "accepted", { decidedAt: new Date() });
        await audit(tx, ctx, { action: "sales.quote.accepted", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "sent" }, after: { status: "accepted" } });
      }
      assertQuoteTransition(q, "converted");
      const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id)).orderBy(asc(quoteLines.lineNo));
      const order = await createOrderInTx(tx, ctx, {
        customerId: q.customerId,
        customerPoNumber: input.customerPoNumber ?? null,
        requestedDeliveryOn: input.requestedDeliveryOn,
        notes: q.notesCustomer,
        shipToAddressId: q.shipToAddressId,
        lines: lines.map((l) => ({ productId: l.productId, qtyUnits: D(l.qtyUnits).toString(), unitPrice: null })),
        quoteId: q.id,
        quotePrices: new Map(lines.map((l) => [l.productId, money(l.unitAmount)])),
        siteId: q.siteId,
      });
      await setQuoteStatus(tx, ctx, q, "converted", { convertedSalesOrderId: order.id });
      await audit(tx, ctx, { action: "sales.quote.converted", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "accepted" }, after: { status: "converted", salesOrderId: order.id, orderNumber: order.orderNumber } });
      return { orderId: order.id, orderNumber: order.orderNumber };
    });
    return result;
  });
}

export async function voidQuote(ctx: AuthContext, id: string, reason: string) {
  ctx.require("sales.quote.void");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason.", { field: "reason" });
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, ctx, id);
    const from = await setQuoteStatus(tx, ctx, q, "voided", { decisionReason: reason.trim() });
    await audit(tx, ctx, { action: "sales.quote.voided", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, reason: reason.trim(), before: { status: from }, after: { status: "voided" } });
  });
}

/**
 * Expires sent quotations whose `valid_until` is before `asOf` (job `sales.quote_expiry`, system actor).
 * Returns the expired quote numbers.
 */
export async function expireDueQuotes(ctx: AuthContext, asOf = businessDate()) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.organizationId, ctx.organizationId), eq(quotes.status, "sent"), lt(quotes.validUntil, asOf)))
      .for("update");
    for (const q of due) {
      await setQuoteStatus(tx, ctx, q, "expired");
      await audit(tx, ctx, { action: "sales.quote.expired", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, before: { status: "sent" }, after: { status: "expired", validUntil: q.validUntil } });
    }
    return due.map((q) => q.quoteNumber);
  });
}

/** Active products for the quotation form. */
export async function quoteProductOptions(ctx: AuthContext) {
  ctx.require("sales.quote.create");
  return db
    .select({ id: products.id, skuCode: products.skuCode, name: products.name })
    .from(products)
    .where(and(eq(products.organizationId, ctx.organizationId), eq(products.status, "active")))
    .orderBy(asc(products.skuCode));
}

type QuoteExportRow =Awaited<ReturnType<typeof listQuotes>>[number];

/** Quotes export (sales.quote.export, S): amounts only with sales.price_list.view. */
export const quotesExport: ExportDefinition<{ status?: string }, QuoteExportRow> = {
  code: "sales.quotes",
  title: "Quotations",
  permission: "sales.quote.export",
  sensitivity: "S",
  columns: [
    { header: "Quotation", value: (r) => r.quoteNumber },
    { header: "Status", value: (r) => r.status },
    { header: "Customer code", value: (r) => r.customerCode },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Valid until", value: (r) => r.validUntil },
    { header: "Subtotal", value: (r) => r.subtotalAmount, numeric: true, requires: "sales.price_list.view" },
    { header: "Tax", value: (r) => r.taxAmount, numeric: true, requires: "sales.price_list.view" },
    { header: "Total", value: (r) => r.totalAmount, numeric: true, requires: "sales.price_list.view" },
    { header: "Largest discount %", value: (r) => r.maxDiscountPct, numeric: true, requires: "sales.price_list.view" },
  ],
  fetch: async (ctx, f, limit) => (await listQuotes(ctx, f)).slice(0, limit),
  siteScope: (ctx) => [ctx.currentSiteId],
  fileName: () => "quotations",
};

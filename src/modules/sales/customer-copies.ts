import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { customers, products, quoteLines, quotes, salesOrderLines, salesOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { emailProvider, emailSetupStatus, sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { emailWentOut } from "@/lib/send-words";
import { idempotent, isUuid } from "./crm-support";

/**
 * ADR-131 (round 5 "Send really sends", C-office problem 2): a price offer or an order confirmation really reaches the
 * customer, by email (Brevo, ADR-118) or on paper. A price offer records when and how it was given
 * (`quotes.given_to_customer_at` / `given_via`), so its status says "Sent" only after that; before, "Ready to give the
 * customer". An email that is not set up or fails changes nothing and says so (Print instead). Emails are plain text
 * (no body is stored, ADR-118); the printable page is the same data. Idempotent on the key (no second email).
 */

const peso = (v: Decimal.Value) => `PHP ${new Decimal(v).toFixed(2)}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CustomerEmailResult = { to: string; outcome: string; given: boolean; replayed: boolean };

/** Whether the app can send email at all (for the screens: "Email is not set up: print it instead"). */
export function customerEmailReady(): { ready: boolean; problem: string | null } {
  const s = emailSetupStatus();
  return { ready: s.ready && emailProvider() !== "none", problem: s.problem };
}

async function loadQuote(ctx: AuthContext, quoteId: string) {
  if (!isUuid(quoteId)) throw new DomainError("not_found", "Price offer not found in your sites.");
  const [row] = await db
    .select({ q: quotes, c: customers })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Price offer not found in your sites.");
  return row;
}

/** "Email to <customer email>" on a ready price offer (`sales.quote.submit` at its site). */
export async function emailQuoteToCustomer(ctx: AuthContext, quoteId: string, input: { idempotencyKey?: string | null } = {}): Promise<CustomerEmailResult> {
  ctx.require("sales.quote.submit");
  const { q, c } = await loadQuote(ctx, quoteId);
  ctx.requireAt("sales.quote.submit", q.siteId);
  if (!["sent", "accepted"].includes(q.status)) throw new DomainError("state", `Price offer ${q.quoteNumber} is not ready to give the customer yet.`);
  const to = (c.email ?? "").trim();
  if (!EMAIL_RE.test(to)) throw new DomainError("validation", `${c.name} has no email address. Add it on the customer's page, or print the offer.`, { field: "email" });
  const lines = await db.select({ l: quoteLines, name: products.name }).from(quoteLines).innerJoin(products, eq(products.id, quoteLines.productId)).where(eq(quoteLines.quoteId, q.id)).orderBy(asc(quoteLines.lineNo));
  const text = [
    `Price offer ${q.quoteNumber} for ${c.name}`,
    `Good until ${q.validUntil}.`,
    "",
    ...lines.map((x) => `${x.l.lineNo}. ${x.name}: ${new Decimal(x.l.qtyUnits).toString()} pcs at ${peso(x.l.unitAmount)} each = ${peso(new Decimal(x.l.qtyUnits).times(x.l.unitAmount))}`),
    "",
    `Total ${peso(q.totalAmount)}${new Decimal(q.taxAmount).gt(0) ? " (with tax)" : ""}.`,
    q.notesCustomer ? `Note: ${q.notesCustomer}` : "",
    "Reply to this email or call us to order.",
  ].filter((x) => x !== null).join("\n");
  return deliver(ctx, { kind: "quote", id: q.id, number: q.quoteNumber, siteId: q.siteId, to, subject: `Price offer ${q.quoteNumber}`, text, template: "sales.quote", key: input.idempotencyKey ?? null });
}

/** "I printed it and gave it to the customer": records the price offer as given on paper (`sales.quote.submit`). */
export async function markQuoteGiven(ctx: AuthContext, quoteId: string) {
  ctx.require("sales.quote.submit");
  return db.transaction(async (tx) => {
    const [q] = isUuid(quoteId) ? await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.siteId, ctx.allowedSiteIds))).for("update").limit(1) : [];
    if (!q) throw new DomainError("not_found", "Price offer not found in your sites.");
    ctx.requireAt("sales.quote.submit", q.siteId);
    if (!["sent", "accepted", "converted"].includes(q.status)) throw new DomainError("state", `Price offer ${q.quoteNumber} is not ready to give the customer yet.`);
    if (q.givenVia) return { already: true };
    await tx.update(quotes).set({ givenToCustomerAt: new Date(), givenVia: "print", givenBy: ctx.userId, updatedAt: new Date() }).where(eq(quotes.id, q.id));
    await audit(tx, ctx, { action: "sales.quote.given_to_customer", entityType: "quote", entityId: q.id, entityNumber: q.quoteNumber, siteId: q.siteId, after: { via: "print" } });
    return { already: false };
  });
}

/** The order confirmation (what, how many, price, deliver by, can ship from): email to the customer (`sales.sales_order.submit`). */
export async function emailOrderConfirmation(ctx: AuthContext, orderId: string, input: { canShipFromText: string; idempotencyKey?: string | null }): Promise<CustomerEmailResult> {
  ctx.require("sales.sales_order.submit");
  if (!isUuid(orderId)) throw new DomainError("not_found", "Customer order not found in your sites.");
  const [row] = await db
    .select({ o: salesOrders, c: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Customer order not found in your sites.");
  const { o, c } = row;
  ctx.requireAt("sales.sales_order.submit", o.siteId);
  if (!["confirmed", "allocated", "picking", "packed", "partially_shipped"].includes(o.status)) throw new DomainError("state", `Order ${o.orderNumber} is not confirmed, so there is nothing to confirm to the customer.`);
  const to = (c.email ?? "").trim();
  if (!EMAIL_RE.test(to)) throw new DomainError("validation", `${c.name} has no email address. Add it on the customer's page, or print the confirmation.`, { field: "email" });
  const lines = await db.select({ l: salesOrderLines, name: products.name }).from(salesOrderLines).innerJoin(products, eq(products.id, salesOrderLines.productId)).where(eq(salesOrderLines.salesOrderId, o.id)).orderBy(asc(salesOrderLines.lineNo));
  const text = [
    `Order confirmation ${o.orderNumber} for ${c.name}`,
    o.customerPoNumber ? `Your order number: ${o.customerPoNumber}` : "",
    `Deliver by: ${o.requestedDeliveryOn ?? "to be agreed"}. ${input.canShipFromText}`,
    "",
    ...lines.filter((x) => new Decimal(x.l.qtyUnits).gt(0)).map((x) => `${x.l.lineNo}. ${x.name}: ${new Decimal(x.l.qtyUnits).toString()} pcs at ${peso(x.l.unitPrice)} each`),
    "",
    `Total ${peso(o.totalAmount)}.`,
    "Thank you for your order.",
  ].filter((x) => x !== "").join("\n");
  return deliver(ctx, { kind: "order", id: o.id, number: o.orderNumber, siteId: o.siteId, to, subject: `Order confirmation ${o.orderNumber}`, text, template: "sales.order_confirmation", key: input.idempotencyKey ?? null });
}

async function deliver(ctx: AuthContext, m: { kind: "quote" | "order"; id: string; number: string; siteId: string; to: string; subject: string; text: string; template: string; key: string | null }): Promise<CustomerEmailResult> {
  // One email per key: the key is claimed before sending; a repeat returns the first result and sends nothing.
  const claim = await db.transaction((tx) => idempotent(tx, ctx, m.key, `${m.template}.email`, async () => ({ to: m.to, outcome: "pending", given: false, replayed: false })));
  if (claim.replayed) return { ...claim.result, replayed: true };
  const res = await sendEmail({ to: m.to, subject: m.subject, text: m.text, template: m.template, organizationId: ctx.organizationId });
  const given = emailWentOut(res.status);
  await db.transaction(async (tx) => {
    if (given && m.kind === "quote") await tx.update(quotes).set({ givenToCustomerAt: new Date(), givenVia: "email", givenBy: ctx.userId, updatedAt: new Date() }).where(eq(quotes.id, m.id));
    await audit(tx, ctx, {
      action: m.kind === "quote" ? "sales.quote.emailed" : "sales.sales_order.confirmation_emailed",
      entityType: m.kind === "quote" ? "quote" : "sales_order",
      entityId: m.id,
      entityNumber: m.number,
      siteId: m.siteId,
      after: { to: m.to, status: res.status, provider: res.provider },
    });
  });
  return { to: m.to, outcome: res.status, given, replayed: false };
}

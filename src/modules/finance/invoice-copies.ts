import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { customers, invoiceLines, invoices } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { emailWentOut } from "@/lib/send-words";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { isUuid } from "./shared";

/**
 * ADR-131 (round 5 "Send really sends", C-office problem 2): a booked invoice really reaches the customer, by email
 * (Brevo, ADR-118) or on paper, and records when and how (`invoices.given_to_customer_at` / `given_via`). Until then
 * the invoice reads "In the books – not given to the customer yet". Email trouble changes nothing and says so.
 * Permission: `finance.invoice.post` at the invoice's site (whoever saves invoices to the books gives them out).
 */
const peso = (v: Decimal.Value) => `PHP ${new Decimal(v).toFixed(2)}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GIVEABLE = ["issued", "partially_paid", "paid"];

async function load(ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Invoice not found in your sites.");
  const [row] = await db
    .select({ i: invoices, c: customers })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.organizationId), inArray(invoices.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Invoice not found in your sites.");
  ctx.requireAt("finance.invoice.post", row.i.siteId);
  if (!GIVEABLE.includes(row.i.status) || !row.i.invoiceNumber) throw new DomainError("state", "Save the invoice to the books first; then give it to the customer.");
  return row;
}

export async function emailInvoiceToCustomer(ctx: AuthContext, id: string, input: { idempotencyKey?: string | null } = {}) {
  ctx.require("finance.invoice.post");
  const { i, c } = await load(ctx, id);
  const to = (c.email ?? "").trim();
  if (!EMAIL_RE.test(to)) throw new DomainError("validation", `${c.name} has no email address. Add it on the customer's page, or print the invoice.`, { field: "email" });
  if (input.idempotencyKey) {
    const replay = await db.transaction((tx) => claimIdempotencyKey<{ to: string; outcome: string; given: boolean }>(tx, ctx.organizationId, input.idempotencyKey!, "finance.invoice.email", { id }));
    if (replay) return { ...replay.replay, replayed: true };
  }
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, i.id)).orderBy(asc(invoiceLines.lineNo));
  const text = [
    `Invoice ${i.invoiceNumber} for ${c.name}`,
    `Date ${i.issueDate}. Please pay by ${i.dueDate}.`,
    "",
    ...lines.map((l) => `${l.lineNo}. ${l.description}: ${new Decimal(l.qty).toString()} ${l.uom} at ${peso(l.unitAmount)} = ${peso(l.totalAmount)}`),
    "",
    `Total ${peso(i.totalAmount)}${new Decimal(i.taxAmount).gt(0) ? ` (tax ${peso(i.taxAmount)})` : ""}.`,
    `Please quote ${i.invoiceNumber} when you pay.`,
  ].join("\n");
  const res = await sendEmail({ to, subject: `Invoice ${i.invoiceNumber}`, text, template: "finance.invoice", organizationId: ctx.organizationId });
  const given = emailWentOut(res.status);
  const result = { to, outcome: res.status as string, given };
  await db.transaction(async (tx) => {
    if (given && !i.givenVia) await tx.update(invoices).set({ givenToCustomerAt: new Date(), givenVia: "email", givenBy: ctx.userId, updatedAt: new Date() }).where(eq(invoices.id, i.id));
    await audit(tx, ctx, { action: "finance.invoice.emailed", entityType: "invoice", entityId: i.id, entityNumber: i.invoiceNumber, siteId: i.siteId, after: { to, status: res.status, provider: res.provider } });
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
  });
  return { ...result, replayed: false };
}

/** "I printed it and gave it to the customer". */
export async function markInvoiceGiven(ctx: AuthContext, id: string) {
  ctx.require("finance.invoice.post");
  const { i } = await load(ctx, id);
  if (i.givenVia) return { already: true };
  await db.transaction(async (tx) => {
    await tx.update(invoices).set({ givenToCustomerAt: new Date(), givenVia: "print", givenBy: ctx.userId, updatedAt: new Date() }).where(eq(invoices.id, i.id));
    await audit(tx, ctx, { action: "finance.invoice.given_to_customer", entityType: "invoice", entityId: i.id, entityNumber: i.invoiceNumber, siteId: i.siteId, after: { via: "print" } });
  });
  return { already: false };
}

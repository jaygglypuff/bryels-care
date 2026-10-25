import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { customers, salesOrderLines, salesOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { isUuid, money, salesTaxRatePct } from "./crm-support";

/**
 * Credit check at order submission (W09-03, A-PROC-14, docs/modules/finance.md A-FIN-27).
 *
 * Finance (Phase 6) will provide the customer's open receivables and overdue invoices. Until then the
 * exposure is the value of the customer's accepted, not yet closed orders (confirmed through invoiced,
 * all sites of the organization) — an interim stand-in for the open balance recorded as A-W3D-07.
 * The check fails when the customer is on credit hold, when exposure + this order exceeds the credit
 * limit, or — only if setting `sales.credit_check.require_limit` is on — when no limit is set. The
 * outcome feeds the `approval_rules` basis `credit_check_failed`; no tax, legal or payment rule is
 * decided here.
 */

/** Order states whose value counts as credit exposure. */
export const EXPOSURE_STATUSES = ["confirmed", "allocated", "picking", "packed", "partially_shipped", "shipped", "invoiced"] as const;

/** Sum of line values × (1 + tax rate) of the customer's exposure orders, excluding one order. */
export async function creditExposure(q: DbOrTx, organizationId: string, customerId: string, excludeOrderId?: string | null): Promise<Decimal> {
  const where = [eq(salesOrders.organizationId, organizationId), eq(salesOrders.customerId, customerId), inArray(salesOrders.status, [...EXPOSURE_STATUSES])];
  if (excludeOrderId) where.push(ne(salesOrders.id, excludeOrderId));
  const [r] = await q
    .select({ v: sql<string>`coalesce(sum(${salesOrderLines.qtyUnits} * ${salesOrderLines.unitPrice}), 0)::text` })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(...where));
  const rate = await salesTaxRatePct(q, organizationId);
  return new Decimal(r?.v ?? 0).times(new Decimal(100).plus(rate)).div(100);
}

export type CreditOutcome = {
  failed: boolean;
  status: "passed" | "failed" | "not_required";
  reasons: { code: "credit_hold" | "credit_limit" | "no_credit_limit"; message: string }[];
  exposure: string;
  limit: string | null;
  available: string | null;
};

export async function evaluateCredit(q: DbOrTx, organizationId: string, customer: { id: string; status: string; creditLimitAmount: string | null }, orderTotal: Decimal.Value, excludeOrderId?: string | null): Promise<CreditOutcome> {
  const exposure = await creditExposure(q, organizationId, customer.id, excludeOrderId);
  const reasons: CreditOutcome["reasons"] = [];
  if (customer.status === "on_hold") reasons.push({ code: "credit_hold", message: "Customer is on credit hold" });
  let available: Decimal | null = null;
  if (customer.creditLimitAmount !== null) {
    available = new Decimal(customer.creditLimitAmount).minus(exposure);
    if (exposure.plus(orderTotal).gt(customer.creditLimitAmount)) reasons.push({ code: "credit_limit", message: "Over credit limit" });
  } else if (await getSetting(q, organizationId, "sales.credit_check.require_limit")) {
    reasons.push({ code: "no_credit_limit", message: "No credit limit set for this customer" });
  }
  return {
    failed: reasons.length > 0,
    status: reasons.length ? "failed" : customer.creditLimitAmount === null && customer.status !== "on_hold" ? "not_required" : "passed",
    reasons,
    exposure: money(exposure),
    limit: customer.creditLimitAmount === null ? null : money(customer.creditLimitAmount),
    available: available === null ? null : money(available),
  };
}

/** Credit summary for the customer page (finance.credit_terms.view only, US-4-01 AC1). */
export async function creditSummary(ctx: AuthContext, customerId: string) {
  ctx.require("finance.credit_terms.view");
  if (!isUuid(customerId)) throw new DomainError("not_found", "Customer not found.");
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId))).limit(1);
  if (!c) throw new DomainError("not_found", "Customer not found.");
  const exposure = await creditExposure(db, ctx.organizationId, c.id);
  return {
    limit: c.creditLimitAmount === null ? null : money(c.creditLimitAmount),
    paymentTermsDays: c.paymentTermsDays,
    exposure: money(exposure),
    available: c.creditLimitAmount === null ? null : money(new Decimal(c.creditLimitAmount).minus(exposure)),
    onHold: c.status === "on_hold",
    usedPct: c.creditLimitAmount && new Decimal(c.creditLimitAmount).gt(0) ? Math.min(999, exposure.div(c.creditLimitAmount).times(100).round().toNumber()) : null,
  };
}

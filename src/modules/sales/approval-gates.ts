import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { customerRequirements, customers, priceLists, quotes, salesOrders, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type ApprovalVerdict, OWN_REQUEST_REASON, selfApprovalNote, sodRequired, stepVerdict } from "@/modules/governance";
import { approvalProgress } from "./crm-approvals";
import { canSeePrices } from "./crm-support";
import { REQUIREMENT_KIND_LABEL } from "./requirements";

/**
 * "To approve" verdicts for commercial records (ADR-075, ADR-082 §4; registered in src/modules/wiring.ts):
 * the same steps, roles and same-person rules as `approveOrder`, `approveQuote`, `approvePriceList` and
 * `approveRequirement`, read only, caller's sites only. Money is shown only to holders of
 * `sales.price_list.view`, as on the record pages. Sales orders say why they need approval (the reasons
 * stored at submission: credit hold, over the credit limit, discount, order value).
 */
const submitter = alias(users, "submitter");
const approversOf = (p: { steps: { approvals: { by: string }[] }[] }) => p.steps.flatMap((s) => s.approvals.map((a) => a.by));

export async function salesOrderApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ o: salesOrders, customer: customers.name, by: submitter.displayName })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(submitter, eq(submitter.id, salesOrders.submittedBy))
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.id, ids), inArray(salesOrders.siteId, ctx.allowedSiteIds), eq(salesOrders.status, "pending_approval")));
  const sod = rows.length ? await sodRequired(db, ctx.organizationId, "sales_order") : true;
  const prices = canSeePrices(ctx);
  for (const { o, customer, by } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "sales_order", recordId: o.id, siteId: o.siteId, basis: (o.approvalBasis ?? {}) as Record<string, string | boolean> });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: "sales.sales_order.approve", siteId: o.siteId, pendingSince: o.submittedAt, excludedUserIds: [o.createdBy, o.submittedBy], priorApproverIds: approversOf(progress), sod, operational: true });
    const why = (o.approvalReasons ?? []).map((r) => r.message).filter(Boolean);
    out.set(o.id, {
      ...v,
      requestedById: o.submittedBy ?? o.createdBy,
      requestedByName: by,
      amount: prices ? o.totalAmount : null,
      currency: o.currency,
      title: `Order from ${customer}`,
      why: why.length ? `Needs approval: ${why.join(" · ")}` : null,
    });
  }
  return out;
}

export async function quoteApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ q: quotes, customer: customers.name, by: submitter.displayName })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .leftJoin(submitter, eq(submitter.id, quotes.submittedBy))
    .where(and(eq(quotes.organizationId, ctx.organizationId), inArray(quotes.id, ids), inArray(quotes.siteId, ctx.allowedSiteIds), eq(quotes.status, "pending_approval")));
  const sod = rows.length ? await sodRequired(db, ctx.organizationId, "quote") : true;
  const prices = canSeePrices(ctx);
  for (const { q, customer, by } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "quote", recordId: q.id, siteId: q.siteId, basis: { discount_pct: q.maxDiscountPct } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: "sales.quote.approve", siteId: q.siteId, pendingSince: q.submittedAt, excludedUserIds: [q.createdBy, q.submittedBy], priorApproverIds: approversOf(progress), sod, operational: true });
    const discount = new Decimal(q.maxDiscountPct ?? 0).gt(0) && prices ? `Needs approval: price up to ${new Decimal(q.maxDiscountPct).toDecimalPlaces(1).toString()} % below the price list` : null;
    out.set(q.id, { ...v, requestedById: q.submittedBy ?? q.createdBy, requestedByName: by, amount: prices ? q.totalAmount : null, currency: q.currency, title: `Quotation for ${customer}`, why: discount });
  }
  return out;
}

export async function priceListApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length) return out;
  const rows = await db
    .select({ p: priceLists, by: submitter.displayName })
    .from(priceLists)
    .leftJoin(submitter, eq(submitter.id, priceLists.submittedBy))
    .where(and(eq(priceLists.organizationId, ctx.organizationId), inArray(priceLists.id, ids), eq(priceLists.status, "pending_approval")));
  for (const { p, by } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "price_list", recordId: p.id, siteId: null, basis: {} });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: "sales.price_list.approve", siteId: null, pendingSince: p.submittedAt, excludedUserIds: [p.submittedBy, p.updatedBy, p.createdBy], priorApproverIds: approversOf(progress), operational: true });
    out.set(p.id, { ...v, requestedById: p.submittedBy, requestedByName: by, title: `Price list ${p.name} (version ${p.versionNo})`, why: p.changeSummary ? p.changeSummary.slice(0, 160) : null });
  }
  return out;
}

export async function customerRequirementApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length) return out;
  const rows = await db
    .select({ r: customerRequirements, customer: customers.name, by: submitter.displayName })
    .from(customerRequirements)
    .innerJoin(customers, eq(customers.id, customerRequirements.customerId))
    .leftJoin(submitter, eq(submitter.id, customerRequirements.submittedBy))
    .where(and(eq(customerRequirements.organizationId, ctx.organizationId), inArray(customerRequirements.id, ids), eq(customerRequirements.status, "pending_approval")));
  for (const { r, customer, by } of rows) {
    const kind = REQUIREMENT_KIND_LABEL[r.requirementKind as keyof typeof REQUIREMENT_KIND_LABEL] ?? r.requirementKind.replace(/_/g, " ");
    const value = r.valueNumeric ?? r.valueText ?? null;
    const own = ctx.sodConflictAt(r.submittedBy, null) || ctx.sodConflictAt(r.createdBy, null);
    const may = ctx.can("masterdata.customer_requirement.approve");
    out.set(r.id, {
      canDecide: may && !own,
      waitingForRoles: [],
      stepLabel: null,
      blockedReason: may && own ? OWN_REQUEST_REASON : null,
      ...(may && !own && ctx.selfApprovesAt(null) && [r.submittedBy, r.createdBy].includes(ctx.userId) ? { ownRequest: true, selfApprovalNote: selfApprovalNote(ctx) } : {}),
      requestedById: r.submittedBy ?? r.createdBy,
      requestedByName: by,
      title: `${customer}: ${kind}${value ? ` ${String(value).replace(/\.0+$/, "")}` : ""} (version ${r.versionNo})`,
      why: r.changeSummary ? r.changeSummary.slice(0, 160) : null,
    });
  }
  return out;
}

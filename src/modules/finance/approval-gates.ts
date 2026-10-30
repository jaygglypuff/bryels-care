import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, expenseClaims, invoices, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type ApprovalVerdict, stepVerdict } from "@/modules/governance";
import { BASE_APPROVE, approvalProgress } from "./approvals";
import { expenseCategories } from "./expenses";

/**
 * "To approve" verdicts for finance records (ADR-075, ADR-082 §4; registered in src/modules/wiring.ts):
 * the same step / role / same-person rules as `decideExpenseClaim` and `approveInvoice`, read only.
 * Only records at the caller's sites are returned; anything else is simply absent.
 */
export async function expenseClaimApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ c: expenseClaims, claimant: users.displayName })
    .from(expenseClaims)
    .innerJoin(users, eq(users.id, expenseClaims.claimantUserId))
    .where(and(eq(expenseClaims.organizationId, ctx.organizationId), inArray(expenseClaims.id, ids), inArray(expenseClaims.siteId, ctx.allowedSiteIds), eq(expenseClaims.status, "submitted")));
  const cats = rows.length ? await expenseCategories(ctx.organizationId) : [];
  for (const { c, claimant } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "expense_claim", recordId: c.id, siteId: c.siteId, basis: { amount: c.amount } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: BASE_APPROVE.expense_claim, siteId: c.siteId, pendingSince: c.submittedAt, excludedUserIds: [c.claimantUserId], priorApproverIds: progress.approvers });
    const category = cats.find((x) => x.code === c.categoryCode)?.label ?? null;
    out.set(c.id, {
      ...v,
      requestedById: c.claimantUserId,
      requestedByName: claimant,
      amount: c.amount,
      currency: c.currency,
      title: `Expense claim from ${claimant}${category ? ` · ${category}` : ""}`,
      why: c.description ? c.description.slice(0, 160) : null,
    });
  }
  return out;
}

export async function invoiceApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ i: invoices, customer: customers.name, submitter: users.displayName })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(users, eq(users.id, invoices.submittedBy))
    .where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.id, ids), inArray(invoices.siteId, ctx.allowedSiteIds), eq(invoices.status, "submitted")));
  for (const { i, customer, submitter } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "invoice", recordId: i.id, siteId: i.siteId, basis: { amount: i.totalAmount } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: BASE_APPROVE.invoice, siteId: i.siteId, pendingSince: i.submittedAt, excludedUserIds: [i.createdBy, i.submittedBy], priorApproverIds: progress.approvers });
    out.set(i.id, { ...v, requestedById: i.submittedBy, requestedByName: submitter, amount: i.totalAmount, currency: i.currency, title: `Invoice for ${customer}` });
  }
  return out;
}

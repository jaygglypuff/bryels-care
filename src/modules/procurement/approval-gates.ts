import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { purchaseOrders, purchaseRequests, supplierReturns, suppliers, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type ApprovalVerdict, stepVerdict } from "@/modules/governance";
import { BASE_APPROVE, approvalProgress } from "./approvals";

/**
 * "To approve" verdicts for purchase requests, purchase orders and supplier returns (ADR-075, ADR-082 §4;
 * registered in src/modules/wiring.ts). Same steps, roles and same-person rules as the decide services
 * (`decidePurchaseRequest`, `decidePurchaseOrder`, `decideSupplierReturn`), read only, caller's sites only.
 */
const approversOf = (p: { steps: { approvals: { by: string }[] }[] }) => p.steps.flatMap((s) => s.approvals.map((a) => a.by));
const submitter = alias(users, "submitter");

export async function purchaseRequestApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ r: purchaseRequests, requester: users.displayName })
    .from(purchaseRequests)
    .leftJoin(users, eq(users.id, purchaseRequests.requestedBy))
    .where(and(eq(purchaseRequests.organizationId, ctx.organizationId), inArray(purchaseRequests.id, ids), inArray(purchaseRequests.siteId, ctx.allowedSiteIds), eq(purchaseRequests.status, "submitted")));
  for (const { r, requester } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "purchase_request", recordId: r.id, siteId: r.siteId, basis: { amount: r.estimatedTotalAmount ?? "unbounded" } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: BASE_APPROVE.purchase_request, siteId: r.siteId, pendingSince: r.submittedAt, excludedUserIds: [r.createdBy, r.requestedBy, r.submittedBy], priorApproverIds: approversOf(progress) });
    out.set(r.id, { ...v, requestedById: r.requestedBy, requestedByName: requester, amount: r.estimatedTotalAmount, currency: r.currency, why: r.justification ? r.justification.slice(0, 160) : null });
  }
  return out;
}

export async function purchaseOrderApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ o: purchaseOrders, supplier: suppliers.name, by: submitter.displayName })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(submitter, eq(submitter.id, purchaseOrders.submittedBy))
    .where(and(eq(purchaseOrders.organizationId, ctx.organizationId), inArray(purchaseOrders.id, ids), inArray(purchaseOrders.siteId, ctx.allowedSiteIds), eq(purchaseOrders.status, "submitted")));
  for (const { o, supplier, by } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "purchase_order", recordId: o.id, siteId: o.siteId, basis: { amount: o.totalAmount } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: BASE_APPROVE.purchase_order, siteId: o.siteId, pendingSince: o.submittedAt, excludedUserIds: [o.createdBy, o.submittedBy], priorApproverIds: approversOf(progress) });
    out.set(o.id, { ...v, requestedById: o.submittedBy, requestedByName: by, amount: o.totalAmount, currency: o.currency, title: `Purchase order to ${supplier}`, why: o.isUrgent ? `Urgent${o.urgentReason ? `: ${o.urgentReason}` : ""}` : null });
  }
  return out;
}

export async function supplierReturnApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ r: supplierReturns, supplier: suppliers.name, by: submitter.displayName })
    .from(supplierReturns)
    .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
    .leftJoin(submitter, eq(submitter.id, supplierReturns.submittedBy))
    .where(and(eq(supplierReturns.organizationId, ctx.organizationId), inArray(supplierReturns.id, ids), inArray(supplierReturns.siteId, ctx.allowedSiteIds), eq(supplierReturns.status, "submitted")));
  for (const { r, supplier, by } of rows) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "supplier_return", recordId: r.id, siteId: r.siteId, basis: { amount: r.creditExpectedAmount ?? "unbounded" } });
    const v = stepVerdict(ctx, { step: progress.next, stepsCount: progress.steps.length, basePermission: BASE_APPROVE.supplier_return, siteId: r.siteId, pendingSince: r.submittedAt, excludedUserIds: [r.createdBy, r.submittedBy], priorApproverIds: approversOf(progress) });
    out.set(r.id, { ...v, requestedById: r.submittedBy, requestedByName: by, amount: r.creditExpectedAmount, currency: r.currency, title: `Return to ${supplier}`, why: r.reasonNote ? r.reasonNote.slice(0, 160) : null });
  }
  return out;
}

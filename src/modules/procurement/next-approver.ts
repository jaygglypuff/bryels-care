import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { purchaseOrders, purchaseRequests, supplierReturns } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { fmtDayMonth } from "@/lib/qty";
import { HANDOFFS, type HandoffKind, type NextActors, nextActors, approvalStepRecord } from "@/modules/governance";
import { approvalProgress, type ProcRecordType } from "./approvals";

/**
 * Who does the next step of a purchase request, purchase order or supplier return (docs/NEXT_APPROVER.md): the open
 * approval step's roles (step 1 the site manager, step 2 the owner above the amount, A-PM-15), never the creator or
 * submitter (ADR-091: unless a top role at the site), never an earlier step's approver; after approval, who sends the
 * order. Null when nobody waits (draft, closed, cancelled). The record must be at one of the viewer's sites.
 */
export async function procurementNextActors(ctx: AuthContext, recordType: ProcRecordType, id: string, q: DbOrTx = db): Promise<NextActors | null> {
  const rec = await load(q, ctx, recordType, id);
  if (!rec || !ctx.allowedSiteIds.includes(rec.siteId)) return null;
  if (rec.status === "approved" && recordType === "purchase_order") return nextActors(ctx, "purchase_order_send", { siteId: rec.siteId }, q);
  // Live check 2026-11-06: a sent order names who receives it and when ("Next: Lito (warehouse) receives it when it
  // arrives on 11 Nov"), the same people the "Delivery coming" message went to (orders.ts, ADR-110 C9).
  if (recordType === "purchase_order" && (rec.status === "sent" || rec.status === "partially_received")) {
    const on = rec.due ? ` on ${fmtDayMonth(rec.due)}` : "";
    const rule = HANDOFFS.delivery_coming;
    return nextActors(ctx, { ...rule, kind: "delivery_coming", does: `${rule.does}${on}`, doBase: `${rule.doBase}${on}` }, { siteId: rec.siteId }, q);
  }
  if (rec.status !== "submitted") return null;
  const progress = await approvalProgress(q, ctx.organizationId, { recordType, recordId: rec.id, siteId: rec.siteId, basis: { amount: rec.amount ?? "unbounded" } });
  const kind: HandoffKind = recordType;
  return nextActors(ctx, kind, approvalStepRecord({ siteId: rec.siteId, excludeUserIds: rec.excluded }, progress, rec.submittedAt), q);
}

async function load(q: DbOrTx, ctx: AuthContext, t: ProcRecordType, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (t === "purchase_order") {
    const [r] = await q.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
    return r ? { id: r.id, siteId: r.siteId, status: r.status as string, submittedAt: r.submittedAt, amount: r.totalAmount as string | null, excluded: [r.createdBy, r.submittedBy], due: (r.promisedDate ?? r.expectedDate) as string | null } : null;
  }
  if (t === "purchase_request") {
    const [r] = await q.select().from(purchaseRequests).where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.organizationId, ctx.organizationId))).limit(1);
    return r ? { id: r.id, siteId: r.siteId, status: r.status as string, submittedAt: r.submittedAt, amount: r.estimatedTotalAmount, excluded: [r.createdBy, r.requestedBy, r.submittedBy] } : null;
  }
  const [r] = await q.select().from(supplierReturns).where(and(eq(supplierReturns.id, id), eq(supplierReturns.organizationId, ctx.organizationId))).limit(1);
  return r ? { id: r.id, siteId: r.siteId, status: r.status as string, submittedAt: r.submittedAt, amount: r.creditExpectedAmount, excluded: [r.createdBy, r.submittedBy] } : null;
}

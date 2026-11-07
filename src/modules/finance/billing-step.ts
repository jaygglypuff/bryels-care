import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, salesOrders, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { BILLING_STAGE_ORDER, type BillingStep, billingStageOf } from "@/lib/billing-step-words";
import { DomainError } from "@/lib/errors";
import type { NextActors } from "@/lib/next-actors-words";
import type { Permission } from "@/lib/permissions";
import { type AdHocHandoff, approvalStepRecord, nextActors } from "@/modules/governance";
import { approvalProgress } from "./approvals";
import { isUuid } from "./shared";

/**
 * The billing step of a delivery or a customer order (ADR-124 item 1): the delivery's "What to do next" follows its
 * invoice, with the people who act next by name (ADR-109). The same stages are the "How work flows" invoice counts
 * (`not_billed`, `inv_draft`, `inv_to_approve`, `inv_approved`; src/modules/analytics/work-flow.ts).
 *
 * - Who may ask: anyone who may see deliveries (`sales.shipment.view`) or invoices (`finance.invoice.view`) at the
 *   delivery's site; another site's delivery is "not found". Viewers who may not open invoices get the stage and the
 *   names but no invoice id or number.
 * - Sent for approval: `nextActors("invoice")` with the open step's roles, the creator and the sender kept out and the
 *   earlier approvers (the same record as To approve, `approvalNext` in src/app/(app)/finance/approval-waiting.ts);
 *   the ADR-122 owner fallback applies there. Approved: who saves it to the books (never an approver when the rules
 *   forbid it). A hint only: the finance commands re-check everything.
 */

const MAKE: AdHocHandoff = { kind: "invoice_make", permission: "finance.invoice.create", does: "makes the invoice", doBase: "make the invoice", where: "in Invoices", fallback: "finance", prefer: ["finance", "sales_cs"] };
const SEND: AdHocHandoff = { kind: "invoice_send", permission: "finance.invoice.submit", does: "sends the invoice for approval", doBase: "send the invoice for approval", where: "in Invoices", fallback: "finance", prefer: ["finance", "sales_cs"] };
const POST: AdHocHandoff = { kind: "finance_post.invoice", permission: "finance.invoice.post", does: "saves it to the books", doBase: "save it to the books", where: "on the invoice", fallback: "finance", operational: true, prefer: ["finance", "owner_director"] };

const LIVE = sql`${invoices.status} not in ('cancelled', 'voided')`;

function requireViewer(ctx: AuthContext) {
  if (!ctx.can("sales.shipment.view") && !ctx.can("finance.invoice.view")) throw new DomainError("forbidden", "Your role cannot see deliveries or invoices.");
}

async function stepOf(ctx: AuthContext, siteId: string, inv: typeof invoices.$inferSelect | null): Promise<BillingStep> {
  const stage = billingStageOf(inv?.status);
  const mayOpen = ctx.canAt("finance.invoice.view", siteId);
  const invoice = inv && mayOpen ? { id: inv.id, number: inv.invoiceNumber, status: inv.status } : null;
  let next: NextActors | null = null;
  if (stage === "not_billed") next = await nextActors(ctx, MAKE, { siteId }).catch(() => null);
  else if (stage === "draft") next = await nextActors(ctx, SEND, { siteId }).catch(() => null);
  else if (inv && (stage === "submitted" || stage === "approved")) {
    const progress = await approvalProgress(db, ctx.organizationId, { recordType: "invoice", recordId: inv.id, siteId: inv.siteId, basis: { amount: inv.totalAmount }, requesterIds: [inv.createdBy, inv.submittedBy] });
    if (stage === "submitted" && progress.next)
      next = await nextActors(ctx, "invoice", { ...approvalStepRecord({ siteId: inv.siteId, excludeUserIds: [inv.createdBy, inv.submittedBy] }, progress, inv.submittedAt), roleStandIn: false }).catch(() => null);
    else {
      const approvers = progress.posterMayEqualApprover ? [] : progress.approvers;
      next = await nextActors(ctx, POST, { siteId: inv.siteId, excludeUserIds: approvers }).catch(() => null);
    }
  }
  return { stage, invoice, next };
}

/** The newest live invoice of each shipment (cancelled and voided ones do not count). */
async function liveInvoices(ctx: AuthContext, shipmentIds: string[]) {
  if (!shipmentIds.length) return new Map<string, typeof invoices.$inferSelect>();
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, ctx.organizationId), inArray(invoices.shipmentId, shipmentIds), LIVE))
    .orderBy(desc(invoices.createdAt));
  const out = new Map<string, typeof invoices.$inferSelect>();
  for (const r of rows) if (r.shipmentId && !out.has(r.shipmentId)) out.set(r.shipmentId, r);
  return out;
}

/** The billing step of one delivery (sent out or delivered; null before it is sent out or after it was reversed). */
export async function billingStepOfShipment(ctx: AuthContext, shipmentId: string): Promise<BillingStep | null> {
  requireViewer(ctx);
  if (!isUuid(shipmentId)) throw new DomainError("not_found", "Delivery not found in your sites.");
  const [s] = await db
    .select({ id: shipments.id, siteId: shipments.siteId, status: shipments.status })
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!s) throw new DomainError("not_found", "Delivery not found in your sites.");
  ctx.requireSite(s.siteId);
  if (!ctx.canAt("sales.shipment.view" as Permission, s.siteId) && !ctx.canAt("finance.invoice.view", s.siteId)) throw new DomainError("forbidden", "Your role cannot see deliveries or invoices at this site.");
  if (!["dispatched", "delivered"].includes(s.status)) return null;
  const inv = (await liveInvoices(ctx, [s.id])).get(s.id) ?? null;
  return stepOf(ctx, s.siteId, inv);
}

/**
 * The billing step of a customer order: the delivery furthest behind among those sent out (an order sent in two parts
 * reads "finance bills it" until both are billed). Null when nothing is sent out yet.
 */
export async function billingStepOfOrder(ctx: AuthContext, orderId: string): Promise<(BillingStep & { shipmentId: string; deliveries: number }) | null> {
  requireViewer(ctx);
  if (!isUuid(orderId)) throw new DomainError("not_found", "Order not found in your sites.");
  const [o] = await db
    .select({ id: salesOrders.id, siteId: salesOrders.siteId })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!o) throw new DomainError("not_found", "Order not found in your sites.");
  ctx.requireSite(o.siteId);
  if (!ctx.canAt("sales.shipment.view" as Permission, o.siteId) && !ctx.canAt("finance.invoice.view", o.siteId)) throw new DomainError("forbidden", "Your role cannot see deliveries or invoices at this site.");
  const sent = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.salesOrderId, o.id), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.status, ["dispatched", "delivered"])))
    .orderBy(shipments.createdAt);
  if (!sent.length) return null;
  const live = await liveInvoices(ctx, sent.map((s) => s.id));
  const rank = (id: string) => BILLING_STAGE_ORDER.indexOf(billingStageOf(live.get(id)?.status));
  const behind = [...sent].sort((a, z) => rank(a.id) - rank(z.id))[0];
  return { ...(await stepOf(ctx, o.siteId, live.get(behind.id) ?? null)), shipmentId: behind.id, deliveries: sent.length };
}

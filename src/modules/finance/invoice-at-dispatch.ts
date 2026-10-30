import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { customers, invoices, salesOrders, shipments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { systemContext } from "@/lib/auth/system";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
// Direct import (not the platform index), like the other modules that notify from inside a transaction.
import { notifyUsers, usersHoldingPermissionAt } from "@/modules/platform/notifications";
import { POSTED_INVOICE_STATUSES, createInvoiceFromShipment } from "./invoices";
import { logTransition, money } from "./shared";

/**
 * Invoice draft at dispatch (consultant review 2026-10-30, flow C: "17 shipments never invoiced").
 *
 * When a shipment is dispatched, the invoice draft for it is created in the dispatch transaction by the
 * existing service `createInvoiceFromShipment` (same lines, prices, tax code and checks as "Create invoice
 * from a dispatched order"), run as the system actor `system:finance.invoice_draft_at_dispatch` on behalf of
 * the dispatcher. Nothing else changes: the draft is still checked, submitted, approved (submitter ≠
 * approver, approval rules by amount) and issued by people, with the issue password.
 *
 * - Once per shipment: the idempotency key `invoice-at-dispatch:<shipment id>` and the service's own
 *   "one live invoice per shipment" rule; a dispatch replay never reaches the hook.
 * - Never blocks the dispatch: the draft is made inside a savepoint; when it cannot be made (no reviewed tax
 *   code, other currency …) the savepoint rolls back, the failure is audited and the people who create
 *   invoices at the site are told; the shipment stays in "Not invoiced" until someone creates it.
 * - Setting `finance.invoice.draft_at_dispatch` (organization or site, default on, A-WD-03).
 * - Reversal: a draft made at dispatch and not yet submitted is cancelled with the reversal reason; anything
 *   finance has moved on (submitted, approved, issued) still blocks the reversal (`invoiceBlockingShipmentReversal`).
 */

const SYSTEM = { code: "finance.invoice_draft_at_dispatch", systemPermissions: ["finance.invoice.view", "finance.invoice.create"] as Permission[] };

/** Idempotency key of the draft made at dispatch (also stored on the invoice row). */
export const dispatchDraftKey = (shipmentId: string) => `invoice-at-dispatch:${shipmentId}`;

async function shipmentLabel(tx: Tx, shipmentId: string) {
  const [r] = await tx
    .select({ dr: shipments.deliveryReceiptNumber, number: shipments.shipmentNumber, customer: customers.name })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  return { doc: r?.dr ?? r?.number ?? "the shipment", customer: r?.customer ?? null };
}

/** `onDispatched` hook: creates the invoice draft of the shipment in the dispatch transaction (see above). */
export async function draftInvoiceAtDispatch(tx: Tx, ctx: AuthContext, shipment: { shipmentId: string; siteId: string }): Promise<{ invoiceId: string } | null> {
  if (!(await getSetting(tx, ctx.organizationId, "finance.invoice.draft_at_dispatch", shipment.siteId))) return null;
  const sys = await systemContext(ctx.organizationId, SYSTEM, { onBehalfOf: ctx.userId, correlationId: ctx.correlationId });
  const label = await shipmentLabel(tx, shipment.shipmentId);
  const notifyAt = async (permission: Permission, n: { title: string; body: string; link: string; key: string; severity: "info" | "warning"; entityId: string | null }) => {
    const to = (await usersHoldingPermissionAt(tx, ctx.organizationId, permission, shipment.siteId)).filter((u) => u !== ctx.userId);
    await notifyUsers(tx, to, { organizationId: ctx.organizationId, siteId: shipment.siteId, kind: "finance.invoice.draft_at_dispatch", severity: n.severity, title: n.title, body: n.body, entityType: n.entityId ? "invoice" : "shipment", entityId: n.entityId ?? shipment.shipmentId, link: n.link, dedupeKey: n.key });
  };
  try {
    const r = await createInvoiceFromShipment(sys, { shipmentId: shipment.shipmentId, idempotencyKey: dispatchDraftKey(shipment.shipmentId) }, { tx });
    const [inv] = await tx.select({ total: invoices.totalAmount, currency: invoices.currency }).from(invoices).where(eq(invoices.id, r.invoiceId)).limit(1);
    await notifyAt("finance.invoice.submit", {
      title: `Invoice draft ready for ${label.doc}${label.customer ? ` (${label.customer})` : ""}`,
      body: `Dispatched by ${ctx.displayName}. Total ${inv ? `${money(inv.total)} ${inv.currency}` : "—"}. Check it and submit it for approval.`,
      link: `/finance/invoices/${r.invoiceId}`,
      key: `invoice.draft_at_dispatch:${shipment.shipmentId}`,
      severity: "info",
      entityId: r.invoiceId,
    });
    return r;
  } catch (e) {
    // A draft that already exists (made by hand in the meantime) is not a failure.
    if (e instanceof DomainError && e.code === "conflict" && (e.details as { code?: string } | undefined)?.code === "DUPLICATE_DOCUMENT") return null;
    const message = e instanceof Error ? e.message : String(e);
    await audit(tx, sys, {
      action: "finance.invoice.draft_at_dispatch_failed",
      entityType: "shipment",
      entityId: shipment.shipmentId,
      entityNumber: label.doc,
      siteId: shipment.siteId,
      reason: message.slice(0, 500),
    });
    await notifyAt("finance.invoice.create", {
      title: `Invoice draft for ${label.doc} could not be created`,
      body: `${message.slice(0, 300)} The shipment is dispatched; create its invoice from Finance → Invoices once this is fixed.`,
      link: "/finance/invoices",
      key: `invoice.draft_at_dispatch.failed:${shipment.shipmentId}`,
      severity: "warning",
      entityId: null,
    });
    return null;
  }
}

/** `onReversing` hook: cancels the not-yet-submitted draft made at dispatch, with the reversal reason. */
export async function cancelDispatchDraftOnReversal(tx: Tx, ctx: AuthContext, shipment: { shipmentId: string; siteId: string; reason: string }) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, ctx.organizationId), eq(invoices.shipmentId, shipment.shipmentId), eq(invoices.status, "draft"), eq(invoices.idempotencyKey, dispatchDraftKey(shipment.shipmentId))))
    .for("update")
    .limit(1);
  if (!inv) return null;
  const sys = await systemContext(ctx.organizationId, SYSTEM, { onBehalfOf: ctx.userId, correlationId: ctx.correlationId });
  const why = `Dispatch reversed: ${shipment.reason}`.slice(0, 500);
  await tx.update(invoices).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  await logTransition(tx, sys, { type: "invoice", id: inv.id, siteId: inv.siteId, label: "This invoice draft" }, "draft", "cancelled", why);
  await audit(tx, sys, { action: "finance.invoice.cancelled", entityType: "invoice", entityId: inv.id, siteId: inv.siteId, reason: why, after: { status: "cancelled", shipmentId: shipment.shipmentId } });
  return { invoiceId: inv.id };
}

/**
 * "Not invoiced" for the owner Home (consultant review 2026-10-30, flow E): dispatched or delivered shipments
 * of the caller's sites (where they hold `finance.invoice.view`) that have no issued invoice yet — a draft,
 * submitted or approved invoice still counts as not invoiced, a voided one too. `withoutDraft` = how many of
 * them have no live invoice record at all (the draft at dispatch failed or was switched off): finance must
 * create those. `oldestDispatchedAt` = the dispatch time of the oldest one.
 */
export async function notInvoicedShipments(ctx: AuthContext): Promise<{ count: number; withoutDraft: number; oldestDispatchedAt: Date | null }> {
  ctx.require("finance.invoice.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("finance.invoice.view", s));
  if (!siteIds.length) return { count: 0, withoutDraft: 0, oldestDispatchedAt: null };
  const posted = sql.join(
    POSTED_INVOICE_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const [r] = await db
    .select({
      count: sql<number>`count(*)::int`,
      withoutDraft: sql<number>`count(*) filter (where not exists (select 1 from ${invoices} i where i.shipment_id = "shipments"."id" and i.status not in ('cancelled', 'voided')))::int`,
      oldest: sql<string | null>`min(${shipments.dispatchedAt})`,
    })
    .from(shipments)
    .where(
      and(
        eq(shipments.organizationId, ctx.organizationId),
        inArray(shipments.siteId, siteIds),
        inArray(shipments.status, ["dispatched", "delivered"]),
        sql`not exists (select 1 from ${invoices} i where i.shipment_id = "shipments"."id" and i.status in (${posted}))`,
      ),
    );
  return { count: Number(r?.count ?? 0), withoutDraft: Number(r?.withoutDraft ?? 0), oldestDispatchedAt: r?.oldest ? new Date(r.oldest) : null };
}

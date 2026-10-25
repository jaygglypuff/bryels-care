import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { purchaseOrders, suppliers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { createReceiptDraft, receiveAndPost, type DiscrepancyKind } from "@/modules/inventory";
import { isUuid } from "./shared";

/**
 * Goods receipt against a purchase order (US-6-03, W01-01..06 with a PO): a thin wrapper over the
 * inventory receiving service with the PO header filled in. The receiving hooks
 * (`purchaseOrderReceivingHooks`) check the PO, V-OVER and move the PO lines and state when the receipt
 * posts. Over-deliveries above tolerance are saved as a draft with an `over` discrepancy for
 * procurement to approve (CX-QTY) and then posted from the receipt page.
 */

export type PoReceiptLineInput = {
  purchaseOrderLineId?: string | null;
  materialId: string;
  qty: string;
  uom?: string | null;
  supplierLotNumber: string;
  manufacturedOn?: string | null;
  expiresOn: string;
  retestOn?: string | null;
  containerCount?: number | null;
  storageConditionsConfirmed?: boolean;
  locationId: string;
  discrepancyKind?: DiscrepancyKind | null;
  discrepancyNote?: string | null;
};

export async function receiveAgainstPurchaseOrder(
  ctx: AuthContext,
  input: { purchaseOrderId: string; supplierDocumentNumber: string; notes?: string | null; lines: PoReceiptLineInput[]; idempotencyKey: string; intent: "post" | "draft" },
) {
  ctx.require("procurement.goods_receipt.create");
  if (!isUuid(input.purchaseOrderId)) throw new DomainError("validation", "Choose a purchase order.", { field: "purchaseOrderId" });
  const [po] = await db.select({ id: purchaseOrders.id, siteId: purchaseOrders.siteId, supplierName: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
  if (!po || !ctx.allowedSiteIds.includes(po.siteId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  if (po.siteId !== ctx.currentSiteId) throw new DomainError("validation", "Switch to the purchase order's site to receive it (V-SCOPE).", { field: "purchaseOrderId", rule: "V-SCOPE" });
  const payload = {
    purchaseOrderId: po.id,
    supplierName: po.supplierName,
    supplierDocumentNumber: input.supplierDocumentNumber,
    notes: input.notes ?? null,
    idempotencyKey: input.idempotencyKey,
    lines: input.lines.map((l) => ({ ...l, purchaseOrderLineId: l.purchaseOrderLineId || null })),
  };
  if (input.intent === "draft") {
    const r = await createReceiptDraft(ctx, payload);
    return { receiptId: r.receiptId, receiptNumber: null as string | null, posted: false, replayed: r.replayed };
  }
  const r = await receiveAndPost(ctx, payload);
  return { receiptId: r.receiptId, receiptNumber: r.receiptNumber, posted: true, replayed: r.replayed };
}

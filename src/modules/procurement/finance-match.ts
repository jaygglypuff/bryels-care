import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { goodsReceiptLines, purchaseOrderLines, purchaseOrders, supplierReturns } from "@/db/schema";

/**
 * W4A side of the W4B three-way-match contract (src/modules/finance/procurement-contract.ts, docs/data-model.md
 * §3.4.1). Registered in src/modules/wiring.ts so finance never reads procurement tables directly.
 *
 * Unit of the price: supplier bill quantities are in the material's base unit (A-W4B-05) while
 * `purchase_order_lines.unit_amount` is per ordered unit (`uom_entered`, e.g. per kg). The source therefore
 * reports the PO price per base unit = `line_amount / qty_base` (10 decimal places, so the bill's
 * `qty × price` comparison stays exact well inside the price tolerance).
 */
export async function purchaseOrderLinesForMatch(q: DbOrTx, organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await q
    .select({ l: purchaseOrderLines, poNumber: purchaseOrders.poNumber, supplierId: purchaseOrders.supplierId })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(and(inArray(purchaseOrderLines.id, ids), eq(purchaseOrders.organizationId, organizationId)));
  return rows.map(({ l, poNumber, supplierId }) => ({
    purchaseOrderLineId: l.id,
    purchaseOrderId: l.purchaseOrderId,
    poNumber,
    supplierId,
    materialId: l.materialId,
    qtyOrderedBase: l.qtyBase,
    unitAmount: new Decimal(l.lineAmount).div(l.qtyBase).toFixed(10),
    currency: l.currency,
  }));
}

/** PO line of each goods receipt line received against a purchase order (unplanned lines are absent). */
export async function purchaseOrderLineOfReceiptLines(q: DbOrTx, goodsReceiptLineIds: string[]) {
  if (!goodsReceiptLineIds.length) return new Map<string, string>();
  const rows = await q
    .select({ id: goodsReceiptLines.id, po: goodsReceiptLines.purchaseOrderLineId })
    .from(goodsReceiptLines)
    .where(and(inArray(goodsReceiptLines.id, goodsReceiptLineIds), isNotNull(goodsReceiptLines.purchaseOrderLineId)));
  return new Map(rows.map((r) => [r.id, r.po!]));
}

/**
 * Supplier returns of the supplier that expect a credit (approved or posted, with an amount), newest first,
 * limited to the given sites. Shown on a supplier bill so finance can resolve a dispute by entering the
 * supplier credit instead of approving the variance. Nothing links a return to a credit yet, so this is a
 * reminder list, not a reconciliation.
 */
export async function expectedSupplierCredits(q: DbOrTx, organizationId: string, supplierId: string, siteIds: string[]) {
  if (!siteIds.length) return [];
  return q
    .select({
      returnId: supplierReturns.id,
      returnNumber: supplierReturns.returnNumber,
      status: supplierReturns.status,
      creditExpectedAmount: supplierReturns.creditExpectedAmount,
      currency: supplierReturns.currency,
      postedAt: supplierReturns.postedAt,
    })
    .from(supplierReturns)
    .where(
      and(
        eq(supplierReturns.organizationId, organizationId),
        eq(supplierReturns.supplierId, supplierId),
        inArray(supplierReturns.siteId, siteIds),
        inArray(supplierReturns.status, ["approved", "posted"]),
        isNotNull(supplierReturns.creditExpectedAmount),
      ),
    )
    .orderBy(desc(supplierReturns.statusChangedAt))
    .limit(20) as Promise<{ returnId: string; returnNumber: string; status: string; creditExpectedAmount: string; currency: string; postedAt: Date | null }[]>;
}

/** The registered source (src/modules/wiring.ts). */
export const purchaseOrderMatchSourceImpl = {
  linesById: purchaseOrderLinesForMatch,
  poLineOfReceiptLine: purchaseOrderLineOfReceiptLines,
  expectedSupplierCredits,
};

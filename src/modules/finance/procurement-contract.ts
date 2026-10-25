import "server-only";
import type { DbOrTx } from "@/db/client";

/**
 * Contract between finance (W4B, three-way match) and procurement (W4A, purchase orders), built in
 * parallel streams. Finance never reads procurement tables directly: the match asks this source for the
 * ordered quantity and unit price of the purchase order lines named on bill lines (docs/data-model.md §3.4
 * `purchase_order_lines`: `qty_base`, `unit_amount`, `currency`, `purchase_order_id`; `purchase_orders.po_number`).
 *
 * Integration (for the integrator): register the source in src/modules/wiring.ts, e.g.
 *
 *   registerPurchaseOrderMatchSource(async (q, orgId, ids) => rows of purchase_order_lines ⨝ purchase_orders
 *     where organization_id = orgId and id in ids, mapped to PoLineForMatch);
 *
 * and, when goods receipt lines carry `purchase_order_line_id`, return it from `poLineOfReceiptLine` so a
 * bill line linked only to the receipt line still meets its PO line. Until a source is registered, the
 * price leg of the match is reported as "no PO data" (`no_po`) and only the receipt quantity is matched.
 */
export type PoLineForMatch = {
  purchaseOrderLineId: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  materialId: string | null;
  qtyOrderedBase: string;
  unitAmount: string;
  currency: string;
};

export type PurchaseOrderMatchSource = {
  linesById: (q: DbOrTx, organizationId: string, purchaseOrderLineIds: string[]) => Promise<PoLineForMatch[]>;
  /** PO line of a goods receipt line, when receipts are PO-based (null otherwise). */
  poLineOfReceiptLine?: (q: DbOrTx, goodsReceiptLineIds: string[]) => Promise<Map<string, string>>;
};

const KEY = "__bc_finance_po_match_source__";

export function registerPurchaseOrderMatchSource(source: PurchaseOrderMatchSource) {
  (globalThis as unknown as Record<string, PurchaseOrderMatchSource>)[KEY] = source;
}

export function purchaseOrderMatchSource(): PurchaseOrderMatchSource | null {
  return (globalThis as unknown as Record<string, PurchaseOrderMatchSource | undefined>)[KEY] ?? null;
}

import "server-only";
import type Decimal from "decimal.js";
import type { Tx } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Purchase-order receipts (Wave 4 W4A, US-6-03, W01-02, W01-06, W04-07..08). Receiving stays in the
 * inventory module; the purchase order rules (open quantity, over-delivery tolerance V-OVER, PO line
 * progress and the PO state machine) belong to procurement, which imports inventory. To keep the module
 * graph one-way, procurement plugs its rules in here (registered by src/modules/wiring.ts
 * `registerAppHooks`). A receipt that names a purchase order fails closed (503 setup_required) when the
 * hooks are not registered, so a PO receipt can never post without updating its PO.
 */

export type PoReceiptLine = {
  lineId: string;
  lineNo: number;
  purchaseOrderLineId: string | null;
  materialId: string;
  qtyBase: Decimal;
  discrepancyKind: string | null;
  discrepancyApproved: boolean;
};

export type ReceivingPoHooks = {
  /** Checks the PO for a draft (site, state, supplier, line materials); returns the supplier to record. */
  validateDraft(tx: Tx, ctx: AuthContext, args: { purchaseOrderId: string; siteId: string; lines: { index: number; purchaseOrderLineId: string | null; materialId: string }[] }): Promise<{ supplierId: string; supplierName: string }>;
  /** In the posting transaction, before lots are created: V-OVER, then PO line progress and the PO state. */
  onPost(tx: Tx, ctx: AuthContext, args: { receiptId: string; receiptLabel: string; purchaseOrderId: string; siteId: string; lines: PoReceiptLine[] }): Promise<void>;
  /** In the reversal transaction: PO line progress back and the PO state back (reason = the reversal reason). */
  onReverse(tx: Tx, ctx: AuthContext, args: { receiptId: string; receiptNumber: string | null; purchaseOrderId: string; siteId: string; reason: string; lines: PoReceiptLine[] }): Promise<void>;
};

const KEY = "__bc_receiving_po_hooks__";

export function registerReceivingPoHooks(h: ReceivingPoHooks) {
  (globalThis as unknown as Record<string, ReceivingPoHooks | undefined>)[KEY] = h;
}

export function receivingPoHooks(): ReceivingPoHooks {
  const h = (globalThis as unknown as Record<string, ReceivingPoHooks | undefined>)[KEY];
  if (!h) throw new DomainError("setup_required", "Purchase-order receiving is not set up in this process (procurement hooks missing). Receive as unplanned or ask an administrator.");
  return h;
}

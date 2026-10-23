import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, goodsReceipts, inventoryLots, locations, materials, salesOrders, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

export type ScanResult = { ok: true; href: string; label: string } | { ok: false; message: string };

const NOT_FOUND = (code: string): ScanResult => ({
  ok: false,
  message: `Nothing found for "${code}" in your sites. Check the label, or type the lot, batch, order or DR number.`,
});

/** Typed ADR-017 payloads we decode. BOX, SKU and EQP are recognised but have no screen yet. */
const PAYLOAD_RE = /^BC:(LOT|BOX|LOC|MAT|SKU|EQP|DOC):(.+)$/;

/** Removes whitespace and control characters a keyboard-wedge scanner may add; upper-cases. */
export function normalizeScan(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase();
}

/**
 * Resolves a scanned or typed code to a page, searching only the user's allowed sites.
 * Records outside those sites return the same "not found" as records that do not exist.
 */
export async function resolveScan(ctx: AuthContext, raw: string): Promise<ScanResult> {
  ctx.require("inventory.lot.view");
  const code = normalizeScan(raw);
  if (!code) return { ok: false, message: "Scan a label or type a number first." };
  const sitesIn = ctx.allowedSiteIds;

  const m = PAYLOAD_RE.exec(code);
  const type = m?.[1] ?? null;
  const value = (m?.[2] ?? code).trim();

  if (type === "BOX" || type === "SKU" || type === "EQP") {
    const what = { BOX: "Box", SKU: "SKU", EQP: "Equipment" }[type];
    return { ok: false, message: `${what} labels (${value}) are recognised but cannot be looked up in this version yet.` };
  }

  if (type === "MAT") {
    const [mat] = await db.select({ code: materials.code }).from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.code, value))).limit(1);
    return mat ? { ok: true, href: `/inventory?q=${encodeURIComponent(mat.code)}&empty=1`, label: `Material ${mat.code}` } : NOT_FOUND(value);
  }

  if (type === "LOC") {
    const [loc] = await db.select().from(locations).where(and(inArray(locations.siteId, sitesIn), eq(locations.code, value)));
    if (!loc) return NOT_FOUND(value);
    if (loc.siteId !== ctx.currentSiteId) return { ok: false, message: `Location ${value} belongs to another of your sites. Switch site first.` };
    return { ok: true, href: `/inventory?loc=${loc.id}`, label: `Location ${loc.code}` };
  }

  // LOT, DOC or an untyped code: match lot, batch, order, DR and receipt numbers.
  const [lot] = await db
    .select({ id: inventoryLots.id, n: inventoryLots.lotNumber })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, value), inArray(inventoryLots.siteId, sitesIn)))
    .limit(1);
  if (lot) return { ok: true, href: `/inventory/${lot.id}`, label: `Lot ${lot.n}` };
  if (type === "LOT") return NOT_FOUND(value);

  const [batch] = await db
    .select({ id: batches.id, n: batches.batchNumber })
    .from(batches)
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.batchNumber, value), inArray(batches.siteId, sitesIn)))
    .limit(1);
  if (batch) {
    if (!ctx.can("production.batch.view")) return { ok: false, message: `${batch.n} is a production batch; your role cannot open batches.` };
    return { ok: true, href: `/production/${batch.id}`, label: `Batch ${batch.n}` };
  }

  const [so] = await db
    .select({ id: salesOrders.id, n: salesOrders.orderNumber })
    .from(salesOrders)
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), eq(salesOrders.orderNumber, value), inArray(salesOrders.siteId, sitesIn)))
    .limit(1);
  const [dr] = so
    ? []
    : await db
        .select({ orderId: shipments.salesOrderId, n: shipments.deliveryReceiptNumber })
        .from(shipments)
        .where(and(eq(shipments.organizationId, ctx.organizationId), eq(shipments.deliveryReceiptNumber, value), inArray(shipments.siteId, sitesIn)))
        .limit(1);
  if (so || dr) {
    const orderId = so?.id ?? dr!.orderId;
    if (!ctx.can("sales.sales_order.view")) return { ok: false, message: `${value} is a sales document; your role cannot open sales orders.` };
    return { ok: true, href: `/sales/${orderId}`, label: so ? `Order ${so.n}` : `Delivery receipt ${dr!.n}` };
  }

  const [gr] = await db
    .select({ id: goodsReceipts.id, n: goodsReceipts.receiptNumber })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.organizationId, ctx.organizationId), eq(goodsReceipts.receiptNumber, value), inArray(goodsReceipts.siteId, sitesIn)))
    .limit(1);
  if (gr) return { ok: true, href: `/inventory/receive/${gr.id}`, label: `Receipt ${gr.n}` };

  return NOT_FOUND(value);
}

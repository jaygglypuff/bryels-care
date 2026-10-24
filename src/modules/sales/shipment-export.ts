import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { containers, customers, inventoryLots, products, salesOrderLines, salesOrders, shipmentLines, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import type { Permission } from "@/lib/permissions";
import { D } from "@/lib/qty";

/**
 * Interim shipment export to the accountant (US-4-14, W09-10, A-PROC-24) until invoices exist in
 * Phase 6: dispatched / delivered shipments of a period with order, DR, customer, lines, lots and
 * quantities; billing never works from draft documents. Prices and line amounts are columns that
 * require `sales.price_list.view` (stream W3D adds that string; until then they are masked for
 * everyone, the safe default). Neutralised and audited by the export layer.
 */
export type ShipmentExportFilter = { siteId: string; from: string; to: string } & Record<string, unknown>;

type Row = {
  dispatchedAt: Date | null;
  shipmentNumber: string | null;
  drNumber: string | null;
  status: string;
  deliveredAt: Date | null;
  orderNumber: string;
  customerPo: string | null;
  customerCode: string;
  customerName: string;
  sku: string;
  productName: string;
  lotNumber: string;
  expiresOn: string | null;
  boxNumber: string | null;
  qty: string;
  uom: string;
  unitPrice: string;
  overShipment: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE = "sales.price_list.view" as Permission;

export async function shipmentExportRows(ctx: AuthContext, f: ShipmentExportFilter, limit: number): Promise<Row[]> {
  ctx.require("sales.shipment.export");
  if (!DATE_RE.test(f.from) || !DATE_RE.test(f.to) || f.from > f.to) throw new DomainError("validation", "Choose a period: from and to dates (YYYY-MM-DD), from not after to.", { field: "from" });
  if (!ctx.allowedSiteIds.includes(f.siteId)) throw new DomainError("not_found", "Site not found in your sites.");
  ctx.requireAt("sales.shipment.export", f.siteId);
  const start = new Date(`${f.from}T00:00:00+08:00`);
  const end = new Date(new Date(`${f.to}T00:00:00+08:00`).getTime() + 86_400_000);
  const rows = await db
    .select({
      dispatchedAt: shipments.dispatchedAt,
      shipmentNumber: shipments.shipmentNumber,
      drNumber: shipments.deliveryReceiptNumber,
      status: shipments.status,
      deliveredAt: shipments.deliveredAt,
      orderNumber: salesOrders.orderNumber,
      customerPo: salesOrders.customerPoNumber,
      customerCode: customers.code,
      customerName: customers.name,
      sku: products.skuCode,
      productName: products.name,
      lotNumber: inventoryLots.lotNumber,
      expiresOn: inventoryLots.expiresOn,
      boxNumber: containers.containerNumber,
      qty: shipmentLines.qtyBase,
      uom: shipmentLines.baseUom,
      unitPrice: salesOrderLines.unitPrice,
      overShipment: shipmentLines.isOverShipment,
    })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.salesOrderLineId))
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, shipmentLines.lotId))
    .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(
      and(
        eq(shipments.organizationId, ctx.organizationId),
        eq(shipments.siteId, f.siteId),
        inArray(shipments.status, ["dispatched", "delivered"]),
        isNotNull(shipmentLines.stockMovementId),
        gte(shipments.dispatchedAt, start),
        lt(shipments.dispatchedAt, end),
      ),
    )
    .orderBy(asc(shipments.dispatchedAt), asc(shipments.shipmentNumber), asc(products.skuCode), asc(inventoryLots.lotNumber))
    .limit(limit);
  return rows;
}

const manila = (d: Date | null) => (d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).slice(0, 16) : "");

export const shipmentExport: ExportDefinition<ShipmentExportFilter, Row> = {
  code: "sales.shipments",
  title: "Dispatched shipments (interim accountant export)",
  permission: "sales.shipment.export",
  sensitivity: "S",
  siteScope: (_ctx, f) => [f.siteId],
  fileName: (f) => `shipments-${f.from}-to-${f.to}`,
  fetch: (ctx, f, limit) => shipmentExportRows(ctx, f, limit),
  columns: [
    { header: "Dispatched (Asia/Manila)", value: (r) => manila(r.dispatchedAt) },
    { header: "Shipment", value: (r) => r.shipmentNumber },
    { header: "DR number", value: (r) => r.drNumber },
    { header: "Status", value: (r) => r.status },
    { header: "Delivered (Asia/Manila)", value: (r) => manila(r.deliveredAt) },
    { header: "Sales order", value: (r) => r.orderNumber },
    { header: "Customer PO", value: (r) => r.customerPo },
    { header: "Customer code", value: (r) => r.customerCode },
    { header: "Customer", value: (r) => r.customerName },
    { header: "SKU", value: (r) => r.sku },
    { header: "Product", value: (r) => r.productName },
    { header: "Lot", value: (r) => r.lotNumber },
    { header: "Expiry", value: (r) => r.expiresOn },
    { header: "Box", value: (r) => r.boxNumber },
    { header: "Quantity", value: (r) => D(r.qty).toString(), numeric: true },
    { header: "Unit", value: (r) => r.uom },
    { header: "Over-shipment", value: (r) => (r.overShipment ? "yes" : "no") },
    { header: "Unit price", value: (r) => D(r.unitPrice).toString(), numeric: true, requires: PRICE },
    { header: "Line amount", value: (r) => D(r.qty).times(r.unitPrice).toDecimalPlaces(2).toString(), numeric: true, requires: PRICE },
  ],
};

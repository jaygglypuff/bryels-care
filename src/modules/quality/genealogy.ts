import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  customers,
  dispenseRecords,
  goodsReceiptLines,
  goodsReceipts,
  inventoryLots,
  materials,
  products,
  salesOrders,
  shipments,
  sites,
  stockMovements,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import type { ExportDefinition } from "@/lib/export";
import { getSetting } from "@/lib/settings";

/**
 * Lot genealogy from the immutable ledger (process map W07-07).
 * Edges: material lot --consumption--> batch --output--> finished lot --shipment--> order/customer.
 * Consumption is read from stock movements (source batch) and dispense records; reversed
 * movements are excluded. Every query is restricted to the user's allowed sites; records at
 * other sites are counted (hiddenCount) but never shown.
 */

export type TraceNode = {
  /** supplier_lot (W2C, US-3-16): the start node of a forward trace from a supplier's lot number. */
  kind: "lot" | "batch" | "shipment" | "supplier_lot";
  id: string;
  number: string;
  label: string;
  status: string;
  href: string;
  siteCode?: string;
  qty?: string | null;
  uom?: string | null;
  /** What the quantity means on this edge: consumed, produced, shipped. */
  qtyRole?: "consumed" | "produced" | "shipped" | "on_order";
  supplierName?: string | null;
  supplierLot?: string | null;
  itemKind?: string;
  expiresOn?: string | null;
  date?: Date | null;
  customerName?: string;
  orderNumber?: string;
  /** Goods receipt that brought a material lot in (receipt → lot edge). */
  receiptNumber?: string | null;
  receiptHref?: string | null;
  children: TraceNode[];
};

export type AffectedCustomer = {
  customerId: string;
  customerName: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  shipmentId: string;
  drNumber: string;
  lotId: string;
  lotNumber: string;
  productName: string;
  qty: string;
  uom: string;
  dispatchedAt: Date;
};

export type TraceResult = {
  query: { lotNumber?: string; batchNumber?: string; supplierLot?: string };
  root: TraceNode | null;
  reverse: TraceNode[];
  forward: TraceNode[];
  affectedCustomers: AffectedCustomer[];
  hiddenCount: number;
  /** When the trace was read (it reflects the ledger at that moment). */
  asOf: Date;
  maxDepth: number;
  /** True when a branch reached maxDepth and was cut (the page says so). */
  depthLimitHit: boolean;
  /** Sites the trace covered (the user's sites). */
  siteCodes: string[];
};

/** Default depth limit (A-DM-10); the setting quality.genealogy.max_depth overrides it. */
const DEFAULT_MAX_DEPTH = 20;

/** Movements that have not been reversed. */
const notReversed = sql`not exists (select 1 from ${stockMovements} r where r.reversal_of_id = ${stockMovements.id})`;

class Tracer {
  hidden = 0;
  depthLimitHit = false;
  maxDepth = DEFAULT_MAX_DEPTH;
  private lotCache = new Map<string, TraceNode | null>();
  /** Source batch per lot, kept for reverse tracing. */
  private sourceBatch = new Map<string, string | null>();
  private siteCodes = new Map<string, string>();
  readonly customers: AffectedCustomer[] = [];
  private seenShipLine = new Set<string>();

  constructor(private ctx: AuthContext) {}

  get allowed() {
    return this.ctx.allowedSiteIds;
  }

  async init() {
    const rows = await db.select({ id: sites.id, code: sites.code }).from(sites).where(eq(sites.organizationId, this.ctx.organizationId));
    for (const r of rows) this.siteCodes.set(r.id, r.code);
    this.maxDepth = await getSetting(db, this.ctx.organizationId, "quality.genealogy.max_depth");
  }

  private tooDeep(depth: number) {
    if (depth > this.maxDepth) {
      this.depthLimitHit = true;
      return true;
    }
    return false;
  }

  async lotNode(lotId: string): Promise<TraceNode | null> {
    if (this.lotCache.has(lotId)) {
      const c = this.lotCache.get(lotId);
      return c ? { ...c, children: [] } : null;
    }
    const [l] = await db
      .select({ lot: inventoryLots, materialName: materials.name, productName: products.name })
      .from(inventoryLots)
      .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
      .leftJoin(products, eq(products.id, inventoryLots.productId))
      .where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.organizationId, this.ctx.organizationId)))
      .limit(1);
    if (!l || !this.allowed.includes(l.lot.siteId)) {
      if (l) this.hidden++;
      this.lotCache.set(lotId, null);
      return null;
    }
    const [gr] = await db
      .select({ id: goodsReceipts.id, number: goodsReceipts.receiptNumber })
      .from(goodsReceiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
      .where(eq(goodsReceiptLines.lotId, lotId))
      .limit(1);
    const node: TraceNode = {
      kind: "lot",
      id: l.lot.id,
      number: l.lot.lotNumber,
      label: l.materialName ?? l.productName ?? "—",
      status: l.lot.qualityStatus,
      href: `/inventory/${l.lot.id}`,
      siteCode: this.siteCodes.get(l.lot.siteId),
      uom: l.lot.baseUom,
      supplierName: l.lot.supplierName,
      supplierLot: l.lot.supplierLotNumber,
      itemKind: l.lot.itemKind,
      expiresOn: l.lot.expiresOn,
      receiptNumber: gr?.number ?? null,
      receiptHref: gr ? `/inventory/receive/${gr.id}` : null,
      children: [],
    };
    this.lotCache.set(lotId, node);
    this.sourceBatch.set(lotId, l.lot.sourceBatchId);
    return { ...node, children: [] };
  }

  async batchNode(batchId: string): Promise<TraceNode | null> {
    const [b] = await db
      .select({ batch: batches, productName: products.name })
      .from(batches)
      .innerJoin(products, eq(products.id, batches.productId))
      .where(and(eq(batches.id, batchId), eq(batches.organizationId, this.ctx.organizationId)))
      .limit(1);
    if (!b) return null;
    if (!this.allowed.includes(b.batch.siteId)) {
      this.hidden++;
      return null;
    }
    return {
      kind: "batch",
      id: b.batch.id,
      number: b.batch.batchNumber,
      label: b.productName,
      status: b.batch.status,
      href: `/production/${b.batch.id}`,
      siteCode: this.siteCodes.get(b.batch.siteId),
      date: b.batch.completedAt ?? b.batch.startedAt,
      children: [],
    };
  }

  /** Batches that consumed the lot, with the quantity consumed (ledger first, dispense records as fallback). */
  async consumersOf(lotId: string) {
    const mv = await db
      .select({ batchId: stockMovements.sourceDocumentId, qty: sql<string>`sum(${stockMovements.qtyBase})::text` })
      .from(stockMovements)
      .where(and(eq(stockMovements.lotId, lotId), eq(stockMovements.movementType, "consumption"), eq(stockMovements.sourceDocumentType, "batch"), notReversed))
      .groupBy(stockMovements.sourceDocumentId);
    const dr = await db
      .select({ batchId: batchMaterials.batchId, qty: sql<string>`sum(${dispenseRecords.actualQtyG})::text` })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .where(eq(dispenseRecords.lotId, lotId))
      .groupBy(batchMaterials.batchId);
    const out = new Map<string, string>();
    for (const r of dr) out.set(r.batchId, r.qty);
    for (const r of mv) if (r.batchId) out.set(r.batchId, r.qty);
    return out;
  }

  /** Lots consumed by the batch with quantities. */
  async inputsOf(batchId: string) {
    const mv = await db
      .select({ lotId: stockMovements.lotId, qty: sql<string>`sum(${stockMovements.qtyBase})::text` })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceDocumentId, batchId), eq(stockMovements.movementType, "consumption"), eq(stockMovements.sourceDocumentType, "batch"), notReversed))
      .groupBy(stockMovements.lotId);
    const dr = await db
      .select({ lotId: dispenseRecords.lotId, qty: sql<string>`sum(${dispenseRecords.actualQtyG})::text` })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .where(eq(batchMaterials.batchId, batchId))
      .groupBy(dispenseRecords.lotId);
    const out = new Map<string, string>();
    for (const r of dr) out.set(r.lotId, r.qty);
    for (const r of mv) out.set(r.lotId, r.qty);
    return out;
  }

  /** Output lots of a batch with the quantity produced. */
  async outputsOf(batchId: string) {
    const [b] = await db.select({ outputLotId: batches.outputLotId }).from(batches).where(eq(batches.id, batchId)).limit(1);
    const bySource = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.sourceBatchId, batchId));
    const ids = new Set<string>(bySource.map((r) => r.id));
    if (b?.outputLotId) ids.add(b.outputLotId);
    if (!ids.size) return new Map<string, string | null>();
    const mv = await db
      .select({ lotId: stockMovements.lotId, qty: sql<string>`sum(${stockMovements.qtyBase})::text` })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceDocumentId, batchId), eq(stockMovements.movementType, "output"), inArray(stockMovements.lotId, [...ids]), notReversed))
      .groupBy(stockMovements.lotId);
    const out = new Map<string, string | null>();
    for (const id of ids) out.set(id, mv.find((m) => m.lotId === id)?.qty ?? null);
    return out;
  }

  async shipmentNodes(lot: TraceNode): Promise<TraceNode[]> {
    const rows = await db
      .select({
        shipmentId: shipments.id,
        siteId: shipments.siteId,
        drNumber: shipments.deliveryReceiptNumber,
        dispatchedAt: shipments.dispatchedAt,
        orderId: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        orderStatus: salesOrders.status,
        customerId: customers.id,
        customerName: customers.name,
        qty: sql<string>`sum(${stockMovements.qtyBase})::text`,
      })
      .from(stockMovements)
      .innerJoin(shipments, eq(shipments.id, stockMovements.sourceDocumentId))
      .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "shipment"), eq(stockMovements.sourceDocumentType, "shipment"), notReversed))
      .groupBy(shipments.id, salesOrders.id, customers.id)
      .orderBy(shipments.dispatchedAt);
    const nodes: TraceNode[] = [];
    for (const r of rows) {
      if (!this.allowed.includes(r.siteId)) {
        this.hidden++;
        continue;
      }
      nodes.push({
        kind: "shipment",
        id: r.shipmentId,
        number: r.drNumber,
        label: r.customerName,
        status: r.orderStatus,
        href: `/sales/${r.orderId}`,
        siteCode: this.siteCodes.get(r.siteId),
        qty: r.qty,
        uom: lot.uom,
        qtyRole: "shipped",
        date: r.dispatchedAt,
        customerName: r.customerName,
        orderNumber: r.orderNumber,
        children: [],
      });
      const key = `${r.shipmentId}:${lot.id}`;
      if (!this.seenShipLine.has(key)) {
        this.seenShipLine.add(key);
        this.customers.push({
          customerId: r.customerId,
          customerName: r.customerName,
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          orderStatus: r.orderStatus,
          shipmentId: r.shipmentId,
          drNumber: r.drNumber,
          lotId: lot.id,
          lotNumber: lot.number,
          productName: lot.label,
          qty: r.qty,
          uom: lot.uom ?? "",
          dispatchedAt: r.dispatchedAt,
        });
      }
    }
    return nodes;
  }

  /** Where the lot went: consuming batches -> their output lots -> ... and shipments of this lot. */
  async forwardOfLot(lot: TraceNode, depth: number, path: Set<string>): Promise<TraceNode[]> {
    if (path.has(lot.id) || this.tooDeep(depth)) return [];
    const nextPath = new Set(path).add(lot.id);
    const out: TraceNode[] = [];
    const consumers = await this.consumersOf(lot.id);
    for (const [batchId, qty] of consumers) {
      const b = await this.batchNode(batchId);
      if (!b) continue;
      b.qty = qty;
      b.uom = lot.uom;
      b.qtyRole = "consumed";
      b.children = await this.forwardOfBatch(b, depth + 1, nextPath);
      out.push(b);
    }
    out.push(...(await this.shipmentNodes(lot)));
    return out;
  }

  async forwardOfBatch(batch: TraceNode, depth: number, path: Set<string>): Promise<TraceNode[]> {
    const out: TraceNode[] = [];
    for (const [lotId, qty] of await this.outputsOf(batch.id)) {
      const l = await this.lotNode(lotId);
      if (!l) continue;
      l.qty = qty;
      l.qtyRole = "produced";
      l.children = await this.forwardOfLot(l, depth + 1, path);
      out.push(l);
    }
    return out;
  }

  /** Where the batch came from: input lots, recursively through intermediates. */
  async reverseOfBatch(batch: TraceNode, depth: number, path: Set<string>): Promise<TraceNode[]> {
    if (path.has(batch.id) || this.tooDeep(depth)) return [];
    const nextPath = new Set(path).add(batch.id);
    const out: TraceNode[] = [];
    for (const [lotId, qty] of await this.inputsOf(batch.id)) {
      const l = await this.lotNode(lotId);
      if (!l) continue;
      l.qty = qty;
      l.qtyRole = "consumed";
      l.children = await this.reverseOfLot(l, depth + 1, nextPath);
      out.push(l);
    }
    out.sort((a, b) => a.number.localeCompare(b.number));
    return out;
  }

  async reverseOfLot(lot: TraceNode, depth: number, path: Set<string>): Promise<TraceNode[]> {
    const src = this.sourceBatch.get(lot.id);
    if (!src) return [];
    const b = await this.batchNode(src);
    if (!b) return [];
    b.children = await this.reverseOfBatch(b, depth + 1, path);
    return [b];
  }
}

export async function traceGenealogy(ctx: AuthContext, q: { lotNumber?: string; batchNumber?: string; supplierLot?: string }): Promise<TraceResult> {
  ctx.require("quality.genealogy.view");
  const lotNumber = q.lotNumber?.trim().toUpperCase().replace(/^BC:LOT:/, "") || undefined;
  const batchNumber = q.batchNumber?.trim().toUpperCase() || undefined;
  const supplierLot = q.supplierLot?.trim() || undefined;
  const asOf = new Date();
  const siteCodes = ctx.allowedSites.map((s) => s.code);
  const t = new Tracer(ctx);
  await t.init();
  const empty: TraceResult = { query: { lotNumber, batchNumber, supplierLot }, root: null, reverse: [], forward: [], affectedCustomers: [], hiddenCount: 0, asOf, maxDepth: t.maxDepth, depthLimitHit: false, siteCodes };
  if (!lotNumber && !batchNumber && !supplierLot) return empty;

  let root: TraceNode | null = null;
  let reverse: TraceNode[] = [];
  let forward: TraceNode[] = [];

  if (lotNumber) {
    const [l] = await db
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, lotNumber), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
      .limit(1);
    if (!l) return empty;
    root = await t.lotNode(l.id);
    if (!root) return empty;
    reverse = await t.reverseOfLot(root, 0, new Set());
    forward = await t.forwardOfLot(root, 0, new Set());
  } else if (batchNumber) {
    const [b] = await db
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.batchNumber, batchNumber), inArray(batches.siteId, ctx.allowedSiteIds)))
      .limit(1);
    if (!b) return empty;
    root = await t.batchNode(b.id);
    if (!root) return empty;
    reverse = await t.reverseOfBatch(root, 0, new Set());
    forward = await t.forwardOfBatch(root, 0, new Set());
  } else if (supplierLot) {
    // Forward trace from a supplier's lot number (data-model §10.3): every received lot carrying it.
    const lots = await db
      .select({ id: inventoryLots.id, supplierName: inventoryLots.supplierName })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.organizationId, ctx.organizationId), sql`upper(${inventoryLots.supplierLotNumber}) = ${supplierLot.toUpperCase()}`, inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
      .orderBy(inventoryLots.lotNumber);
    if (!lots.length) return empty;
    const children: TraceNode[] = [];
    for (const l of lots) {
      const n = await t.lotNode(l.id);
      if (!n) continue;
      n.children = await t.forwardOfLot(n, 1, new Set());
      children.push(n);
    }
    const suppliers = [...new Set(lots.map((l) => l.supplierName).filter((x): x is string => !!x))];
    root = { kind: "supplier_lot", id: supplierLot, number: supplierLot, label: suppliers.join(", ") || "Supplier lot", status: "received", href: `/quality/trace?supplierLot=${encodeURIComponent(supplierLot)}`, supplierName: suppliers.join(", ") || null, supplierLot, children: [] };
    forward = children;
  }

  if (root) {
    await audit(db, ctx, {
      action: "quality.genealogy.viewed",
      entityType: root.kind === "lot" ? "inventory_lot" : root.kind === "batch" ? "batch" : "supplier_lot",
      entityId: root.kind === "supplier_lot" ? null : root.id,
      entityNumber: root.number,
      after: { direction: root.kind === "supplier_lot" ? "forward" : "both", affectedCustomers: t.customers.length, hiddenCount: t.hidden, maxDepth: t.maxDepth, depthLimitHit: t.depthLimitHit, sites: siteCodes, asOf: asOf.toISOString() },
    });
  }

  const affectedCustomers = [...t.customers].sort((a, b) => a.dispatchedAt.getTime() - b.dispatchedAt.getTime());
  return { query: { lotNumber, batchNumber, supplierLot }, root, reverse, forward, affectedCustomers, hiddenCount: t.hidden, asOf, maxDepth: t.maxDepth, depthLimitHit: t.depthLimitHit, siteCodes };
}

export type TraceRow = {
  direction: "subject" | "reverse" | "forward";
  depth: number;
  kind: string;
  number: string;
  label: string;
  status: string;
  site: string;
  qty: string;
  uom: string;
  role: string;
  supplier: string;
  supplierLot: string;
  receipt: string;
  customer: string;
  order: string;
  date: string;
};

/** Flat rows (indented list order) of a trace, for export and phone layout. */
export function flattenTrace(t: TraceResult): TraceRow[] {
  const rows: TraceRow[] = [];
  const row = (n: TraceNode, direction: TraceRow["direction"], depth: number): TraceRow => ({
    direction,
    depth,
    kind: n.kind === "lot" ? (n.itemKind === "product" ? "finished_lot" : "material_lot") : n.kind,
    number: n.kind === "shipment" ? `${n.orderNumber ?? ""} ${n.number}`.trim() : n.number,
    label: n.label,
    status: n.status,
    site: n.siteCode ?? "",
    qty: n.qty ?? "",
    uom: n.qty ? (n.uom ?? "") : "",
    role: n.qtyRole ?? "",
    supplier: n.supplierName ?? "",
    supplierLot: n.supplierLot ?? "",
    receipt: n.receiptNumber ?? "",
    customer: n.customerName ?? "",
    order: n.orderNumber ?? "",
    date: n.date ? n.date.toISOString() : "",
  });
  const walk = (nodes: TraceNode[], direction: TraceRow["direction"], depth: number) => {
    for (const n of nodes) {
      rows.push(row(n, direction, depth));
      walk(n.children, direction, depth + 1);
    }
  };
  if (t.root) rows.push(row(t.root, "subject", 0));
  walk(t.reverse, "reverse", 1);
  walk(t.forward, "forward", 1);
  return rows;
}

/**
 * CSV/XLSX export of a trace (quality.genealogy.export, S). The file names customers and suppliers,
 * so runExport audits platform.export.created and this definition adds quality.genealogy.exported.
 */
export const genealogyExport: ExportDefinition<{ lotNumber?: string; batchNumber?: string; supplierLot?: string }, TraceRow> = {
  code: "quality.genealogy",
  title: "Traceability report",
  permission: "quality.genealogy.export",
  sensitivity: "S",
  columns: [
    { header: "Direction", value: (r) => r.direction },
    { header: "Depth", value: (r) => r.depth, numeric: true },
    { header: "Kind", value: (r) => r.kind },
    { header: "Number", value: (r) => r.number },
    { header: "Item / customer", value: (r) => r.label },
    { header: "Status", value: (r) => r.status },
    { header: "Site", value: (r) => r.site },
    { header: "Quantity", value: (r) => r.qty, numeric: true },
    { header: "Unit", value: (r) => r.uom },
    { header: "Quantity meaning", value: (r) => r.role },
    { header: "Supplier", value: (r) => r.supplier },
    { header: "Supplier lot", value: (r) => r.supplierLot },
    { header: "Goods receipt", value: (r) => r.receipt },
    { header: "Customer", value: (r) => r.customer },
    { header: "Order", value: (r) => r.order },
    { header: "Date", value: (r) => r.date },
  ],
  fetch: async (ctx, f, limit) => {
    const t = await traceGenealogy(ctx, f);
    if (!t.root) throw new DomainError("not_found", "Nothing traces from that number at your sites.");
    const rows = flattenTrace(t);
    await audit(db, ctx, {
      action: "quality.genealogy.exported",
      entityType: t.root.kind === "lot" ? "inventory_lot" : t.root.kind === "batch" ? "batch" : "supplier_lot",
      entityId: t.root.kind === "supplier_lot" ? null : t.root.id,
      entityNumber: t.root.number,
      after: { filters: f, rows: rows.length, asOf: t.asOf.toISOString(), sites: t.siteCodes, depthLimitHit: t.depthLimitHit },
    });
    return rows.slice(0, limit);
  },
  siteScope: (ctx) => ctx.allowedSiteIds,
  fileName: (f) => `trace-${(f.lotNumber ?? f.batchNumber ?? f.supplierLot ?? "query").replace(/[^A-Za-z0-9-]/g, "")}`,
};

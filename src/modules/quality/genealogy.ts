import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  customers,
  dispenseRecords,
  inventoryLots,
  materials,
  products,
  salesOrders,
  shipments,
  sites,
  stockMovements,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";

/**
 * Lot genealogy from the immutable ledger (process map W07-07).
 * Edges: material lot --consumption--> batch --output--> finished lot --shipment--> order/customer.
 * Consumption is read from stock movements (source batch) and dispense records; reversed
 * movements are excluded. Every query is restricted to the user's allowed sites; records at
 * other sites are counted (hiddenCount) but never shown.
 */

export type TraceNode = {
  kind: "lot" | "batch" | "shipment";
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
  query: { lotNumber?: string; batchNumber?: string };
  root: TraceNode | null;
  reverse: TraceNode[];
  forward: TraceNode[];
  affectedCustomers: AffectedCustomer[];
  hiddenCount: number;
};

const MAX_DEPTH = 8;

/** Movements that have not been reversed. */
const notReversed = sql`not exists (select 1 from ${stockMovements} r where r.reversal_of_id = ${stockMovements.id})`;

class Tracer {
  hidden = 0;
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
    if (depth > MAX_DEPTH || path.has(lot.id)) return [];
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
    if (depth > MAX_DEPTH || path.has(batch.id)) return [];
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

export async function traceGenealogy(ctx: AuthContext, q: { lotNumber?: string; batchNumber?: string }): Promise<TraceResult> {
  ctx.require("quality.genealogy.view");
  const lotNumber = q.lotNumber?.trim().toUpperCase() || undefined;
  const batchNumber = q.batchNumber?.trim().toUpperCase() || undefined;
  const empty: TraceResult = { query: { lotNumber, batchNumber }, root: null, reverse: [], forward: [], affectedCustomers: [], hiddenCount: 0 };
  if (!lotNumber && !batchNumber) return empty;

  const t = new Tracer(ctx);
  await t.init();
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
  }

  if (root) {
    await audit(db, ctx, {
      action: "quality.genealogy.viewed",
      entityType: root.kind === "lot" ? "inventory_lot" : "batch",
      entityId: root.id,
      entityNumber: root.number,
      after: { affectedCustomers: t.customers.length, hiddenCount: t.hidden },
    });
  }

  const affectedCustomers = [...t.customers].sort((a, b) => a.dispatchedAt.getTime() - b.dispatchedAt.getTime());
  return { query: { lotNumber, batchNumber }, root, reverse, forward, affectedCustomers, hiddenCount: t.hidden };
}

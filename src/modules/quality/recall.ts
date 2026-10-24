import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  complaints,
  containerContents,
  containerLineage,
  containers,
  customers,
  dispenseRecords,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  salesOrders,
  shipments,
  sites,
  stockMovements,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { getSetting } from "@/lib/settings";
import { lotsOfBox, returnedQtyByLot, shipmentBoxes, shipmentRef } from "@/modules/sales";
import { complaintStartLots } from "./complaints";
import { parseTraceCode } from "./complaints-rules";

/**
 * Read-only recall explorer (US-4-17, process map W07-07, ux-system §9.14, data-model §10.3/§10.4).
 * Extends the W2C genealogy (genealogy.ts, the per-node tree of one lot) to the full blast radius:
 * from a supplier lot, material lot, batch, finished lot, box or complaint, every lot and batch affected,
 * every box, shipment and customer with quantities shipped, returned and still at the customer, and the
 * stock still in our warehouses.
 *
 * Edges are the same ledger edges as genealogy.ts (consumption movements and live dispense records into a
 * batch; batch outputs by source batch / output lot; re-lots by origin lot, which includes customer
 * returns), read level by level in batched queries so a trace stays fast. Modes:
 * - forward: everything downstream of the start lots;
 * - reverse: upstream to the supplier lots first, then everything downstream of any upstream lot, so
 *   sibling batches sharing an input lot appear (data-model §10.4 step 3).
 * Every node outside the user's sites is counted (hiddenCount) and not traversed. The recall case workflow
 * itself (holds, notifications, reconciliation) is Phase 6 (E-6-06).
 */

export type RecallMode = "forward" | "reverse";
export type RecallQuery = { code?: string; supplierLot?: string; complaintId?: string; mode?: RecallMode | null };

export type RecallLot = { id: string; number: string; itemKind: string; itemName: string; status: string; siteCode: string; expiresOn: string | null; role: "start" | "upstream" | "downstream"; depth: number; viaBatchNumber: string | null; originLotNumber: string | null; onHand: string; uom: string; supplierName: string | null; supplierLot: string | null };
export type RecallBatch = { id: string; number: string; productName: string; status: string; siteCode: string; relation: "subject" | "source" | "downstream" | "sibling"; date: Date | null };
export type RecallShipment = { shipmentId: string; drNumber: string; dispatchedAt: Date; deliveredAt: Date | null; orderId: string; orderNumber: string; customerId: string; customerName: string; shipTo: string; siteCode: string; lotId: string; lotNumber: string; productName: string; uom: string; qtyShipped: string; qtyReturned: string; qtyOutstanding: string; boxes: string[] };
export type RecallCustomer = { customerId: string; customerName: string; shipTo: string; shipmentCount: number; drNumbers: string[]; lotNumbers: string[]; outstanding: { uom: string; qty: string }[] };
export type RecallBox = { containerId: string; number: string; status: string; siteCode: string; locationCode: string | null; lotNumbers: string[]; qtyNow: string; uom: string; drNumber: string | null; customerName: string | null };
export type RecallStock = { lotId: string; lotNumber: string; status: string; siteCode: string; locationCode: string; locationKind: string; qty: string; uom: string };

export type RecallScope = {
  query: RecallQuery;
  subject: { kind: "lot" | "batch" | "box" | "supplier_lot" | "complaint"; id: string | null; number: string; label: string } | null;
  mode: RecallMode;
  lots: RecallLot[];
  batches: RecallBatch[];
  shipments: RecallShipment[];
  customers: RecallCustomer[];
  boxes: RecallBox[];
  stock: RecallStock[];
  hiddenCount: number;
  asOf: Date;
  siteCodes: string[];
  maxDepth: number;
  depthLimitHit: boolean;
  /** The single message for "not found" and "outside your sites" (ux-system §9.14 states). */
  notFoundMessage: string;
};

const NOT_FOUND = "No records trace from this code at your sites.";
const notReversed = sql`not exists (select 1 from ${stockMovements} r where r.reversal_of_id = ${stockMovements.id})`;

type LotRow = typeof inventoryLots.$inferSelect;
type Edge = { from: string; to: string; batchId: string | null };

class Explorer {
  hidden = new Set<string>();
  depthLimitHit = false;
  lots = new Map<string, LotRow>();
  batches = new Map<string, typeof batches.$inferSelect>();
  private blocked = new Set<string>();
  constructor(readonly ctx: AuthContext, readonly maxDepth: number) {}

  private allowed(siteId: string) {
    return this.ctx.allowedSiteIds.includes(siteId);
  }

  /** Loads lots; returns the visible ids (others are counted as hidden and never traversed). */
  async loadLots(ids: string[]) {
    const need = [...new Set(ids)].filter((id) => !this.lots.has(id) && !this.blocked.has(id));
    if (need.length) {
      const rows = await db.select().from(inventoryLots).where(and(inArray(inventoryLots.id, need), eq(inventoryLots.organizationId, this.ctx.organizationId)));
      for (const r of rows) {
        if (this.allowed(r.siteId)) this.lots.set(r.id, r);
        else {
          this.blocked.add(r.id);
          this.hidden.add(`lot:${r.id}`);
        }
      }
    }
    return [...new Set(ids)].filter((id) => this.lots.has(id));
  }

  async loadBatches(ids: string[]) {
    const need = [...new Set(ids)].filter((id) => !this.batches.has(id) && !this.blocked.has(id));
    if (need.length) {
      const rows = await db.select().from(batches).where(and(inArray(batches.id, need), eq(batches.organizationId, this.ctx.organizationId)));
      for (const r of rows) {
        if (this.allowed(r.siteId)) this.batches.set(r.id, r);
        else {
          this.blocked.add(r.id);
          this.hidden.add(`batch:${r.id}`);
        }
      }
    }
    return [...new Set(ids)].filter((id) => this.batches.has(id));
  }

  /** Lot → batch consumption edges (ledger first, live dispense records too). */
  private async consumers(lotIds: string[]): Promise<{ lotId: string; batchId: string }[]> {
    if (!lotIds.length) return [];
    const mv = await db
      .selectDistinct({ lotId: stockMovements.lotId, batchId: stockMovements.sourceDocumentId })
      .from(stockMovements)
      .where(and(inArray(stockMovements.lotId, lotIds), eq(stockMovements.movementType, "consumption"), eq(stockMovements.sourceDocumentType, "batch"), notReversed));
    const dr = await db
      .selectDistinct({ lotId: dispenseRecords.lotId, batchId: batchMaterials.batchId })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .where(and(inArray(dispenseRecords.lotId, lotIds), isNull(dispenseRecords.voidedAt)));
    const seen = new Set<string>();
    const out: { lotId: string; batchId: string }[] = [];
    for (const r of [...mv, ...dr]) {
      if (!r.batchId) continue;
      const k = `${r.lotId}:${r.batchId}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ lotId: r.lotId, batchId: r.batchId });
      }
    }
    return out;
  }

  /** Input lots of batches. */
  private async inputs(batchIds: string[]): Promise<{ lotId: string; batchId: string }[]> {
    if (!batchIds.length) return [];
    const mv = await db
      .selectDistinct({ lotId: stockMovements.lotId, batchId: stockMovements.sourceDocumentId })
      .from(stockMovements)
      .where(and(inArray(stockMovements.sourceDocumentId, batchIds), eq(stockMovements.movementType, "consumption"), eq(stockMovements.sourceDocumentType, "batch"), notReversed));
    const dr = await db
      .selectDistinct({ lotId: dispenseRecords.lotId, batchId: batchMaterials.batchId })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .where(and(inArray(batchMaterials.batchId, batchIds), isNull(dispenseRecords.voidedAt)));
    const seen = new Set<string>();
    return [...mv, ...dr].filter((r) => r.batchId && !seen.has(`${r.lotId}:${r.batchId}`) && seen.add(`${r.lotId}:${r.batchId}`)).map((r) => ({ lotId: r.lotId, batchId: r.batchId! }));
  }

  /** Output lots of batches (by source batch and the batch's output lot). */
  private async outputs(batchIds: string[]): Promise<{ lotId: string; batchId: string }[]> {
    if (!batchIds.length) return [];
    const bySource = await db.select({ lotId: inventoryLots.id, batchId: inventoryLots.sourceBatchId }).from(inventoryLots).where(inArray(inventoryLots.sourceBatchId, batchIds));
    const byOutput = await db.select({ lotId: batches.outputLotId, batchId: batches.id }).from(batches).where(and(inArray(batches.id, batchIds), sql`${batches.outputLotId} is not null`));
    const seen = new Set<string>();
    return [...bySource, ...byOutput].filter((r) => r.lotId && r.batchId && !seen.has(`${r.lotId}:${r.batchId}`) && seen.add(`${r.lotId}:${r.batchId}`)).map((r) => ({ lotId: r.lotId!, batchId: r.batchId! }));
  }

  /** Downstream edges of lots, plus every visible consuming batch (one still in process has no output yet). */
  async forwardEdges(lotIds: string[]): Promise<{ edges: Edge[]; batchIds: string[] }> {
    const cons = await this.consumers(lotIds);
    const visibleBatches = await this.loadBatches(cons.map((c) => c.batchId));
    const outs = await this.outputs(visibleBatches);
    const edges: Edge[] = [];
    for (const c of cons) {
      if (!visibleBatches.includes(c.batchId)) continue;
      for (const o of outs.filter((x) => x.batchId === c.batchId)) edges.push({ from: c.lotId, to: o.lotId, batchId: c.batchId });
    }
    const relots = lotIds.length ? await db.select({ id: inventoryLots.id, origin: inventoryLots.originLotId }).from(inventoryLots).where(inArray(inventoryLots.originLotId, lotIds)) : [];
    for (const r of relots) edges.push({ from: r.origin!, to: r.id, batchId: null });
    return { edges, batchIds: visibleBatches };
  }

  async backwardEdges(lotIds: string[]): Promise<{ edges: Edge[]; batchIds: string[] }> {
    const rows = lotIds.map((id) => this.lots.get(id)!).filter(Boolean);
    const batchIds = await this.loadBatches(rows.map((r) => r.sourceBatchId).filter((x): x is string => !!x));
    const ins = await this.inputs(batchIds);
    const edges: Edge[] = [];
    for (const r of rows) {
      if (r.sourceBatchId && batchIds.includes(r.sourceBatchId)) for (const i of ins.filter((x) => x.batchId === r.sourceBatchId)) edges.push({ from: i.lotId, to: r.id, batchId: r.sourceBatchId });
      if (r.originLotId) edges.push({ from: r.originLotId, to: r.id, batchId: null });
    }
    return { edges, batchIds };
  }
}

type Visit = { role: RecallLot["role"]; depth: number; viaBatchId: string | null; originLotId: string | null };

/** Breadth-first walk; `dir` picks the edge end to follow. Returns the newly reached lots with their visit info. */
async function walk(x: Explorer, start: string[], dir: "forward" | "backward", visited: Map<string, Visit>, role: Visit["role"], batchSink: Set<string>) {
  let frontier = start;
  let depth = 0;
  const reached: string[] = [];
  while (frontier.length) {
    const { edges, batchIds } = dir === "forward" ? await x.forwardEdges(frontier) : await x.backwardEdges(frontier);
    if (!edges.length && !batchIds.length) break;
    if (depth >= x.maxDepth) {
      x.depthLimitHit = true;
      break;
    }
    for (const b of batchIds) batchSink.add(b);
    const nextIds = [...new Set(edges.map((e) => (dir === "forward" ? e.to : e.from)))];
    const visible = await x.loadLots(nextIds);
    const next: string[] = [];
    for (const id of visible) {
      if (visited.has(id)) continue;
      const e = edges.find((ed) => (dir === "forward" ? ed.to : ed.from) === id)!;
      visited.set(id, { role, depth: depth + 1, viaBatchId: e.batchId, originLotId: e.batchId ? null : dir === "forward" ? e.from : null });
      next.push(id);
      reached.push(id);
    }
    frontier = next;
    depth++;
  }
  return reached;
}

/** Resolves the explorer's start: lots plus a subject description, or null (same answer for not found and out of scope). */
async function resolveStart(ctx: AuthContext, q: RecallQuery): Promise<{ subject: NonNullable<RecallScope["subject"]>; lotIds: string[]; batchId: string | null; defaultMode: RecallMode } | null> {
  const allowed = ctx.allowedSiteIds;
  if (q.complaintId) {
    ctx.require("quality.complaint.view");
    try {
      const r = await complaintStartLots(ctx, q.complaintId);
      return { subject: { kind: "complaint", id: r.complaint.id, number: r.complaint.number, label: r.complaint.customerName }, lotIds: r.lotIds, batchId: null, defaultMode: "reverse" };
    } catch (e) {
      if (e instanceof DomainError && e.code === "not_found") return null;
      throw e;
    }
  }
  if (q.supplierLot?.trim()) {
    const v = q.supplierLot.trim().toUpperCase();
    const rows = await db.select({ id: inventoryLots.id, supplierName: inventoryLots.supplierName }).from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), sql`upper(${inventoryLots.supplierLotNumber}) = ${v}`, inArray(inventoryLots.siteId, allowed)));
    if (!rows.length) return null;
    const names = [...new Set(rows.map((r) => r.supplierName).filter((x): x is string => !!x))];
    return { subject: { kind: "supplier_lot", id: null, number: q.supplierLot.trim(), label: names.join(", ") || "Supplier lot" }, lotIds: rows.map((r) => r.id), batchId: null, defaultMode: "forward" };
  }
  const p = parseTraceCode(q.code);
  if (!p) return null;
  if (p.kind === "any" && /^CMP-/.test(p.value)) {
    const [c] = await db.select({ id: complaints.id }).from(complaints).where(and(eq(complaints.organizationId, ctx.organizationId), eq(complaints.complaintNumber, p.value), inArray(complaints.siteId, allowed))).limit(1);
    return c ? resolveStart(ctx, { complaintId: c.id }) : null;
  }
  if (p.kind !== "lot") {
    const [box] = await db.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, p.value), inArray(containers.siteId, allowed))).limit(1);
    if (box) {
      const ids = await lotsOfBox(db, ctx.organizationId, box.id);
      return { subject: { kind: "box", id: box.id, number: box.containerNumber, label: `Box ${box.containerNumber}` }, lotIds: ids, batchId: null, defaultMode: "reverse" };
    }
    if (p.kind === "box") return null;
    const [b] = await db.select({ id: batches.id, number: batches.batchNumber, productName: products.name }).from(batches).innerJoin(products, eq(products.id, batches.productId)).where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.batchNumber, p.value), inArray(batches.siteId, allowed))).limit(1);
    if (b) {
      const outs = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.id));
      const [bo] = await db.select({ outputLotId: batches.outputLotId }).from(batches).where(eq(batches.id, b.id));
      const ids = [...new Set([...outs.map((o) => o.id), ...(bo?.outputLotId ? [bo.outputLotId] : [])])];
      return { subject: { kind: "batch", id: b.id, number: b.number, label: b.productName }, lotIds: ids, batchId: b.id, defaultMode: "forward" };
    }
  }
  const [lot] = await db
    .select({ id: inventoryLots.id, number: inventoryLots.lotNumber, itemKind: inventoryLots.itemKind, materialName: materials.name, productName: products.name })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, p.value), inArray(inventoryLots.siteId, allowed)))
    .limit(1);
  if (!lot) return null;
  return { subject: { kind: "lot", id: lot.id, number: lot.number, label: lot.materialName ?? lot.productName ?? "Lot" }, lotIds: [lot.id], batchId: null, defaultMode: lot.itemKind === "product" ? "reverse" : "forward" };
}

export async function recallScope(ctx: AuthContext, q: RecallQuery): Promise<RecallScope> {
  ctx.require("quality.genealogy.view");
  const maxDepth = await getSetting(db, ctx.organizationId, "quality.genealogy.max_depth");
  const asOf = new Date();
  const siteCodes = ctx.allowedSites.map((s) => s.code);
  const empty = (mode: RecallMode = "forward"): RecallScope => ({ query: q, subject: null, mode, lots: [], batches: [], shipments: [], customers: [], boxes: [], stock: [], hiddenCount: 0, asOf, siteCodes, maxDepth, depthLimitHit: false, notFoundMessage: NOT_FOUND });
  if (!q.code?.trim() && !q.supplierLot?.trim() && !q.complaintId) return empty();
  const start = await resolveStart(ctx, q);
  if (!start) return empty(q.mode ?? "forward");
  const mode: RecallMode = q.mode ?? start.defaultMode;
  const x = new Explorer(ctx, maxDepth);
  const startIds = await x.loadLots(start.lotIds);
  const visited = new Map<string, Visit>();
  for (const id of startIds) visited.set(id, { role: "start", depth: 0, viaBatchId: null, originLotId: null });

  // Batches by relation.
  const downstreamBatches = new Set<string>();
  const upstreamBatches = new Set<string>();
  const siblingSink = new Set<string>();
  await walk(x, startIds, "forward", visited, "downstream", downstreamBatches);
  if (mode === "reverse") {
    const up = await walk(x, startIds, "backward", visited, "upstream", upstreamBatches);
    // Everything downstream of any upstream lot: sibling batches and their products.
    await walk(x, up, "forward", visited, "downstream", siblingSink);
  }
  const sourceBatchIds = new Set(startIds.map((id) => x.lots.get(id)?.sourceBatchId).filter((v): v is string => !!v));
  for (const b of upstreamBatches) sourceBatchIds.add(b);
  await x.loadBatches([...downstreamBatches, ...upstreamBatches, ...siblingSink, ...(start.batchId ? [start.batchId] : [])]);

  const siteCode = new Map((await db.select({ id: sites.id, code: sites.code }).from(sites).where(eq(sites.organizationId, ctx.organizationId))).map((s) => [s.id, s.code]));
  const lotIds = [...visited.keys()];

  // Names, on-hand per lot.
  const names = lotIds.length
    ? await db.select({ id: inventoryLots.id, materialName: materials.name, productName: products.name }).from(inventoryLots).leftJoin(materials, eq(materials.id, inventoryLots.materialId)).leftJoin(products, eq(products.id, inventoryLots.productId)).where(inArray(inventoryLots.id, lotIds))
    : [];
  const stockRows = lotIds.length
    ? await db
        .select({ lotId: inventoryBalances.lotId, qty: inventoryBalances.qtyBase, locationCode: locations.code, locationKind: locations.kind, siteId: inventoryBalances.siteId })
        .from(inventoryBalances)
        .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
        .where(and(inArray(inventoryBalances.lotId, lotIds), gt(inventoryBalances.qtyBase, "0"), inArray(inventoryBalances.siteId, ctx.allowedSiteIds)))
        .orderBy(asc(locations.code))
    : [];
  const batchNo = (id: string | null) => (id ? (x.batches.get(id)?.batchNumber ?? null) : null);
  const lots: RecallLot[] = lotIds
    .map((id) => {
      const l = x.lots.get(id)!;
      const v = visited.get(id)!;
      const n = names.find((r) => r.id === id);
      const onHand = stockRows.filter((s) => s.lotId === id).reduce((a, s) => a.plus(s.qty), new Decimal(0));
      return {
        id,
        number: l.lotNumber,
        itemKind: l.itemKind,
        itemName: n?.materialName ?? n?.productName ?? "—",
        status: l.qualityStatus,
        siteCode: siteCode.get(l.siteId) ?? "",
        expiresOn: l.expiresOn,
        role: v.role,
        depth: v.depth,
        viaBatchNumber: batchNo(v.viaBatchId),
        originLotNumber: l.originLotId ? (x.lots.get(l.originLotId)?.lotNumber ?? null) : null,
        onHand: onHand.toString(),
        uom: l.baseUom,
        supplierName: l.supplierName,
        supplierLot: l.supplierLotNumber,
      };
    })
    .sort((a, b) => ["start", "upstream", "downstream"].indexOf(a.role) - ["start", "upstream", "downstream"].indexOf(b.role) || a.depth - b.depth || a.number.localeCompare(b.number));

  const productName = new Map((await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.organizationId, ctx.organizationId))).map((p) => [p.id, p.name]));
  const batchList: RecallBatch[] = [...x.batches.values()]
    .filter((b) => b.id === start.batchId || downstreamBatches.has(b.id) || upstreamBatches.has(b.id) || siblingSink.has(b.id) || sourceBatchIds.has(b.id))
    .map((b) => ({
      id: b.id,
      number: b.batchNumber,
      productName: productName.get(b.productId) ?? "—",
      status: b.status,
      siteCode: siteCode.get(b.siteId) ?? "",
      relation: (b.id === start.batchId ? "subject" : sourceBatchIds.has(b.id) ? "source" : downstreamBatches.has(b.id) ? "downstream" : "sibling") as RecallBatch["relation"],
      date: b.completedAt ?? b.startedAt ?? null,
    }))
    .sort((a, b) => ["subject", "source", "downstream", "sibling"].indexOf(a.relation) - ["subject", "source", "downstream", "sibling"].indexOf(b.relation) || a.number.localeCompare(b.number));

  // Shipments of every affected lot (ledger), with returns and boxes.
  const shipRows = lotIds.length
    ? await db
        .select({ shipmentId: stockMovements.sourceDocumentId, lotId: stockMovements.lotId, qty: sql<string>`sum(${stockMovements.qtyBase})::text` })
        .from(stockMovements)
        .where(and(inArray(stockMovements.lotId, lotIds), eq(stockMovements.movementType, "shipment"), eq(stockMovements.sourceDocumentType, "shipment"), notReversed))
        .groupBy(stockMovements.sourceDocumentId, stockMovements.lotId)
    : [];
  const shipmentIds = [...new Set(shipRows.map((r) => r.shipmentId).filter((v): v is string => !!v))];
  const shipHeads = shipmentIds.length
    ? await db
        .select({ s: shipments, orderNumber: salesOrders.orderNumber, customerId: customers.id, customerName: customers.name, shipTo: customers.shipToAddress })
        .from(shipments)
        .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
        .innerJoin(customers, eq(customers.id, salesOrders.customerId))
        .where(inArray(shipments.id, shipmentIds))
    : [];
  const visibleShip = shipHeads.filter((h) => {
    if (ctx.allowedSiteIds.includes(h.s.siteId)) return true;
    x.hidden.add(`shipment:${h.s.id}`);
    return false;
  });
  const visibleIds = visibleShip.map((h) => h.s.id);
  const returned = await returnedQtyByLot(db, visibleIds, { postedOnly: true });
  const sBoxes = await shipmentBoxes(db, ctx.organizationId, visibleIds);
  const shipmentsOut: RecallShipment[] = [];
  for (const r of shipRows) {
    const h = visibleShip.find((v) => v.s.id === r.shipmentId);
    if (!h) continue;
    const l = x.lots.get(r.lotId)!;
    const ret = returned.get(`${h.s.id}:${r.lotId}`) ?? new Decimal(0);
    const shippedQty = new Decimal(r.qty);
    shipmentsOut.push({
      shipmentId: h.s.id,
      drNumber: shipmentRef(h.s),
      dispatchedAt: h.s.dispatchedAt ?? h.s.createdAt ?? new Date(0), // shipments with ledger movements left the site, so dispatched_at is set (ck_shipments_dispatched)
      deliveredAt: h.s.deliveredAt,
      orderId: h.s.salesOrderId,
      orderNumber: h.orderNumber,
      customerId: h.customerId,
      customerName: h.customerName,
      shipTo: h.shipTo,
      siteCode: siteCode.get(h.s.siteId) ?? "",
      lotId: r.lotId,
      lotNumber: l.lotNumber,
      productName: names.find((n) => n.id === r.lotId)?.productName ?? "—",
      uom: l.baseUom,
      qtyShipped: shippedQty.toString(),
      qtyReturned: ret.toString(),
      qtyOutstanding: Decimal.max(shippedQty.minus(ret), 0).toString(),
      boxes: sBoxes.filter((b) => b.shipmentId === h.s.id && b.lotId === r.lotId).map((b) => b.containerNumber),
    });
  }
  shipmentsOut.sort((a, b) => a.dispatchedAt.getTime() - b.dispatchedAt.getTime() || a.lotNumber.localeCompare(b.lotNumber));

  const byCustomer = new Map<string, RecallCustomer & { _out: Map<string, Decimal> }>();
  for (const s of shipmentsOut) {
    const c = byCustomer.get(s.customerId) ?? { customerId: s.customerId, customerName: s.customerName, shipTo: s.shipTo, shipmentCount: 0, drNumbers: [], lotNumbers: [], outstanding: [], _out: new Map<string, Decimal>() };
    if (!c.drNumbers.includes(s.drNumber)) {
      c.drNumbers.push(s.drNumber);
      c.shipmentCount++;
    }
    if (!c.lotNumbers.includes(s.lotNumber)) c.lotNumbers.push(s.lotNumber);
    c._out.set(s.uom, (c._out.get(s.uom) ?? new Decimal(0)).plus(s.qtyOutstanding));
    byCustomer.set(s.customerId, c);
  }
  const customerList: RecallCustomer[] = [...byCustomer.values()]
    .map(({ _out, ...c }) => ({ ...c, outstanding: [..._out.entries()].map(([uom, qty]) => ({ uom, qty: qty.toString() })) }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  // Boxes: current contents, boxes tagged on movements of affected lots, shipment boxes, then lineage children.
  const boxIds = new Set<string>();
  if (lotIds.length) {
    for (const r of await db.selectDistinct({ id: containerContents.containerId }).from(containerContents).where(and(inArray(containerContents.lotId, lotIds), gt(containerContents.qtyBase, "0")))) boxIds.add(r.id);
    for (const r of await db.selectDistinct({ id: sql<string>`${stockMovements.meta}->>'containerId'` }).from(stockMovements).where(and(inArray(stockMovements.lotId, lotIds), sql`${stockMovements.meta}->>'containerId' is not null`))) if (r.id) boxIds.add(r.id);
  }
  for (const b of sBoxes) boxIds.add(b.containerId);
  let frontier = [...boxIds];
  for (let i = 0; i < maxDepth && frontier.length; i++) {
    const kids = await db.selectDistinct({ id: containerLineage.childContainerId }).from(containerLineage).where(inArray(containerLineage.parentContainerId, frontier));
    frontier = kids.map((k) => k.id).filter((id) => !boxIds.has(id));
    for (const id of frontier) boxIds.add(id);
  }
  const boxRows = boxIds.size
    ? await db.select({ c: containers, locationCode: locations.code }).from(containers).leftJoin(locations, eq(locations.id, containers.currentLocationId)).where(and(inArray(containers.id, [...boxIds]), eq(containers.organizationId, ctx.organizationId))).orderBy(asc(containers.containerNumber))
    : [];
  const contents = boxIds.size ? await db.select().from(containerContents).where(inArray(containerContents.containerId, [...boxIds])) : [];
  const boxesOut: RecallBox[] = [];
  for (const b of boxRows) {
    if (!ctx.allowedSiteIds.includes(b.c.siteId)) {
      x.hidden.add(`box:${b.c.id}`);
      continue;
    }
    const cc = contents.filter((c) => c.containerId === b.c.id);
    const linked = sBoxes.find((s) => s.containerId === b.c.id);
    const ship = linked ? visibleShip.find((v) => v.s.id === linked.shipmentId) : null;
    const lotNos = [...new Set([...cc.map((c) => x.lots.get(c.lotId)?.lotNumber), ...(linked ? [x.lots.get(linked.lotId)?.lotNumber] : [])].filter((v): v is string => !!v))];
    boxesOut.push({
      containerId: b.c.id,
      number: b.c.containerNumber,
      status: b.c.status,
      siteCode: siteCode.get(b.c.siteId) ?? "",
      locationCode: b.locationCode,
      lotNumbers: lotNos,
      qtyNow: cc.reduce((a, c) => a.plus(c.qtyBase), new Decimal(0)).toString(),
      uom: cc[0]?.baseUom ?? "",
      drNumber: ship?.s.deliveryReceiptNumber ?? null,
      customerName: ship?.customerName ?? null,
    });
  }

  const stock: RecallStock[] = stockRows.map((s) => {
    const l = x.lots.get(s.lotId)!;
    return { lotId: s.lotId, lotNumber: l.lotNumber, status: l.qualityStatus, siteCode: siteCode.get(s.siteId) ?? "", locationCode: s.locationCode, locationKind: s.locationKind, qty: new Decimal(s.qty).toString(), uom: l.baseUom };
  });

  await audit(db, ctx, {
    action: "quality.genealogy.viewed",
    entityType: start.subject.kind === "lot" ? "inventory_lot" : start.subject.kind === "box" ? "container" : start.subject.kind,
    entityId: start.subject.id,
    entityNumber: start.subject.number,
    after: { explorer: "recall", mode, lots: lots.length, batches: batchList.length, shipments: shipmentsOut.length, customers: customerList.length, boxes: boxesOut.length, hiddenCount: x.hidden.size, maxDepth, depthLimitHit: x.depthLimitHit, sites: siteCodes, asOf: asOf.toISOString() },
  });

  return { query: q, subject: start.subject, mode, lots, batches: batchList, shipments: shipmentsOut, customers: customerList, boxes: boxesOut, stock, hiddenCount: x.hidden.size, asOf, siteCodes, maxDepth, depthLimitHit: x.depthLimitHit, notFoundMessage: NOT_FOUND };
}

/* ------------------------------------------------------------------ export */

export type RecallRow = {
  section: "customer_shipment" | "box" | "stock" | "lot" | "batch";
  customer: string;
  shipTo: string;
  order: string;
  dr: string;
  dispatched: string;
  lot: string;
  item: string;
  status: string;
  site: string;
  box: string;
  location: string;
  qtyShipped: string;
  qtyReturned: string;
  qtyOutstanding: string;
  qty: string;
  uom: string;
  batch: string;
  relation: string;
};

const blank: Omit<RecallRow, "section"> = { customer: "", shipTo: "", order: "", dr: "", dispatched: "", lot: "", item: "", status: "", site: "", box: "", location: "", qtyShipped: "", qtyReturned: "", qtyOutstanding: "", qty: "", uom: "", batch: "", relation: "" };

/** Flat rows of a recall scope: affected shipments first (the notification list), then boxes, stock, lots and batches. */
export function flattenRecall(r: RecallScope): RecallRow[] {
  const rows: RecallRow[] = [];
  for (const s of r.shipments) rows.push({ ...blank, section: "customer_shipment", customer: s.customerName, shipTo: s.shipTo, order: s.orderNumber, dr: s.drNumber, dispatched: s.dispatchedAt.toISOString(), lot: s.lotNumber, item: s.productName, site: s.siteCode, box: s.boxes.join(" "), qtyShipped: s.qtyShipped, qtyReturned: s.qtyReturned, qtyOutstanding: s.qtyOutstanding, uom: s.uom });
  for (const b of r.boxes) rows.push({ ...blank, section: "box", box: b.number, status: b.status, site: b.siteCode, location: b.locationCode ?? "", lot: b.lotNumbers.join(" "), qty: b.qtyNow, uom: b.uom, dr: b.drNumber ?? "", customer: b.customerName ?? "" });
  for (const s of r.stock) rows.push({ ...blank, section: "stock", lot: s.lotNumber, status: s.status, site: s.siteCode, location: `${s.locationCode} (${s.locationKind})`, qty: s.qty, uom: s.uom });
  for (const l of r.lots) rows.push({ ...blank, section: "lot", lot: l.number, item: l.itemName, status: l.status, site: l.siteCode, relation: l.role, batch: l.viaBatchNumber ?? "", qty: l.onHand, uom: l.uom });
  for (const b of r.batches) rows.push({ ...blank, section: "batch", batch: b.number, item: b.productName, status: b.status, site: b.siteCode, relation: b.relation });
  return rows;
}

/** Recall list export (quality.genealogy.export, S): names customers, so runExport audits it and this adds quality.genealogy.exported. */
export const recallExport: ExportDefinition<RecallQuery, RecallRow> = {
  code: "quality.recall",
  title: "Recall explorer (affected customers, boxes and stock)",
  permission: "quality.genealogy.export",
  sensitivity: "S",
  columns: [
    { header: "Section", value: (r) => r.section },
    { header: "Customer", value: (r) => r.customer },
    { header: "Ship-to", value: (r) => r.shipTo },
    { header: "Order", value: (r) => r.order },
    { header: "DR number", value: (r) => r.dr },
    { header: "Dispatched", value: (r) => r.dispatched },
    { header: "Lot", value: (r) => r.lot },
    { header: "Item", value: (r) => r.item },
    { header: "Status", value: (r) => r.status },
    { header: "Site", value: (r) => r.site },
    { header: "Box", value: (r) => r.box },
    { header: "Location", value: (r) => r.location },
    { header: "Shipped", value: (r) => r.qtyShipped, numeric: true },
    { header: "Returned", value: (r) => r.qtyReturned, numeric: true },
    { header: "Still at customer", value: (r) => r.qtyOutstanding, numeric: true },
    { header: "Quantity", value: (r) => r.qty, numeric: true },
    { header: "Unit", value: (r) => r.uom },
    { header: "Batch", value: (r) => r.batch },
    { header: "Relation", value: (r) => r.relation },
  ],
  fetch: async (ctx, f, limit) => {
    const r = await recallScope(ctx, f);
    if (!r.subject) throw new DomainError("not_found", NOT_FOUND);
    const rows = flattenRecall(r);
    await audit(db, ctx, {
      action: "quality.genealogy.exported",
      entityType: r.subject.kind === "lot" ? "inventory_lot" : r.subject.kind === "box" ? "container" : r.subject.kind,
      entityId: r.subject.id,
      entityNumber: r.subject.number,
      after: { explorer: "recall", filters: f, mode: r.mode, rows: rows.length, asOf: r.asOf.toISOString(), sites: r.siteCodes, depthLimitHit: r.depthLimitHit },
    });
    return rows.slice(0, limit);
  },
  siteScope: (ctx) => ctx.allowedSiteIds,
  fileName: (f) => `recall-${(f.code ?? f.supplierLot ?? f.complaintId ?? "query").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60)}`,
};

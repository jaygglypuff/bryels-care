import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, goodsReceipts, inventoryBalances, inventoryLots, organizations, packs, products, purchaseOrders, salesOrders, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { NEAR_EXPIRY_WINDOW_DAYS, addDays, resolveScope, type DashboardScope } from "./dashboard";

/**
 * Operations Center (ADR-081, docs/WORKFLOW_ARCHITECTURE.md §2): one board for the connected pipeline
 * Expected delivery → Receiving → Inspection → Raw materials → Production → Quality check → Packaging →
 * Finished goods → Customer orders to dispatch. Every count is a live query over posted records in the
 * caller's sites; a stage is only computed when the caller holds the view permission of the module the
 * records belong to. Nothing here changes a record: each stage links to the screen that does the work.
 */

export const PIPELINE_STAGE_KEYS = ["expected", "receiving", "inspection", "raw_available", "production", "qc", "packaging", "finished", "dispatch"] as const;
export type PipelineStageKey = (typeof PIPELINE_STAGE_KEYS)[number];

/** `label` is lower case, shown after the number ("2 in progress"). */
export type PipelinePart = { label: string; n: number };
export type PipelineStage = {
  key: PipelineStageKey;
  label: string;
  /** One line under the label: what "in this stage" means. */
  hint: string;
  href: string;
  count: number;
  /** Split of `count` by status (the parts always add up to `count`). */
  parts: PipelinePart[];
  /** Items that need someone now (late, on hold, expiring); 0 = nothing to flag. Never added to `count`. */
  attention: number;
  attentionLabel: string;
  attentionHref?: string;
};

export type ActiveBatch = {
  id: string;
  batchNumber: string;
  productName: string;
  status: string;
  siteCode: string;
  stepsDone: number;
  stepsTotal: number;
  plannedStartOn: string | null;
  orderNumber: string | null;
  /** Planned start passed and the batch has not started yet. */
  late: boolean;
  href: string;
};

export type OperationsCenter = { scope: DashboardScope; today: string; stages: PipelineStage[]; batches: ActiveBatch[] };

export const ACTIVE_BATCH_LIMIT = 50;
const ACTIVE_BATCH_STATES = ["planned", "materials_staged", "in_process", "awaiting_qc", "quarantined"];
const OPEN_PO_STATES = ["approved", "sent", "partially_received"];
const ORDER_TO_PICK = ["confirmed", "allocated"];
const ORDER_TO_DISPATCH = ["picking", "packed", "partially_shipped"];

const n = sql<number>`count(*)::int`;
const num = (r: { n: number } | undefined) => Number(r?.n ?? 0);

async function orgToday(ctx: AuthContext): Promise<string> {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const [r] = await db.execute<{ today: string }>(sql`select ((now() at time zone ${o?.tz ?? "Asia/Manila"})::date)::text as today`);
  return r.today;
}

/** Lots of one kind with stock on hand in the sites, split by quality status, plus how many expire soon. */
async function lotsOnHand(siteIds: string[], itemKind: "material" | "product", soon: string) {
  const onHand = db
    .select({ lotId: inventoryBalances.lotId })
    .from(inventoryBalances)
    .where(and(inArray(inventoryBalances.siteId, siteIds), gt(inventoryBalances.qtyBase, "0")))
    .groupBy(inventoryBalances.lotId)
    .as("oh");
  const rows = await db
    .select({
      status: inventoryLots.qualityStatus,
      n,
      expiring: sql<number>`count(*) filter (where ${inventoryLots.expiresOn} is not null and ${inventoryLots.expiresOn} <= ${soon})::int`,
    })
    .from(inventoryLots)
    .innerJoin(onHand, eq(onHand.lotId, inventoryLots.id))
    .where(and(inArray(inventoryLots.siteId, siteIds), eq(inventoryLots.itemKind, itemKind)))
    .groupBy(inventoryLots.qualityStatus);
  const by = new Map(rows.map((r) => [r.status, r]));
  return { quarantine: num(by.get("quarantine")), onHold: num(by.get("on_hold")), released: num(by.get("released")), releasedExpiring: Number(by.get("released")?.expiring ?? 0) };
}

export async function getOperationsCenter(ctx: AuthContext, opts: { all?: boolean } = {}): Promise<OperationsCenter> {
  const scope = resolveScope(ctx, !!opts.all);
  const siteIds = scope.siteIds;
  const siteCode = new Map(scope.sites.map((s) => [s.id, s.code]));
  const today = await orgToday(ctx);
  const soon = addDays(today, NEAR_EXPIRY_WINDOW_DAYS);
  const can = (p: Parameters<AuthContext["can"]>[0]) => ctx.can(p);
  const seesBatches = can("production.batch.view") || can("production.work_order.view");
  const seesLots = can("inventory.lot.view");

  const [po, gr, materialLots, batchRows, packRows, productLots, orders, active] = await Promise.all([
    can("procurement.purchase_order.view")
      ? db
          .select({ status: purchaseOrders.status, n, late: sql<number>`count(*) filter (where ${purchaseOrders.expectedDate} < ${today})::int` })
          .from(purchaseOrders)
          .where(and(inArray(purchaseOrders.siteId, siteIds), inArray(purchaseOrders.status, OPEN_PO_STATES)))
          .groupBy(purchaseOrders.status)
      : null,
    can("procurement.goods_receipt.view")
      ? db.select({ n }).from(goodsReceipts).where(and(inArray(goodsReceipts.siteId, siteIds), eq(goodsReceipts.status, "draft")))
      : null,
    seesLots ? lotsOnHand(siteIds, "material", soon) : null,
    seesBatches
      ? db
          .select({ status: batches.status, n, late: sql<number>`count(*) filter (where ${batches.status} = 'planned' and ${batches.plannedStartOn} < ${today})::int` })
          .from(batches)
          .where(and(inArray(batches.siteId, siteIds), inArray(batches.status, ACTIVE_BATCH_STATES)))
          .groupBy(batches.status)
      : null,
    can("inventory.pack.view")
      ? db
          .select({ status: packs.status, n })
          .from(packs)
          .where(and(inArray(packs.siteId, siteIds), eq(packs.sourceKind, "batch_output"), inArray(packs.status, ["open", "verified"])))
          .groupBy(packs.status)
      : null,
    seesLots ? lotsOnHand(siteIds, "product", soon) : null,
    can("sales.sales_order.view")
      ? db
          .select({ status: salesOrders.status, n, late: sql<number>`count(*) filter (where ${salesOrders.requestedDeliveryOn} < ${today})::int` })
          .from(salesOrders)
          .where(and(inArray(salesOrders.siteId, siteIds), inArray(salesOrders.status, [...ORDER_TO_PICK, ...ORDER_TO_DISPATCH])))
          .groupBy(salesOrders.status)
      : null,
    seesBatches ? activeBatches(siteIds, today, siteCode) : null,
  ]);

  const sum = (rows: { status: string; n: number }[], states: readonly string[]) => rows.filter((r) => states.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
  const lateOf = (rows: { status: string; late: number }[], states?: readonly string[]) =>
    rows.filter((r) => !states || states.includes(r.status)).reduce((a, r) => a + Number(r.late), 0);
  const stages: PipelineStage[] = [];

  if (po) {
    const toSend = sum(po, ["approved"]);
    const sent = sum(po, ["sent"]);
    const part = sum(po, ["partially_received"]);
    stages.push({
      key: "expected",
      label: "Expected deliveries",
      hint: "Purchase orders waiting for goods",
      href: "/procurement/expected",
      count: toSend + sent + part,
      parts: [{ label: "approved", n: toSend }, { label: "sent", n: sent }, { label: "part received", n: part }],
      attention: lateOf(po),
      attentionLabel: "past the expected date",
    });
  }
  if (gr) {
    const drafts = num(gr[0]);
    stages.push({ key: "receiving", label: "Receiving", hint: "Receipts started, not posted yet", href: "/inventory/receipts?status=draft", count: drafts, parts: [{ label: "draft", n: drafts }], attention: 0, attentionLabel: "" });
  }
  if (materialLots) {
    stages.push({
      key: "inspection",
      label: "Awaiting inspection",
      hint: "Material lots QA has not released",
      href: "/inventory?kind=material&status=quarantine",
      count: materialLots.quarantine,
      parts: [{ label: "waiting for QA", n: materialLots.quarantine }],
      attention: materialLots.onHold,
      attentionLabel: "on hold",
      attentionHref: "/inventory?kind=material&status=on_hold",
    });
    stages.push({
      key: "raw_available",
      label: "Raw materials available",
      hint: "Released material lots with stock",
      href: "/inventory?kind=material&status=released",
      count: materialLots.released,
      parts: [{ label: "released", n: materialLots.released }],
      attention: materialLots.releasedExpiring,
      attentionLabel: `expire within ${NEAR_EXPIRY_WINDOW_DAYS} days`,
      attentionHref: "/inventory/lots/expiry",
    });
  }
  if (batchRows) {
    const planned = sum(batchRows, ["planned"]);
    const running = sum(batchRows, ["materials_staged", "in_process"]);
    stages.push({
      key: "production",
      label: "Production",
      hint: "Batches planned or being made",
      href: "/production/orders",
      count: planned + running,
      parts: [{ label: "planned", n: planned }, { label: "in progress", n: running }],
      attention: lateOf(batchRows, ["planned"]),
      attentionLabel: "late to start",
    });
    const awaiting = sum(batchRows, ["awaiting_qc"]);
    const held = sum(batchRows, ["quarantined"]);
    stages.push({
      key: "qc",
      label: "Quality check",
      hint: "Finished batches waiting for QA",
      href: can("quality.disposition.view") ? "/quality" : "/production/orders",
      count: awaiting + held,
      parts: [{ label: "awaiting QC", n: awaiting }, { label: "in hold area", n: held }],
      attention: 0,
      attentionLabel: "",
    });
  }
  if (packRows) {
    const open = sum(packRows, ["open"]);
    const verified = sum(packRows, ["verified"]);
    stages.push({ key: "packaging", label: "Packaging", hint: "Boxing of finished batches", href: "/warehouse/packs", count: open + verified, parts: [{ label: "boxing", n: open }, { label: "checked", n: verified }], attention: 0, attentionLabel: "" });
  }
  if (productLots) {
    stages.push({
      key: "finished",
      label: "Finished goods",
      hint: "Released product lots with stock",
      href: "/inventory?kind=product&status=released",
      count: productLots.released,
      parts: [{ label: "available", n: productLots.released }],
      attention: productLots.releasedExpiring,
      attentionLabel: `expire within ${NEAR_EXPIRY_WINDOW_DAYS} days`,
      attentionHref: "/inventory/lots/expiry",
    });
  }
  if (orders) {
    const toPick = sum(orders, ORDER_TO_PICK);
    const toDispatch = sum(orders, ORDER_TO_DISPATCH);
    stages.push({
      key: "dispatch",
      label: "Orders to dispatch",
      hint: "Customer orders confirmed, not shipped",
      href: "/sales/board",
      count: toPick + toDispatch,
      parts: [{ label: "to pick", n: toPick }, { label: "picking or packed", n: toDispatch }],
      attention: lateOf(orders),
      attentionLabel: "past the requested date",
    });
  }

  stages.sort((a, b) => PIPELINE_STAGE_KEYS.indexOf(a.key) - PIPELINE_STAGE_KEYS.indexOf(b.key));
  return { scope, today, stages, batches: active ?? [] };
}

async function activeBatches(siteIds: string[], today: string, siteCode: Map<string, string>): Promise<ActiveBatch[]> {
  const stepsDone = sql<number>`(select count(*)::int from process_step_records p where p.batch_id = "batches"."id")`;
  const stepsTotal = sql<number>`coalesce(jsonb_array_length(${batches.formulaSnapshot}->'steps'), 0)`;
  // Furthest along first (QC, then running, then planned), oldest planned start first within a state.
  const rank = sql<number>`case ${batches.status} when 'awaiting_qc' then 0 when 'quarantined' then 1 when 'in_process' then 2 when 'materials_staged' then 3 else 4 end`;
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      siteId: batches.siteId,
      plannedStartOn: batches.plannedStartOn,
      productName: products.name,
      workOrderId: batches.workOrderId,
      orderNumber: workOrders.workOrderNumber,
      stepsDone,
      stepsTotal,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(workOrders, eq(workOrders.id, batches.workOrderId))
    .where(and(inArray(batches.siteId, siteIds), inArray(batches.status, ACTIVE_BATCH_STATES)))
    .orderBy(rank, asc(batches.plannedStartOn), asc(batches.batchNumber))
    .limit(ACTIVE_BATCH_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    batchNumber: r.batchNumber,
    productName: r.productName,
    status: r.status,
    siteCode: siteCode.get(r.siteId) ?? "",
    stepsDone: Math.min(Number(r.stepsDone), Number(r.stepsTotal)),
    stepsTotal: Number(r.stepsTotal),
    plannedStartOn: r.plannedStartOn,
    orderNumber: r.orderNumber,
    late: r.status === "planned" && !!r.plannedStartOn && r.plannedStartOn < today,
    // ADR-080: production orders are the hub; a batch without an order opens its full record.
    href: r.workOrderId ? `/production/orders/${r.workOrderId}` : `/production/${r.id}`,
  }));
}


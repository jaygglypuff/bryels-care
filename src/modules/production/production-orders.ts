import "server-only";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batches, processStepRecords, productionLines, products, salesOrderLines, salesOrders, workOrders } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtMass, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { getEffectiveFormulaRevision } from "@/modules/masterdata";
import { insertBatch } from "./batches";
import { listDailyLogs, defectSummary } from "./daily-log";
import { productionOrderActions, type NextAction } from "./production-order-next";
import {
  OPEN_STATUSES,
  PRODUCTION_ORDER_LABEL,
  PRODUCTION_ORDER_STATUSES,
  isLate,
  piecesText,
  productionOrderStatus,
  progressSteps,
  workOrderStatusesFor,
  type BatchFact,
  type ProductionOrderStatus,
  type ProductionOrderStatusView,
} from "./production-order-status";
import { idempotent, manilaToday } from "./shared";
import { createWorkOrder, lockWorkOrder, planLockedWorkOrder, releaseLockedWorkOrder } from "./work-orders";
import { getWorkOrder, type WorkOrderDetail } from "./work-orders-queries";
import { batchesOfWorkOrder, type Shortage } from "./work-orders-reserve";

/**
 * Production orders (ADR-074, ADR-080): ONE record the owner follows from ordering to done, built on
 * the existing work order and batch services. A production order IS a work order; its simple status
 * is derived from its batches (production-order-status.ts) and its one next action from that status
 * (production-order-next.ts). "Plan" and "Release" collapse into one Approve command that plans,
 * reserves materials and creates the batches in one transaction.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Sales order states whose lines still need products ("Make for this order", ADR-080 V2-2). */
export const MAKE_FOR_SALES_STATUSES = ["submitted", "pending_approval", "confirmed", "allocated", "picking", "packed", "partially_shipped"] as const;

export type ProductionOrderInput = {
  productId: string;
  /** Batch size in kg; empty = the formula's reference size. */
  batchSizeKg?: string | null;
  /** Default 1, or the whole batches that cover `quantityUnits` (owner decision: one order, one batch unless "More details" says otherwise). */
  batchCount?: number | string | null;
  /** How many pieces are needed (ADR-080: pieces first). Sets the target and, without a batch count, the number of batches. */
  quantityUnits?: string | number | null;
  plannedStart: string;
  /** Default = plannedStart. */
  plannedEnd?: string | null;
  /** The date the products are needed; default = the linked customer order's delivery date. */
  neededBy?: string | null;
  /** "Make for this order": the customer order this production order is for (work_orders.sales_order_id). */
  salesOrderId?: string | null;
  productionLineId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

/** Finished pieces from a bulk mass: mass × expected yield % ÷ unit mass, rounded down. */
function unitsFrom(sizeG: Decimal.Value, yieldPct: Decimal.Value | null, unitNetMassG: Decimal.Value) {
  const m = new Decimal(unitNetMassG);
  if (m.lte(0)) return new Decimal(0);
  return new Decimal(sizeG).mul(yieldPct ?? 100).div(100).div(m).floor();
}

/**
 * Whole batches that cover `units`: the smallest n with floor(n × batch mass × yield ÷ unit mass) ≥ units,
 * i.e. the same rounding as the expected pieces shown for the order (2 × 17.6 kg at 95 % ÷ 135 g = 247 bars).
 */
function batchesFor(units: Decimal.Value, sizeG: Decimal.Value, yieldPct: Decimal.Value | null, unitNetMassG: Decimal.Value) {
  const exact = new Decimal(sizeG).mul(yieldPct ?? 100).div(100).div(unitNetMassG);
  if (exact.lt(1)) return null;
  let n = Decimal.max(new Decimal(units).div(exact).floor(), 1).toNumber();
  while (unitsFrom(new Decimal(sizeG).mul(n), yieldPct, unitNetMassG).lt(units)) n++;
  return n;
}

/**
 * Creates a production order (a draft work order) with the simple defaults of the New order screen.
 * Pieces first: `quantityUnits` becomes the target and, unless a batch count is typed, the whole
 * number of batches that covers it. A link to a customer order needs `sales.sales_order.view`, a
 * sales order of the current site that still needs products; its delivery date is the default
 * needed-by date. Sales users with view-only access cannot create (no `production.work_order.create`).
 */
export async function createProductionOrder(ctx: AuthContext, input: ProductionOrderInput) {
  ctx.require("production.work_order.create");
  ctx.requireSite(ctx.currentSiteId);
  const units = input.quantityUnits === null || input.quantityUnits === undefined || String(input.quantityUnits).trim() === "" ? null : String(input.quantityUnits).trim();
  if (units !== null && (!/^\d{1,9}$/.test(units) || units === "0" || /^0+$/.test(units))) throw new DomainError("validation", "Enter how many pieces as a whole number above 0.", { field: "quantityUnits", fieldErrors: { quantityUnits: "Enter a whole number above 0." } });
  let neededBy = input.neededBy?.trim() || null;
  if (neededBy && !DATE.test(neededBy)) throw new DomainError("validation", "Choose a valid needed-by date.", { field: "neededBy", fieldErrors: { neededBy: "Choose a valid date." } });
  const salesOrderId = input.salesOrderId?.trim() || null;
  if (salesOrderId) {
    ctx.require("sales.sales_order.view");
    const [so] = UUID.test(salesOrderId) ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
    if (!so || !ctx.allowedSiteIds.includes(so.siteId)) throw new DomainError("not_found", "Customer order not found in your sites.");
    if (so.siteId !== ctx.currentSiteId) throw new DomainError("validation", "Switch to the customer order's site to make products for it.", { field: "salesOrderId" });
    if (!(MAKE_FOR_SALES_STATUSES as readonly string[]).includes(so.status)) throw new DomainError("state", `Customer order ${so.orderNumber} is ${so.status.replace(/_/g, " ")}; products are made only for open customer orders.`, { field: "salesOrderId" });
    neededBy ??= so.requestedDeliveryOn ?? null;
  }
  let count: number | string = input.batchCount === null || input.batchCount === undefined || input.batchCount === "" ? 1 : input.batchCount;
  if (units !== null && (input.batchCount === null || input.batchCount === undefined || input.batchCount === "")) {
    const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    const eff = product && DATE.test(input.plannedStart) ? await getEffectiveFormulaRevision(ctx, product.id, input.plannedStart).catch(() => null) : null;
    if (product && eff) {
      const sizeG = input.batchSizeKg && /^\d{1,9}(\.\d{1,3})?$/.test(input.batchSizeKg) ? new Decimal(input.batchSizeKg).mul(1000) : new Decimal(eff.rev.referenceBatchSizeG);
      const n = batchesFor(units, sizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG);
      if (n === null) throw new DomainError("validation", "One batch makes less than one piece. Check the batch size.", { field: "batchSizeKg" });
      count = n;
    }
  }
  return createWorkOrder(ctx, {
    productId: input.productId,
    batchSizeKg: input.batchSizeKg || null,
    batchCount: count as number,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd || input.plannedStart,
    neededBy,
    salesOrderId,
    targetUnits: units,
    productionLineId: input.productionLineId || null,
    notes: input.notes || null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}

/** "Coconut Oil: need 88 kg, only 40 kg can be used — 48 kg short." per material. */
export function shortageLines(shortages: Shortage[]) {
  return shortages.map((s) => {
    const fmt = (v: string) => (s.baseUom === "g" ? fmtMass(v) : fmtQty(v, s.baseUom, 2));
    const usable = new Decimal(s.covered).plus(s.reservedNow);
    return `${s.materialName}: need ${fmt(s.required)}, only ${fmt(usable.toString())} can be used — ${fmt(s.short)} short.`;
  });
}

export type ApproveResult = {
  workOrderNumber: string;
  batches: { batchId: string; batchNumber: string }[];
  reservations: number;
  shortages: string[];
};

/**
 * Approve = plan + release + reserve materials + create the batches, in ONE transaction
 * (`production.work_order.approve`). Idempotent: a repeat with the same key returns the stored
 * result. When materials are short (and release with shortage is off) nothing changes and the
 * error says which materials and how much, in plain words. Separation of duties
 * (`approvals.sod.work_order_release`) is checked against the person who created the order (or who
 * planned it, for an order planned on the old screen); the owner override applies (ADR-073).
 * Creating the batches needs no separate `production.batch.create`: approving the order includes it.
 */
export async function approveProductionOrder(ctx: AuthContext, workOrderId: string, opts: { note?: string | null; idempotencyKey?: string | null } = {}): Promise<ApproveResult> {
  ctx.require("production.work_order.approve");
  try {
    return await db.transaction(async (tx) => {
      const { result } = await idempotent(tx, ctx, opts.idempotencyKey, "production.production_order.approve", async () => {
        let wo = await lockWorkOrder(tx, ctx, workOrderId);
        const from = wo.status;
        if (from !== "draft" && from !== "planned") {
          throw new DomainError("state", `Production order ${wo.workOrderNumber} is already approved; only a draft can be approved.`, { machine: "work_order", from });
        }
        if (await getSetting(tx, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId)) {
          const maker = from === "planned" ? wo.submittedBy : wo.createdBy;
          ctx.assertSeparation(maker === ctx.userId, "You created this production order; another person who can approve must approve it.");
        }
        if (from === "draft") {
          await planLockedWorkOrder(tx, ctx, wo);
          wo = await lockWorkOrder(tx, ctx, workOrderId); // re-read the revisions frozen at planning
        }
        const released = await releaseLockedWorkOrder(tx, ctx, wo, opts.note);
        const existing = (await batchesOfWorkOrder(tx, wo.id)).filter((b) => b.status !== "rejected" || b.startedAt !== null);
        const made: { batchId: string; batchNumber: string }[] = [];
        for (let i = existing.length; i < wo.batchCount; i++) {
          made.push(await insertBatch(tx, ctx, wo.siteId, { formulaRevisionId: wo.formulaRevisionId!, plannedSizeG: new Decimal(wo.batchSizeBase), plannedStartOn: wo.plannedStart, workOrderId: wo.id }));
        }
        const shortages = shortageLines(released.shortages);
        await audit(tx, ctx, {
          action: "production.production_order.approved",
          entityType: "work_order",
          entityId: wo.id,
          entityNumber: wo.workOrderNumber,
          siteId: wo.siteId,
          reason: opts.note?.trim() || null,
          before: { status: from, simpleStatus: "draft" },
          after: { status: "released", simpleStatus: "approved", batches: made.map((b) => b.batchNumber), reservations: released.reservations.length, shortages },
        });
        return { workOrderNumber: wo.workOrderNumber, batches: made, reservations: released.reservations.length, shortages };
      });
      return result;
    });
  } catch (e) {
    if (e instanceof DomainError && e.code === "insufficient_stock" && Array.isArray(e.details?.shortages)) {
      const shortages = e.details.shortages as Shortage[];
      const lines = shortageLines(shortages);
      throw new DomainError("insufficient_stock", `Not enough materials to approve this order. ${lines.join(" ")} Nothing was changed. Receive or free up the missing stock, then press Approve again.`, { shortages, lines });
    }
    throw e;
  }
}

/** Plain words for a batch state on the production order screens (UX review §4 word list). */
export function batchStepWord(status: string, started: boolean): string {
  const words: Record<string, string> = {
    draft: "Waiting to start",
    planned: "Waiting to start",
    materials_staged: "Materials ready",
    in_process: "Being made",
    awaiting_qc: "Quality check",
    quarantined: "Quality check",
    released: "Passed · ready to sell",
    rework_approved: "Redo",
    closed: "Finished",
  };
  if (status === "rejected") return started ? "Failed the quality check" : "Not used";
  return words[status] ?? status.replace(/_/g, " ");
}

/**
 * The batch facts the status read model needs, for many work orders in three queries: batch state,
 * start, whether it was ever rejected, finished lot status, the frozen step list, the open and done
 * step records, and how many material lines have something taken (staged).
 */
export async function loadBatchFacts(workOrderIds: string[]): Promise<Map<string, BatchFact[]>> {
  const out = new Map<string, BatchFact[]>();
  if (workOrderIds.length === 0) return out;
  const rows = await db
    .select({
      id: batches.id,
      workOrderId: batches.workOrderId,
      batchNumber: batches.batchNumber,
      status: batches.status,
      startedAt: batches.startedAt,
      everRejected: sql<boolean>`exists (select 1 from batch_state_transitions t where t.batch_id = ${batches.id} and t.to_state = 'rejected')`,
      lotStatus: sql<string | null>`(select l.quality_status from inventory_lots l where l.id = ${batches.outputLotId})`,
      steps: sql<{ stepNo: number; name: string; stepKind: string }[] | null>`(select jsonb_agg(jsonb_build_object('stepNo', (s->>'stepNo')::int, 'name', s->>'name', 'stepKind', s->>'stepKind')) from jsonb_array_elements(${batches.formulaSnapshot}->'steps') s)`,
      materialsTaken: sql<number>`(select count(distinct st.batch_material_id)::int from batch_material_stagings st where st.batch_id = ${batches.id})`,
      materialsTotal: sql<number>`(select count(*)::int from batch_materials bm where bm.batch_id = ${batches.id})`,
    })
    .from(batches)
    .where(inArray(batches.workOrderId, workOrderIds))
    .orderBy(batches.createdAt);
  const working = rows.filter((r) => r.status === "in_process").map((r) => r.id);
  const recs = working.length
    ? await db
        .select({ batchId: processStepRecords.batchId, stepNo: processStepRecords.stepNo, name: processStepRecords.name, kind: processStepRecords.stepKind, status: processStepRecords.status, earliestCompletionAt: processStepRecords.earliestCompletionAt, conductedBy: processStepRecords.conductedBy })
        .from(processStepRecords)
        .where(inArray(processStepRecords.batchId, working))
    : [];
  for (const r of rows) {
    const list = out.get(r.workOrderId!) ?? [];
    list.push({
      id: r.id,
      batchNumber: r.batchNumber,
      status: r.status,
      startedAt: r.startedAt,
      everRejected: !!r.everRejected,
      lotStatus: r.lotStatus,
      plannedSteps: r.steps ?? [],
      stepRecords: recs.filter((x) => x.batchId === r.id),
      materialsTaken: Number(r.materialsTaken),
      materialsTotal: Number(r.materialsTotal),
    });
    out.set(r.workOrderId!, list);
  }
  return out;
}

/** Expected (or, once batches are finished, made) pieces of an order. */
function piecesOf(wo: { qtyPlannedBase: string; targetUnits: string | null; batchCount: number }, unitNetMassG: string, yieldPct: string | null, madeUnits: string | null, family: string) {
  const expected = wo.targetUnits ? new Decimal(wo.targetUnits) : unitsFrom(wo.qtyPlannedBase, yieldPct, unitNetMassG);
  const made = madeUnits && new Decimal(madeUnits).gt(0) ? new Decimal(madeUnits) : null;
  return {
    expectedUnits: expected.toString(),
    madeUnits: made?.toString() ?? null,
    /** "247 bars · 2 batches" (expected until something is made). */
    text: piecesText((made ?? expected).toFixed(0), family, wo.batchCount),
    word: made ? "made" : "expected",
  };
}

const allowedFor = (ctx: AuthContext, siteId: string) => ({ can: (p: string) => ctx.can(p as never) && ctx.canAt(p as never, siteId), userId: ctx.userId });

/** The production order screen: work order detail plus status v2, next action(s), progress, pieces, late flag, daily log and rejects. */
export async function getProductionOrder(ctx: AuthContext, workOrderId: string, now: Date = new Date()) {
  const d = await getWorkOrder(ctx, workOrderId); // checks production.work_order.view and site scope
  const wo = d.workOrder;
  const facts = (await loadBatchFacts([wo.id])).get(wo.id) ?? [];
  const view = productionOrderStatus(wo.status, facts, now);
  const status = view.status;
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId);
  const maker = wo.status === "planned" ? wo.submittedBy : wo.createdBy;
  const actions = productionOrderActions(view, { siteId: wo.siteId, cancelReason: wo.cancelReason }, allowedFor(ctx, wo.siteId), {
    can: ctx.can("production.work_order.approve") && ctx.canAt("production.work_order.approve", wo.siteId),
    sodConflict: sodOn && ctx.sodConflict(maker),
  });
  const canLog = ctx.can("production.daily_log.view");
  const logs = canLog ? await listDailyLogs(ctx, wo.id) : null;
  const summary = canLog ? await defectSummary(ctx, { workOrderId: wo.id }) : null;
  const live = d.batches.filter((b) => b.status !== "rejected" || b.startedAt !== null);
  const [made] = await db.select({ units: sql<string | null>`sum(${batches.actualUnits})::text` }).from(batches).where(eq(batches.workOrderId, wo.id));
  const yieldPct = d.formulaRevision?.theoreticalYieldPct ?? (await getEffectiveFormulaRevision(ctx, wo.productId, wo.plannedStart).catch(() => null))?.rev.theoreticalYieldPct ?? null;
  const today = manilaToday(now);
  return {
    detail: d,
    status,
    statusLabel: PRODUCTION_ORDER_LABEL[status],
    statusView: view,
    nextAction: actions.primary,
    batchActions: actions.perBatch,
    progress: {
      steps: progressSteps(status),
      batchesTotal: view.batchesTotal || wo.batchCount,
      batchesFinished: view.batchesDone,
    },
    pieces: piecesOf(wo, d.product.unitNetMassG, yieldPct, made?.units ?? null, d.product.family),
    neededBy: wo.neededBy,
    late: isLate(wo.neededBy, status, today),
    batches: live.map((b) => ({ ...b, word: batchStepWord(b.status, b.startedAt !== null) })),
    logs,
    summary,
    today,
    canAddLog: ctx.can("production.daily_log.create") && ctx.canAt("production.daily_log.create", wo.siteId) && ["released", "in_progress", "completed"].includes(wo.status),
    canCancel: d.actions.canCancel,
  };
}
export type ProductionOrderView = Awaited<ReturnType<typeof getProductionOrder>>;

/**
 * Production orders of the current site with their status v2, pieces and late flag, newest first.
 * `status`: a production order status, "open" (default: not Done, Failed or Cancelled) or "all".
 * The status is computed from the batches, so the SQL only pre-filters on the work order states
 * that can map to the asked status (production-order-status.ts).
 */
export async function listProductionOrders(ctx: AuthContext, f: { status?: string; q?: string } = {}, now: Date = new Date()) {
  ctx.require("production.work_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, ctx.currentSiteId)];
  const simple = f.status && (PRODUCTION_ORDER_STATUSES as readonly string[]).includes(f.status) ? (f.status as ProductionOrderStatus) : null;
  const all = f.status === "all";
  if (simple) conds.push(inArray(workOrders.status, workOrderStatusesFor(simple)));
  else if (!all) conds.push(inArray(workOrders.status, workOrderStatusesFor("open")));
  if (f.q?.trim()) conds.push(or(sql`${workOrders.workOrderNumber} ilike ${"%" + f.q.trim() + "%"}`, sql`${products.name} ilike ${"%" + f.q.trim() + "%"}`)!);
  const rows = await db
    .select({
      wo: workOrders,
      productName: products.name,
      productSku: products.skuCode,
      productFamily: products.family,
      unitNetMassG: products.unitNetMassG,
      lineCode: productionLines.code,
      salesOrderNumber: salesOrders.orderNumber,
      yieldPct: sql<string | null>`coalesce((select fr.theoretical_yield_pct from formula_revisions fr where fr.id = ${workOrders.formulaRevisionId}), (select fr.theoretical_yield_pct from formula_revisions fr where fr.formula_id = ${workOrders.formulaId} and fr.status = 'approved' order by fr.revision_no desc limit 1))::text`,
      madeUnits: sql<string | null>`(select sum(b.actual_units)::text from batches b where b.work_order_id = ${workOrders.id})`,
    })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, workOrders.salesOrderId))
    .where(and(...conds))
    .orderBy(desc(workOrders.plannedStart), desc(workOrders.createdAt))
    .limit(300);
  const facts = await loadBatchFacts(rows.map((r) => r.wo.id));
  const today = manilaToday(now);
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", ctx.currentSiteId);
  return rows
    .map((r) => {
      const view = productionOrderStatus(r.wo.status, facts.get(r.wo.id) ?? [], now);
      const pieces = piecesOf(r.wo, r.unitNetMassG, r.yieldPct, r.madeUnits, r.productFamily);
      const actions = productionOrderActions(view, { siteId: r.wo.siteId, cancelReason: r.wo.cancelReason }, allowedFor(ctx, r.wo.siteId), {
        can: ctx.can("production.work_order.approve") && ctx.canAt("production.work_order.approve", r.wo.siteId),
        sodConflict: sodOn && ctx.sodConflict(r.wo.status === "planned" ? r.wo.submittedBy : r.wo.createdBy), // the list links to the order page, which approves
      });
      return {
        id: r.wo.id,
        number: r.wo.workOrderNumber,
        productName: r.productName,
        productSku: r.productSku,
        lineCode: r.lineCode,
        quantityG: r.wo.qtyPlannedBase,
        batchCount: r.wo.batchCount,
        batchesClosed: view.batchesDone,
        piecesText: pieces.text,
        piecesWord: pieces.word,
        plannedStart: r.wo.plannedStart,
        plannedEnd: r.wo.plannedEnd,
        neededBy: r.wo.neededBy,
        late: isLate(r.wo.neededBy, view.status, today),
        salesOrderNumber: r.salesOrderNumber,
        workOrderStatus: r.wo.status,
        status: view.status,
        statusLabel: view.label,
        subtitle: view.subtitle,
        warn: view.warn,
        warning: view.warning,
        batchesNote: view.batchesNote,
        waiting: view.batches.some((b) => b.waitUntil !== null && b.batchStatus === "in_process" && b.id === view.leadBatchId),
        statusChangedAt: r.wo.statusChangedAt,
        nextAction: actions.primary.kind === "approve" ? ({ kind: "link", label: "Approve", href: `/production/orders/${r.wo.id}`, hint: actions.primary.hint } as NextAction) : actions.primary,
      };
    })
    .filter((r) => (simple ? r.status === simple : all ? true : (OPEN_STATUSES as readonly string[]).includes(r.status)));
}
export type ProductionOrderRow = Awaited<ReturnType<typeof listProductionOrders>>[number];

/**
 * The owner board (ADR-080 §1): five columns = the five statuses. In progress is split into
 * "Being made" and "Curing / resting"; Done shows the last 7 days and includes Failed orders.
 */
export async function listProductionOrderBoard(ctx: AuthContext, now: Date = new Date()) {
  const rows = await listProductionOrders(ctx, { status: "all" }, now);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const col = (k: ProductionOrderStatus) => rows.filter((r) => r.status === k);
  return [
    { key: "draft", label: "Draft", rows: col("draft") },
    { key: "approved", label: "Approved", rows: col("approved") },
    { key: "in_progress", label: "In progress", rows: col("in_progress"), groups: [{ label: "Being made", rows: col("in_progress").filter((r) => !r.waiting) }, { label: "Curing / resting", rows: col("in_progress").filter((r) => r.waiting) }] },
    { key: "quality_check", label: "Quality check", rows: col("quality_check") },
    { key: "done", label: "Done (last 7 days)", rows: rows.filter((r) => (r.status === "done" || r.status === "failed") && r.statusChangedAt >= since) },
  ];
}

export type MakeForLine = {
  salesOrderId: string;
  salesOrderNumber: string;
  salesOrderLineId: string;
  lineNo: number;
  productId: string;
  productName: string;
  productFamily: string;
  ordered: string;
  allocated: string;
  freeStock: string;
  alreadyInProduction: string;
  /** Pieces still missing: ordered − allocated − free usable stock − pieces already in open production orders for this customer order. */
  missing: string;
  /** Whole batches that cover the missing pieces (null without an approved formula). */
  batchCount: number | null;
  unitsPerBatch: string | null;
  neededBy: string | null;
};

/**
 * What is missing on the lines of a customer order, for "Make for this order" (ADR-080 V2-2).
 * Needs `production.work_order.create` and `sales.sales_order.view`; the order must be at a site of
 * the caller (not found otherwise). Read-only.
 */
export async function salesOrderShortfalls(ctx: AuthContext, salesOrderId: string): Promise<MakeForLine[]> {
  ctx.require("production.work_order.create");
  ctx.require("sales.sales_order.view");
  const [so] = UUID.test(salesOrderId) ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
  if (!so || !ctx.allowedSiteIds.includes(so.siteId)) throw new DomainError("not_found", "Customer order not found in your sites.");
  ctx.requireSite(so.siteId);
  if (!(MAKE_FOR_SALES_STATUSES as readonly string[]).includes(so.status)) return [];
  const today = manilaToday();
  const lines = await db
    .select({ line: salesOrderLines, product: products })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, so.id))
    .orderBy(salesOrderLines.lineNo);
  const out: MakeForLine[] = [];
  for (const { line, product } of lines) {
    const [a] = await db.execute<{ allocated: string; free: string; planned: string }>(sql`
      select
        (select coalesce(sum(a.qty_units), 0)::text from stock_allocations a where a.sales_order_line_id = ${line.id} and a.status <> 'released') as allocated,
        (select coalesce(sum(greatest(oh.q - coalesce(al.q, 0), 0)), 0)::text
           from (select l.id, sum(b.qty_base) as q from inventory_lots l join inventory_balances b on b.lot_id = l.id
                  where l.product_id = ${product.id} and l.site_id = ${so.siteId} and l.quality_status = 'released'
                    and (l.expires_on is null or l.expires_on >= ${today}::date) group by l.id) oh
           left join (select a.lot_id, sum(a.qty_units) as q from stock_allocations a
                        join sales_order_lines sol on sol.id = a.sales_order_line_id join sales_orders o on o.id = sol.sales_order_id
                       where a.status = 'open' and o.status in ('confirmed', 'allocated', 'picking', 'packed', 'partially_shipped') group by 1) al on al.lot_id = oh.id) as free,
        (select coalesce(sum(coalesce(w.target_units, floor(w.qty_planned_base * coalesce(fr.theoretical_yield_pct, 100) / 100 / ${product.unitNetMassG}::numeric))), 0)::text
           from work_orders w left join formula_revisions fr on fr.id = w.formula_revision_id
          where w.sales_order_id = ${so.id} and w.product_id = ${product.id} and w.status not in ('cancelled', 'closed')) as planned
    `);
    const ordered = new Decimal(line.qtyUnits);
    const missing = Decimal.max(ordered.minus(a.allocated).minus(a.free).minus(a.planned), 0);
    const eff = await getEffectiveFormulaRevision(ctx, product.id, today).catch(() => null);
    const per = eff ? unitsFrom(eff.rev.referenceBatchSizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG) : null;
    out.push({
      salesOrderId: so.id,
      salesOrderNumber: so.orderNumber,
      salesOrderLineId: line.id,
      lineNo: line.lineNo,
      productId: product.id,
      productName: product.name,
      productFamily: product.family,
      ordered: ordered.toString(),
      allocated: new Decimal(a.allocated).toString(),
      freeStock: new Decimal(a.free).toString(),
      alreadyInProduction: new Decimal(a.planned).toString(),
      missing: missing.toString(),
      batchCount: eff && missing.gt(0) ? batchesFor(missing, eff.rev.referenceBatchSizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG) : null,
      unitsPerBatch: per?.toString() ?? null,
      neededBy: so.requestedDeliveryOn ?? null,
    });
  }
  return out;
}

/** The prefill of "Make for this order" for one customer order line (product + missing pieces + needed by). */
export async function makeForSalesLine(ctx: AuthContext, salesOrderLineId: string): Promise<MakeForLine> {
  ctx.require("production.work_order.create");
  ctx.require("sales.sales_order.view");
  const [l] = UUID.test(salesOrderLineId) ? await db.select({ salesOrderId: salesOrderLines.salesOrderId }).from(salesOrderLines).where(eq(salesOrderLines.id, salesOrderLineId)).limit(1) : [];
  if (!l) throw new DomainError("not_found", "Customer order line not found in your sites.");
  const line = (await salesOrderShortfalls(ctx, l.salesOrderId)).find((x) => x.salesOrderLineId === salesOrderLineId);
  if (!line) throw new DomainError("state", "This customer order no longer needs products made.");
  return line;
}

/** Open production orders made for a customer order (sales order page: "Being made for this order"). */
export async function productionOrdersForSalesOrder(ctx: AuthContext, salesOrderId: string) {
  ctx.require("production.work_order.view");
  if (!UUID.test(salesOrderId)) return [];
  const rows = await db
    .select({ id: workOrders.id, number: workOrders.workOrderNumber, status: workOrders.status, siteId: workOrders.siteId, productName: products.name })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .where(and(eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.salesOrderId, salesOrderId), inArray(workOrders.siteId, ctx.allowedSiteIds), ne(workOrders.status, "cancelled")));
  const facts = await loadBatchFacts(rows.map((r) => r.id));
  return rows.map((r) => {
    const v = productionOrderStatus(r.status, facts.get(r.id) ?? []);
    return { id: r.id, number: r.number, productName: r.productName, status: v.status, statusLabel: v.label, subtitle: v.subtitle };
  });
}

export type { ProductionOrderStatusView, WorkOrderDetail };

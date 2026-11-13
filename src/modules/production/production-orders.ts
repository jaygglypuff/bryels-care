import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batches, customers, notifications, processStepRecords, productionLines, products, rolePermissions, salesOrderLines, salesOrders, userSiteAssignments, users, workOrders } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtMass, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { getEffectiveFormulaRevision, productReadiness } from "@/modules/masterdata";
import { notifyUsers, usersHoldingPermissionAt } from "@/modules/platform/notifications";
import { siteOrderCover, type SiteOrderCover } from "./order-cover";
import { canShipFrom, comingWords, type CanShipFrom } from "./order-cover-rule";
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
import { createWorkOrder, lockWorkOrder, planLockedWorkOrder, releaseLockedWorkOrder, remainingBatchSizesG } from "./work-orders";
import { batchPlanText, checkBatchSizes, gramsForPieces, proposeBatches } from "./batch-plan";
import { largestBatchFor } from "./batch-plan-facts";
import type { BatchPlanStored } from "@/db/schema";
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
  /**
   * ADR-104 §4, with "How many pieces?": split (default) = the proposed N batches; one = one batch of all the
   * pieces (only up to the largest batch); custom = `batchSizes` pieces per batch (each ≤ largest, sum = pieces).
   * Ignored when a batch size or count is typed under More details (the kg path).
   */
  batchMode?: "split" | "one" | "custom" | string | null;
  batchSizes?: (string | number)[] | null;
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
  // ADR-116 (owner bug report 2026-11-06): only a product whose recipe AND steps are approved and in use on the planned
  // start can be ordered; otherwise the same plain sentence the New order screen shows (who approves next).
  if (UUID.test(input.productId ?? "") && DATE.test(input.plannedStart ?? "")) {
    const ready = await productReadiness(ctx, input.productId, input.plannedStart);
    if (!ready.ready) throw new DomainError("validation", ready.sentence, { field: "productId", fieldErrors: { productId: ready.sentence }, rule: "V-REV", recipe: ready.recipe.kind, steps: ready.steps.kind });
  }
  let count: number | string = input.batchCount === null || input.batchCount === undefined || input.batchCount === "" ? 1 : input.batchCount;
  const typedCount = !(input.batchCount === null || input.batchCount === undefined || input.batchCount === "");
  const typedSize = !!input.batchSizeKg?.trim();
  let batchPlan: BatchPlanStored | null = null;
  if (units !== null && !typedCount) {
    const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    const eff = product && DATE.test(input.plannedStart) ? await getEffectiveFormulaRevision(ctx, product.id, input.plannedStart).catch(() => null) : null;
    const plan = product && eff && !typedSize ? await planBatches(ctx, product, eff.rev, input.plannedStart, Number(units), input.batchMode ?? null, input.batchSizes ?? null) : null;
    if (plan) {
      batchPlan = plan;
      count = plan.sizesG.length;
    } else if (product && eff) {
      const sizeG = input.batchSizeKg && /^\d{1,9}(\.\d{1,3})?$/.test(input.batchSizeKg) ? new Decimal(input.batchSizeKg).mul(1000) : new Decimal(eff.rev.referenceBatchSizeG);
      const n = batchesFor(units, sizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG);
      if (n === null) throw new DomainError("validation", "One batch makes less than one piece. Check the batch size.", { field: "batchSizeKg" });
      count = n;
    }
  }
  // ADR-104 §4: a batch size typed under More details may not be bigger than the mixer's recorded capacity.
  if (typedSize && /^\d{1,9}(\.\d{1,3})?$/.test(input.batchSizeKg!.trim()) && UUID.test(input.productId) && DATE.test(input.plannedStart)) {
    const largest = await largestBatchFor(db, ctx.organizationId, input.productId, ctx.currentSiteId, input.plannedStart);
    const sizeG = new Decimal(input.batchSizeKg!.trim()).mul(1000);
    if (largest.grams && sizeG.gt(largest.grams)) {
      const msg = `A batch of ${fmtMass(sizeG.toString())} is more than the largest batch (${fmtMass(largest.grams)}, ${largest.from}). Use a smaller batch size or more batches.`;
      throw new DomainError("validation", msg, { field: "batchSizeKg", fieldErrors: { batchSizeKg: msg }, rule: "A-FD-05" });
    }
  }
  return createWorkOrder(ctx, {
    productId: input.productId,
    batchSizeKg: batchPlan ? new Decimal(batchPlan.sizesG[0]).div(1000).toString() : input.batchSizeKg || null,
    batchCount: count as number,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd || input.plannedStart,
    neededBy,
    salesOrderId,
    targetUnits: units,
    productionLineId: input.productionLineId || null,
    notes: input.notes || null,
    idempotencyKey: input.idempotencyKey ?? null,
  }, { batchPlan });
}

const BATCH_MODES = ["split", "one", "custom"] as const;

/**
 * ADR-104 §4: the batch plan for "How many pieces?" (server side of the New order choice). Proposal from the
 * recipe's batch size and the largest batch (largestBatchFor; the recipe's batch size when no capacity is
 * known, A-FD-05); "one" is refused above the largest with the reason and the split offered; "custom" sizes
 * are checked (> 0, ≤ largest, sum). Batch grams = grams for the pieces (ADR-094 rounding). Null when the
 * product cannot be planned by pieces (no piece weight or expected %): the old whole-batch path applies.
 */
async function planBatches(
  ctx: AuthContext,
  product: typeof products.$inferSelect,
  rev: { referenceBatchSizeG: string; theoreticalYieldPct: string | null },
  plannedStart: string,
  pieces: number,
  modeIn: string | null,
  sizesIn: (string | number)[] | null,
): Promise<BatchPlanStored | null> {
  const mode = (modeIn?.trim() || "split") as (typeof BATCH_MODES)[number];
  if (!(BATCH_MODES as readonly string[]).includes(mode)) throw new DomainError("validation", "Choose how to make it: split into batches, one batch, or choose sizes.", { field: "batchMode", fieldErrors: { batchMode: "Choose one." } });
  const yieldPct = rev.theoreticalYieldPct ?? "100";
  const largest = await largestBatchFor(db, ctx.organizationId, product.id, ctx.currentSiteId, plannedStart);
  const word = pieceWordOf(product.family);
  const p = proposeBatches({ pieces, refBatchG: rev.referenceBatchSizeG, yieldPct, pieceG: product.unitNetMassG, largestG: largest.grams, largestFrom: largest.from, word });
  if (!p) return null;
  let sizes: number[];
  if (mode === "one") {
    if (!p.one.allowed) throw new DomainError("validation", p.one.reason!, { field: "batchMode", fieldErrors: { batchMode: p.one.reason! }, rule: "A-FD-05", split: p.split, maxPieces: p.maxPieces });
    sizes = [pieces];
  } else if (mode === "custom") {
    const c = checkBatchSizes(sizesIn ?? [], pieces, p.maxPieces, word);
    if (!c.ok) throw new DomainError("validation", c.message, { field: "batchSizes", fieldErrors: { batchSizes: c.message }, index: c.index, maxPieces: p.maxPieces });
    sizes = c.sizes;
  } else sizes = p.split.sizes;
  if (sizes.length > 200) throw new DomainError("validation", "At most 200 batches in one order.", { field: "quantityUnits" });
  return {
    mode,
    sizesG: sizes.map((n) => gramsForPieces(n, product.unitNetMassG, yieldPct).toString()),
    pieces: sizes.map(String),
    largestG: largest.grams ?? p.largestG,
    largestFrom: largest.from ?? "recipe",
  };
}

/** "bars" for soap, else "pieces" (as the New order screen). */
function pieceWordOf(family: string | null | undefined) {
  return (family ?? "").toLowerCase().includes("soap") ? "bars" : "pieces";
}

/** "2 batches of 1,000 bars" for a stored batch plan (order page and lists). */
export function batchPlanWords(plan: BatchPlanStored | null | undefined, family: string | null | undefined): string | null {
  if (!plan?.pieces?.length) return null;
  return batchPlanText(plan.pieces.map(Number), pieceWordOf(family));
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
          ctx.assertSeparationAt(maker === ctx.userId, "You created this production order; another person who can approve must approve it.", wo.siteId);
        }
        if (from === "draft") {
          await planLockedWorkOrder(tx, ctx, wo);
          wo = await lockWorkOrder(tx, ctx, workOrderId); // re-read the revisions frozen at planning
        }
        const released = await releaseLockedWorkOrder(tx, ctx, wo, opts.note);
        const existing = (await batchesOfWorkOrder(tx, wo.id)).filter((b) => b.status !== "rejected" || b.startedAt !== null);
        const made: { batchId: string; batchNumber: string }[] = [];
        // ADR-104 §4: each batch gets its planned size (the batch plan), so ingredient targets scale from it.
        const sizes = remainingBatchSizesG(wo, existing.map((b) => b.plannedSizeG));
        for (let i = existing.length; i < wo.batchCount; i++) {
          made.push(await insertBatch(tx, ctx, wo.siteId, { formulaRevisionId: wo.formulaRevisionId!, plannedSizeG: sizes[i - existing.length] ?? new Decimal(wo.batchSizeBase), plannedStartOn: wo.plannedStart, workOrderId: wo.id }));
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
        // C9(h) / ADR-109: the person the order is assigned to is told it can start ("Get the materials" on their Home).
        if (wo.assignedOperatorId && wo.assignedOperatorId !== ctx.userId) {
          await notifyUsers(tx, [wo.assignedOperatorId], {
            organizationId: ctx.organizationId,
            siteId: wo.siteId,
            kind: "handoff.production_order_approved",
            severity: "info",
            title: `Production order ${wo.workOrderNumber} approved: you can start`,
            body: `${ctx.displayName} approved it (${made.length + existing.length} ${made.length + existing.length === 1 ? "batch" : "batches"}). Get the materials first; it is on your Home.`,
            entityType: "work_order",
            entityId: wo.id,
            link: `/production/orders/${wo.id}`,
            dedupeKey: `handoff.production_order_approved:${wo.id}:${wo.assignedOperatorId}`,
          });
        }
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
export function piecesOf(wo: { qtyPlannedBase: string; targetUnits: string | null; batchCount: number }, unitNetMassG: string, yieldPct: string | null, madeUnits: string | null, family: string) {
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
  const actions = productionOrderActions(view, { siteId: wo.siteId, cancelReason: wo.cancelReason, workOrderId: wo.id }, allowedFor(ctx, wo.siteId), {
    can: ctx.can("production.work_order.approve") && ctx.canAt("production.work_order.approve", wo.siteId),
    sodConflict: sodOn && ctx.sodConflictAt(maker, wo.siteId),
  });
  const canLog = ctx.can("production.daily_log.view");
  const logs = canLog ? await listDailyLogs(ctx, wo.id) : null;
  const summary = canLog ? await defectSummary(ctx, { workOrderId: wo.id }) : null;
  const live = d.batches.filter((b) => b.status !== "rejected" || b.startedAt !== null);
  const [made] = await db.select({ units: sql<string | null>`sum(${batches.actualUnits})::text` }).from(batches).where(eq(batches.workOrderId, wo.id));
  const yieldPct = d.formulaRevision?.theoreticalYieldPct ?? (await getEffectiveFormulaRevision(ctx, wo.productId, wo.plannedStart).catch(() => null))?.rev.theoreticalYieldPct ?? null;
  const today = manilaToday(now);
  const [assignee] = wo.assignedOperatorId ? await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.id, wo.assignedOperatorId)).limit(1) : [];
  // UX review: an approved order without a batch says who plans it (the planner, else the supervisor, else who approved it).
  const noBatchPlanned = live.length === 0 && (status === "approved" || status === "in_progress");
  const planBy = noBatchPlanned ? (wo.assignedPlannerId ?? wo.assignedSupervisorId ?? wo.statusChangedBy) : null;
  const [planner] = planBy ? await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.id, planBy)).limit(1) : [];
  // ADR-116: a draft order is approved by fixing the recipe and steps in use on its start day; when one is not approved
  // (or not in use yet) the screen says so in the same plain sentence the approval would refuse with.
  const notReady = wo.status === "draft" ? (await productReadiness(ctx, wo.productId, wo.plannedStart)).sentence : null;
  return {
    /** Draft order whose product can't be made on its start day yet: why, and who approves next (ADR-116). */
    notReady,
    /** Approved, but no batch exists yet: nothing to do on the floor until someone plans one. */
    noBatchPlanned,
    /** Who to ask to plan the batch (name only, never an e-mail address); null when a batch exists. */
    planner: planner ?? null,
    /** The user can create the batch (old work order screen, production.batch.create at the site). */
    canPlanBatch: noBatchPlanned && ctx.can("production.batch.create") && ctx.canAt("production.batch.create", wo.siteId),
    /** A batch of the order has started: the daily log ("What happened today?") is useful only from then on. */
    anyBatchStarted: live.some((b) => b.startedAt !== null),
    detail: d,
    /** ADR-082: who makes this order; null = open for anyone at the site. */
    assignee: assignee ?? null,
    canAssign: ctx.can("production.work_order.edit") && ctx.canAt("production.work_order.edit", wo.siteId) && !ASSIGN_CLOSED.includes(wo.status),
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
export async function listProductionOrders(ctx: AuthContext, f: { status?: string; q?: string; mine?: boolean } = {}, now: Date = new Date()) {
  ctx.require("production.work_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, ctx.currentSiteId)];
  const simple = f.status && (PRODUCTION_ORDER_STATUSES as readonly string[]).includes(f.status) ? (f.status as ProductionOrderStatus) : null;
  const all = f.status === "all";
  if (simple) conds.push(inArray(workOrders.status, workOrderStatusesFor(simple)));
  else if (!all) conds.push(inArray(workOrders.status, workOrderStatusesFor("open")));
  if (f.q?.trim()) conds.push(or(sql`${workOrders.workOrderNumber} ilike ${"%" + f.q.trim() + "%"}`, sql`${products.name} ilike ${"%" + f.q.trim() + "%"}`)!);
  // ADR-082 "My work": my orders and the ones nobody took; never someone else's.
  if (f.mine) conds.push(or(eq(workOrders.assignedOperatorId, ctx.userId), isNull(workOrders.assignedOperatorId))!);
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
      assigneeName: users.displayName,
    })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, workOrders.salesOrderId))
    .leftJoin(users, eq(users.id, workOrders.assignedOperatorId))
    .where(and(...conds))
    .orderBy(...(f.mine ? [sql`(${workOrders.assignedOperatorId} = ${ctx.userId}) desc nulls last`] : []), desc(workOrders.plannedStart), desc(workOrders.createdAt))
    .limit(300);
  const facts = await loadBatchFacts(rows.map((r) => r.wo.id));
  const today = manilaToday(now);
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", ctx.currentSiteId);
  return rows
    .map((r) => {
      const view = productionOrderStatus(r.wo.status, facts.get(r.wo.id) ?? [], now);
      const pieces = piecesOf(r.wo, r.unitNetMassG, r.yieldPct, r.madeUnits, r.productFamily);
      const actions = productionOrderActions(view, { siteId: r.wo.siteId, cancelReason: r.wo.cancelReason, workOrderId: r.wo.id }, allowedFor(ctx, r.wo.siteId), {
        can: ctx.can("production.work_order.approve") && ctx.canAt("production.work_order.approve", r.wo.siteId),
        sodConflict: sodOn && ctx.sodConflictAt(r.wo.status === "planned" ? r.wo.submittedBy : r.wo.createdBy, r.wo.siteId), // the list links to the order page, which approves
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
        assigneeName: r.assigneeName,
        assignedToMe: r.wo.assignedOperatorId === ctx.userId,
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

// ---------------------------------------------------------------- assignment (ADR-082)

/** Work order states in which the person making it can no longer change. */
const ASSIGN_CLOSED: readonly string[] = ["closed", "cancelled"];
/** Who may be assigned: people who record production (the daily log) at the order's site. */
const ASSIGNEE_PERMISSION = "production.daily_log.create";

async function peopleWhoMakeAt(organizationId: string, siteId: string) {
  return db
    .selectDistinct({ id: users.id, name: users.displayName })
    .from(users)
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, ASSIGNEE_PERMISSION),
        activeAssignment(),
        or(eq(userSiteAssignments.siteId, siteId), eq(userSiteAssignments.isOrganizationWide, true)),
      ),
    )
    .orderBy(asc(users.displayName));
}

/** The people an order can be assigned to (the picker on the order page). */
export async function assigneeChoices(ctx: AuthContext, workOrderId: string) {
  ctx.require("production.work_order.view");
  const [wo] = UUID.test(workOrderId)
    ? await db.select({ siteId: workOrders.siteId }).from(workOrders).where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, ctx.organizationId))).limit(1)
    : [];
  if (!wo || !ctx.allowedSiteIds.includes(wo.siteId)) throw new DomainError("not_found", "Production order not found in your sites.");
  return peopleWhoMakeAt(ctx.organizationId, wo.siteId);
}

/**
 * Assigns a production order to the person who makes it, or back to "anyone" (`assigneeId: null`).
 * Planner or site manager (production.work_order.edit at the site); the assignee must record
 * production there. Audited; the new assignee gets an in-app notification with the order link.
 */
export async function assignProductionOrder(ctx: AuthContext, workOrderId: string, input: { assigneeId: string | null }) {
  ctx.require("production.work_order.edit");
  return db.transaction(async (tx) => {
    const wo = await lockWorkOrder(tx, ctx, workOrderId); // not_found outside the caller's sites
    if (!ctx.canAt("production.work_order.edit", wo.siteId)) throw new DomainError("forbidden", "You cannot assign production orders at this site.");
    if (ASSIGN_CLOSED.includes(wo.status)) throw new DomainError("state", `Production order ${wo.workOrderNumber} is ${wo.status}; it can no longer be assigned.`);
    const to = input.assigneeId?.trim() || null;
    if (to) {
      const ok = UUID.test(to) && (await peopleWhoMakeAt(ctx.organizationId, wo.siteId)).some((p) => p.id === to);
      if (!ok) throw new DomainError("validation", "Choose someone who makes production at this site.", { field: "assigneeId", fieldErrors: { assigneeId: "Not a production person at this site." } });
    }
    if (to === wo.assignedOperatorId) return { changed: false };
    await tx.update(workOrders).set({ assignedOperatorId: to, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
    await audit(tx, ctx, {
      action: "production.production_order.assigned",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.workOrderNumber,
      siteId: wo.siteId,
      before: { assigneeId: wo.assignedOperatorId },
      after: { assigneeId: to },
    });
    if (to && to !== ctx.userId)
      await notifyUsers(tx, [to], {
        organizationId: ctx.organizationId,
        siteId: wo.siteId,
        kind: "production.order.assigned",
        severity: "info",
        title: `${wo.workOrderNumber} is yours to make`,
        body: `${ctx.displayName} assigned production order ${wo.workOrderNumber} to you. It is at the top of My work.`,
        entityType: "work_order",
        entityId: wo.id,
        link: `/production/orders/${wo.id}`,
      });
    return { changed: true };
  });
}

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
  /** Free stock counted for this line (the set-aside rule, after earlier orders took theirs). */
  freeStock: string;
  /** Pieces coming for this line: waiting for QA, being made, or in a production order made for it (the order-cover rule). */
  alreadyInProduction: string;
  /** "coming: 94 waiting for QA" (empty when nothing is coming). */
  comingText: string;
  /** Pieces still missing: ordered − allocated − free stock − stock coming for it (order-cover-rule.ts). */
  missing: string;
  /** Whole batches that cover the missing pieces (null without an approved formula). */
  batchCount: number | null;
  unitsPerBatch: string | null;
  neededBy: string | null;
  /** ADR-131 (C-office bug B11): the planner was already asked to make this shortage (the message exists). */
  asked?: boolean;
  /** When the planner was asked (the message time), for "Asked the planner on …". */
  askedAt?: Date | null;
};

/**
 * What is missing on the lines of a customer order, for "Make for this order" (ADR-080 V2-2, ADR-110 C4).
 * Read-only, so `sales.sales_order.view` is enough: sales sees the shortage card and asks the planner; only
 * `production.work_order.create` makes the production order (makeForSalesLine / createProductionOrder). The
 * order must be at a site of the caller (not found otherwise). Free stock follows the set-aside rule (C2); stock
 * coming (batches waiting for QA, approved production orders) follows the one order-cover rule (order-cover-rule.ts),
 * the same as "How work flows" and the planner's Home.
 */
export async function salesOrderShortfalls(ctx: AuthContext, salesOrderId: string): Promise<MakeForLine[]> {
  ctx.require("sales.sales_order.view");
  const [so] = UUID.test(salesOrderId) ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
  if (!so || !ctx.allowedSiteIds.includes(so.siteId)) throw new DomainError("not_found", "Customer order not found in your sites.");
  ctx.requireSite(so.siteId);
  if (!(MAKE_FOR_SALES_STATUSES as readonly string[]).includes(so.status)) return [];
  const lines = await shortfallsFrom(ctx, await siteOrderCover(db, ctx.organizationId, so.siteId), [so.id]);
  // ADR-131 (bug B11): once asked, the order says so instead of offering the button again.
  for (const l of lines) {
    if (new Decimal(l.missing).lte(0)) continue;
    const [n] = await db.select({ at: notifications.createdAt }).from(notifications).where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.dedupeKey, askToMakeKey(l.salesOrderLineId, l.missing)))).orderBy(desc(notifications.createdAt)).limit(1);
    l.asked = !!n;
    l.askedAt = n?.at ?? null;
  }
  return lines;
}

/** MakeForLine rows of the given orders out of one site cover (one read for the planner's Home list). */
async function shortfallsFrom(ctx: AuthContext, cover: SiteOrderCover, orderIds: string[]): Promise<MakeForLine[]> {
  const today = manilaToday();
  const wanted = orderIds.map((id) => cover.orders.find((o) => o.orderId === id)).filter((o): o is SiteOrderCover["orders"][number] => !!o);
  const productIds = [...new Set(wanted.flatMap((o) => o.lines.map((l) => l.productId)))];
  const prods = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const effs = new Map<string, Awaited<ReturnType<typeof getEffectiveFormulaRevision>> | null>();
  const out: MakeForLine[] = [];
  for (const o of wanted) {
    for (const l of [...o.lines].sort((a, b) => a.lineNo - b.lineNo)) {
      const product = prods.find((p) => p.id === l.productId)!;
      if (!effs.has(product.id)) effs.set(product.id, await getEffectiveFormulaRevision(ctx, product.id, today).catch(() => null));
      const eff = effs.get(product.id) ?? null;
      const per = eff ? unitsFrom(eff.rev.referenceBatchSizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG) : null;
      out.push({
        salesOrderId: o.orderId,
        salesOrderNumber: o.orderNumber,
        salesOrderLineId: l.lineId,
        lineNo: l.lineNo,
        productId: product.id,
        productName: product.name,
        productFamily: product.family,
        ordered: new Decimal(l.ordered).toString(),
        allocated: new Decimal(l.allocated).toString(),
        freeStock: l.fromFree.toString(),
        alreadyInProduction: l.comingTotal.toString(),
        comingText: comingWords(l.coming),
        missing: l.missing.toString(),
        batchCount: eff && l.missing.gt(0) ? batchesFor(l.missing, eff.rev.referenceBatchSizeG, eff.rev.theoreticalYieldPct, product.unitNetMassG) : null,
        unitsPerBatch: per?.toString() ?? null,
        neededBy: o.requestedDeliveryOn ?? null,
      });
    }
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

/** Dedupe key of "Ask the planner to make …" per customer order line and missing quantity (one message per shortage). */
export const askToMakeKey = (salesOrderLineId: string, missing: string) => `make-for:${salesOrderLineId}:${missing}`;

/**
 * ADR-110 C4 "Ask the planner to make 378": sales (sales.sales_order.create at the order's site) tells the people
 * who create production orders at that site (production.work_order.create) that a customer order line is short.
 * One in-app message per planner and shortage (dedupe), linking to the pre-filled new production order; audited.
 * Asking never creates a production order. Refused when nothing is missing.
 */
export async function askPlannerToMake(ctx: AuthContext, salesOrderLineId: string) {
  ctx.require("sales.sales_order.view");
  ctx.require("sales.sales_order.create");
  const [l] = UUID.test(salesOrderLineId)
    ? await db.select({ salesOrderId: salesOrderLines.salesOrderId, siteId: salesOrders.siteId }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId)).where(and(eq(salesOrderLines.id, salesOrderLineId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1)
    : [];
  if (!l || !ctx.allowedSiteIds.includes(l.siteId)) throw new DomainError("not_found", "Customer order line not found in your sites.");
  ctx.requireAt("sales.sales_order.create", l.siteId);
  const line = (await salesOrderShortfalls(ctx, l.salesOrderId)).find((x) => x.salesOrderLineId === salesOrderLineId);
  if (!line || new Decimal(line.missing).lte(0)) throw new DomainError("state", "Nothing is missing on this line any more: stock or a production order covers it.");
  const [so] = await db.select({ customerName: customers.name }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(eq(salesOrders.id, l.salesOrderId)).limit(1);
  const pcs = fmtQty(line.missing, "pcs", 0);
  return db.transaction(async (tx) => {
    const planners = (await usersHoldingPermissionAt(tx, ctx.organizationId, "production.work_order.create", l.siteId)).filter((u) => u !== ctx.userId);
    const told = await notifyUsers(tx, planners, {
      organizationId: ctx.organizationId,
      siteId: l.siteId,
      kind: "production.make_for_order.asked",
      severity: "warning",
      title: `Customer order short: make ${pcs} ${line.productName}`,
      body: `${ctx.displayName} asks: ${line.salesOrderNumber} (${so?.customerName ?? "customer"}) needs ${pcs} more ${line.productName}${line.neededBy ? ` by ${line.neededBy}` : ""}. Make a production order for it.`,
      entityType: "sales_order",
      entityId: l.salesOrderId,
      link: `/production/orders/new?salesOrderLine=${salesOrderLineId}`,
      dedupeKey: askToMakeKey(salesOrderLineId, line.missing),
    });
    await audit(tx, ctx, {
      action: "sales.sales_order.make_requested",
      entityType: "sales_order",
      entityId: l.salesOrderId,
      entityNumber: line.salesOrderNumber,
      siteId: l.siteId,
      after: { lineNo: line.lineNo, product: line.productName, missing: line.missing, told: told.length },
    });
    return { told: told.length, alreadyAsked: planners.length > 0 && told.length === 0, planners: planners.length, missing: line.missing, productName: line.productName, salesOrderNumber: line.salesOrderNumber };
  });
}

export type ShortCustomerLine = MakeForLine & { customerName: string; asked: boolean };

/**
 * ADR-110 C4 planner Home "Customer orders short": open customer orders at the current site whose lines still miss
 * pieces after free stock, set-asides and open production orders for them (same numbers as the order's shortage
 * card). Needs `production.work_order.create`. At most `limit` lines, the earliest needed-by first.
 */
export async function customerOrdersShort(ctx: AuthContext, opts: { limit?: number } = {}): Promise<ShortCustomerLine[]> {
  ctx.require("production.work_order.create");
  ctx.requireSite(ctx.currentSiteId);
  if (!ctx.can("sales.sales_order.view")) return [];
  const limit = opts.limit ?? 5;
  // The one order-cover rule (same as "How work flows"): stock waiting for QA or being made is not "short".
  const cover = await siteOrderCover(db, ctx.organizationId, ctx.currentSiteId);
  const short = cover.orders.filter((o) => (o.status === "confirmed" || o.status === "partially_shipped") && o.lines.some((l) => l.missing.gt(0)));
  const out: ShortCustomerLine[] = [];
  for (const line of await shortfallsFrom(ctx, cover, short.map((o) => o.orderId))) {
    if (new Decimal(line.missing).lte(0)) continue;
    const [n] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.dedupeKey, askToMakeKey(line.salesOrderLineId, line.missing)))).limit(1);
    out.push({ ...line, customerName: short.find((o) => o.orderId === line.salesOrderId)!.customerName, asked: !!n });
    if (out.length >= limit) break;
  }
  return out;
}

/** Open production orders made for a customer order (sales order page: "Being made for this order"). */
export async function productionOrdersForSalesOrder(ctx: AuthContext, salesOrderId: string) {
  ctx.require("production.work_order.view");
  if (!UUID.test(salesOrderId)) return [];
  const rows = await db
    .select({ id: workOrders.id, number: workOrders.workOrderNumber, status: workOrders.status, siteId: workOrders.siteId, productName: products.name, pieces: workOrders.targetUnits, plannedEnd: workOrders.plannedEnd, who: users.displayName })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(users, eq(users.id, workOrders.assignedOperatorId))
    .where(and(eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.salesOrderId, salesOrderId), inArray(workOrders.siteId, ctx.allowedSiteIds), ne(workOrders.status, "cancelled")));
  const facts = await loadBatchFacts(rows.map((r) => r.id));
  const today = manilaToday();
  const qaDays = rows.length ? Number(await getSetting(db, ctx.organizationId, "sales.can_ship.qa_days", rows[0].siteId)) : 0;
  return rows.map((r) => {
    const v = productionOrderStatus(r.status, facts.get(r.id) ?? []);
    // ADR-131 (B-owner problem 2) "Where is it now": the step and who makes it, and when it should be ready.
    const from = r.plannedEnd > today ? r.plannedEnd : today;
    const readyOn = v.status === "done" || v.status === "failed" ? null : new Date(Date.parse(`${from}T00:00:00Z`) + qaDays * 86_400_000).toISOString().slice(0, 10);
    return { id: r.id, number: r.number, productName: r.productName, status: v.status, statusLabel: v.label, subtitle: v.subtitle, stepNote: v.stepNote, who: r.who ?? null, pieces: r.pieces === null ? null : new Decimal(r.pieces).toString(), readyOn };
  });
}

export type EarlierOrder = { orderId: string; orderNumber: string; customerName: string; requestedDeliveryOn: string | null; productIds: string[] };

/**
 * ADR-131 (owner decision 2026-11-08: stock goes first to the order with the earliest delivery date): the open orders at
 * the same site that are due earlier than this one and still need some of the same products (not all set aside). The
 * set-aside button warns with them ("Order X (due earlier) also needs this"); setting aside is not refused — taking
 * stock another order needs is an explicit choice. Read only; `sales.sales_order.view` at the order's site.
 */
export async function earlierOrdersNeedingSameStock(ctx: AuthContext, salesOrderId: string): Promise<EarlierOrder[]> {
  ctx.require("sales.sales_order.view");
  const [so] = UUID.test(salesOrderId) ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
  if (!so || !ctx.allowedSiteIds.includes(so.siteId)) throw new DomainError("not_found", "Customer order not found in your sites.");
  const cover = await siteOrderCover(db, ctx.organizationId, so.siteId);
  const me = cover.orders.find((o) => o.orderId === so.id);
  if (!me) return [];
  const mine = new Set(me.lines.filter((l) => l.need.gt(0)).map((l) => l.productId));
  const due = me.requestedDeliveryOn;
  return cover.orders
    .filter((o) => o.orderId !== so.id && o.requestedDeliveryOn && (!due || o.requestedDeliveryOn < due) && ["confirmed", "pending_approval", "submitted", "allocated", "partially_shipped"].includes(o.status))
    .map((o) => ({ orderId: o.orderId, orderNumber: o.orderNumber, customerName: o.customerName, requestedDeliveryOn: o.requestedDeliveryOn, productIds: [...new Set(o.lines.filter((l) => l.need.gt(0) && mine.has(l.productId)).map((l) => l.productId))] }))
    .filter((o) => o.productIds.length > 0)
    .slice(0, 3);
}

/**
 * ADR-131 (C-office problem 3): "Can ship from" on a customer order, from the one order-cover rule (earliest delivery
 * first): today when everything is set aside or on the shelf; else the latest ready day of the batches and production
 * orders it waits for (planned finish or today, plus the QA days in Settings); null when something still needs making.
 * Read only; `sales.sales_order.view` at the order's site.
 */
export async function orderCanShipFrom(ctx: AuthContext, salesOrderId: string): Promise<CanShipFrom & { asked: boolean }> {
  ctx.require("sales.sales_order.view");
  const [so] = UUID.test(salesOrderId) ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, ctx.organizationId))).limit(1) : [];
  if (!so || !ctx.allowedSiteIds.includes(so.siteId)) throw new DomainError("not_found", "Customer order not found in your sites.");
  const today = manilaToday();
  if (!(MAKE_FOR_SALES_STATUSES as readonly string[]).includes(so.status)) return { date: null, why: "not_known", asked: false };
  const cover = await siteOrderCover(db, ctx.organizationId, so.siteId);
  const o = cover.orders.find((x) => x.orderId === so.id);
  if (!o) return { date: today, why: "all_set_aside", asked: false };
  const r = canShipFrom(o.lines, today);
  let asked = false;
  if (r.why === "not_known") {
    for (const l of o.lines.filter((x) => x.missing.gt(0))) {
      const [n] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.dedupeKey, askToMakeKey(l.lineId, l.missing.toString())))).limit(1);
      if (n) asked = true;
    }
  }
  return { ...r, asked };
}

export type { ProductionOrderStatusView, WorkOrderDetail };

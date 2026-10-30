import "server-only";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batches, productionLines, products, workOrders } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtMass, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { insertBatch } from "./batches";
import { listDailyLogs, defectSummary } from "./daily-log";
import { PRODUCTION_ORDER_LABEL, PRODUCTION_ORDER_STEPS, productionOrderStatus, workOrderStatusesFor, type ProductionOrderStatus } from "./production-order-status";
import { idempotent, manilaToday } from "./shared";
import { createWorkOrder, lockWorkOrder, planLockedWorkOrder, releaseLockedWorkOrder } from "./work-orders";
import { getWorkOrder, type WorkOrderDetail } from "./work-orders-queries";
import { batchesOfWorkOrder, type Shortage } from "./work-orders-reserve";

/**
 * Production orders (ADR-074): ONE record the owner follows from ordering to done, built on the
 * existing work order and batch services. A production order IS a work order; its simple status is
 * derived (production-order-status.ts). "Plan" and "Release" collapse into one Approve command that
 * plans, reserves materials and creates the batches in one transaction.
 */

export type ProductionOrderInput = {
  productId: string;
  /** Batch size in kg; empty = the formula's reference size. */
  batchSizeKg?: string | null;
  /** Default 1 (owner decision: one order, one batch unless "More details" says otherwise). */
  batchCount?: number | string | null;
  plannedStart: string;
  /** Default = plannedStart. */
  plannedEnd?: string | null;
  productionLineId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

/** Creates a production order (a draft work order) with the simple defaults of the production order screen. */
export async function createProductionOrder(ctx: AuthContext, input: ProductionOrderInput) {
  ctx.require("production.work_order.create");
  const count = input.batchCount === null || input.batchCount === undefined || input.batchCount === "" ? 1 : input.batchCount;
  return createWorkOrder(ctx, {
    productId: input.productId,
    batchSizeKg: input.batchSizeKg || null,
    batchCount: count as number,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd || input.plannedStart,
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
          const simple = productionOrderStatus(from, false);
          throw new DomainError("state", `Production order ${wo.workOrderNumber} is ${PRODUCTION_ORDER_LABEL[simple].toLowerCase()}; only a draft can be approved.`, { machine: "work_order", from });
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

/** Plain words for a batch state on the production order screens. */
export function batchStepWord(status: string, started: boolean): string {
  const words: Record<string, string> = {
    draft: "Waiting to start",
    planned: "Waiting to start",
    materials_staged: "Materials ready",
    in_process: "Being made",
    awaiting_qc: "Waiting for quality check",
    quarantined: "Waiting for quality check",
    released: "Passed quality check",
    rework_approved: "Being reworked",
    closed: "Finished",
  };
  if (status === "rejected") return started ? "Failed quality check" : "Not used";
  return words[status] ?? status.replace(/_/g, " ");
}

export type NextAction =
  | { kind: "approve"; label: "Approve"; hint: string }
  | { kind: "link"; label: "Start" | "Finish"; href: string; hint: string }
  | { kind: "wait"; title: string; hint: string; who: { permission: string; siteId: string } | null }
  | { kind: "none"; hint: string };

/**
 * The ONE next action of a production order. Start and Finish open the screen where that work is
 * recorded (the batch engine is unchanged); they never fake a state change.
 */
export function nextProductionAction(ctx: AuthContext, d: WorkOrderDetail, status: ProductionOrderStatus, sodOn: boolean): NextAction {
  const wo = d.workOrder;
  if (status === "cancelled") return { kind: "none", hint: `Cancelled: ${wo.cancelReason ?? "no reason recorded"}.` };
  if (status === "done") return { kind: "none", hint: "This order is done." };
  if (status === "draft") {
    if (!ctx.can("production.work_order.approve")) return { kind: "wait", title: "Waiting for approval", hint: "A manager approves the order. Approving sets the materials aside and creates the batch.", who: { permission: "production.work_order.approve", siteId: wo.siteId } };
    const maker = wo.status === "planned" ? wo.submittedBy : wo.createdBy;
    if (sodOn && ctx.sodConflict(maker)) return { kind: "wait", title: "Another person approves", hint: "You created this order, so another person who can approve must approve it.", who: { permission: "production.work_order.approve", siteId: wo.siteId } };
    return { kind: "approve", label: "Approve", hint: "Approving sets the materials aside and creates the batch." };
  }
  const live = d.batches.filter((b) => b.status !== "rejected" || b.startedAt !== null);
  const next = live.find((b) => b.status !== "closed" && b.status !== "rejected");
  if (!next) return { kind: "none", hint: "All batches are finished. The order closes when every batch record is closed." };
  if (next.status === "planned") return { kind: "link", label: "Start", href: `/production/staging/${next.id}`, hint: `Batch ${next.batchNumber}: bring the materials to the line (scan each lot).` };
  if (next.status === "materials_staged") return { kind: "link", label: "Start", href: `/production/${next.id}`, hint: `Batch ${next.batchNumber}: do the line check, then start making it.` };
  if (next.status === "in_process" || next.status === "rework_approved") return { kind: "link", label: "Finish", href: `/production/${next.id}`, hint: `Batch ${next.batchNumber}: record the remaining steps and the output, then send it for the quality check.` };
  if (next.status === "released") return { kind: "link", label: "Finish", href: `/production/${next.id}/closure`, hint: `Batch ${next.batchNumber} passed the quality check: close its record to finish.` };
  return { kind: "wait", title: "Waiting for the quality check", hint: `Batch ${next.batchNumber} is with quality control.`, who: { permission: "quality.disposition.approve", siteId: wo.siteId } };
}

/** The production order screen: work order detail plus simple status, next action, progress, daily log and defects. */
export async function getProductionOrder(ctx: AuthContext, workOrderId: string) {
  const d = await getWorkOrder(ctx, workOrderId); // checks production.work_order.view and site scope
  const wo = d.workOrder;
  const anyStarted = d.batches.some((b) => b.startedAt !== null);
  const status = productionOrderStatus(wo.status, anyStarted);
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId);
  const canLog = ctx.can("production.daily_log.view");
  const logs = canLog ? await listDailyLogs(ctx, wo.id) : null;
  const summary = canLog ? await defectSummary(ctx, { workOrderId: wo.id }) : null;
  const live = d.batches.filter((b) => b.status !== "rejected" || b.startedAt !== null);
  const stepIndex = status === "cancelled" ? -1 : PRODUCTION_ORDER_STEPS.indexOf(status);
  return {
    detail: d,
    status,
    statusLabel: PRODUCTION_ORDER_LABEL[status],
    nextAction: nextProductionAction(ctx, d, status, sodOn),
    progress: {
      steps: PRODUCTION_ORDER_STEPS.map((s, i) => ({ key: s, label: PRODUCTION_ORDER_LABEL[s], state: i < stepIndex || status === "done" ? "done" : i === stepIndex ? "current" : "todo" })),
      batchesTotal: wo.batchCount,
      batchesFinished: live.filter((b) => b.status === "closed").length,
    },
    batches: live.map((b) => ({ ...b, word: batchStepWord(b.status, b.startedAt !== null) })),
    logs,
    summary,
    today: manilaToday(),
    canAddLog: ctx.can("production.daily_log.create") && ctx.canAt("production.daily_log.create", wo.siteId) && ["released", "in_progress", "completed"].includes(wo.status),
    canCancel: d.actions.canCancel,
  };
}
export type ProductionOrderView = Awaited<ReturnType<typeof getProductionOrder>>;

/** Production orders of the current site with their simple status, newest first. */
export async function listProductionOrders(ctx: AuthContext, f: { status?: string; q?: string } = {}) {
  ctx.require("production.work_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, ctx.currentSiteId)];
  const simple = f.status && (PRODUCTION_ORDER_LABEL as Record<string, string>)[f.status] ? (f.status as ProductionOrderStatus) : null;
  if (simple) conds.push(inArray(workOrders.status, workOrderStatusesFor(simple)));
  else if (f.status !== "all") conds.push(inArray(workOrders.status, ["draft", "planned", "released", "in_progress"]));
  if (f.q?.trim()) conds.push(or(sql`${workOrders.workOrderNumber} ilike ${"%" + f.q.trim() + "%"}`, sql`${products.name} ilike ${"%" + f.q.trim() + "%"}`)!);
  const rows = await db
    .select({
      wo: workOrders,
      productName: products.name,
      productSku: products.skuCode,
      lineCode: productionLines.code,
      batchesStarted: sql<number>`(select count(*)::int from ${batches} where ${batches.workOrderId} = ${workOrders.id} and ${batches.startedAt} is not null)`,
      batchesClosed: sql<number>`(select count(*)::int from ${batches} where ${batches.workOrderId} = ${workOrders.id} and ${batches.status} = 'closed')`,
    })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
    .where(and(...conds))
    .orderBy(desc(workOrders.plannedStart), desc(workOrders.createdAt))
    .limit(300);
  return rows
    .map((r) => {
      const st = productionOrderStatus(r.wo.status, r.batchesStarted > 0);
      return {
        id: r.wo.id,
        number: r.wo.workOrderNumber,
        productName: r.productName,
        productSku: r.productSku,
        lineCode: r.lineCode,
        quantityG: r.wo.qtyPlannedBase,
        batchCount: r.wo.batchCount,
        batchesClosed: r.batchesClosed,
        plannedStart: r.wo.plannedStart,
        plannedEnd: r.wo.plannedEnd,
        workOrderStatus: r.wo.status,
        status: st,
        statusLabel: PRODUCTION_ORDER_LABEL[st],
      };
    })
    .filter((r) => !simple || r.status === simple);
}
export type ProductionOrderRow = Awaited<ReturnType<typeof listProductionOrders>>[number];

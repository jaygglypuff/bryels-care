import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import {
  formulaRevisions,
  formulas,
  inventoryBalances,
  inventoryLots,
  locations,
  productMinStock,
  productionPlanLines,
  productionPlans,
  products,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  stockReservations,
  users,
  workOrders,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { getEffectiveFormulaRevision } from "@/modules/masterdata";
import { OPEN_ALLOCATION_ORDER_STATUSES } from "@/modules/inventory";
import { addDays, idempotent, manilaToday } from "./shared";
import { insertWorkOrder } from "./work-orders";
import { stagingKinds, workOrderCandidates, workOrderRequirements } from "./work-orders-reserve";

/**
 * Demand-to-production planning (E-5-07, US-5-15, FR-production-13, docs/process-maps.md W05-01).
 *
 * A plan freezes, per SKU, the demand the planner saw: open confirmed sales orders (ordered −
 * allocated), the minimum stock (product_min_stock), released finished goods available
 * (on hand − reserved − allocated, released and in date) and units already coming from open work
 * orders. Net = demand + min stock − available − open work orders. Material availability for each
 * line is recomputed live (cumulative in target-date order, FEFO-eligible free stock). Forecasts
 * join once FR-analytics-08 is scheduled. Converting a line creates a draft work order linked by
 * production_plan_line_id; its release reserves by FEFO (US-3-05). Nothing is created automatically.
 */

/** Production plan state machine (docs/data-model.md §3.5: draft → approved → closed; draft → closed). */
export const PLAN_TRANSITIONS: Record<string, readonly string[]> = { draft: ["approved", "closed"], approved: ["closed"], closed: [] };
const planMachine = {
  assert(from: string, to: string, label: string) {
    if (!(PLAN_TRANSITIONS[from] ?? []).includes(to)) throw new DomainError("state", `${label} is ${from}; it cannot become ${to}.`, { machine: "production_plan", from, to });
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const OPEN_WO = ["draft", "planned", "released", "in_progress"];

/** Expected finished units of a work order: target units, else bulk × theoretical yield ÷ unit mass. */
function expectedUnits(qtyPlannedBase: string, yieldPct: string | null, unitNetMassG: string, targetUnits: string | null) {
  if (targetUnits) return new Decimal(targetUnits);
  const y = new Decimal(yieldPct ?? 100);
  return new Decimal(qtyPlannedBase).mul(y).div(100).div(unitNetMassG).floor();
}

type DemandRow = {
  productId: string;
  soDemand: Decimal;
  salesOrderIds: Set<string>;
  salesOrderLineIds: string[];
  firstDate: string | null;
  minStock: Decimal | null;
  onHand: Decimal;
  available: Decimal;
  openWo: Decimal;
};

/** Demand snapshot per SKU at a site for a period (pure read). */
export async function demandSnapshot(q: DbOrTx, ctx: AuthContext, siteId: string, periodEnd: string) {
  const today = manilaToday();
  const rows = new Map<string, DemandRow>();
  const row = (productId: string) => {
    let r = rows.get(productId);
    if (!r) rows.set(productId, (r = { productId, soDemand: new Decimal(0), salesOrderIds: new Set(), salesOrderLineIds: [], firstDate: null, minStock: null, onHand: new Decimal(0), available: new Decimal(0), openWo: new Decimal(0) }));
    return r;
  };
  // 1. Open confirmed (or partially shipped) orders due by the period end (ordered − allocated − shipped).
  const so = await q
    .select({
      lineId: salesOrderLines.id,
      orderId: salesOrders.id,
      productId: salesOrderLines.productId,
      qty: salesOrderLines.qtyUnits,
      due: salesOrders.requestedDeliveryOn,
      // Open and fulfilled (shipped) allocations cover the line; released ones (W3E) do not.
      allocated: sql<string>`coalesce((select sum(${stockAllocations.qtyUnits}) from ${stockAllocations} where ${stockAllocations.salesOrderLineId} = ${salesOrderLines.id} and ${stockAllocations.status} <> 'released'), 0)::text`,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), eq(salesOrders.siteId, siteId), inArray(salesOrders.status, ["confirmed", "partially_shipped"]), sql`(${salesOrders.requestedDeliveryOn} is null or ${salesOrders.requestedDeliveryOn} <= ${periodEnd})`));
  for (const l of so) {
    const open = Decimal.max(new Decimal(l.qty).minus(l.allocated), 0);
    if (open.lte(0)) continue;
    const r = row(l.productId);
    r.soDemand = r.soDemand.plus(open);
    r.salesOrderIds.add(l.orderId);
    r.salesOrderLineIds.push(l.lineId);
    if (l.due && (!r.firstDate || l.due < r.firstDate)) r.firstDate = l.due;
  }
  // 2. Minimum stock.
  for (const m of await q.select().from(productMinStock).where(and(eq(productMinStock.organizationId, ctx.organizationId), eq(productMinStock.siteId, siteId)))) {
    if (new Decimal(m.minStockUnits).gt(0)) row(m.productId).minStock = new Decimal(m.minStockUnits);
  }
  if (!rows.size) return [];
  const ids = [...rows.keys()];
  // 3. Finished goods on hand and available (released, in date, storage; minus reservations and open allocations).
  const stock = await q
    .select({
      productId: inventoryLots.productId,
      onHand: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text`,
      usable: sql<string>`coalesce(sum(case when ${inventoryLots.qualityStatus} = 'released' and (${inventoryLots.expiresOn} is null or ${inventoryLots.expiresOn} >= ${today}) and ${locations.kind} = 'storage' then ${inventoryBalances.qtyBase} else 0 end), 0)::text`,
    })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryLots.siteId, siteId), eq(inventoryLots.itemKind, "product"), inArray(inventoryLots.productId, ids)))
    .groupBy(inventoryLots.productId);
  const held = await q
    .select({ productId: inventoryLots.productId, qty: sql<string>`coalesce(sum(${stockReservations.qtyBase}), 0)::text` })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(and(eq(stockReservations.siteId, siteId), eq(stockReservations.status, "active"), inArray(inventoryLots.productId, ids), sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`))
    .groupBy(inventoryLots.productId);
  const alloc = await q
    .select({ productId: inventoryLots.productId, qty: sql<string>`coalesce(sum(${stockAllocations.qtyUnits}), 0)::text` })
    .from(stockAllocations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(inventoryLots.siteId, siteId), inArray(inventoryLots.productId, ids), eq(stockAllocations.status, "open"), inArray(salesOrders.status, OPEN_ALLOCATION_ORDER_STATUSES)))
    .groupBy(inventoryLots.productId);
  // 4. Units already coming from open work orders.
  const wos = await q
    .select({ wo: workOrders, unitNetMassG: products.unitNetMassG, yieldPct: formulaRevisions.theoreticalYieldPct })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(formulaRevisions, eq(formulaRevisions.id, workOrders.formulaRevisionId))
    .where(and(eq(workOrders.siteId, siteId), inArray(workOrders.status, OPEN_WO), inArray(workOrders.productId, ids)));
  for (const r of rows.values()) {
    const s = stock.find((x) => x.productId === r.productId);
    r.onHand = new Decimal(s?.onHand ?? 0);
    const usable = new Decimal(s?.usable ?? 0)
      .minus(held.find((x) => x.productId === r.productId)?.qty ?? 0)
      .minus(alloc.find((x) => x.productId === r.productId)?.qty ?? 0);
    r.available = Decimal.max(usable, 0);
    r.openWo = wos.filter((x) => x.wo.productId === r.productId).reduce((a, x) => a.plus(expectedUnits(x.wo.qtyPlannedBase, x.yieldPct, x.unitNetMassG, x.wo.targetUnits)), new Decimal(0));
  }
  return [...rows.values()].map((r) => ({
    ...r,
    net: Decimal.max(r.soDemand.plus(r.minStock ?? 0).minus(r.available).minus(r.openWo), 0).ceil(),
  }));
}

/** Builds a draft plan for the current site and period from demand (W05-01). */
export async function buildProductionPlan(ctx: AuthContext, input: { periodStart: string; periodEnd: string; notes?: string | null; idempotencyKey?: string | null }) {
  ctx.require("production.production_plan.create");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!isDate(input.periodStart)) throw new DomainError("validation", "Choose the first day of the period.", { field: "periodStart" });
  if (!isDate(input.periodEnd) || input.periodEnd < input.periodStart) throw new DomainError("validation", "The period end cannot be before its start.", { field: "periodEnd" });
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.production_plan.create", async () => {
      const demand = (await demandSnapshot(tx, ctx, siteId, input.periodEnd)).filter((d) => d.net.gt(0));
      const number = await nextNumber(tx, ctx.organizationId, "PP");
      const [plan] = await tx
        .insert(productionPlans)
        .values({ organizationId: ctx.organizationId, siteId, planNumber: number, status: "draft", periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes?.trim() || null, submittedBy: ctx.userId, submittedAt: new Date(), statusChangedBy: ctx.userId, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      let lineNo = 0;
      for (const d of demand.sort((a, z) => (a.firstDate ?? input.periodEnd).localeCompare(z.firstDate ?? input.periodEnd))) {
        lineNo += 1;
        const target = d.firstDate && d.firstDate >= input.periodStart ? d.firstDate : d.firstDate && d.firstDate < input.periodStart ? input.periodStart : input.periodEnd;
        await tx.insert(productionPlanLines).values({
          organizationId: ctx.organizationId,
          siteId,
          productionPlanId: plan.id,
          lineNo,
          productId: d.productId,
          source: d.soDemand.gt(0) ? "sales_order" : "min_stock",
          salesOrderId: d.salesOrderIds.size === 1 ? [...d.salesOrderIds][0] : null,
          salesOrderLineId: d.salesOrderLineIds.length === 1 ? d.salesOrderLineIds[0] : null,
          demandUnits: d.soDemand.toString(),
          onHandUnits: d.onHand.toString(),
          availableUnits: d.available.toString(),
          openWorkOrderUnits: d.openWo.toString(),
          minStockUnits: d.minStock?.toString() ?? null,
          qtyUnits: d.net.toString(),
          targetDate: target,
          createdBy: ctx.userId,
        });
      }
      await audit(tx, ctx, { action: "production.production_plan.created", entityType: "production_plan", entityId: plan.id, entityNumber: number, siteId, after: { periodStart: input.periodStart, periodEnd: input.periodEnd, lines: lineNo } });
      return { planId: plan.id, planNumber: number, lines: lineNo };
    });
    return result;
  });
}

async function lockPlan(tx: DbOrTx, ctx: AuthContext, planId: string) {
  if (!UUID.test(planId)) throw new DomainError("not_found", "Plan not found in your sites.");
  const [p] = await tx.select().from(productionPlans).where(and(eq(productionPlans.id, planId), eq(productionPlans.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!p || !ctx.allowedSiteIds.includes(p.siteId)) throw new DomainError("not_found", "Plan not found in your sites.");
  ctx.requireSite(p.siteId);
  return p;
}

/** Optional approval gate (A-PROC-30), approver ≠ creator when approvals.sod.production_plan is on (A-PM-14). */
export async function approveProductionPlan(ctx: AuthContext, planId: string, note?: string | null) {
  ctx.require("production.production_plan.approve");
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, planId);
    planMachine.assert(p.status, "approved", `Plan ${p.planNumber}`);
    if (ctx.sodBlocksAt((await getSetting(tx, ctx.organizationId, "approvals.sod.production_plan", p.siteId)) && p.submittedBy === ctx.userId, "You built this plan; another person with approval permission must approve it.", p.siteId)) {
      throw new DomainError("separation_of_duties", "You built this plan; another person with approval permission must approve it.", ctx.refusalDetails());
    }
    const now = new Date();
    await tx.update(productionPlans).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: note?.trim() || null, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId }).where(eq(productionPlans.id, p.id));
    await audit(tx, ctx, { action: "production.production_plan.approved", entityType: "production_plan", entityId: p.id, entityNumber: p.planNumber, siteId: p.siteId, reason: note?.trim() || null, before: { status: p.status }, after: { status: "approved" } });
    return { planNumber: p.planNumber };
  });
}

export async function closeProductionPlan(ctx: AuthContext, planId: string) {
  ctx.require("production.production_plan.edit");
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, planId);
    planMachine.assert(p.status, "closed", `Plan ${p.planNumber}`);
    const now = new Date();
    await tx.update(productionPlans).set({ status: "closed", statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId }).where(eq(productionPlans.id, p.id));
    await audit(tx, ctx, { action: "production.production_plan.closed", entityType: "production_plan", entityId: p.id, entityNumber: p.planNumber, siteId: p.siteId, before: { status: p.status }, after: { status: "closed" } });
    return { planNumber: p.planNumber };
  });
}

/**
 * Converts a plan line into a draft work order linked by production_plan_line_id (US-5-15).
 * Batch count = ⌈units × unit mass ÷ (reference batch size × theoretical yield)⌉ of the formula
 * revision effective on the planned start. Refused while the plan needs approval and is not
 * approved, for a closed plan, and when the line already has an open work order.
 */
export async function convertPlanLine(ctx: AuthContext, input: { planLineId: string; plannedStart?: string | null; idempotencyKey?: string | null }) {
  ctx.require("production.work_order.create");
  ctx.require("production.production_plan.view");
  if (!UUID.test(input.planLineId)) throw new DomainError("not_found", "Plan line not found in your sites.");
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.production_plan_line.convert", async () => {
      const [line] = await tx.select().from(productionPlanLines).where(and(eq(productionPlanLines.id, input.planLineId), eq(productionPlanLines.organizationId, ctx.organizationId))).for("update").limit(1);
      if (!line || !ctx.allowedSiteIds.includes(line.siteId)) throw new DomainError("not_found", "Plan line not found in your sites.");
      const plan = await lockPlan(tx, ctx, line.productionPlanId);
      if (plan.siteId !== ctx.currentSiteId) throw new DomainError("validation", "Switch to the plan's site to create its work orders.");
      if (plan.status === "closed") throw new DomainError("state", `Plan ${plan.planNumber} is closed.`);
      if ((await getSetting(tx, ctx.organizationId, "production.production_plan.approval_required", plan.siteId)) && plan.status !== "approved") {
        throw new DomainError("state", `Plan ${plan.planNumber} must be approved before its lines become work orders.`);
      }
      const [existing] = await tx.select().from(workOrders).where(and(eq(workOrders.productionPlanLineId, line.id), ne(workOrders.status, "cancelled"))).limit(1);
      if (existing) throw new DomainError("state", `Line ${line.lineNo} already has work order ${existing.workOrderNumber}.`);
      const [product] = await tx.select().from(products).where(eq(products.id, line.productId)).limit(1);
      const today = manilaToday();
      const plannedStart = input.plannedStart && isDate(input.plannedStart) ? input.plannedStart : addDays(today, 1);
      const rev = await getEffectiveFormulaRevision(ctx, product.id, plannedStart, { tx });
      if (!rev) throw new DomainError("validation", `${product.name} has no approved formula revision effective on ${plannedStart} (V-REV).`, { rule: "V-REV" });
      const unitsPerBatch = new Decimal(rev.rev.referenceBatchSizeG).mul(rev.rev.theoreticalYieldPct).div(100).div(product.unitNetMassG).floor();
      if (unitsPerBatch.lte(0)) throw new DomainError("validation", "The formula's batch size is smaller than one unit.");
      const batchCount = Decimal.max(new Decimal(line.qtyUnits).div(unitsPerBatch).ceil(), 1).toNumber();
      const plannedEnd = addDays(plannedStart, Math.max(batchCount - 1, 0));
      const wo = await insertWorkOrder(
        tx,
        ctx,
        {
          productId: product.id,
          formulaId: rev.formula.id,
          batchCount,
          plannedStart,
          plannedEnd,
          targetUnits: new Decimal(line.qtyUnits).toFixed(0),
          salesOrderId: line.salesOrderId,
          notes: `From plan ${plan.planNumber} line ${line.lineNo}`,
        },
        { productionPlanLineId: line.id },
      );
      await audit(tx, ctx, {
        action: "production.production_plan_line.converted",
        entityType: "production_plan",
        entityId: plan.id,
        entityNumber: plan.planNumber,
        siteId: plan.siteId,
        after: { lineNo: line.lineNo, workOrder: wo.workOrderNumber, batchCount, unitsPerBatch: unitsPerBatch.toString() },
      });
      return { workOrderId: wo.id, workOrderNumber: wo.workOrderNumber, batchCount };
    });
    return result;
  });
}

/** Sets the minimum finished-goods stock of a SKU at the current site (planning input). */
export async function setMinStock(ctx: AuthContext, input: { productId: string; minStockUnits: string }) {
  ctx.require("production.production_plan.edit");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!/^\d{1,9}$/.test(input.minStockUnits?.trim() ?? "")) throw new DomainError("validation", "Enter the minimum stock as a whole number of units.", { field: "minStockUnits" });
  if (!UUID.test(input.productId)) throw new DomainError("validation", "Choose a product.", { field: "productId" });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
    if (!p) throw new DomainError("validation", "Choose a product.", { field: "productId" });
    const [before] = await tx.select().from(productMinStock).where(and(eq(productMinStock.siteId, siteId), eq(productMinStock.productId, p.id))).limit(1);
    const units = input.minStockUnits.trim();
    if (before) await tx.update(productMinStock).set({ minStockUnits: units, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(productMinStock.id, before.id));
    else await tx.insert(productMinStock).values({ organizationId: ctx.organizationId, siteId, productId: p.id, minStockUnits: units, updatedBy: ctx.userId });
    await audit(tx, ctx, { action: "production.min_stock.changed", entityType: "product", entityId: p.id, entityNumber: p.skuCode, siteId, before: { minStockUnits: before?.minStockUnits ?? null }, after: { minStockUnits: units } });
  });
}

export async function listProductionPlans(ctx: AuthContext) {
  ctx.require("production.production_plan.view");
  ctx.requireSite(ctx.currentSiteId);
  return db
    .select({
      p: productionPlans,
      by: users.displayName,
      lines: sql<number>`(select count(*)::int from ${productionPlanLines} where ${productionPlanLines.productionPlanId} = ${productionPlans.id})`,
      converted: sql<number>`(select count(distinct ${workOrders.productionPlanLineId})::int from ${workOrders} inner join ${productionPlanLines} on ${productionPlanLines.id} = ${workOrders.productionPlanLineId} where ${productionPlanLines.productionPlanId} = ${productionPlans.id} and ${workOrders.status} <> 'cancelled')`,
    })
    .from(productionPlans)
    .innerJoin(users, eq(users.id, productionPlans.createdBy))
    .where(and(eq(productionPlans.organizationId, ctx.organizationId), eq(productionPlans.siteId, ctx.currentSiteId)))
    .orderBy(desc(productionPlans.createdAt))
    .limit(100);
}

/** Plan detail with live material availability per line (cumulative in line order). */
export async function getProductionPlan(ctx: AuthContext, planId: string) {
  ctx.require("production.production_plan.view");
  if (!UUID.test(planId)) throw new DomainError("not_found", "Plan not found in your sites.");
  const [p] = await db.select().from(productionPlans).where(and(eq(productionPlans.id, planId), eq(productionPlans.organizationId, ctx.organizationId))).limit(1);
  if (!p || !ctx.allowedSiteIds.includes(p.siteId)) throw new DomainError("not_found", "Plan not found in your sites.");
  ctx.requireSite(p.siteId);
  const lines = await db
    .select({ l: productionPlanLines, productName: products.name, productSku: products.skuCode, unitNetMassG: products.unitNetMassG, soNumber: salesOrders.orderNumber })
    .from(productionPlanLines)
    .innerJoin(products, eq(products.id, productionPlanLines.productId))
    .leftJoin(salesOrders, eq(salesOrders.id, productionPlanLines.salesOrderId))
    .where(eq(productionPlanLines.productionPlanId, p.id))
    .orderBy(asc(productionPlanLines.lineNo));
  const wos = lines.length
    ? await db
        .select({ id: workOrders.id, number: workOrders.workOrderNumber, status: workOrders.status, lineId: workOrders.productionPlanLineId })
        .from(workOrders)
        .where(and(inArray(workOrders.productionPlanLineId, lines.map((x) => x.l.id)), isNotNull(workOrders.productionPlanLineId)))
    : [];
  const kinds = await stagingKinds(db, ctx.organizationId, p.siteId);
  const used = new Map<string, Decimal>();
  const freeCache = new Map<string, Decimal>();
  const out = [];
  for (const x of lines) {
    const wo = wos.find((w) => w.lineId === x.l.id && w.status !== "cancelled") ?? null;
    const rev = await getEffectiveFormulaRevision(ctx, x.l.productId, manilaToday()).catch(() => null);
    const materials: { materialCode: string; materialName: string; baseUom: string; required: string; free: string; short: string }[] = [];
    let batchCount = 0;
    if (rev && !wo) {
      const unitsPerBatch = new Decimal(rev.rev.referenceBatchSizeG).mul(rev.rev.theoreticalYieldPct).div(100).div(x.unitNetMassG).floor();
      batchCount = unitsPerBatch.gt(0) ? Decimal.max(new Decimal(x.l.qtyUnits).div(unitsPerBatch).ceil(), 1).toNumber() : 0;
      const pseudo = { formulaRevisionId: rev.rev.id, batchCount, batchSizeBase: rev.rev.referenceBatchSizeG };
      for (const r of await workOrderRequirements(db, pseudo)) {
        if (!freeCache.has(r.materialId)) {
          const { candidates } = await workOrderCandidates(db, { organizationId: p.organizationId, siteId: p.siteId, plannedEnd: x.l.targetDate }, r, kinds);
          freeCache.set(r.materialId, candidates.filter((c) => c.eligible).reduce((a, c) => a.plus(c.available), new Decimal(0)));
        }
        const free = Decimal.max(freeCache.get(r.materialId)!.minus(used.get(r.materialId) ?? 0), 0);
        used.set(r.materialId, (used.get(r.materialId) ?? new Decimal(0)).plus(r.required));
        materials.push({ materialCode: r.materialCode, materialName: r.materialName, baseUom: r.baseUom, required: r.required.toString(), free: free.toString(), short: Decimal.max(r.required.minus(free), 0).toString() });
      }
    }
    out.push({ ...x.l, productName: x.productName, productSku: x.productSku, salesOrderNumber: x.soNumber, workOrder: wo, formulaLabel: rev ? `${rev.formula.code} rev ${rev.rev.revisionNo}` : null, batchCount, materials, hasShortage: materials.some((m) => new Decimal(m.short).gt(0)) });
  }
  const approvalRequired = await getSetting(db, ctx.organizationId, "production.production_plan.approval_required", p.siteId);
  const sod = await getSetting(db, ctx.organizationId, "approvals.sod.production_plan", p.siteId);
  return {
    plan: p,
    lines: out,
    approvalRequired,
    actions: {
      canApprove: ctx.can("production.production_plan.approve") && p.status === "draft" && !(sod && ctx.sodConflictAt(p.submittedBy, p.siteId)),
      canClose: ctx.can("production.production_plan.edit") && p.status !== "closed",
      canConvert: ctx.can("production.work_order.create") && p.status !== "closed" && (!approvalRequired || p.status === "approved") && p.siteId === ctx.currentSiteId,
    },
  };
}
export type ProductionPlanDetail = Awaited<ReturnType<typeof getProductionPlan>>;

/** Live demand preview and min-stock settings for the plan page (nothing stored). */
export async function planningOverview(ctx: AuthContext, periodEnd: string) {
  ctx.require("production.production_plan.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const demand = await demandSnapshot(db, ctx, siteId, isDate(periodEnd) ? periodEnd : addDays(manilaToday(), 14));
  const prods = await db.select().from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.skuCode));
  const hasFormula = new Set((await db.select({ productId: formulas.productId }).from(formulas).where(eq(formulas.organizationId, ctx.organizationId))).map((f) => f.productId));
  const mins = await db.select().from(productMinStock).where(eq(productMinStock.siteId, siteId));
  return {
    demand: demand.map((d) => ({ ...d, product: prods.find((p) => p.id === d.productId)!, soDemand: d.soDemand.toString(), minStock: d.minStock?.toString() ?? null, onHand: d.onHand.toString(), available: d.available.toString(), openWo: d.openWo.toString(), net: d.net.toString(), salesOrderIds: [...d.salesOrderIds] })),
    products: prods.filter((p) => hasFormula.has(p.id)).map((p) => ({ id: p.id, sku: p.skuCode, name: p.name, minStockUnits: mins.find((m) => m.productId === p.id)?.minStockUnits ?? null })),
  };
}

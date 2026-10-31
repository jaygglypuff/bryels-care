import "server-only";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterialStagings,
  batchMaterials,
  batches,
  formulaRevisions,
  formulas,
  inventoryLots,
  locations,
  processStepRecords,
  productionLines,
  products,
  rolePermissions,
  routingRevisions,
  routings,
  salesOrders,
  stockReservations,
  userSiteAssignments,
  users,
  workOrderStateTransitions,
  workOrders,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { getEffectiveFormulaRevision } from "@/modules/masterdata";
import { type FormulaSnapshot, manilaToday } from "./shared";
import { WORK_ORDER_STATUSES } from "./work-orders-state";
import { stagingKinds, workOrderCandidates, workOrderRequirements } from "./work-orders-reserve";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkOrderFilter = { status?: string; productId?: string; lineId?: string; from?: string; to?: string; q?: string };

/** Work orders of the current site, newest planned start first, with batch progress counts. */
export async function listWorkOrders(ctx: AuthContext, f: WorkOrderFilter = {}) {
  ctx.require("production.work_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, ctx.currentSiteId)];
  if (f.status && (WORK_ORDER_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(workOrders.status, f.status));
  else if (f.status === "open") conds.push(inArray(workOrders.status, ["draft", "planned", "released", "in_progress"]));
  if (f.productId && UUID.test(f.productId)) conds.push(eq(workOrders.productId, f.productId));
  if (f.lineId && UUID.test(f.lineId)) conds.push(eq(workOrders.productionLineId, f.lineId));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(sql`${workOrders.plannedEnd} >= ${f.from}`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(sql`${workOrders.plannedStart} <= ${f.to}`);
  if (f.q?.trim()) conds.push(or(sql`${workOrders.workOrderNumber} ilike ${"%" + f.q.trim() + "%"}`, sql`${products.name} ilike ${"%" + f.q.trim() + "%"}`)!);
  const rows = await db
    .select({
      wo: workOrders,
      productName: products.name,
      productSku: products.skuCode,
      lineCode: productionLines.code,
      batchesTotal: sql<number>`(select count(*)::int from ${batches} where ${batches.workOrderId} = ${workOrders.id} and not (${batches.status} = 'rejected' and ${batches.startedAt} is null))`,
      batchesStarted: sql<number>`(select count(*)::int from ${batches} where ${batches.workOrderId} = ${workOrders.id} and ${batches.startedAt} is not null)`,
    })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
    .where(and(...conds))
    .orderBy(desc(workOrders.plannedStart), desc(workOrders.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.wo, productName: r.productName, productSku: r.productSku, lineCode: r.lineCode, batchesTotal: r.batchesTotal, batchesStarted: r.batchesStarted }));
}
export type WorkOrderListRow = Awaited<ReturnType<typeof listWorkOrders>>[number];

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Work order detail: overview, batches, materials (required / reserved / staged / consumed, FEFO candidates) and history. */
export async function getWorkOrder(ctx: AuthContext, workOrderId: string) {
  ctx.require("production.work_order.view");
  if (!UUID.test(workOrderId)) throw new DomainError("not_found", "Work order not found in your sites.");
  const [row] = await db
    .select({ wo: workOrders, product: products, formula: formulas, line: productionLines })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .innerJoin(formulas, eq(formulas.id, workOrders.formulaId))
    .leftJoin(productionLines, eq(productionLines.id, workOrders.productionLineId))
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, ctx.organizationId), inArray(workOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Work order not found in your sites.");
  const { wo, product, formula, line } = row;
  ctx.requireSite(wo.siteId);

  const [rev] = wo.formulaRevisionId ? await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, wo.formulaRevisionId)).limit(1) : [];
  const [routingRev] = wo.routingRevisionId
    ? await db.select({ rev: routingRevisions, routing: routings }).from(routingRevisions).innerJoin(routings, eq(routings.id, routingRevisions.routingId)).where(eq(routingRevisions.id, wo.routingRevisionId)).limit(1)
    : [];
  // "Revision in use" notice: a newer revision is effective today than the one frozen on the work order.
  let newerRevision: string | null = null;
  if (rev && ctx.can("masterdata.formula.view")) {
    const today = await getEffectiveFormulaRevision(ctx, wo.productId, manilaToday()).catch(() => null);
    if (today && today.rev.id !== rev.id && today.rev.revisionNo > rev.revisionNo) newerRevision = `${today.formula.code} rev ${today.rev.revisionNo}`;
  }
  const [so] = wo.salesOrderId ? await db.select({ id: salesOrders.id, number: salesOrders.orderNumber }).from(salesOrders).where(eq(salesOrders.id, wo.salesOrderId)).limit(1) : [];

  const bs = await db
    .select({
      b: batches,
      stepsDone: sql<number>`(select count(*)::int from ${processStepRecords} where ${processStepRecords.batchId} = ${batches.id})`,
    })
    .from(batches)
    .where(eq(batches.workOrderId, wo.id))
    .orderBy(asc(batches.createdAt));

  // Materials tab.
  const reqs = await workOrderRequirements(db, wo);
  const reservations = await db
    .select({ r: stockReservations, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, qualityStatus: inventoryLots.qualityStatus, materialId: inventoryLots.materialId, locationCode: locations.code })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .innerJoin(locations, eq(locations.id, stockReservations.locationId))
    .where(and(eq(stockReservations.demandType, "work_order"), eq(stockReservations.demandId, wo.id)))
    .orderBy(asc(stockReservations.createdAt));
  const staged = await db
    .select({ materialId: batchMaterials.materialId, qty: sql<string>`sum(${batchMaterialStagings.qtyBase})::text` })
    .from(batchMaterialStagings)
    .innerJoin(batchMaterials, eq(batchMaterials.id, batchMaterialStagings.batchMaterialId))
    .where(eq(batchMaterialStagings.workOrderId, wo.id))
    .groupBy(batchMaterials.materialId);
  const consumed = bs.length
    ? await db
        .select({ materialId: batchMaterials.materialId, qty: sql<string>`sum(${batchMaterials.dispensedQtyG})::text` })
        .from(batchMaterials)
        .where(inArray(batchMaterials.batchId, bs.map((x) => x.b.id)))
        .groupBy(batchMaterials.materialId)
    : [];
  const kinds = await stagingKinds(db, ctx.organizationId, wo.siteId);
  const showCandidates = ["draft", "planned", "released", "in_progress"].includes(wo.status) && ctx.can("inventory.lot.view");
  const materialsTab = [];
  for (const r of reqs) {
    const active = reservations.filter((x) => x.materialId === r.materialId && x.r.status === "active" && (!x.r.expiresAt || x.r.expiresAt > new Date()));
    const reserved = active.reduce((a, x) => a.plus(x.r.qtyBase), new Decimal(0));
    const st = new Decimal(staged.find((x) => x.materialId === r.materialId)?.qty ?? 0);
    const cons = new Decimal(consumed.find((x) => x.materialId === r.materialId)?.qty ?? 0);
    const short = Decimal.max(r.required.minus(reserved).minus(st), 0);
    const cands = showCandidates ? (await workOrderCandidates(db, wo, r, kinds)).candidates : [];
    const free = cands.filter((c) => c.eligible).reduce((a, c) => a.plus(c.available), new Decimal(0));
    materialsTab.push({
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialName: r.materialName,
      baseUom: r.baseUom,
      required: r.required.toString(),
      reserved: reserved.toString(),
      staged: st.toString(),
      consumed: cons.toString(),
      short: short.toString(),
      freeEligible: free.toString(),
      reservations: active.map((x) => ({ number: x.r.reservationNumber, lotNumber: x.lotNumber, expiresOn: x.expiresOn, locationCode: x.locationCode, qty: x.r.qtyBase, expiresAt: x.r.expiresAt })),
      recommended: cands.filter((c) => c.eligible).slice(0, 5).map((c) => ({ rank: c.rank, lotNumber: c.lotNumber, locationCode: c.locationCode, expiresOn: c.expiresOn, available: c.available })),
      blocked: cands.filter((c) => !c.eligible && c.reason).slice(0, 5).map((c) => ({ lotNumber: c.lotNumber, locationCode: c.locationCode, reason: c.reason })),
    });
  }

  const transitions = await db.select().from(workOrderStateTransitions).where(eq(workOrderStateTransitions.workOrderId, wo.id)).orderBy(asc(workOrderStateTransitions.occurredAt));
  const audits = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.organizationId, ctx.organizationId), eq(auditEvents.entityType, "work_order"), eq(auditEvents.entityId, wo.id)))
    .orderBy(asc(auditEvents.occurredAt));
  const nm = await names([wo.createdBy, wo.submittedBy, wo.approvedBy, wo.assignedPlannerId, wo.assignedSupervisorId, ...transitions.map((t) => t.actorId), ...audits.map((a) => a.actorId)]);
  const n = (id: string | null | undefined) => (id ? (nm.get(id) ?? "Unknown user") : null);
  const sodOn = await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId);
  const activeBatches = bs.filter((x) => x.b.status !== "rejected" || x.b.startedAt !== null).length;

  return {
    workOrder: wo,
    product,
    formula,
    line: line ?? null,
    formulaRevision: rev ? { id: rev.id, label: `${formula.code} rev ${rev.revisionNo}`, referenceBatchSizeG: rev.referenceBatchSizeG, theoreticalYieldPct: rev.theoreticalYieldPct } : null,
    routingRevision: routingRev ? { id: routingRev.rev.id, label: `${routingRev.routing.code} rev ${routingRev.rev.revisionNo}` } : null,
    newerRevision,
    salesOrder: so ?? null,
    people: { createdBy: n(wo.createdBy), planner: n(wo.assignedPlannerId), supervisor: n(wo.assignedSupervisorId), submittedBy: n(wo.submittedBy), approvedBy: n(wo.approvedBy) },
    batches: bs.map((x) => {
      const snap = x.b.formulaSnapshot as FormulaSnapshot;
      return { id: x.b.id, batchNumber: x.b.batchNumber, status: x.b.status, plannedSizeG: x.b.plannedSizeG, plannedStartOn: x.b.plannedStartOn, startedAt: x.b.startedAt, stepsDone: x.stepsDone, stepsTotal: snap.steps.length };
    }),
    batchesRemaining: Math.max(wo.batchCount - activeBatches, 0),
    materials: materialsTab,
    transitions: transitions.map((t) => ({ ...t, actor: n(t.actorId) })),
    audits: audits.map((a) => ({ ...a, actor: n(a.actorId) })),
    actions: {
      canEdit: ctx.can("production.work_order.edit") && wo.status === "draft",
      canPlan: ctx.can("production.work_order.submit") && wo.status === "draft",
      canRelease: ctx.can("production.work_order.approve") && wo.status === "planned",
      releaseBlockedBySod: sodOn && ctx.sodConflictAt(wo.submittedBy, wo.siteId),
      canTopUp: ctx.can("production.work_order.approve") && (wo.status === "released" || wo.status === "in_progress"),
      canCancel: ctx.can("production.work_order.void") && ["draft", "planned", "released"].includes(wo.status),
      canCreateBatch: ctx.can("production.batch.create") && ["planned", "released", "in_progress"].includes(wo.status) && activeBatches < wo.batchCount && wo.siteId === ctx.currentSiteId,
    },
  };
}
export type WorkOrderDetail = Awaited<ReturnType<typeof getWorkOrder>>;

/** Options for the work order form at the current site. */
export async function workOrderFormOptions(ctx: AuthContext) {
  ctx.require("production.work_order.create");
  const siteId = ctx.currentSiteId;
  const today = manilaToday();
  const fs = await db
    .select({ formulaId: formulas.id, formulaCode: formulas.code, formulaName: formulas.name, productId: products.id, productName: products.name, productSku: products.skuCode, unitNetMassG: products.unitNetMassG })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(eq(formulas.organizationId, ctx.organizationId))
    .orderBy(asc(products.name), asc(formulas.code));
  const revs = fs.length
    ? await db
        .select()
        .from(formulaRevisions)
        .where(and(inArray(formulaRevisions.formulaId, fs.map((f) => f.formulaId)), eq(formulaRevisions.status, "approved")))
        .orderBy(desc(formulaRevisions.revisionNo))
    : [];
  const formulasOut = fs.map((f) => {
    const approved = revs.filter((r) => r.formulaId === f.formulaId);
    const eff = approved.find((r) => r.effectiveFrom && r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo > today)) ?? approved[0] ?? null;
    return { ...f, referenceBatchSizeG: eff?.referenceBatchSizeG ?? null, theoreticalYieldPct: eff?.theoreticalYieldPct ?? null, effectiveRevision: eff ? `rev ${eff.revisionNo}` : null };
  });
  const lines = await db.select().from(productionLines).where(and(eq(productionLines.siteId, siteId), eq(productionLines.status, "active"))).orderBy(asc(productionLines.code));
  const supervisors = await db
    .selectDistinct({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(and(eq(users.organizationId, ctx.organizationId), eq(users.status, "active"), eq(rolePermissions.permissionCode, "production.batch.edit"), or(eq(userSiteAssignments.siteId, siteId), eq(userSiteAssignments.isOrganizationWide, true))))
    .orderBy(asc(users.displayName));
  return { formulas: formulasOut, lines, supervisors, today };
}

/** Production lines of the current site (board filter). */
export async function listProductionLines(ctx: AuthContext, siteId = ctx.currentSiteId) {
  ctx.requireSite(siteId);
  return db.select().from(productionLines).where(eq(productionLines.siteId, siteId)).orderBy(asc(productionLines.code));
}

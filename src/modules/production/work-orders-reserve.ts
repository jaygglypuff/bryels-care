import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx, Tx } from "@/db/client";
import { batchMaterialStagings, batchMaterials, batches, bomLines, formulaRevisions, formulas, inventoryLots, locations, materials, products, stockReservations, workOrders } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { candidatesFor, lockLots, resolveAllocationStrategy } from "@/modules/inventory";

type Candidate = Awaited<ReturnType<typeof candidatesFor>>[number];
import { addDays, manilaToday } from "./shared";
import { expectedPieces, isPackagingKind, perPieceQty, perPieceSetup } from "./packaging-lines";

/**
 * Material requirement and FEFO reservation for work orders (US-3-05 AC1, W05-04, A-PROC-09).
 *
 * Requirement per material = Σ over the frozen formula revision's BOM lines of
 *   proportional: quantity × (batch size ÷ reference size) × batch count
 *   fixed:        quantity × batch count
 * Covered = active work-order reservations + quantity already staged for the work order's batches.
 * Reservations pick released, unexpired lots in storage locations (never a staging location) in
 * the resolved FEFO/FIFO order, whose expiry is after the planned end plus the configured margin.
 */

type WoForReserve = typeof workOrders.$inferSelect;

export type MaterialRequirement = {
  materialId: string;
  materialCode: string;
  materialName: string;
  materialKind: string;
  baseUom: string;
  required: Decimal;
};

export async function workOrderRequirements(q: DbOrTx, wo: Pick<WoForReserve, "formulaRevisionId" | "batchCount" | "batchSizeBase"> & { siteId?: string | null }): Promise<MaterialRequirement[]> {
  if (!wo.formulaRevisionId) return [];
  const [rev] = await q.select().from(formulaRevisions).where(eq(formulaRevisions.id, wo.formulaRevisionId)).limit(1);
  if (!rev) return [];
  const lines = await q
    .select({ line: bomLines, material: materials })
    .from(bomLines)
    .innerJoin(materials, eq(materials.id, bomLines.materialId))
    .where(eq(bomLines.formulaRevisionId, rev.id))
    .orderBy(bomLines.lineNo);
  const factor = new Decimal(wo.batchSizeBase).div(rev.referenceBatchSizeG);
  const out = new Map<string, MaterialRequirement>();
  for (const { line, material } of lines) {
    const perBatch = line.scaling === "fixed" ? new Decimal(line.quantityG) : new Decimal(line.quantityG).mul(factor);
    const qty = perBatch.mul(wo.batchCount).toDecimalPlaces(6);
    const r = out.get(material.id);
    if (r) r.required = r.required.plus(qty);
    else out.set(material.id, { materialId: material.id, materialCode: material.code, materialName: material.name, materialKind: material.materialKind, baseUom: material.baseUom, required: qty });
  }
  // ADR-088 §3: a recipe without packaging lines takes them from the product's per-piece setup (same
  // arithmetic as insertBatch, per batch, so what is set aside is what each batch's list shows).
  if (!lines.some(({ material }) => isPackagingKind(material.materialKind))) {
    const [fp] = await q.select({ organizationId: formulas.organizationId, sku: products.skuCode, unitNetMassG: products.unitNetMassG }).from(formulas).innerJoin(products, eq(products.id, formulas.productId)).where(eq(formulas.id, rev.formulaId)).limit(1);
    if (fp) {
      const pieces = expectedPieces(wo.batchSizeBase, rev.theoreticalYieldPct, fp.unitNetMassG);
      for (const p of await perPieceSetup(q, fp.organizationId, wo.siteId ?? null, fp.sku)) {
        const qty = perPieceQty(pieces, p.perPiece, p.extraPct).mul(wo.batchCount);
        if (qty.lte(0)) continue;
        const r = out.get(p.materialId);
        if (r) r.required = r.required.plus(qty);
        else out.set(p.materialId, { materialId: p.materialId, materialCode: p.materialCode, materialName: p.materialName, materialKind: p.materialKind, baseUom: p.baseUom, required: qty });
      }
    }
  }
  return [...out.values()];
}

/** Active (unexpired) work-order reservations per material. */
export async function activeWorkOrderReservations(q: DbOrTx, workOrderId: string) {
  return q
    .select({ r: stockReservations, materialId: sql<string>`${inventoryLots.materialId}` })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(
      and(
        eq(stockReservations.demandType, "work_order"),
        eq(stockReservations.demandId, workOrderId),
        eq(stockReservations.status, "active"),
        sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`,
      ),
    );
}

/** Quantity already staged for the work order's batches, per material. */
export async function stagedByMaterial(q: DbOrTx, workOrderId: string) {
  const rows = await q
    .select({ materialId: batchMaterials.materialId, qty: sql<string>`sum(${batchMaterialStagings.qtyBase})::text` })
    .from(batchMaterialStagings)
    .innerJoin(batchMaterials, eq(batchMaterials.id, batchMaterialStagings.batchMaterialId))
    .where(eq(batchMaterialStagings.workOrderId, workOrderId))
    .groupBy(batchMaterials.materialId);
  return new Map(rows.map((r) => [r.materialId, new Decimal(r.qty)]));
}

/** Location kinds that are staging areas for the site (never reserved for a work order). */
export async function stagingKinds(q: DbOrTx, organizationId: string, siteId: string) {
  return getSetting(q, organizationId, "production.staging.location_kinds", siteId);
}

/** Minimum remaining shelf life (days from today) so that expiry falls after planned end + margin. */
export async function minDaysForWorkOrder(q: DbOrTx, wo: Pick<WoForReserve, "organizationId" | "siteId" | "plannedEnd">, ruleMin: number | null) {
  const margin = await getSetting(q, wo.organizationId, "production.work_order.lot_expiry_margin_days", wo.siteId);
  const today = manilaToday();
  const toEnd = Math.round((Date.parse(wo.plannedEnd + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
  // expires_on > planned_end + margin  ⇔  days left ≥ (planned_end − today) + margin + 1
  return Math.max(toEnd + margin + 1, ruleMin ?? 0, 0);
}

export type Shortage = { materialId: string; materialCode: string; materialName: string; baseUom: string; required: string; covered: string; reservedNow: string; short: string; reasons: string[] };
export type NewReservation = { id: string; reservationNumber: string; materialCode: string; lotNumber: string; locationCode: string; qty: string; baseUom: string };

/** Eligible candidates for a work order (released, in date for the planned end, storage only). */
export async function workOrderCandidates(q: DbOrTx, wo: Pick<WoForReserve, "organizationId" | "siteId" | "plannedEnd">, req: MaterialRequirement, kindsToSkip: string[]) {
  const rule = await resolveAllocationStrategy(q, wo.organizationId, { materialId: req.materialId, materialKind: req.materialKind });
  const minDays = await minDaysForWorkOrder(q, wo, rule.minShelfLifeDays);
  const cands = await candidatesFor(q, wo.siteId, { materialId: req.materialId, productId: null }, { strategy: rule.strategy, minShelfLifeDays: minDays || null });
  return {
    rule,
    minDays,
    candidates: cands.map((c): Candidate => (c.eligible && kindsToSkip.includes(c.locationKind) ? { ...c, eligible: false, rank: null, reason: "In a production staging location" } : c)),
  };
}

/**
 * Reserves the uncovered requirement of every material in the caller's transaction. Lots are
 * locked in id order before availability is re-read (docs/data-model.md §5.4), reservation numbers
 * are allocated last. Returns the reservations made and the shortages left.
 */
export async function reserveWorkOrderMaterials(tx: Tx, ctx: AuthContext, wo: WoForReserve) {
  const reqs = await workOrderRequirements(tx, wo);
  const kinds = await stagingKinds(tx, wo.organizationId, wo.siteId);
  const covered = async () => {
    const active = await activeWorkOrderReservations(tx, wo.id);
    const staged = await stagedByMaterial(tx, wo.id);
    const m = new Map<string, Decimal>();
    for (const a of active) m.set(a.materialId, (m.get(a.materialId) ?? new Decimal(0)).plus(a.r.qtyBase));
    for (const [k, v] of staged) m.set(k, (m.get(k) ?? new Decimal(0)).plus(v));
    return m;
  };

  // 1. Preliminary candidate read to know which lots to lock; 2. lock; 3. re-read and reserve.
  const pre = [];
  for (const r of reqs) pre.push(...(await workOrderCandidates(tx, wo, r, kinds)).candidates.map((c) => c.lotId));
  await lockLots(tx, pre);

  const cov = await covered();
  const picks: { req: MaterialRequirement; c: Candidate; qty: Decimal }[] = [];
  const shortages: Shortage[] = [];
  for (const r of reqs) {
    const already = cov.get(r.materialId) ?? new Decimal(0);
    let need = Decimal.max(r.required.minus(already), 0);
    const { candidates } = await workOrderCandidates(tx, wo, r, kinds);
    let reservedNow = new Decimal(0);
    for (const c of candidates) {
      if (need.lte(0)) break;
      if (!c.eligible) continue;
      const take = Decimal.min(need, c.available);
      if (take.lte(0)) continue;
      picks.push({ req: r, c, qty: take });
      need = need.minus(take);
      reservedNow = reservedNow.plus(take);
    }
    if (need.gt(0)) {
      const reasons = [...new Set(candidates.filter((c) => !c.eligible && c.reason).map((c) => `${c.lotNumber} at ${c.locationCode}: ${c.reason}`))].slice(0, 5);
      shortages.push({
        materialId: r.materialId,
        materialCode: r.materialCode,
        materialName: r.materialName,
        baseUom: r.baseUom,
        required: r.required.toString(),
        covered: already.toString(),
        reservedNow: reservedNow.toString(),
        short: need.toString(),
        reasons,
      });
    }
  }
  return { picks, shortages, requirements: reqs };
}

/** Inserts the picked reservations (numbers allocated last) and audits each like W1C reservations. */
export async function insertWorkOrderReservations(tx: Tx, ctx: AuthContext, wo: WoForReserve, picks: { req: MaterialRequirement; c: Candidate; qty: Decimal }[]) {
  const grace = await getSetting(tx, wo.organizationId, "production.work_order.reservation_grace_days", wo.siteId);
  const expiresAt = new Date(`${addDays(wo.plannedEnd, grace + 1)}T00:00:00+08:00`);
  const out: NewReservation[] = [];
  for (const p of picks) {
    const number = await nextNumber(tx, ctx.organizationId, "RSV");
    const [r] = await tx
      .insert(stockReservations)
      .values({
        organizationId: wo.organizationId,
        siteId: wo.siteId,
        reservationNumber: number,
        lotId: p.c.lotId,
        locationId: p.c.locationId,
        qtyBase: p.qty.toString(),
        baseUom: p.c.baseUom,
        demandType: "work_order",
        demandId: wo.id,
        demandReference: `${wo.workOrderNumber} · ${p.req.materialCode}`,
        status: "active",
        expiresAt,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, {
      action: "inventory.stock_reservation.created",
      entityType: "stock_reservation",
      entityId: r.id,
      entityNumber: number,
      siteId: wo.siteId,
      after: { lotNumber: p.c.lotNumber, location: p.c.locationCode, qtyBase: p.qty.toString(), demand: `work_order: ${wo.workOrderNumber}`, rank: p.c.rank, expiresAt: expiresAt.toISOString() },
    });
    out.push({ id: r.id, reservationNumber: number, materialCode: p.req.materialCode, lotNumber: p.c.lotNumber, locationCode: p.c.locationCode, qty: p.qty.toString(), baseUom: p.c.baseUom });
  }
  return out;
}

/** Ends every active reservation of a demand (cancel / close) with a reason and an audit row each. */
export async function endReservationsForDemand(tx: Tx, ctx: AuthContext, demandType: "work_order" | "batch", demandId: string, status: "released" | "cancelled", reason: string) {
  const rows = await tx
    .update(stockReservations)
    .set({ status, releasedAt: new Date(), releasedBy: ctx.userId, releasedReason: reason })
    .where(and(eq(stockReservations.demandType, demandType), eq(stockReservations.demandId, demandId), eq(stockReservations.status, "active")))
    .returning();
  for (const r of rows) {
    await audit(tx, ctx, {
      action: "inventory.stock_reservation.released",
      entityType: "stock_reservation",
      entityId: r.id,
      entityNumber: r.reservationNumber,
      siteId: r.siteId,
      reason,
      before: { status: "active" },
      after: { status },
    });
  }
  return rows.length;
}

/** Location codes by id (for messages). */
export async function locationCodes(q: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await q.select({ id: locations.id, code: locations.code }).from(locations).where(inArray(locations.id, ids));
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Batches of a work order (for progress and guards). */
export async function batchesOfWorkOrder(q: DbOrTx, workOrderId: string) {
  return q.select().from(batches).where(eq(batches.workOrderId, workOrderId));
}

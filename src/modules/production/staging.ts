import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  batchMaterialStagings,
  batchMaterialSubstitutions,
  batchMaterials,
  batches,
  inventoryLots,
  locations,
  materials,
  products,
  stockReservations,
  users,
  workOrders,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { parseScan } from "@/lib/scan";
import { getSetting } from "@/lib/settings";
import { assertLotUsable, lockLots, postMovement } from "@/modules/inventory";
import { idempotent, lockBatch } from "./shared";
import { transitionBatch } from "./state";
import { endReservationsForDemand, stagingKinds, workOrderCandidates, type MaterialRequirement } from "./work-orders-reserve";

/**
 * Material staging by scan (US-3-08, docs/process-maps.md W05-05): the warehouse operator picks
 * the lots the work order reserved and moves them to a production staging location by scanning
 * BC:LOT and BC:LOC. A lot that is not reserved is blocked with the expected lots shown; a qa_qc
 * substitution (production.material_substitution.approve) may reserve another released lot of the
 * SAME material; a different material is never allowed. When every ingredient is staged the batch
 * moves planned → materials_staged.
 */

/**
 * Staging is a warehouse task (W05-05): people who see batches (production.batch.view) or who post
 * stock movements at the site (inventory.movement.post, the warehouse operator) may see a batch's
 * staging view; posting a staging scan always needs inventory.movement.post.
 */
export function canSeeStaging(ctx: AuthContext) {
  return ctx.can("production.batch.view") || ctx.can("inventory.movement.post");
}
function requireStagingAccess(ctx: AuthContext) {
  if (!canSeeStaging(ctx)) ctx.require("production.batch.view");
}

type Line = { bm: typeof batchMaterials.$inferSelect; material: typeof materials.$inferSelect };

const STAGEABLE_WO: readonly string[] = ["released", "in_progress"];

function scanValue(raw: string, type: "LOT" | "LOC", label: string) {
  const p = parseScan(raw ?? "");
  if (p.kind === "invalid") throw new DomainError("validation", `Scan the ${label} label (BC:${type}:…) or type its code.`, { field: type === "LOT" ? "lotCode" : "toLocationCode" });
  if (p.kind === "typed" && p.type !== type) {
    throw new DomainError("validation", `That is a ${p.type === "LOC" ? "location" : p.type === "LOT" ? "lot" : p.type.toLowerCase()} label. Scan the ${label}.`, { field: type === "LOT" ? "lotCode" : "toLocationCode" });
  }
  return p.value;
}

async function stagedTotals(q: DbOrTx, batchId: string) {
  const rows = await q
    .select({ bmId: batchMaterialStagings.batchMaterialId, qty: sql<string>`sum(${batchMaterialStagings.qtyBase})::text` })
    .from(batchMaterialStagings)
    .where(eq(batchMaterialStagings.batchId, batchId))
    .groupBy(batchMaterialStagings.batchMaterialId);
  return new Map(rows.map((r) => [r.bmId, new Decimal(r.qty)]));
}

/** Active work-order reservations of a material (the "expected lots" of staging). */
export async function expectedLots(q: DbOrTx, workOrderId: string, materialId: string) {
  return q
    .select({ r: stockReservations, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, locationCode: locations.code })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .innerJoin(locations, eq(locations.id, stockReservations.locationId))
    .where(
      and(
        eq(stockReservations.demandType, "work_order"),
        eq(stockReservations.demandId, workOrderId),
        eq(stockReservations.status, "active"),
        eq(inventoryLots.materialId, materialId),
        sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`,
      ),
    )
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(stockReservations.createdAt));
}

async function loadWorkOrderForBatch(tx: Tx, b: typeof batches.$inferSelect) {
  if (!b.workOrderId) throw new DomainError("state", `Batch ${b.batchNumber} has no work order, so no materials are reserved for it. Staging by scan is for work-order batches.`);
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, b.workOrderId)).for("update").limit(1);
  if (!wo) throw new DomainError("not_found", "Work order not found.");
  if (!STAGEABLE_WO.includes(wo.status)) {
    throw new DomainError("state", `Work order ${wo.workOrderNumber} is ${wo.status.replace(/_/g, " ")}. Materials are staged after the work order is released.`);
  }
  return wo;
}

/**
 * Consumes `qty` from active reservations (oldest first) as `converted`; a partly used reservation
 * is converted and its remainder re-reserved under a new number (reservations are never edited in
 * place). Returns the quantity that could not be covered (0 when fully covered).
 */
export async function convertReservations(tx: Tx, ctx: AuthContext, rows: (typeof stockReservations.$inferSelect)[], qty: Decimal, why: string, status: "converted" | "released") {
  let left = qty;
  for (const r of rows) {
    if (left.lte(0)) break;
    const rq = new Decimal(r.qtyBase);
    const used = Decimal.min(rq, left);
    await tx
      .update(stockReservations)
      .set({ status, releasedAt: new Date(), releasedBy: ctx.userId, releasedReason: why })
      .where(eq(stockReservations.id, r.id));
    let remainderNumber: string | null = null;
    if (rq.gt(used)) {
      remainderNumber = await nextNumber(tx, ctx.organizationId, "RSV");
      await tx.insert(stockReservations).values({
        organizationId: r.organizationId,
        siteId: r.siteId,
        reservationNumber: remainderNumber,
        lotId: r.lotId,
        locationId: r.locationId,
        containerId: r.containerId,
        qtyBase: rq.minus(used).toString(),
        baseUom: r.baseUom,
        demandType: r.demandType,
        demandId: r.demandId,
        demandReference: r.demandReference,
        status: "active",
        expiresAt: r.expiresAt,
        createdBy: ctx.userId,
      });
    }
    await audit(tx, ctx, {
      action: status === "converted" ? "inventory.stock_reservation.converted" : "inventory.stock_reservation.released",
      entityType: "stock_reservation",
      entityId: r.id,
      entityNumber: r.reservationNumber,
      siteId: r.siteId,
      reason: why,
      before: { status: "active", qtyBase: r.qtyBase },
      after: { status, used: used.toString(), remainderReservation: remainderNumber },
    });
    left = left.minus(used);
  }
  return left;
}

export type StageInput = {
  batchId: string;
  lotCode: string;
  toLocationCode: string;
  /** Optional when the lot has one reserved location. */
  fromLocationId?: string | null;
  /** Quantity in the lot's base unit; defaults to what the ingredient still needs (capped by the reservation). */
  qty?: string | null;
  idempotencyKey?: string | null;
};

/**
 * One staging scan (W05-05). Blocks: a lot of another material ("This is Palm Oil, not Coconut
 * Oil"; never allowed), a lot that is not reserved for the work order (expected lots shown), a
 * lot that is not usable now (status re-read under lock), a destination that is not a staging
 * location, and more than the reservation or the ingredient's remaining need.
 */
export async function stageMaterial(ctx: AuthContext, input: StageInput) {
  ctx.require("inventory.movement.post");
  requireStagingAccess(ctx);
  const lotNumber = scanValue(input.lotCode, "LOT", "lot");
  const locCode = scanValue(input.toLocationCode, "LOC", "staging location");
  let qtyIn: Decimal | null = null;
  if (input.qty !== undefined && input.qty !== null && String(input.qty).trim() !== "") {
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(String(input.qty).trim())) throw new DomainError("validation", "Enter the quantity as a number.", { field: "qty" });
    qtyIn = new Decimal(String(input.qty).trim());
    if (qtyIn.lte(0)) throw new DomainError("validation", "The quantity must be greater than zero.", { field: "qty" });
  }

  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch_material.stage", () =>
      stageInTx(tx, ctx, b, { lotNumber, locCode, fromLocationId: input.fromLocationId ?? null, qty: qtyIn }),
    );
    return result;
  });
}

/**
 * The body of one staging scan in the caller's transaction (caller holds the batch lock and has
 * checked inventory.movement.post). Also used by the Materials list when
 * `production.prepare.move_stock` is on (ADR-080 §2): a "Taken" tick posts the same transfer.
 */
export async function stageInTx(tx: Tx, ctx: AuthContext, b: typeof batches.$inferSelect, input: { lotNumber: string; locCode: string; fromLocationId?: string | null; qty?: Decimal | null }) {
  const { lotNumber, locCode } = input;
  const qtyIn = input.qty ?? null;
  {
    {
      if (b.status !== "planned") {
        throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; materials are staged while the batch is planned.`);
      }
      const wo = await loadWorkOrderForBatch(tx, b);
      const [found] = await tx
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.siteId, b.siteId), eq(inventoryLots.lotNumber, lotNumber)))
        .limit(1);
      if (!found) throw new DomainError("not_found", `Lot ${lotNumber} was not found at this site.`, { field: "lotCode" });
      const [lot] = await lockLots(tx, [found.id]);

      const lines: Line[] = await tx
        .select({ bm: batchMaterials, material: materials })
        .from(batchMaterials)
        .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
        .where(eq(batchMaterials.batchId, b.id))
        .orderBy(asc(batchMaterials.lineNo));
      const staged = await stagedTotals(tx, b.id);
      const remainingOf = (l: Line) => Decimal.max(new Decimal(l.bm.theoreticalQtyG).minus(staged.get(l.bm.id) ?? 0), 0);
      const candidates = lines.filter((l) => lot.itemKind === "material" && l.material.id === lot.materialId);
      if (!candidates.length) {
        const [m] = lot.materialId ? await tx.select().from(materials).where(eq(materials.id, lot.materialId)).limit(1) : [];
        const [p] = lot.productId ? await tx.select().from(products).where(eq(products.id, lot.productId)).limit(1) : [];
        const what = m?.name ?? p?.name ?? "another item";
        const open = lines.filter((l) => remainingOf(l).gt(0)).map((l) => l.material.name);
        throw new DomainError("blocked_lot", `This is ${what}, not an ingredient of batch ${b.batchNumber}${open.length ? ` (still to stage: ${open.join(", ")})` : ""}. A different material is never allowed.`, {
          rule: "V-MAT",
          field: "lotCode",
        });
      }
      const line = candidates.find((l) => remainingOf(l).gt(0)) ?? candidates[0];
      const remaining = remainingOf(line);
      if (remaining.lte(0)) throw new DomainError("state", `${line.material.name} is already fully staged for batch ${b.batchNumber}.`);

      assertLotUsable(lot);

      const reserved = (await expectedLots(tx, wo.id, line.material.id)).filter((x) => x.r.lotId === lot.id);
      if (!reserved.length) {
        const exp = await expectedLots(tx, wo.id, line.material.id);
        const expText = exp.length ? exp.map((x) => `${x.lotNumber} at ${x.locationCode}`).join(", ") : "none reserved; ask the planner to top up reservations";
        throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is not the reserved lot of ${line.material.name}. Expected: ${expText}. QA can approve a substitution with another released lot of the same material.`, {
          rule: "V-MAT",
          field: "lotCode",
          expected: exp.map((x) => ({ lotNumber: x.lotNumber, locationCode: x.locationCode, qty: x.r.qtyBase })),
        });
      }
      const fromId = input.fromLocationId || [...reserved].sort((a, z) => new Decimal(z.r.qtyBase).comparedTo(a.r.qtyBase))[0].r.locationId;
      const atFrom = reserved.filter((x) => x.r.locationId === fromId);
      if (!atFrom.length) throw new DomainError("validation", `Lot ${lot.lotNumber} is reserved at ${reserved.map((x) => x.locationCode).join(", ")}; pick it from there.`, { field: "fromLocationId" });
      const reservedQty = atFrom.reduce((a, x) => a.plus(x.r.qtyBase), new Decimal(0));

      const [to] = await tx.select().from(locations).where(and(eq(locations.siteId, b.siteId), eq(locations.code, locCode))).limit(1);
      if (!to || !to.isActive) throw new DomainError("not_found", `Location ${locCode} was not found at this site.`, { field: "toLocationCode" });
      const kinds = await stagingKinds(tx, ctx.organizationId, b.siteId);
      if (!kinds.includes(to.kind)) {
        throw new DomainError("validation", `${to.code} is a ${to.kind} location. Scan the production staging location (${kinds.join(" / ")}).`, { field: "toLocationCode" });
      }
      if (to.id === fromId) throw new DomainError("validation", "The lot is already at this location; scan the staging location.", { field: "toLocationCode" });

      const cap = Decimal.min(remaining, reservedQty);
      const qty = qtyIn ?? cap;
      if (qty.gt(reservedQty)) throw new DomainError("validation", `Only ${reservedQty.toString()} ${lot.baseUom} of lot ${lot.lotNumber} is reserved at this location for ${wo.workOrderNumber}.`, { field: "qty" });
      if (qty.gt(remaining)) throw new DomainError("validation", `${line.material.name} needs only ${remaining.toString()} ${lot.baseUom} more for batch ${b.batchNumber}.`, { field: "qty" });

      const stagingId = uuidv7();
      const { movement } = await postMovement(tx, ctx, {
        movementType: "transfer",
        lotId: lot.id,
        fromLocationId: fromId,
        toLocationId: to.id,
        qtyBase: qty,
        sourceDocumentType: "batch",
        sourceDocumentId: b.id,
        sourceDocumentNumber: b.batchNumber,
        reason: `Staged ${line.material.name} for batch ${b.batchNumber} (${wo.workOrderNumber})`,
        idempotencyKey: `staging:${stagingId}`,
        meta: { stagingId, batchMaterialId: line.bm.id, workOrder: wo.workOrderNumber, toLocation: to.code },
      });
      await convertReservations(tx, ctx, atFrom.map((x) => x.r), qty, `Staged for batch ${b.batchNumber}`, "converted");

      const ttl = await getSetting(tx, ctx.organizationId, "production.staging.reservation_ttl_hours", b.siteId);
      const rsvNumber = await nextNumber(tx, ctx.organizationId, "RSV");
      const [batchRsv] = await tx
        .insert(stockReservations)
        .values({
          organizationId: b.organizationId,
          siteId: b.siteId,
          reservationNumber: rsvNumber,
          lotId: lot.id,
          locationId: to.id,
          qtyBase: qty.toString(),
          baseUom: lot.baseUom,
          demandType: "batch",
          demandId: b.id,
          demandReference: `${b.batchNumber} · ${line.material.code}`,
          status: "active",
          expiresAt: sql`now() + make_interval(hours => ${ttl})`,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, {
        action: "inventory.stock_reservation.created",
        entityType: "stock_reservation",
        entityId: batchRsv.id,
        entityNumber: rsvNumber,
        siteId: b.siteId,
        after: { lotNumber: lot.lotNumber, location: to.code, qtyBase: qty.toString(), demand: `batch: ${b.batchNumber}`, ttlHours: ttl },
      });
      await tx.insert(batchMaterialStagings).values({
        id: stagingId,
        organizationId: b.organizationId,
        siteId: b.siteId,
        batchId: b.id,
        batchMaterialId: line.bm.id,
        workOrderId: wo.id,
        lotId: lot.id,
        fromLocationId: fromId,
        toLocationId: to.id,
        qtyBase: qty.toString(),
        baseUom: lot.baseUom,
        movementId: movement.id,
        batchReservationId: batchRsv.id,
        stagedBy: ctx.userId,
      });
      await audit(tx, ctx, {
        action: "production.batch_material.staged",
        entityType: "batch",
        entityId: b.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        after: { material: line.material.code, lot: lot.lotNumber, qty: qty.toString(), uom: lot.baseUom, to: to.code, movementId: movement.id, workOrder: wo.workOrderNumber },
      });

      // All lines staged → planned → materials_staged (data-model §6.2 guard).
      staged.set(line.bm.id, (staged.get(line.bm.id) ?? new Decimal(0)).plus(qty));
      const allStaged = lines.every((l) => remainingOf(l).lte(0));
      if (allStaged) {
        await transitionBatch(tx, ctx, b, "materials_staged");
        await audit(tx, ctx, { action: "production.batch.state_changed", entityType: "batch", entityId: b.id, entityNumber: b.batchNumber, siteId: b.siteId, before: { status: "planned" }, after: { status: "materials_staged" } });
      }
      return {
        stagingId,
        materialName: line.material.name,
        lotNumber: lot.lotNumber,
        qty: qty.toString(),
        baseUom: lot.baseUom,
        toLocation: to.code,
        remaining: remainingOf(line).toString(),
        batchStaged: allStaged,
        batchMaterialId: line.bm.id,
      };
    }
  }
}

export type SubstitutionInput = {
  batchId: string;
  batchMaterialId: string;
  substituteLotCode: string;
  substituteLocationId?: string | null;
  expectedLotId?: string | null;
  reason: string;
  idempotencyKey?: string | null;
};

/**
 * Controlled exception CX-MAT (docs/permissions-matrix.md §5.3): a qa_qc user lets staging use
 * another released lot of the same material. Ends the work-order reservation of the expected lot
 * for the quantity the ingredient still needs and reserves the substitute lot instead; records
 * both lots and the reason. A lot of a different material is refused even with this permission.
 */
export async function approveMaterialSubstitution(ctx: AuthContext, input: SubstitutionInput) {
  ctx.require("production.material_substitution.approve");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Give the reason for the substitution (at least 5 characters).", { field: "reason" });
  const lotNumber = scanValue(input.substituteLotCode, "LOT", "substitute lot");
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.material_substitution.approve", async () => {
      if (b.status !== "planned") throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; substitutions at staging apply to planned batches.`);
      const wo = await loadWorkOrderForBatch(tx, b);
      const [line] = await tx
        .select({ bm: batchMaterials, material: materials })
        .from(batchMaterials)
        .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
        .where(and(eq(batchMaterials.id, input.batchMaterialId), eq(batchMaterials.batchId, b.id)))
        .limit(1);
      if (!line) throw new DomainError("not_found", "Ingredient line not found on this batch.");
      const [found] = await tx
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.siteId, b.siteId), eq(inventoryLots.lotNumber, lotNumber)))
        .limit(1);
      if (!found) throw new DomainError("not_found", `Lot ${lotNumber} was not found at this site.`, { field: "substituteLotCode" });
      const lockIds = [found.id, ...(input.expectedLotId ? [input.expectedLotId] : [])];
      const locked = await lockLots(tx, lockIds);
      const lot = locked.find((l) => l.id === found.id)!;
      if (lot.itemKind !== "material" || lot.materialId !== line.material.id) {
        throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is not ${line.material.name}. A substitution must be the same material; a different material is never allowed.`, { rule: "V-MAT", field: "substituteLotCode" });
      }
      assertLotUsable(lot);
      const staged = (await stagedTotals(tx, b.id)).get(line.bm.id) ?? new Decimal(0);
      const need = Decimal.max(new Decimal(line.bm.theoreticalQtyG).minus(staged), 0);
      if (need.lte(0)) throw new DomainError("state", `${line.material.name} is already fully staged.`);

      const req: MaterialRequirement = { materialId: line.material.id, materialCode: line.material.code, materialName: line.material.name, materialKind: line.material.materialKind, baseUom: line.material.baseUom, required: need };
      const kinds = await stagingKinds(tx, ctx.organizationId, b.siteId);
      const { candidates } = await workOrderCandidates(tx, wo, req, kinds);
      const atLot = candidates.filter((c) => c.lotId === lot.id && (!input.substituteLocationId || c.locationId === input.substituteLocationId));
      const usable = atLot.find((c) => c.eligible && new Decimal(c.available).gte(need));
      if (!usable) {
        const why = atLot.find((c) => c.reason)?.reason ?? (atLot.length ? `only ${atLot.map((c) => c.available).join(" + ")} ${lot.baseUom} free` : "no stock in a storage location");
        throw new DomainError("insufficient_stock", `Lot ${lot.lotNumber} cannot cover ${need.toString()} ${lot.baseUom}: ${why}.`, { field: "substituteLotCode" });
      }
      if (input.expectedLotId === lot.id) throw new DomainError("validation", "The substitute must be a different lot from the expected one.");

      // End the expected lot's reservation for the quantity now covered by the substitute.
      const expected = (await expectedLots(tx, wo.id, line.material.id)).filter((x) => x.r.lotId !== lot.id && (!input.expectedLotId || x.r.lotId === input.expectedLotId));
      await convertReservations(tx, ctx, expected.map((x) => x.r), need, `Substituted by lot ${lot.lotNumber} (QA): ${reason}`, "released");

      const number = await nextNumber(tx, ctx.organizationId, "RSV");
      const [rsv] = await tx
        .insert(stockReservations)
        .values({
          organizationId: b.organizationId,
          siteId: b.siteId,
          reservationNumber: number,
          lotId: lot.id,
          locationId: usable.locationId,
          qtyBase: need.toString(),
          baseUom: lot.baseUom,
          demandType: "work_order",
          demandId: wo.id,
          demandReference: `${wo.workOrderNumber} · ${line.material.code} (substitution)`,
          status: "active",
          expiresAt: expected[0]?.r.expiresAt ?? sql`now() + interval '7 days'`,
          createdBy: ctx.userId,
        })
        .returning();
      const expectedLotId = input.expectedLotId ?? expected[0]?.r.lotId ?? null;
      const [sub] = await tx
        .insert(batchMaterialSubstitutions)
        .values({
          organizationId: b.organizationId,
          siteId: b.siteId,
          batchId: b.id,
          batchMaterialId: line.bm.id,
          workOrderId: wo.id,
          materialId: line.material.id,
          expectedLotId,
          substituteLotId: lot.id,
          substituteLocationId: usable.locationId,
          qtyBase: need.toString(),
          reason,
          newReservationId: rsv.id,
          approvedBy: ctx.userId,
        })
        .returning();
      const expectedNumbers = [...new Set(expected.map((x) => x.lotNumber))];
      await audit(tx, ctx, {
        action: "production.dispense_record.material_substituted",
        entityType: "batch",
        entityId: b.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        reason,
        before: { expectedLots: expectedNumbers },
        after: { substitutionId: sub.id, material: line.material.code, substituteLot: lot.lotNumber, location: usable.locationCode, qty: need.toString(), reservation: number },
      });
      return { substitutionId: sub.id, lotNumber: lot.lotNumber, locationCode: usable.locationCode, qty: need.toString(), expectedLots: expectedNumbers };
    });
    return result;
  });
}

/**
 * Ends the staging reservations of a batch (demand_type = 'batch'), e.g. when execution has
 * consumed the staged stock or the batch is closed. For W2B (execution) and W2D (closure).
 */
export async function releaseBatchStagingReservations(tx: Tx, ctx: AuthContext, batchId: string, reason: string) {
  return endReservationsForDemand(tx, ctx, "batch", batchId, "released", reason);
}

/** Everything the staging screen, the dispensing sheet and the traveler need for one batch. */
export async function getStagingView(ctx: AuthContext, batchId: string) {
  requireStagingAccess(ctx);
  const [row] = await db
    .select({ b: batches, productName: products.name, productSku: products.skuCode })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found in your sites.");
  ctx.requireSite(row.b.siteId);
  const b = row.b;
  const [wo] = b.workOrderId ? await db.select().from(workOrders).where(eq(workOrders.id, b.workOrderId)).limit(1) : [];
  const lines = await db
    .select({ bm: batchMaterials, material: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, b.id))
    .orderBy(asc(batchMaterials.lineNo));
  const stagings = await db
    .select({ s: batchMaterialStagings, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, by: users.displayName })
    .from(batchMaterialStagings)
    .innerJoin(inventoryLots, eq(inventoryLots.id, batchMaterialStagings.lotId))
    .innerJoin(users, eq(users.id, batchMaterialStagings.stagedBy))
    .where(eq(batchMaterialStagings.batchId, b.id))
    .orderBy(asc(batchMaterialStagings.stagedAt));
  const subs = await db
    .select({ s: batchMaterialSubstitutions, lotNumber: inventoryLots.lotNumber, by: users.displayName })
    .from(batchMaterialSubstitutions)
    .innerJoin(inventoryLots, eq(inventoryLots.id, batchMaterialSubstitutions.substituteLotId))
    .innerJoin(users, eq(users.id, batchMaterialSubstitutions.approvedBy))
    .where(eq(batchMaterialSubstitutions.batchId, b.id));
  const locIds = [...new Set(stagings.flatMap((x) => [x.s.fromLocationId, x.s.toLocationId]))];
  const locs = locIds.length ? await db.select({ id: locations.id, code: locations.code }).from(locations).where(inArray(locations.id, locIds)) : [];
  const code = (id: string) => locs.find((l) => l.id === id)?.code ?? "?";
  const kinds = await getSetting(db, ctx.organizationId, "production.staging.location_kinds", b.siteId);
  const stagingLocations = await db
    .select({ id: locations.id, code: locations.code, name: locations.name })
    .from(locations)
    .where(and(eq(locations.siteId, b.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
    .orderBy(asc(locations.code));

  const out = [];
  for (const l of lines) {
    const st = stagings.filter((x) => x.s.batchMaterialId === l.bm.id);
    const stagedQty = st.reduce((a, x) => a.plus(x.s.qtyBase), new Decimal(0));
    const exp = wo ? await expectedLots(db, wo.id, l.material.id) : [];
    out.push({
      batchMaterialId: l.bm.id,
      lineNo: l.bm.lineNo,
      materialId: l.material.id,
      materialCode: l.material.code,
      materialName: l.material.name,
      baseUom: l.material.baseUom,
      theoreticalQtyG: l.bm.theoreticalQtyG,
      tolerancePct: l.bm.tolerancePct,
      toleranceAbsG: l.bm.toleranceAbsG,
      staged: stagedQty.toString(),
      remaining: Decimal.max(new Decimal(l.bm.theoreticalQtyG).minus(stagedQty), 0).toString(),
      isStaged: stagedQty.gte(l.bm.theoreticalQtyG),
      expected: exp.map((x) => ({ reservationNumber: x.r.reservationNumber, lotId: x.r.lotId, lotNumber: x.lotNumber, expiresOn: x.expiresOn, locationId: x.r.locationId, locationCode: x.locationCode, qty: x.r.qtyBase })),
      stagings: st.map((x) => ({ id: x.s.id, lotNumber: x.lotNumber, expiresOn: x.expiresOn, qty: x.s.qtyBase, from: code(x.s.fromLocationId), to: code(x.s.toLocationId), by: x.by, at: x.s.stagedAt })),
      substitutions: subs.filter((x) => x.s.batchMaterialId === l.bm.id).map((x) => ({ lotNumber: x.lotNumber, reason: x.s.reason, by: x.by, at: x.s.approvedAt, qty: x.s.qtyBase })),
    });
  }
  return {
    batch: b,
    productName: row.productName,
    productSku: row.productSku,
    workOrder: wo ?? null,
    lines: out,
    allStaged: out.length > 0 && out.every((l) => l.isStaged),
    stagingLocations,
    canStage: ctx.can("inventory.movement.post") && b.status === "planned" && !!wo && STAGEABLE_WO.includes(wo.status),
    canSubstitute: ctx.can("production.material_substitution.approve") && b.status === "planned",
  };
}
export type StagingView = Awaited<ReturnType<typeof getStagingView>>;

/** Planned work-order batches of the current site whose materials can be staged now (staging queue). */
export async function listBatchesToStage(ctx: AuthContext) {
  requireStagingAccess(ctx);
  ctx.requireSite(ctx.currentSiteId);
  return db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      plannedStartOn: batches.plannedStartOn,
      plannedSizeG: batches.plannedSizeG,
      productName: products.name,
      workOrderNumber: workOrders.workOrderNumber,
      workOrderStatus: workOrders.status,
      lines: sql<number>`(select count(*)::int from ${batchMaterials} where ${batchMaterials.batchId} = ${batches.id})`,
      linesStaged: sql<number>`(select count(*)::int from batch_materials bm where bm.batch_id = ${batches.id} and coalesce((select sum(s.qty_base) from batch_material_stagings s where s.batch_material_id = bm.id), 0) >= bm.theoretical_qty_g)`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .innerJoin(workOrders, eq(workOrders.id, batches.workOrderId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, ctx.currentSiteId), inArray(batches.status, ["planned", "materials_staged"])))
    .orderBy(asc(batches.plannedStartOn), asc(batches.batchNumber));
}

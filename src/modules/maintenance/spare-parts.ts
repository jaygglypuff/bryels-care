import "server-only";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { equipment, inventoryBalances, inventoryLots, locations, maintenanceSpareParts, maintenanceWorkOrderParts, maintenanceWorkOrders, materials, sites } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertLotUsable, postMovement } from "@/modules/inventory";
import { IssuePartInput, SparePartInput, parse } from "./schemas";
import { equipmentInScope } from "./shared";

/**
 * Spare parts (US-6-19): ordinary materials and lots (received, held and released like any material),
 * listed per site, optionally for one piece of equipment, with an optional minimum stock. Issuing a part to
 * a maintenance work order posts one `issue` stock movement through `postMovement` (source document
 * maintenance_work_order, idempotency key, lot row lock, no negative stock) and records the part line in
 * the same transaction. Only released, unexpired lots can be issued (the normal V-HOLD / V-EXP / V-REC rule).
 */

export async function registerSparePart(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.spare_part.edit");
  const input = parse(SparePartInput, raw);
  ctx.requireAt("maintenance.spare_part.edit", input.siteId);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
    if (!m) throw new DomainError("validation", "Choose a material.", { field: "materialId", fieldErrors: { materialId: "Not found." } });
    if (input.equipmentId) {
      const e = await equipmentInScope(tx, ctx, input.equipmentId);
      if (e.siteId !== input.siteId) throw new DomainError("validation", "The equipment is at another site.", { field: "equipmentId", fieldErrors: { equipmentId: "Another site." } });
    }
    const [dup] = await tx
      .select({ id: maintenanceSpareParts.id })
      .from(maintenanceSpareParts)
      .where(and(eq(maintenanceSpareParts.siteId, input.siteId), eq(maintenanceSpareParts.materialId, m.id), input.equipmentId ? eq(maintenanceSpareParts.equipmentId, input.equipmentId) : isNull(maintenanceSpareParts.equipmentId)))
      .limit(1);
    if (dup) {
      await tx.update(maintenanceSpareParts).set({ minQtyBase: input.minQty, note: input.note, isActive: true }).where(eq(maintenanceSpareParts.id, dup.id));
      await audit(tx, ctx, { action: "maintenance.spare_part.updated", entityType: "maintenance_spare_part", entityId: dup.id, entityNumber: m.code, siteId: input.siteId, after: { minQty: input.minQty, note: input.note } });
      return { sparePartId: dup.id, created: false };
    }
    const [r] = await tx.insert(maintenanceSpareParts).values({ organizationId: ctx.organizationId, siteId: input.siteId, materialId: m.id, equipmentId: input.equipmentId, minQtyBase: input.minQty, note: input.note, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "maintenance.spare_part.created", entityType: "maintenance_spare_part", entityId: r.id, entityNumber: m.code, siteId: input.siteId, after: { material: m.code, equipmentId: input.equipmentId, minQty: input.minQty } });
    return { sparePartId: r.id, created: true };
  });
}

export async function removeSparePart(ctx: AuthContext, input: { sparePartId: string }) {
  ctx.require("maintenance.spare_part.edit");
  if (!/^[0-9a-f-]{36}$/i.test(input.sparePartId ?? "")) throw new DomainError("not_found", "Spare part not found in your sites.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(maintenanceSpareParts).where(and(eq(maintenanceSpareParts.id, input.sparePartId), eq(maintenanceSpareParts.organizationId, ctx.organizationId))).limit(1);
    if (!r || !ctx.allowedSiteIds.includes(r.siteId)) throw new DomainError("not_found", "Spare part not found in your sites.");
    ctx.requireAt("maintenance.spare_part.edit", r.siteId);
    await tx.update(maintenanceSpareParts).set({ isActive: false }).where(eq(maintenanceSpareParts.id, r.id));
    await audit(tx, ctx, { action: "maintenance.spare_part.removed", entityType: "maintenance_spare_part", entityId: r.id, siteId: r.siteId });
    return { removed: true };
  });
}

/** Spare parts at the caller's sites with released stock on hand and the below-minimum flag. */
export async function listSpareParts(ctx: AuthContext, f: { siteId?: string; equipmentId?: string } = {}) {
  ctx.require("maintenance.spare_part.view");
  if (f.siteId) ctx.requireSite(f.siteId);
  const siteIds = f.siteId ? [f.siteId] : ctx.allowedSiteIds;
  const rows = await db
    .select({ s: maintenanceSpareParts, materialCode: materials.code, materialName: materials.name, baseUom: materials.baseUom, equipmentCode: equipment.code, siteCode: sites.code })
    .from(maintenanceSpareParts)
    .innerJoin(materials, eq(materials.id, maintenanceSpareParts.materialId))
    .innerJoin(sites, eq(sites.id, maintenanceSpareParts.siteId))
    .leftJoin(equipment, eq(equipment.id, maintenanceSpareParts.equipmentId))
    .where(
      and(
        eq(maintenanceSpareParts.organizationId, ctx.organizationId),
        inArray(maintenanceSpareParts.siteId, siteIds),
        eq(maintenanceSpareParts.isActive, true),
        f.equipmentId ? or(eq(maintenanceSpareParts.equipmentId, f.equipmentId), isNull(maintenanceSpareParts.equipmentId)) : undefined,
      ),
    )
    .orderBy(asc(sites.code), asc(materials.code));
  const stock = rows.length
    ? await db
        .select({ siteId: inventoryLots.siteId, materialId: inventoryLots.materialId, qty: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text` })
        .from(inventoryBalances)
        .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
        .where(and(inArray(inventoryLots.materialId, rows.map((r) => r.s.materialId)), inArray(inventoryLots.siteId, siteIds), eq(inventoryLots.qualityStatus, "released"), gt(inventoryBalances.qtyBase, "0")))
        .groupBy(inventoryLots.siteId, inventoryLots.materialId)
    : [];
  return rows.map((r) => {
    const onHand = new Decimal(stock.find((x) => x.siteId === r.s.siteId && x.materialId === r.s.materialId)?.qty ?? 0);
    return { ...r.s, materialCode: r.materialCode, materialName: r.materialName, baseUom: r.baseUom, equipmentCode: r.equipmentCode, siteCode: r.siteCode, onHand: onHand.toString(), belowMin: r.s.minQtyBase !== null && onHand.lt(r.s.minQtyBase) };
  });
}

/** Released lots and locations of the spare parts that can be issued to a work order (picker). */
export async function issuablePartStock(ctx: AuthContext, workOrderId: string) {
  ctx.require("maintenance.work_order.post");
  if (!/^[0-9a-f-]{36}$/i.test(workOrderId)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
  const [w] = await db.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.id, workOrderId), eq(maintenanceWorkOrders.organizationId, ctx.organizationId))).limit(1);
  if (!w || !ctx.allowedSiteIds.includes(w.siteId)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
  const parts = await db
    .select({ materialId: maintenanceSpareParts.materialId })
    .from(maintenanceSpareParts)
    .where(and(eq(maintenanceSpareParts.siteId, w.siteId), eq(maintenanceSpareParts.isActive, true), or(isNull(maintenanceSpareParts.equipmentId), eq(maintenanceSpareParts.equipmentId, w.equipmentId))));
  if (!parts.length) return [];
  return db
    .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, materialCode: materials.code, materialName: materials.name, uom: inventoryLots.baseUom, locationId: locations.id, locationCode: locations.code, qty: inventoryBalances.qtyBase, expiresOn: inventoryLots.expiresOn })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(materials, eq(materials.id, inventoryLots.materialId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(inArray(inventoryLots.materialId, [...new Set(parts.map((p) => p.materialId))]), eq(inventoryLots.siteId, w.siteId), eq(inventoryLots.qualityStatus, "released"), gt(inventoryBalances.qtyBase, "0")))
    .orderBy(asc(materials.code), asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber));
}

/**
 * Issues a spare part to a work order in progress or on hold (maintenance.work_order.post): the material
 * must be on the site's spare-parts list (general or for this equipment); one `issue` movement per call.
 */
export async function issueSparePart(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.work_order.post");
  const input = parse(IssuePartInput, raw);
  const qty = new Decimal(input.qty);
  if (qty.lte(0)) throw new DomainError("validation", "Enter a quantity greater than zero.", { field: "qty", fieldErrors: { qty: "More than 0." } });
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.id, input.workOrderId), eq(maintenanceWorkOrders.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!w || !ctx.allowedSiteIds.includes(w.siteId)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
    ctx.requireAt("maintenance.work_order.post", w.siteId);
    const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!lot || lot.siteId !== w.siteId) throw new DomainError("validation", "Choose a lot at the work order's site.", { field: "lotId", fieldErrors: { lotId: "Not at this site." } });
    if (lot.itemKind !== "material" || !lot.materialId) throw new DomainError("validation", "Spare parts are material lots.", { field: "lotId" });
    const { movement, replayed } = await (async () => {
      if (!["in_progress", "on_hold"].includes(w.status)) {
        throw new DomainError("state", `Work order ${w.workOrderNumber} is ${w.status.replace(/_/g, " ")}; parts are issued while the work is in progress or on hold.`);
      }
      const [listed] = await tx
        .select({ id: maintenanceSpareParts.id })
        .from(maintenanceSpareParts)
        .where(and(eq(maintenanceSpareParts.siteId, w.siteId), eq(maintenanceSpareParts.materialId, lot.materialId!), eq(maintenanceSpareParts.isActive, true), or(isNull(maintenanceSpareParts.equipmentId), eq(maintenanceSpareParts.equipmentId, w.equipmentId))))
        .limit(1);
      if (!listed) throw new DomainError("validation", "This material is not on the site's spare-parts list. Add it to the list first.", { field: "lotId", fieldErrors: { lotId: "Not a listed spare part." } });
      assertLotUsable(lot);
      return postMovement(tx, ctx, {
        movementType: "issue",
        lotId: lot.id,
        fromLocationId: input.fromLocationId,
        qtyBase: qty.toString(),
        sourceDocumentType: "maintenance_work_order",
        sourceDocumentId: w.id,
        sourceDocumentNumber: w.workOrderNumber,
        reason: "maintenance spare part",
        idempotencyKey: input.idempotencyKey,
        meta: { workOrder: w.workOrderNumber, equipmentId: w.equipmentId },
      });
    })();
    // Replay: postMovement returned the movement of the same key; return the part line already recorded.
    if (replayed) {
      const [existing] = await tx.select().from(maintenanceWorkOrderParts).where(eq(maintenanceWorkOrderParts.stockMovementId, movement.id)).limit(1);
      if (existing) return { partId: existing.id, movementId: movement.id, replayed: true };
    }
    const [part] = await tx
      .insert(maintenanceWorkOrderParts)
      .values({ organizationId: ctx.organizationId, siteId: w.siteId, workOrderId: w.id, materialId: lot.materialId!, lotId: lot.id, fromLocationId: input.fromLocationId, qtyBase: qty.toString(), uomBase: lot.baseUom, stockMovementId: movement.id, issuedBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "maintenance.work_order.part_issued", entityType: "maintenance_work_order", entityId: w.id, entityNumber: w.workOrderNumber, siteId: w.siteId, after: { partId: part.id, lot: lot.lotNumber, qty: qty.toString(), uom: lot.baseUom, movementId: movement.id } });
    return { partId: part.id, movementId: movement.id, replayed: false };
  });
}

import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  equipment,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  stockCountCounters,
  stockCountScopes,
  stockCounts,
  stockReservations,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import type { ReferenceBatch, ReferenceCount, ReferenceLocation, ReferenceLot, ReferenceMaterial, ReferencePayload } from "../protocol";
import { findDeviceByKey, touchDevice } from "./devices";

/** Bounded so a phone never downloads an unbounded table (A-OFF-07 retention is device-side). */
const MAX_LOTS = 3000;
const MAX_MATERIALS = 2000;

type Snap = { steps?: { stepNo: number; name: string; stepKind: string; requiresEquipment?: boolean; equipmentKind?: string | null }[] };
const WEIGHING = ["dispensing", "weighing"];

/**
 * Reference data for the device cache (US-7-01, docs/offline-sync.md §7, data-model §11.5). One site
 * per call, each section only when the caller holds its permission at that site. DTO allow-list: the
 * selected columns are the whole payload; no prices, costs, payroll or personal data are ever
 * included (`offline.no_sensitive_cache`). Full refresh on every call: the master tables have no
 * change cursor yet (A-W4D-04), and the volumes per site are small.
 */
export async function buildReference(ctx: AuthContext, siteId: string, deviceKey: string | null = null): Promise<ReferencePayload> {
  ctx.requireSite(siteId);
  const now = new Date();
  const can = (p: Parameters<AuthContext["canAt"]>[0]) => ctx.canAt(p, siteId);

  const materialsOut: ReferenceMaterial[] | null = can("masterdata.material.view") || can("inventory.lot.view")
    ? (
        await db
          .select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom, materialKind: materials.materialKind })
          .from(materials)
          .where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.status, "active")))
          .orderBy(asc(materials.code))
          .limit(MAX_MATERIALS)
      )
    : null;

  const locationsOut: ReferenceLocation[] | null = can("masterdata.location.view") || can("inventory.lot.view")
    ? await db
        .select({ id: locations.id, siteId: locations.siteId, code: locations.code, name: locations.name, kind: locations.kind, isActive: locations.isActive })
        .from(locations)
        .where(eq(locations.siteId, siteId))
        .orderBy(asc(locations.code))
    : null;

  let lotsOut: ReferenceLot[] | null = null;
  if (can("inventory.lot.view")) {
    const rows = await db
      .select({
        id: inventoryLots.id,
        siteId: inventoryLots.siteId,
        lotNumber: inventoryLots.lotNumber,
        itemKind: inventoryLots.itemKind,
        materialId: inventoryLots.materialId,
        itemCode: sql<string | null>`coalesce(${materials.code}, ${products.skuCode})`,
        itemName: sql<string | null>`coalesce(${materials.name}, ${products.name})`,
        qualityStatus: inventoryLots.qualityStatus,
        expiresOn: inventoryLots.expiresOn,
        baseUom: inventoryLots.baseUom,
      })
      .from(inventoryLots)
      .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
      .leftJoin(products, eq(products.id, inventoryLots.productId))
      .where(
        and(
          eq(inventoryLots.organizationId, ctx.organizationId),
          eq(inventoryLots.siteId, siteId),
          sql`exists (select 1 from ${inventoryBalances} b where b.lot_id = ${inventoryLots.id} and b.qty_base > 0)`,
        ),
      )
      .orderBy(asc(inventoryLots.lotNumber))
      .limit(MAX_LOTS);
    const ids = rows.map((r) => r.id);
    const bal = ids.length
      ? await db
          .select({ lotId: inventoryBalances.lotId, locationId: inventoryBalances.locationId, qty: inventoryBalances.qtyBase })
          .from(inventoryBalances)
          .where(and(inArray(inventoryBalances.lotId, ids), gt(inventoryBalances.qtyBase, "0")))
      : [];
    const byLot = new Map<string, { locationId: string; qty: string }[]>();
    for (const b of bal) byLot.set(b.lotId, [...(byLot.get(b.lotId) ?? []), { locationId: b.locationId, qty: b.qty }]);
    lotsOut = rows.map((r) => ({ ...r, expiresOn: r.expiresOn ? String(r.expiresOn) : null, balances: byLot.get(r.id) ?? [] }));
  }

  let countsOut: ReferenceCount[] | null = null;
  if (can("inventory.stock_count.submit")) {
    const open = await db
      .select({ id: stockCounts.id, siteId: stockCounts.siteId, countNumber: stockCounts.countNumber, status: stockCounts.status, isBlind: stockCounts.isBlind })
      .from(stockCounts)
      .where(and(eq(stockCounts.organizationId, ctx.organizationId), eq(stockCounts.siteId, siteId), eq(stockCounts.status, "in_progress")))
      .orderBy(asc(stockCounts.countNumber));
    const countIds = open.map((c) => c.id);
    const counters = countIds.length ? await db.select().from(stockCountCounters).where(inArray(stockCountCounters.stockCountId, countIds)) : [];
    const scopes = countIds.length ? await db.select().from(stockCountScopes).where(inArray(stockCountScopes.stockCountId, countIds)) : [];
    countsOut = open
      .filter((c) => {
        const assigned = counters.filter((x) => x.stockCountId === c.id);
        return assigned.length === 0 || assigned.some((x) => x.userId === ctx.userId);
      })
      .map((c) => ({ ...c, locationIds: scopes.filter((s) => s.stockCountId === c.id).map((s) => s.locationId) }));
  }

  let batchesOut: ReferenceBatch[] | null = null;
  if (can("production.dispense_record.create")) {
    const bs = await db
      .select({ id: batches.id, siteId: batches.siteId, batchNumber: batches.batchNumber, status: batches.status, productName: products.name, snap: batches.formulaSnapshot })
      .from(batches)
      .innerJoin(products, eq(products.id, batches.productId))
      .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, siteId), inArray(batches.status, ["materials_staged", "in_process"])))
      .orderBy(asc(batches.batchNumber))
      .limit(50);
    const batchIds = bs.map((b) => b.id);
    const lines = batchIds.length
      ? await db
          .select({ bm: batchMaterials, code: materials.code, name: materials.name, baseUom: materials.baseUom })
          .from(batchMaterials)
          .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
          .where(inArray(batchMaterials.batchId, batchIds))
          .orderBy(asc(batchMaterials.lineNo))
      : [];
    const reserved = batchIds.length
      ? await db
          .selectDistinct({ batchId: stockReservations.demandId, lotId: stockReservations.lotId, materialId: inventoryLots.materialId })
          .from(stockReservations)
          .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
          .where(and(eq(stockReservations.demandType, "batch"), inArray(stockReservations.demandId, batchIds), eq(stockReservations.status, "active")))
      : [];
    const scales = await db
      .select({ id: equipment.id, code: equipment.code, name: equipment.name, kind: equipment.equipmentKind })
      .from(equipment)
      .where(and(eq(equipment.siteId, siteId), eq(equipment.status, "in_service")))
      .orderBy(asc(equipment.code));
    batchesOut = bs.map((b) => {
      const step = [...((b.snap as Snap).steps ?? [])].sort((x, y) => x.stepNo - y.stepNo).find((s) => WEIGHING.includes(s.stepKind));
      return {
        id: b.id,
        siteId: b.siteId,
        batchNumber: b.batchNumber,
        status: b.status,
        productName: b.productName,
        weighing: step ? { stepNo: step.stepNo, name: step.name, requiresEquipment: !!step.requiresEquipment, equipmentKind: step.equipmentKind ?? null } : null,
        lines: lines
          .filter((l) => l.bm.batchId === b.id)
          .map((l) => ({
            id: l.bm.id,
            lineNo: l.bm.lineNo,
            materialId: l.bm.materialId,
            materialCode: l.code,
            materialName: l.name,
            baseUom: l.baseUom,
            theoreticalQtyG: l.bm.theoreticalQtyG,
            tolerancePct: l.bm.tolerancePct,
            toleranceAbsG: l.bm.toleranceAbsG,
            dispensedQtyG: l.bm.dispensedQtyG,
            status: l.bm.status,
            reservedLotIds: reserved.filter((r) => r.batchId === b.id && r.materialId === l.bm.materialId).map((r) => r.lotId),
          })),
        scales: scales.filter((s) => !step?.equipmentKind || s.kind === step.equipmentKind).map(({ id, code, name }) => ({ id, code, name })),
      };
    });
  }

  const device = await findDeviceByKey(ctx.organizationId, deviceKey);
  if (device && device.status === "active" && device.siteId === siteId) await touchDevice(device.id, { referenceRefreshed: true });
  return { siteId, generatedAt: now.toISOString(), full: true, cursor: now.toISOString(), materials: materialsOut, locations: locationsOut, lots: lotsOut, counts: countsOut, batches: batchesOut };
}

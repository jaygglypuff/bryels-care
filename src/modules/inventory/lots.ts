import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  batches,
  goodsReceiptLines,
  goodsReceipts,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  stockMovements,
  users,
  warehouses,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { daysUntil } from "@/lib/qty";

export const LOT_STATUSES = ["quarantine", "released", "on_hold", "rejected", "expired", "recalled"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

/** Expiry warning window shown amber in lists (assumption A-INV-MVP-01, configurable later). */
export const EXPIRY_WARN_DAYS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** Today's date in Manila as YYYY-MM-DD, used for expiry comparisons in SQL. */
const TODAY_SQL = sql`(now() at time zone 'Asia/Manila')::date`;

/** True when the expiry date has passed (the lot is unusable whatever its stored status). */
export function isPastExpiry(expiresOn: string | null): boolean {
  const d = daysUntil(expiresOn);
  return d !== null && d < 0;
}

/**
 * Location kinds a lot may be moved to (MVP rule, assumption A-INV-MVP-02):
 * - released and in date: storage, production, shipping, quarantine, hold
 * - quarantine / on hold: only quarantine-type locations (quarantine, hold) until QA decides
 * - rejected, recalled, expired (by status or by date): quarantine, hold or the rejected cage
 */
export function allowedDestinationKinds(status: string, expiresOn: string | null): string[] {
  const expired = status === "expired" || isPastExpiry(expiresOn);
  if (status === "released" && !expired) return ["storage", "production", "shipping", "quarantine", "hold"];
  if (status === "quarantine" || status === "on_hold") return ["quarantine", "hold"];
  return ["quarantine", "hold", "rejected"];
}

export type LotFilter = { q?: string; kind?: "material" | "product"; status?: string; locationId?: string; includeEmpty?: boolean };

/** Lots of the current site with on-hand totals, in FEFO order (earliest expiry first). */
export async function listLots(ctx: AuthContext, f: LotFilter = {}) {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);

  const conds: SQL[] = [eq(inventoryLots.siteId, ctx.currentSiteId)];
  if (f.kind) conds.push(eq(inventoryLots.itemKind, f.kind));
  if (f.status === "expired") {
    conds.push(or(eq(inventoryLots.qualityStatus, "expired"), sql`${inventoryLots.expiresOn} < ${TODAY_SQL}`)!);
  } else if (f.status === "expiring") {
    conds.push(sql`${inventoryLots.expiresOn} between ${TODAY_SQL} and ${TODAY_SQL} + ${EXPIRY_WARN_DAYS}::int`);
  } else if (f.status && (LOT_STATUSES as readonly string[]).includes(f.status)) {
    conds.push(eq(inventoryLots.qualityStatus, f.status));
  }
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(
      or(
        ilike(inventoryLots.lotNumber, like),
        ilike(inventoryLots.supplierLotNumber, like),
        ilike(inventoryLots.supplierName, like),
        ilike(inventoryLots.brand, like),
        ilike(materials.code, like),
        ilike(materials.name, like),
        ilike(products.skuCode, like),
        ilike(products.name, like),
      )!,
    );
  }
  if (f.locationId && isUuid(f.locationId)) {
    conds.push(
      sql`exists (select 1 from ${inventoryBalances} b2 where b2.lot_id = ${inventoryLots.id} and b2.location_id = ${f.locationId} and b2.qty_base > 0)`,
    );
  }

  const onHand = sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text`;
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      itemKind: inventoryLots.itemKind,
      qualityStatus: inventoryLots.qualityStatus,
      supplierName: inventoryLots.supplierName,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      brand: inventoryLots.brand,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      onHand,
      locationCodes: sql<string | null>`string_agg(${locations.code}, ', ' order by ${locations.code})`,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(inventoryBalances, and(eq(inventoryBalances.lotId, inventoryLots.id), gt(inventoryBalances.qtyBase, "0")))
    .leftJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(...conds))
    .groupBy(inventoryLots.id, materials.id, products.id)
    .having(f.includeEmpty ? undefined : sql`coalesce(sum(${inventoryBalances.qtyBase}), 0) > 0`)
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber))
    .limit(500);
  return rows;
}

/** KPI strip for the current site: counts of lots that still hold stock. */
/** Stock warning counts at the current site; `kind` limits them to materials or finished products (ADR-081 stock tabs). */
export async function lotKpis(ctx: AuthContext, opts: { kind?: "material" | "product" } = {}) {
  ctx.require("inventory.lot.view");
  const rows = await db.execute<{ quarantined: string; on_hold: string; expiring: string; expired: string }>(sql`
    with s as (
      select l.id, l.quality_status, l.expires_on
      from ${inventoryLots} l
      join ${inventoryBalances} b on b.lot_id = l.id
      where l.site_id = ${ctx.currentSiteId} ${opts.kind ? sql`and l.item_kind = ${opts.kind}` : sql``}
      group by l.id
      having sum(b.qty_base) > 0
    )
    select
      count(*) filter (where quality_status = 'quarantine')::text as quarantined,
      count(*) filter (where quality_status = 'on_hold')::text as on_hold,
      count(*) filter (where quality_status not in ('expired','rejected','recalled') and expires_on between ${TODAY_SQL} and ${TODAY_SQL} + ${EXPIRY_WARN_DAYS}::int)::text as expiring,
      count(*) filter (where quality_status = 'expired' or expires_on < ${TODAY_SQL})::text as expired
    from s`);
  const r = rows[0];
  return { quarantined: Number(r.quarantined), onHold: Number(r.on_hold), expiring: Number(r.expiring), expired: Number(r.expired) };
}

const fromLoc = alias(locations, "from_loc");
const toLoc = alias(locations, "to_loc");

/** Lot detail within the user's allowed sites; anything else is "not found" (never leaks the site). */
export async function getLotDetail(ctx: AuthContext, lotId: string) {
  ctx.require("inventory.lot.view");
  if (!isUuid(lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  const [row] = await db
    .select({
      lot: inventoryLots,
      materialCode: materials.code,
      materialName: materials.name,
      inciName: materials.inciName,
      storageConditions: materials.storageConditions,
      productSku: products.skuCode,
      productName: products.name,
      batchNumber: batches.batchNumber,
      createdByName: users.displayName,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(batches, eq(batches.id, inventoryLots.sourceBatchId))
    .leftJoin(users, eq(users.id, inventoryLots.createdBy))
    .where(and(eq(inventoryLots.id, lotId), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Lot not found in your sites.");
  ctx.requireSite(row.lot.siteId);

  const balances = await db
    .select({
      locationId: locations.id,
      code: locations.code,
      name: locations.name,
      kind: locations.kind,
      warehouseCode: warehouses.code,
      qtyBase: inventoryBalances.qtyBase,
    })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(and(eq(inventoryBalances.lotId, lotId), gt(inventoryBalances.qtyBase, "0")))
    .orderBy(asc(locations.code));

  const movements = await db
    .select({
      id: stockMovements.id,
      movementType: stockMovements.movementType,
      qtyBase: stockMovements.qtyBase,
      baseUom: stockMovements.baseUom,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
      fromName: fromLoc.name,
      toName: toLoc.name,
      sourceDocumentType: stockMovements.sourceDocumentType,
      sourceDocumentId: stockMovements.sourceDocumentId,
      sourceDocumentNumber: stockMovements.sourceDocumentNumber,
      reason: stockMovements.reason,
      postedAt: stockMovements.postedAt,
      postedBy: users.displayName,
    })
    .from(stockMovements)
    .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
    .innerJoin(users, eq(users.id, stockMovements.postedBy))
    .where(eq(stockMovements.lotId, lotId))
    .orderBy(desc(stockMovements.postedAt));

  const [receipt] = await db
    .select({ id: goodsReceipts.id, number: goodsReceipts.receiptNumber, receivedAt: goodsReceipts.receivedAt, supplierDocumentNumber: goodsReceipts.supplierDocumentNumber })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .where(eq(goodsReceiptLines.lotId, lotId))
    .limit(1);

  return {
    ...row.lot,
    itemCode: row.materialCode ?? row.productSku ?? "",
    itemName: row.materialName ?? row.productName ?? "",
    inciName: row.inciName,
    storageConditions: row.storageConditions,
    batchNumber: row.batchNumber,
    createdByName: row.createdByName,
    receipt: receipt ?? null,
    balances,
    movements,
  };
}

export type LotDetail = Awaited<ReturnType<typeof getLotDetail>>;

/** Active locations of the lot's site the lot may be moved to under allowedDestinationKinds. */
export async function moveDestinations(ctx: AuthContext, lot: { siteId: string; qualityStatus: string; expiresOn: string | null }) {
  ctx.requireSite(lot.siteId);
  const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
  return db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, lot.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
    .orderBy(asc(locations.code));
}

/** A location of the current site (for the "lots at location" filter), or null. */
export async function getCurrentSiteLocation(ctx: AuthContext, locationId: string | undefined) {
  ctx.require("inventory.lot.view");
  if (!locationId || !isUuid(locationId)) return null;
  const [loc] = await db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.siteId, ctx.currentSiteId))).limit(1);
  return loc ?? null;
}

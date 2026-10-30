import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { containerContents, containers, inventoryBalances, inventoryLots, locations, materials, products, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { daysUntil } from "@/lib/qty";
import { activeCountsForLocations } from "./counts";
import { isUuid } from "./lots";
import { getInventorySetting } from "./policy";
import { sectionSql } from "@/modules/masterdata";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = ["manufacturedOn", "expiresOn", "supplierLotNumber", "supplierName", "brand"] as const;

export type LotAttributesInput = Partial<Record<(typeof EDITABLE)[number], string | null>> & { reason: string };

/**
 * US-2-16: corrects lot attributes (dates, supplier lot) with a reason. Quality status is never
 * edited here (only QA dispositions change it): any status field is 422.
 */
export async function editLotAttributes(ctx: AuthContext, lotId: string, input: LotAttributesInput & Record<string, unknown>) {
  ctx.require("inventory.lot.edit");
  if ("qualityStatus" in input || "status" in input || "quality_status" in input) {
    throw new DomainError("validation", "Quality status cannot be edited here; only a QA disposition changes it.", { rule: "inventory.lot_edit_cannot_change_status" });
  }
  const unknown = Object.keys(input).filter((k) => k !== "reason" && !(EDITABLE as readonly string[]).includes(k));
  if (unknown.length) throw new DomainError("validation", `These fields cannot be edited: ${unknown.join(", ")}.`);
  if (!input.reason?.trim() || input.reason.trim().length < 5) throw new DomainError("validation", "Give a reason for the correction (at least 5 characters).", { fieldErrors: { reason: "Give a reason (at least 5 characters)." } });
  for (const k of ["manufacturedOn", "expiresOn"] as const) {
    const v = input[k];
    if (v && !DATE_RE.test(v)) throw new DomainError("validation", "Enter dates as YYYY-MM-DD.", { fieldErrors: { [k]: "Use YYYY-MM-DD." } });
  }
  if (!isUuid(lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, lotId)).for("update").limit(1);
    if (!lot || lot.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);
    const next = {
      manufacturedOn: input.manufacturedOn === undefined ? lot.manufacturedOn : input.manufacturedOn || null,
      expiresOn: input.expiresOn === undefined ? lot.expiresOn : input.expiresOn || null,
      supplierLotNumber: input.supplierLotNumber === undefined ? lot.supplierLotNumber : input.supplierLotNumber?.trim() || null,
      supplierName: input.supplierName === undefined ? lot.supplierName : input.supplierName?.trim() || null,
      brand: input.brand === undefined ? lot.brand : input.brand?.trim() || null,
    };
    if (next.brand && next.brand.length > 80) throw new DomainError("validation", "Brand: use at most 80 characters.", { fieldErrors: { brand: "Use at most 80 characters." } });
    if (next.manufacturedOn && next.expiresOn && next.expiresOn < next.manufacturedOn) throw new DomainError("validation", "The expiry date cannot be before the manufacture date.", { fieldErrors: { expiresOn: "Must be on or after the manufacture date." } });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if ((lot[k] ?? null) !== next[k]) {
        before[k] = lot[k];
        after[k] = next[k];
      }
    }
    if (Object.keys(after).length === 0) throw new DomainError("validation", "Nothing changed.");
    await tx.update(inventoryLots).set(next).where(eq(inventoryLots.id, lot.id));
    await audit(tx, ctx, {
      action: "inventory.inventory_lot.attributes_changed",
      entityType: "inventory_lot",
      entityId: lot.id,
      entityNumber: lot.lotNumber,
      siteId: lot.siteId,
      reason: input.reason.trim(),
      before,
      after,
    });
    return { changed: Object.keys(after) };
  });
}

/**
 * Expiry alerts (US-2-16, A-KPI-03): lots with stock at the current site that expired or expire
 * within the largest configured bucket (default 30/60/90 days), earliest first.
 */
export async function expiryAlerts(ctx: AuthContext) {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  const buckets = [...(await getInventorySetting(db, ctx.organizationId, ctx.currentSiteId, "inventory.expiry.alert_days"))].sort((a, b) => a - b);
  const horizon = buckets.at(-1) ?? 90;
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      itemKind: inventoryLots.itemKind,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      onHand: sql<string>`sum(${inventoryBalances.qtyBase})::text`,
      locationCodes: sql<string>`string_agg(${locations.code}, ', ' order by ${locations.code})`,
    })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, and(eq(inventoryBalances.lotId, inventoryLots.id), gt(inventoryBalances.qtyBase, "0")))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(
      and(
        eq(inventoryLots.siteId, ctx.currentSiteId),
        sql`${inventoryLots.expiresOn} is not null`,
        sql`${inventoryLots.expiresOn} <= (now() at time zone 'Asia/Manila')::date + ${horizon}::int`,
        sql`${inventoryLots.qualityStatus} not in ('rejected','recalled')`,
      ),
    )
    .groupBy(inventoryLots.id, materials.id, products.id)
    .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber));
  const withBucket = rows.map((r) => {
    const d = daysUntil(r.expiresOn)!;
    const bucket = d < 0 ? "expired" : `≤ ${buckets.find((b) => d <= b) ?? horizon} days`;
    return { ...r, daysLeft: d, bucket };
  });
  return { buckets, rows: withBucket };
}

/** Locations of the current site with stock, box and count summaries (US-2-16 locations list). */
export async function listLocationsWithStock(ctx: AuthContext) {
  ctx.require("masterdata.location.view");
  ctx.requireSite(ctx.currentSiteId);
  const rows = await db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
      kind: locations.kind,
      isActive: locations.isActive,
      warehouseCode: warehouses.code,
      section: sql<string>`${sectionSql("locations", "warehouses")}`, // S6 (ADR-077)
      lots: sql<number>`(select count(distinct b.lot_id)::int from ${inventoryBalances} b where b.location_id = ${locations.id} and b.qty_base > 0)`,
      boxes: sql<number>`(select count(*)::int from ${containers} c where c.current_location_id = ${locations.id} and c.status in ('open','sealed'))`,
      blocked: sql<number>`(select count(distinct b.lot_id)::int from ${inventoryBalances} b join ${inventoryLots} l on l.id = b.lot_id where b.location_id = ${locations.id} and b.qty_base > 0 and l.quality_status <> 'released')`,
    })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(eq(locations.siteId, ctx.currentSiteId))
    .orderBy(asc(warehouses.code), asc(locations.code));
  const frozen = await activeCountsForLocations(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, frozenBy: frozen.find((f) => f.locationId === r.id)?.countNumber ?? null }));
}

/** Location detail: lots (loose vs boxed), boxes and any count freezing it. Scoped to allowed sites. */
export async function getLocationDetail(ctx: AuthContext, locationId: string) {
  ctx.require("masterdata.location.view");
  if (!isUuid(locationId)) throw new DomainError("not_found", "Location not found in your sites.");
  const [loc] = await db
    .select({ loc: locations, warehouseCode: warehouses.code, warehouseName: warehouses.name })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(and(eq(locations.id, locationId), inArray(locations.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!loc) throw new DomainError("not_found", "Location not found in your sites.");
  ctx.requireSite(loc.loc.siteId);
  const lots = ctx.can("inventory.lot.view")
    ? await db
        .select({
          id: inventoryLots.id,
          lotNumber: inventoryLots.lotNumber,
          qualityStatus: inventoryLots.qualityStatus,
          expiresOn: inventoryLots.expiresOn,
          baseUom: inventoryLots.baseUom,
          itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
          itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
          onHand: inventoryBalances.qtyBase,
          boxed: sql<string>`coalesce((select sum(cc.qty_base) from ${containerContents} cc join ${containers} c on c.id = cc.container_id where cc.lot_id = ${inventoryLots.id} and c.current_location_id = ${locationId} and c.status in ('open','sealed')), 0)::text`,
        })
        .from(inventoryBalances)
        .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
        .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
        .leftJoin(products, eq(products.id, inventoryLots.productId))
        .where(and(eq(inventoryBalances.locationId, locationId), gt(inventoryBalances.qtyBase, "0")))
        .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber))
    : [];
  const boxes = ctx.can("inventory.container.view")
    ? await db
        .select({ id: containers.id, number: containers.containerNumber, status: containers.status })
        .from(containers)
        .where(and(eq(containers.currentLocationId, locationId), inArray(containers.status, ["open", "sealed"])))
        .orderBy(asc(containers.containerNumber))
    : [];
  const frozen = await activeCountsForLocations(db, [locationId]);
  return { ...loc.loc, warehouseCode: loc.warehouseCode, warehouseName: loc.warehouseName, lots, boxes, frozenBy: frozen[0] ?? null };
}

import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { LOCATION_SECTIONS, SECTION_HINTS, SECTION_LABELS, isSection, sectionSql, type LocationSection } from "@/modules/masterdata";
import { EXPIRY_WARN_DAYS, LOT_STATUSES } from "./lots";

/**
 * Stock grouped by warehouse section (S6, ADR-077). The owner could not tell where the raw materials and
 * finished goods were; every stock screen now groups by the section of the location the stock sits in
 * (`sectionOf` in src/lib/location-sections.ts). A lot stored in two sections appears under both, each
 * with the quantity in that section. Reads only; site-scoped to the caller's current site.
 */

const TODAY_SQL = sql`(now() at time zone 'Asia/Manila')::date`;

export type SectionTile = { section: LocationSection; label: string; hint: string; lots: number; locations: number; blockedLots: number };

/** Warehouse home tiles: per section, the lots that hold stock, the locations in it and how many lots cannot be used. */
export async function sectionSummary(ctx: AuthContext): Promise<SectionTile[]> {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  const rows = await db.execute<{ section: string; lots: string; blocked: string }>(sql`
    select ${sectionSql("l", "w")} as section,
           count(distinct b.lot_id)::text as lots,
           count(distinct b.lot_id) filter (where lot.quality_status <> 'released' or lot.expires_on < ${TODAY_SQL})::text as blocked
    from ${inventoryBalances} b
    join ${locations} l on l.id = b.location_id
    join ${warehouses} w on w.id = l.warehouse_id
    join ${inventoryLots} lot on lot.id = b.lot_id
    where b.site_id = ${ctx.currentSiteId} and b.qty_base > 0
    group by 1`);
  const locs = await db.execute<{ section: string; n: string }>(sql`
    select ${sectionSql("l", "w")} as section, count(*)::text as n
    from ${locations} l join ${warehouses} w on w.id = l.warehouse_id
    where l.site_id = ${ctx.currentSiteId} and l.status <> 'inactive'
    group by 1`);
  return LOCATION_SECTIONS.map((s) => {
    const r = rows.find((x) => x.section === s);
    return { section: s, label: SECTION_LABELS[s], hint: SECTION_HINTS[s], lots: Number(r?.lots ?? 0), locations: Number(locs.find((x) => x.section === s)?.n ?? 0), blockedLots: Number(r?.blocked ?? 0) };
  });
}

export type SectionStockFilter = { q?: string; kind?: "material" | "product"; status?: string; section?: string; locationId?: string };

export type SectionStockRow = {
  section: LocationSection;
  lotId: string;
  lotNumber: string;
  itemKind: string;
  qualityStatus: string;
  supplierLotNumber: string | null;
  expiresOn: string | null;
  baseUom: string;
  itemCode: string;
  itemName: string;
  onHand: string;
  locationCodes: string;
};

export type SectionGroup = { section: LocationSection; label: string; hint: string; rows: SectionStockRow[] };

/**
 * Lots with stock at the current site, one row per lot and section, grouped in the owner's walking order
 * (Raw materials, Packaging, Finished goods, Waiting for QA, Returns, Production, Other). Only sections
 * with stock are returned; each group is FEFO-sorted (earliest expiry first).
 */
export async function stockBySection(ctx: AuthContext, f: SectionStockFilter = {}): Promise<SectionGroup[]> {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [sql`b.site_id = ${ctx.currentSiteId}`, sql`b.qty_base > 0`];
  if (f.kind === "material" || f.kind === "product") conds.push(sql`lot.item_kind = ${f.kind}`);
  if (f.status === "expired") conds.push(sql`(lot.quality_status = 'expired' or lot.expires_on < ${TODAY_SQL})`);
  else if (f.status === "expiring") conds.push(sql`lot.expires_on between ${TODAY_SQL} and ${TODAY_SQL} + ${EXPIRY_WARN_DAYS}::int`);
  else if (f.status && (LOT_STATUSES as readonly string[]).includes(f.status)) conds.push(sql`lot.quality_status = ${f.status}`);
  if (isSection(f.section)) conds.push(sql`${sectionSql("l", "w")} = ${f.section}`);
  if (f.locationId && /^[0-9a-f-]{36}$/i.test(f.locationId)) conds.push(sql`b.location_id = ${f.locationId}`);
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(sql`(lot.lot_number ilike ${like} or lot.supplier_lot_number ilike ${like} or lot.supplier_name ilike ${like} or m.code ilike ${like} or m.name ilike ${like} or p.sku_code ilike ${like} or p.name ilike ${like})`);
  }
  const rows = await db.execute<{
    section: string;
    lot_id: string;
    lot_number: string;
    item_kind: string;
    quality_status: string;
    supplier_lot_number: string | null;
    expires_on: string | null;
    base_uom: string;
    item_code: string;
    item_name: string;
    on_hand: string;
    location_codes: string;
  }>(sql`
    select ${sectionSql("l", "w")} as section, lot.id as lot_id, lot.lot_number, lot.item_kind, lot.quality_status,
           lot.supplier_lot_number, lot.expires_on::text as expires_on, lot.base_uom,
           coalesce(m.code, p.sku_code) as item_code, coalesce(m.name, p.name) as item_name,
           sum(b.qty_base)::text as on_hand, string_agg(distinct l.code, ', ') as location_codes
    from ${inventoryBalances} b
    join ${locations} l on l.id = b.location_id
    join ${warehouses} w on w.id = l.warehouse_id
    join ${inventoryLots} lot on lot.id = b.lot_id
    left join ${materials} m on m.id = lot.material_id
    left join ${products} p on p.id = lot.product_id
    where ${sql.join(conds, sql` and `)}
    group by 1, lot.id, m.id, p.id
    order by lot.expires_on asc nulls last, lot.lot_number asc
    limit 1000`);
  const groups = new Map<LocationSection, SectionStockRow[]>();
  for (const r of rows) {
    const s: LocationSection = isSection(r.section) ? r.section : "other";
    const list = groups.get(s) ?? [];
    list.push({
      section: s,
      lotId: r.lot_id,
      lotNumber: r.lot_number,
      itemKind: r.item_kind,
      qualityStatus: r.quality_status,
      supplierLotNumber: r.supplier_lot_number,
      expiresOn: r.expires_on,
      baseUom: r.base_uom,
      itemCode: r.item_code,
      itemName: r.item_name,
      onHand: r.on_hand,
      locationCodes: r.location_codes,
    });
    groups.set(s, list);
  }
  return LOCATION_SECTIONS.filter((s) => groups.has(s)).map((s) => ({ section: s, label: SECTION_LABELS[s], hint: SECTION_HINTS[s], rows: groups.get(s)! }));
}

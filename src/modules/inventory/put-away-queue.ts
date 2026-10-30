import "server-only";
import { sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { SECTION_LABELS, isSection, sectionForItem, sectionSql, type LocationSection } from "@/modules/masterdata";
import { fmtStock } from "./low-stock";
import { MOVABLE_BOX_STATUSES } from "./moves";

/**
 * "To put away" (consultant review flow A): lots that QA released but whose stock still sits in a
 * quarantine, hold or receiving location of the current site. Before this list a released lot stayed
 * in the quarantine cage (QUA-01) and nobody told the warehouse.
 *
 * One row per lot × source location, oldest release first (the latest `released` lot disposition; the
 * lot's creation time when there is none). Each row carries the suggested shelf: the first active,
 * unblocked storage location (by code) in the section the item belongs in (sectionForItem, ADR-077),
 * the same rule putAwayOptions uses to list destinations. Locations under an open QA hold are left out
 * on both sides: stock in them may only move to quarantine/hold/rejected, and they refuse stock.
 * Quantities exclude boxed stock (boxed stock moves with its box on the Move screen); a row whose stock
 * is all in boxes is still listed with `boxedQtyBase` so the warehouse is told about it.
 * Read-only; site-scoped to the caller's current site.
 */

export type PutAwayTask = {
  lotId: string;
  lotNumber: string;
  itemKind: "material" | "product";
  itemCode: string;
  itemName: string;
  supplierLotNumber: string | null;
  expiresOn: string | null;
  baseUom: string;
  fromLocationId: string;
  fromCode: string;
  fromName: string;
  /** Loose quantity at the source location, base unit (decimal string). */
  qtyBase: string;
  /** Quantity in boxes at the source location, base unit (decimal string). */
  boxedQtyBase: string;
  /** Loose quantity in a friendly unit: 60,000 g → "60 kg"; pieces stay pieces. */
  qtyText: string;
  boxedQtyText: string | null;
  releasedAt: Date;
  section: LocationSection;
  sectionLabel: string;
  suggested: { id: string; code: string; name: string } | null;
};

const SOURCE_KINDS = ["quarantine", "hold", "receiving"];
const TODAY_SQL = sql`(now() at time zone 'Asia/Manila')::date`;

export async function lotsToPutAway(ctx: AuthContext, opts: { limit?: number } = {}): Promise<PutAwayTask[]> {
  ctx.require("inventory.lot.view");
  ctx.requireSite(ctx.currentSiteId);
  const siteId = ctx.currentSiteId;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await db.execute<{
    lot_id: string;
    lot_number: string;
    item_kind: string;
    item_code: string;
    item_name: string;
    material_kind: string | null;
    supplier_lot_number: string | null;
    expires_on: string | null;
    base_uom: string;
    location_id: string;
    location_code: string;
    location_name: string;
    qty: string;
    boxed: string;
    released_at: Date | string;
  }>(sql`
    with held as (
      select h.location_id from quality_holds h
      where h.site_id = ${siteId} and h.status in ('open', 'investigating') and h.location_id is not null
    ),
    boxed as (
      select cc.lot_id, c.current_location_id as location_id, sum(cc.qty_base) as qty
      from container_contents cc join containers c on c.id = cc.container_id
      where c.site_id = ${siteId} and c.status in (${sql.join(
        MOVABLE_BOX_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
      group by 1, 2
    )
    select lot.id as lot_id, lot.lot_number, lot.item_kind,
           coalesce(m.code, p.sku_code, '') as item_code, coalesce(m.name, p.name, '') as item_name, m.material_kind,
           lot.supplier_lot_number, lot.expires_on::text as expires_on, lot.base_uom,
           l.id as location_id, l.code as location_code, l.name as location_name,
           b.qty_base::text as qty, coalesce(bx.qty, 0)::text as boxed,
           coalesce((select max(d.decided_at) from dispositions d
                      where d.subject_type = 'lot' and d.subject_id = lot.id and d.to_status = 'released'), lot.created_at) as released_at
    from inventory_balances b
    join inventory_lots lot on lot.id = b.lot_id
    join locations l on l.id = b.location_id
    left join materials m on m.id = lot.material_id
    left join products p on p.id = lot.product_id
    left join boxed bx on bx.lot_id = b.lot_id and bx.location_id = b.location_id
    where b.site_id = ${siteId}
      and lot.organization_id = ${ctx.organizationId}
      and b.qty_base > 0
      and lot.quality_status = 'released'
      and (lot.expires_on is null or lot.expires_on >= ${TODAY_SQL})
      and l.kind in (${sql.join(
        SOURCE_KINDS.map((k) => sql`${k}`),
        sql`, `,
      )})
      and l.id not in (select location_id from held)
    order by released_at asc, lot.lot_number asc, l.code asc
    limit ${limit}`);
  if (rows.length === 0) return [];

  // Storage bins by section, first by code: the suggestion.
  const bins = await db.execute<{ id: string; code: string; name: string; section: string }>(sql`
    select l.id, l.code, l.name, ${sectionSql("l", "w")} as section
    from locations l join warehouses w on w.id = l.warehouse_id
    where l.site_id = ${siteId} and l.is_active and l.status = 'active' and l.kind = 'storage'
      and l.id not in (select h.location_id from quality_holds h where h.site_id = ${siteId} and h.status in ('open', 'investigating') and h.location_id is not null)
    order by l.code asc`);
  const firstBin = new Map<LocationSection, { id: string; code: string; name: string }>();
  for (const b of bins) {
    const s: LocationSection = isSection(b.section) ? b.section : "other";
    if (!firstBin.has(s)) firstBin.set(s, { id: b.id, code: b.code, name: b.name });
  }

  return rows.map((r) => {
    const itemKind = r.item_kind === "product" ? "product" : "material";
    const section = sectionForItem({ itemKind, materialKind: r.material_kind });
    const boxed = Decimal.min(new Decimal(r.boxed), new Decimal(r.qty));
    const loose = Decimal.max(new Decimal(r.qty).minus(boxed), 0);
    return {
      lotId: r.lot_id,
      lotNumber: r.lot_number,
      itemKind,
      itemCode: r.item_code,
      itemName: r.item_name,
      supplierLotNumber: r.supplier_lot_number,
      expiresOn: r.expires_on,
      baseUom: r.base_uom,
      fromLocationId: r.location_id,
      fromCode: r.location_code,
      fromName: r.location_name,
      qtyBase: loose.toString(),
      boxedQtyBase: boxed.toString(),
      qtyText: fmtStock(loose, r.base_uom),
      boxedQtyText: boxed.gt(0) ? fmtStock(boxed, r.base_uom) : null,
      releasedAt: r.released_at instanceof Date ? r.released_at : new Date(r.released_at),
      section,
      sectionLabel: SECTION_LABELS[section],
      suggested: firstBin.get(section) ?? null,
    };
  });
}

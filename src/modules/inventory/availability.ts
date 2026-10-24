import "server-only";
import { sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { isUuid } from "./lots";

/**
 * Availability buckets (docs/data-model.md §5.3, A-DM-23). Each lot × location quantity lands in
 * exactly one status bucket, by precedence recalled → rejected → expired (status or date) →
 * on_hold → quarantine → released. Reserved and allocated quantities count only against usable
 * (released, in-date) stock, so
 *   available = on_hand − reserved − allocated − quarantined − on_hold − expired − recalled − rejected
 * holds by construction. Allocations sitting on blocked stock are reported as `allocatedBlocked`
 * (a warning: those orders cannot ship). A lot is usable through the end of its expiry day
 * (expired when expires_on < as_of), matching assertLotUsable (assumption A-W1A-04).
 */
export type AvailabilityInputRow = {
  qualityStatus: string;
  expiresOn: string | null;
  onHand: Decimal.Value;
  reserved: Decimal.Value;
  allocated: Decimal.Value;
};

export type AvailabilityBuckets = {
  onHand: string;
  reserved: string;
  allocated: string;
  quarantined: string;
  onHold: string;
  expired: string;
  recalled: string;
  rejected: string;
  available: string;
  allocatedBlocked: string;
};

export type Bucket = "recalled" | "rejected" | "expired" | "on_hold" | "quarantine" | "released";

export function bucketOf(status: string, expiresOn: string | null, asOf: string): Bucket {
  if (status === "recalled") return "recalled";
  if (status === "rejected") return "rejected";
  if (status === "expired" || (expiresOn && expiresOn.slice(0, 10) < asOf)) return "expired";
  if (status === "on_hold") return "on_hold";
  if (status === "quarantine") return "quarantine";
  if (status === "released") return "released";
  return "quarantine"; // unknown status: treated as blocked, never available
}

/** The pure function the SQL is tested against (`availability.formula`). */
export function computeAvailability(rows: AvailabilityInputRow[], asOf: string): AvailabilityBuckets {
  const z = () => new Decimal(0);
  const t = { onHand: z(), reserved: z(), allocated: z(), quarantined: z(), onHold: z(), expired: z(), recalled: z(), rejected: z(), available: z(), allocatedBlocked: z() };
  for (const r of rows) {
    const on = new Decimal(r.onHand);
    const res = new Decimal(r.reserved);
    const al = new Decimal(r.allocated);
    t.onHand = t.onHand.plus(on);
    const b = bucketOf(r.qualityStatus, r.expiresOn, asOf);
    if (b === "released") {
      t.reserved = t.reserved.plus(res);
      t.allocated = t.allocated.plus(al);
      t.available = t.available.plus(on.minus(res).minus(al));
    } else {
      t.allocatedBlocked = t.allocatedBlocked.plus(res).plus(al);
      if (b === "quarantine") t.quarantined = t.quarantined.plus(on);
      else if (b === "on_hold") t.onHold = t.onHold.plus(on);
      else if (b === "expired") t.expired = t.expired.plus(on);
      else if (b === "recalled") t.recalled = t.recalled.plus(on);
      else t.rejected = t.rejected.plus(on);
    }
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toString()])) as AvailabilityBuckets;
}

export type AvailabilityRow = AvailabilityBuckets & {
  lotId: string;
  lotNumber: string;
  itemKind: string;
  itemCode: string;
  itemName: string;
  qualityStatus: string;
  expiresOn: string | null;
  baseUom: string;
  locationId: string;
  locationCode: string;
  locationKind: string;
  bucket: Bucket;
};

export type AvailabilityFilter = { siteId: string; asOf?: string; lotId?: string; locationId?: string; itemKind?: "material" | "product"; q?: string; includeEmpty?: boolean };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * Availability per lot × location of one site, computed in SQL (the screen, the API and the export
 * all use this). `asOf` is the business date (Asia/Manila) used for expiry; never CURRENT_DATE.
 * Rows of other sites can never contribute: both the balance and the lot must belong to the site,
 * and the site must be in the caller's scope.
 */
export async function availabilityRows(ctx: AuthContext, f: AvailabilityFilter, limit = 5000): Promise<AvailabilityRow[]> {
  ctx.require("inventory.balance.view");
  if (!isUuid(f.siteId)) throw new DomainError("not_found", "Site not found in your sites.");
  ctx.requireSite(f.siteId);
  const asOf = f.asOf ?? manilaToday();
  if (!DATE_RE.test(asOf)) throw new DomainError("validation", "As-of date must be YYYY-MM-DD.", { field: "asOf" });
  if (f.lotId && !isUuid(f.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  if (f.locationId && !isUuid(f.locationId)) throw new DomainError("not_found", "Location not found in your sites.");
  const like = f.q?.trim() ? `%${f.q.trim().replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;

  const rows = await db.execute<Record<string, string | null>>(sql`
    with alloc as (
      select a.lot_id, a.location_id, sum(a.qty_units) as qty
        from stock_allocations a
        join sales_order_lines sol on sol.id = a.sales_order_line_id
        join sales_orders so on so.id = sol.sales_order_id
       where a.status = 'open' and so.status in ('confirmed', 'allocated', 'picking', 'packed', 'partially_shipped') and so.site_id = ${f.siteId}
       group by 1, 2
    ), base as (
      select b.lot_id, b.location_id, l.lot_number, l.item_kind,
             coalesce(m.code, p.sku_code) as item_code, coalesce(m.name, p.name) as item_name,
             l.quality_status, l.expires_on::text as expires_on, l.base_uom,
             loc.code as location_code, loc.kind as location_kind,
             b.qty_base as on_hand, 0::numeric as reserved, coalesce(a.qty, 0) as allocated_raw,
             case
               when l.quality_status = 'recalled' then 'recalled'
               when l.quality_status = 'rejected' then 'rejected'
               when l.quality_status = 'expired' or l.expires_on < ${asOf}::date then 'expired'
               when l.quality_status = 'on_hold' then 'on_hold'
               when l.quality_status = 'released' then 'released'
               else 'quarantine'
             end as bucket
        from inventory_balances b
        join inventory_lots l on l.id = b.lot_id
        join locations loc on loc.id = b.location_id
        left join materials m on m.id = l.material_id
        left join products p on p.id = l.product_id
        left join alloc a on a.lot_id = b.lot_id and a.location_id = b.location_id
       where b.site_id = ${f.siteId} and l.site_id = ${f.siteId} and loc.site_id = ${f.siteId}
         and l.organization_id = ${ctx.organizationId}
         and (${f.lotId ?? null}::uuid is null or b.lot_id = ${f.lotId ?? null}::uuid)
         and (${f.locationId ?? null}::uuid is null or b.location_id = ${f.locationId ?? null}::uuid)
         and (${f.itemKind ?? null}::text is null or l.item_kind = ${f.itemKind ?? null}::text)
         and (${like}::text is null or l.lot_number ilike ${like} or m.code ilike ${like} or m.name ilike ${like} or p.sku_code ilike ${like} or p.name ilike ${like})
         and (${f.includeEmpty ?? false} or b.qty_base > 0 or coalesce(a.qty, 0) > 0)
    )
    select lot_id, location_id, lot_number, item_kind, item_code, item_name, quality_status, expires_on, base_uom,
           location_code, location_kind, bucket,
           on_hand::text as on_hand,
           (case when bucket = 'released' then reserved else 0 end)::text as reserved,
           (case when bucket = 'released' then allocated_raw else 0 end)::text as allocated,
           (case when bucket = 'quarantine' then on_hand else 0 end)::text as quarantined,
           (case when bucket = 'on_hold' then on_hand else 0 end)::text as on_hold,
           (case when bucket = 'expired' then on_hand else 0 end)::text as expired,
           (case when bucket = 'recalled' then on_hand else 0 end)::text as recalled,
           (case when bucket = 'rejected' then on_hand else 0 end)::text as rejected,
           (case when bucket = 'released' then on_hand - reserved - allocated_raw else 0 end)::text as available,
           (case when bucket <> 'released' then reserved + allocated_raw else 0 end)::text as allocated_blocked
      from base
     order by expires_on asc nulls last, lot_number, location_code
     limit ${limit}`);

  const n = (v: string | null) => new Decimal(v ?? 0).toString();
  return rows.map((r) => ({
    lotId: r.lot_id!,
    locationId: r.location_id!,
    lotNumber: r.lot_number!,
    itemKind: r.item_kind!,
    itemCode: r.item_code ?? "",
    itemName: r.item_name ?? "",
    qualityStatus: r.quality_status!,
    expiresOn: r.expires_on,
    baseUom: r.base_uom!,
    locationCode: r.location_code!,
    locationKind: r.location_kind!,
    bucket: r.bucket as Bucket,
    onHand: n(r.on_hand),
    reserved: n(r.reserved),
    allocated: n(r.allocated),
    quarantined: n(r.quarantined),
    onHold: n(r.on_hold),
    expired: n(r.expired),
    recalled: n(r.recalled),
    rejected: n(r.rejected),
    available: n(r.available),
    allocatedBlocked: n(r.allocated_blocked),
  }));
}

/** Totals per base unit (quantities of different units are never added together). */
export function availabilityTotals(rows: AvailabilityRow[], asOf: string) {
  const byUom = new Map<string, AvailabilityRow[]>();
  for (const r of rows) byUom.set(r.baseUom, [...(byUom.get(r.baseUom) ?? []), r]);
  return [...byUom.entries()].map(([uom, rs]) => ({
    uom,
    ...computeAvailability(
      rs.map((r) => ({ qualityStatus: r.qualityStatus, expiresOn: r.expiresOn, onHand: r.onHand, reserved: r.reserved, allocated: new Decimal(r.allocated).plus(r.allocatedBlocked) })),
      asOf,
    ),
  }));
}

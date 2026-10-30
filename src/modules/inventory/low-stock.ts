import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { manilaToday } from "./availability";

/**
 * Low stock (owner QA 2026-10-30: "there is no low-stock signal although materials have minimums").
 * Read model only; Home and other screens decide how to show it.
 *
 * Minimums (owner-maintained configuration, never invented here):
 * - materials: the active reorder policy per site × material (`material_reorder_policies.min_stock_base`,
 *   A-W4A-05, edited under Management → Purchasing → Reorder suggestions);
 * - finished products: `product_min_stock.min_stock_units` per site × product (A-W2A-06, planning).
 *
 * On hand = USABLE stock only (decision documented in docs/modules/inventory.md "Low stock"): lots with
 * quality status `released`, not past their expiry date (Asia/Manila business date), quantity > 0 at the
 * site. Stock in quarantine / on hold / waiting for quality is not usable yet and is returned separately as
 * `waitingForQuality` so the screen can say "7,000 pcs more are waiting for quality approval". Reservations
 * and open purchase orders are NOT subtracted / added here: this is "below minimum now"; the reorder
 * suggestion (procurement) is where open supply and reservations are weighed.
 *
 * Scope: `inventory.balance.view` at each site (the same permission as the action centre's low_stock
 * item). Without `opts.siteIds`: every allowed site where the caller holds it. With `opts.siteIds`: each
 * must be in the caller's sites (404 otherwise) and the permission must be held there (403).
 */
export type LowStockItem = {
  kind: "material" | "product";
  /** Material id or product id. */
  id: string;
  code: string;
  name: string;
  siteId: string;
  siteCode: string;
  /** Base unit of the quantities below (g, mL, pcs …). */
  unit: string;
  /** Usable (released, in-date) stock in base units, decimal string. */
  onHand: string;
  /** Stock at the site not usable yet (quarantine, on hold), base units. */
  waitingForQuality: string;
  /** Minimum in base units. */
  minimum: string;
  /** minimum − onHand (> 0). */
  shortBy: string;
  /** Plain display texts ("2,880 pcs", "20 kg"). */
  onHandText: string;
  minimumText: string;
  shortByText: string;
  /** Where to act: reorder suggestions for materials (or the stock list), the production plan for products. */
  href: string;
};

/** g → kg and mL → L from 1,000; whole numbers without decimals. Decimal-safe. */
export function fmtStock(v: Decimal.Value, unit: string): string {
  let d = new Decimal(v);
  let u = unit;
  if ((unit === "g" || unit === "mL" || unit === "ml") && d.abs().gte(1000)) {
    d = d.div(1000);
    u = unit === "g" ? "kg" : "L";
  }
  const dp = d.isInteger() ? 0 : Math.min(d.decimalPlaces(), 2);
  const [int, rawFrac] = d.toFixed(dp).split(".");
  const frac = rawFrac?.replace(/0+$/, ""); // "3.00 kg" reads as "3 kg"
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${frac ? `${grouped}.${frac}` : grouped} ${u}`;
}

/** fmtStock, but zero in grams reads "0 kg" (and mL "0 L"): the owner thinks of oils in kg, not grams. */
export function fmtStockFriendly(v: Decimal.Value, unit: string): string {
  if (new Decimal(v).isZero()) return unit === "g" ? "0 kg" : unit === "mL" || unit === "ml" ? "0 L" : fmtStock(0, unit);
  return fmtStock(v, unit);
}

type Row = { kind: "material" | "product"; id: string; code: string; name: string; site_id: string; site_code: string; unit: string; on_hand: string; waiting: string; minimum: string };

export async function lowStockItems(ctx: AuthContext, opts: { siteIds?: string[] } = {}): Promise<LowStockItem[]> {
  ctx.require("inventory.balance.view");
  let siteIds: string[];
  if (opts.siteIds) {
    for (const s of opts.siteIds) {
      if (typeof s !== "string" || !/^[0-9a-f-]{36}$/i.test(s)) throw new DomainError("not_found", "Record not found in your sites.");
      ctx.requireAt("inventory.balance.view", s); // 404 outside the caller's sites, 403 without the permission there
    }
    siteIds = [...new Set(opts.siteIds)];
  } else {
    siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("inventory.balance.view", s));
  }
  if (!siteIds.length) return [];
  const today = manilaToday();
  const inSites = sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    with stock as (
      select b.site_id, l.material_id, l.product_id,
             sum(b.qty_base) filter (where l.quality_status = 'released' and (l.expires_on is null or l.expires_on >= ${today}::date)) as usable,
             sum(b.qty_base) filter (where l.quality_status in ('quarantine', 'on_hold')) as waiting
        from inventory_balances b join inventory_lots l on l.id = b.lot_id
       where b.site_id in (${inSites}) and b.qty_base > 0 and l.organization_id = ${ctx.organizationId}::uuid
       group by b.site_id, l.material_id, l.product_id
    )
    select 'material' as kind, m.id, m.code, m.name, p.site_id, s.code as site_code, m.base_uom as unit,
           coalesce(sum(st.usable), 0)::text as on_hand, coalesce(sum(st.waiting), 0)::text as waiting, p.min_stock_base::text as minimum
      from material_reorder_policies p
      join materials m on m.id = p.material_id
      join sites s on s.id = p.site_id
      left join stock st on st.site_id = p.site_id and st.material_id = p.material_id
     where p.organization_id = ${ctx.organizationId}::uuid and p.is_active and p.min_stock_base > 0 and p.site_id in (${inSites})
     group by m.id, m.code, m.name, p.site_id, s.code, m.base_uom, p.min_stock_base
    union all
    select 'product' as kind, pr.id, pr.sku_code as code, pr.name, ms.site_id, s.code as site_code, pr.base_uom as unit,
           coalesce(sum(st.usable), 0)::text, coalesce(sum(st.waiting), 0)::text, ms.min_stock_units::text
      from product_min_stock ms
      join products pr on pr.id = ms.product_id
      join sites s on s.id = ms.site_id
      left join stock st on st.site_id = ms.site_id and st.product_id = ms.product_id
     where ms.organization_id = ${ctx.organizationId}::uuid and ms.min_stock_units > 0 and ms.site_id in (${inSites})
     group by pr.id, pr.sku_code, pr.name, ms.site_id, s.code, pr.base_uom, ms.min_stock_units`)) as unknown as Row[];

  const out: LowStockItem[] = [];
  for (const r of rows) {
    const onHand = new Decimal(r.on_hand);
    const minimum = new Decimal(r.minimum);
    if (!onHand.lt(minimum)) continue;
    const shortBy = minimum.minus(onHand);
    const href =
      r.kind === "material"
        ? ctx.canAt("procurement.reorder_suggestion.view", r.site_id)
          ? "/procurement/reorder"
          : `/inventory/availability?q=${encodeURIComponent(r.code)}`
        : ctx.canAt("production.work_order.view", r.site_id)
          ? "/production/plan"
          : `/inventory/availability?q=${encodeURIComponent(r.code)}`;
    out.push({
      kind: r.kind,
      id: r.id,
      code: r.code,
      name: r.name,
      siteId: r.site_id,
      siteCode: r.site_code,
      unit: r.unit,
      onHand: onHand.toString(),
      waitingForQuality: new Decimal(r.waiting).toString(),
      minimum: minimum.toString(),
      shortBy: shortBy.toString(),
      onHandText: fmtStock(onHand, r.unit),
      minimumText: fmtStock(minimum, r.unit),
      shortByText: fmtStock(shortBy, r.unit),
      href,
    });
  }
  // Most short first (share of the minimum missing), then code.
  return out.sort((a, b) => new Decimal(b.shortBy).div(b.minimum).comparedTo(new Decimal(a.shortBy).div(a.minimum)) || a.code.localeCompare(b.code));
}

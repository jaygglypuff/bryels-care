import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { addDays, resolveScope, type DashboardScope } from "./dashboard";
import { canSeeKpi } from "./kpis";

/**
 * "Best-selling products" on the Reports landing page (ADR-088 grade-5 business overview).
 *
 * Rules (the same as the "Orders confirmed" number, KPI-SAL-01 / KPI-SAL-01V):
 * - an order counts when it was confirmed in the window: its first transition to `confirmed`, or its
 *   entry time for orders entered before transitions were recorded (A-W3A-03);
 * - orders still draft, submitted, waiting for approval, or cancelled are left out;
 * - units = Σ sales_order_lines.qty_units; value = Σ qty_units × unit_price (order price, not invoiced);
 * - the value is shown only to people who may see order money (sales order view + financial KPI view +
 *   price list view at every site in scope, exactly like KPI-SAL-01V); others see units only.
 * Scope: the current site, or every allowed site (`all`, needs analytics.owner_dashboard.view). Sites
 * where the caller cannot view customer orders are left out; with none left the section is hidden (null).
 * Read only. Quantities and money stay decimal strings (numeric in SQL).
 */
export type TopProduct = { productId: string; name: string; units: string; value: string | null; orders: number };
export type TopProducts = { scope: DashboardScope; from: string; to: string; masked: boolean; rows: TopProduct[] };

const MONEY_PERMS = ["sales.sales_order.view", "analytics.financial_kpi.view", "sales.price_list.view"] as const;

export async function getTopProducts(ctx: AuthContext, opts: { all?: boolean; days?: number; limit?: number; today?: string } = {}): Promise<TopProducts | null> {
  ctx.require("analytics.dashboard.view");
  if (opts.all && !ctx.can("analytics.owner_dashboard.view")) throw new DomainError("forbidden", "All-sites figures need the owner's overview permission.");
  const scope = resolveScope(ctx, !!opts.all);
  const siteIds = scope.siteIds.filter((s) => ctx.canAt("sales.sales_order.view", s));
  if (siteIds.length === 0) return null;
  const days = Math.min(Math.max(opts.days ?? 28, 1), 366);
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const masked = !canSeeKpi(ctx, [...MONEY_PERMS], siteIds);

  // Window in the organization's time zone: [today - days + 1, today + 1).
  const [clock] = await db.execute<{ today: string; tz: string }>(sql`
    select ((now() at time zone coalesce(o.timezone, 'Asia/Manila'))::date)::text as today, coalesce(o.timezone, 'Asia/Manila') as tz
      from organizations o where o.id = ${ctx.organizationId}`);
  const today = opts.today ?? clock?.today;
  const tz = clock?.tz ?? "Asia/Manila";
  if (!today) return null;
  const from = addDays(today, -(days - 1));
  const to = addDays(today, 1);

  const ids = sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `);
  const rows = await db.execute<{ product_id: string; name: string; units: string; value: string; orders: number }>(sql`
    with confirmed as (
      select o.id
        from sales_orders o
        cross join lateral (
          select coalesce(
                   (select min(t.occurred_at) from sales_order_state_transitions t where t.sales_order_id = o.id and t.to_state = 'confirmed'),
                   case when not exists (select 1 from sales_order_state_transitions t2 where t2.sales_order_id = o.id and t2.to_state in ('draft', 'submitted', 'pending_approval')) then o.created_at end) as confirmed_at) ca
       where o.organization_id = ${ctx.organizationId}
         and o.site_id in (${ids})
         and o.status not in ('draft', 'submitted', 'pending_approval', 'cancelled')
         and ca.confirmed_at >= (${from}::date)::timestamp at time zone ${tz}
         and ca.confirmed_at < (${to}::date)::timestamp at time zone ${tz})
    select p.id as product_id, p.name, sum(l.qty_units)::text as units, sum(l.qty_units * l.unit_price)::text as value, count(distinct l.sales_order_id)::int as orders
      from sales_order_lines l
      join confirmed c on c.id = l.sales_order_id
      join products p on p.id = l.product_id
     group by p.id, p.name
     order by ${masked ? sql`sum(l.qty_units)` : sql`sum(l.qty_units * l.unit_price)`} desc, p.name asc
     limit ${limit}`);

  return {
    scope,
    from,
    to,
    masked,
    rows: [...rows].map((r) => ({ productId: r.product_id, name: r.name, units: r.units, value: masked ? null : r.value, orders: Number(r.orders) })),
  };
}

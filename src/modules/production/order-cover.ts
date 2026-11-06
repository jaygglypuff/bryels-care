import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { freeFinishedStock } from "@/modules/inventory";
import { coverOrders, type ComingSource, type LineCover, type OrderCoverResult } from "./order-cover-rule";

/**
 * Loads the inputs of the one order-cover rule (order-cover-rule.ts) for a site and runs it. No permission check
 * here: the callers (work-flow counts, salesOrderShortfalls, customerOrdersShort) check view permissions and the
 * site first. Read only.
 */

/** Customer order statuses that still wait for stock (the same list as "Make for this order"). */
export const COVER_ORDER_STATUSES = ["submitted", "pending_approval", "confirmed", "allocated", "picking", "packed", "partially_shipped"] as const;

export type CoverOrderMeta = {
  orderId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  requestedDeliveryOn: string | null;
  statusChangedAt: Date;
  lines: { lineId: string; lineNo: number; productId: string; ordered: string; allocated: string }[];
};

type MetaLine = CoverOrderMeta["lines"][number];
export type SiteOrderCoverOrder = Omit<CoverOrderMeta, "lines"> & { state: OrderCoverResult["state"]; lines: (MetaLine & LineCover)[] };
export type SiteOrderCover = { orders: SiteOrderCoverOrder[]; freeByProduct: Map<string, Decimal> };

/** Stock coming at the site, per batch (QA check, being made) and per unapproved production order made for an order. */
export async function comingStock(q: DbOrTx, organizationId: string, siteId: string): Promise<ComingSource[]> {
  const rows = await q.execute<{ id: string; ref: string; product_id: string; kind: ComingSource["kind"]; qty: string | null; sales_order_id: string | null }>(sql`
    -- Waiting for the QA check: what is in the batch's lot (samples already taken out), else the pieces made.
    select b.id, b.batch_number as ref, b.product_id, 'waiting_qa' as kind, w.sales_order_id,
           coalesce((select sum(ib.qty_base) from inventory_balances ib where ib.lot_id = b.output_lot_id and ib.qty_base > 0), b.actual_units, 0)::text as qty
      from batches b left join work_orders w on w.id = b.work_order_id
     where b.organization_id = ${organizationId} and b.site_id = ${siteId} and b.status in ('awaiting_qc', 'quarantined')
       and (w.id is null or w.status <> 'cancelled')
    union all
    -- Being made: batches of approved or in-progress production orders, at their planned pieces.
    select b.id, b.batch_number, b.product_id, 'being_made', w.sales_order_id,
           floor(round(case when w.target_units is not null and w.qty_planned_base > 0 then w.target_units * b.planned_size_g / w.qty_planned_base
                            else b.planned_size_g * coalesce(fr.theoretical_yield_pct, 100) / 100 / nullif(p.unit_net_mass_g, 0) end, 3))::text
      from batches b join work_orders w on w.id = b.work_order_id join products p on p.id = b.product_id
      left join formula_revisions fr on fr.id = b.formula_revision_id
     where b.organization_id = ${organizationId} and b.site_id = ${siteId}
       and b.status in ('planned', 'materials_staged', 'in_process', 'rework_approved') and w.status in ('released', 'in_progress')
    union all
    -- Not approved yet: only for the customer order it was made for (it may still be changed or refused).
    select w.id, w.work_order_number, w.product_id, 'planned', w.sales_order_id,
           floor(round(coalesce(w.target_units, w.qty_planned_base * coalesce(fr.theoretical_yield_pct, 100) / 100 / nullif(p.unit_net_mass_g, 0)), 3))::text
      from work_orders w join products p on p.id = w.product_id left join formula_revisions fr on fr.id = w.formula_revision_id
     where w.organization_id = ${organizationId} and w.site_id = ${siteId} and w.status in ('draft', 'planned') and w.sales_order_id is not null`);
  return [...rows].map((r) => ({ id: r.id, ref: r.ref, productId: r.product_id, kind: r.kind, qty: new Decimal(r.qty ?? 0), salesOrderId: r.sales_order_id }));
}

/** Every open customer order of the site, in priority order (earliest delivery date first), with the rule applied. */
export async function siteOrderCover(q: DbOrTx, organizationId: string, siteId: string): Promise<SiteOrderCover> {
  const statuses = sql.join(COVER_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);
  const rows = await q.execute<{ id: string; order_number: string; status: string; customer_name: string; requested_delivery_on: string | null; status_changed_at: Date | string; line_id: string; line_no: number; product_id: string; ordered: string; allocated: string }>(sql`
    select so.id, so.order_number, so.status, c.name as customer_name, so.requested_delivery_on::text as requested_delivery_on, so.status_changed_at,
           l.id as line_id, l.line_no, l.product_id, l.qty_units::text as ordered,
           coalesce((select sum(a.qty_units) from stock_allocations a where a.sales_order_line_id = l.id and a.status in ('open', 'fulfilled')), 0)::text as allocated
      from sales_orders so join customers c on c.id = so.customer_id join sales_order_lines l on l.sales_order_id = so.id
     where so.organization_id = ${organizationId} and so.site_id = ${siteId} and so.status in (${statuses})
     order by so.requested_delivery_on asc nulls last, so.created_at asc, so.id, l.line_no`);
  const metas = new Map<string, CoverOrderMeta>();
  for (const r of rows) {
    let m = metas.get(r.id);
    if (!m) {
      m = { orderId: r.id, orderNumber: r.order_number, status: r.status, customerName: r.customer_name, requestedDeliveryOn: r.requested_delivery_on, statusChangedAt: r.status_changed_at instanceof Date ? r.status_changed_at : new Date(r.status_changed_at), lines: [] };
      metas.set(r.id, m);
    }
    m.lines.push({ lineId: r.line_id, lineNo: Number(r.line_no), productId: r.product_id, ordered: r.ordered, allocated: r.allocated });
  }
  const products = [...new Set([...metas.values()].flatMap((m) => m.lines.map((l) => l.productId)))];
  const freeByProduct = new Map<string, Decimal>();
  if (products.length) for (const s of await freeFinishedStock(q, siteId, products)) freeByProduct.set(s.productId, (freeByProduct.get(s.productId) ?? new Decimal(0)).plus(s.available));
  const coming = products.length ? (await comingStock(q, organizationId, siteId)).filter((c) => products.includes(c.productId)) : [];
  const results = coverOrders(
    [...metas.values()].map((m) => ({ orderId: m.orderId, lines: m.lines.map((l) => ({ lineId: l.lineId, productId: l.productId, need: Decimal.max(new Decimal(l.ordered).minus(l.allocated), 0) })) })),
    freeByProduct,
    coming,
  );
  return {
    orders: results.map((r) => {
      const m = metas.get(r.orderId)!;
      return { ...m, state: r.state, lines: m.lines.map((l) => ({ ...l, ...r.lines.find((x) => x.lineId === l.lineId)! })) };
    }),
    freeByProduct,
  };
}

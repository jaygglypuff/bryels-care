import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { addDaysIso, businessDate } from "./shared";

/**
 * Supplier performance (US-6-04, W04-10, KPI-PRO-*), computed from the records, per supplier over a
 * period, scoped to the caller's sites:
 *
 * | Measure | Definition (A-W4A-08) |
 * |---|---|
 * | On time | posted PO receipt lines received on or before the line's due date (promised, else expected) + `procurement.purchase_order.late_grace_days` ÷ PO receipt lines |
 * | In full | PO lines completed in the period (received or short-closed) whose received quantity ≥ ordered ÷ completed PO lines |
 * | Quality rejects | lots received from the supplier in the period that QA rejected (disposition to `rejected`) ÷ lots received |
 * | Discrepancies | receipt lines with a recorded discrepancy |
 * | Lead time | average days from PO order date to receipt, against the agreed lead time |
 * | Returns | posted supplier returns |
 *
 * Ratios with no denominator are shown as "no data", never as 0 % or 100 %.
 */

export type SupplierPerformanceRow = {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  qualityStatus: string;
  receiptLines: number;
  onTimeLines: number;
  onTimePct: string | null;
  completedLines: number;
  inFullLines: number;
  inFullPct: string | null;
  lotsReceived: number;
  lotsRejected: number;
  rejectPct: string | null;
  discrepancies: number;
  avgLeadDays: string | null;
  avgAgreedLeadDays: string | null;
  returnsPosted: number;
};

const pct = (n: number, d: number) => (d > 0 ? new Decimal(n).div(d).mul(100).toDecimalPlaces(1).toFixed(1) : null);

export async function supplierPerformance(ctx: AuthContext, f: { from?: string; to?: string; supplierId?: string } = {}): Promise<{ from: string; to: string; rows: SupplierPerformanceRow[] }> {
  ctx.require("procurement.supplier_performance.view");
  const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : businessDate();
  const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : addDaysIso(to, -90);
  if (from > to) throw new DomainError("validation", "The start date must not be after the end date.", { field: "from" });
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.supplier_performance.view", s));
  if (!siteIds.length) return { from, to, rows: [] };
  const grace = await getSetting(db, ctx.organizationId, "procurement.purchase_order.late_grace_days");
  const sitesSql = sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `);
  const toEx = addDaysIso(to, 1);
  const sup = f.supplierId ? sql`and s.id = ${f.supplierId}::uuid` : sql``;
  const rows = (await db.execute(sql`
    with rl as (
      select g.supplier_id, l.id, l.lot_id, l.discrepancy_kind, l.purchase_order_line_id,
             (g.posted_at at time zone 'Asia/Manila')::date as received_on,
             coalesce(po.promised_date, pol.expected_date, po.expected_date) as due_on,
             po.order_date, sm.lead_time_days as agreed
        from goods_receipt_lines l
        join goods_receipts g on g.id = l.goods_receipt_id
        left join purchase_order_lines pol on pol.id = l.purchase_order_line_id
        left join purchase_orders po on po.id = pol.purchase_order_id
        left join supplier_materials sm on sm.id = pol.supplier_material_id
       where g.organization_id = ${ctx.organizationId}::uuid and g.site_id in (${sitesSql})
         and g.status = 'posted' and g.supplier_id is not null
         and g.posted_at >= (${from}::date)::timestamp at time zone 'Asia/Manila'
         and g.posted_at < (${toEx}::date)::timestamp at time zone 'Asia/Manila'
    ),
    receipt as (
      select supplier_id,
             count(*) filter (where purchase_order_line_id is not null)::int as receipt_lines,
             count(*) filter (where purchase_order_line_id is not null and due_on is not null and received_on <= due_on + ${grace}::int)::int as on_time,
             count(distinct lot_id)::int as lots,
             count(*) filter (where discrepancy_kind is not null)::int as discrepancies,
             avg(received_on - order_date) filter (where order_date is not null) as avg_lead,
             avg(agreed) filter (where order_date is not null) as avg_agreed
        from rl group by supplier_id
    ),
    rejects as (
      select rl.supplier_id, count(distinct rl.lot_id)::int as rejected
        from rl join dispositions d on d.subject_type = 'lot' and d.subject_id = rl.lot_id and d.to_status = 'rejected'
       group by rl.supplier_id
    ),
    completed as (
      select po.supplier_id, count(*)::int as completed,
             count(*) filter (where pol.qty_received_base >= pol.qty_base)::int as in_full
        from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
       where po.organization_id = ${ctx.organizationId}::uuid and po.site_id in (${sitesSql})
         and pol.line_status in ('received', 'short_closed')
         and pol.updated_at >= (${from}::date)::timestamp at time zone 'Asia/Manila'
         and pol.updated_at < (${toEx}::date)::timestamp at time zone 'Asia/Manila'
       group by po.supplier_id
    ),
    returns as (
      select supplier_id, count(*)::int as n from supplier_returns
       where organization_id = ${ctx.organizationId}::uuid and site_id in (${sitesSql}) and status = 'posted'
         and posted_at >= (${from}::date)::timestamp at time zone 'Asia/Manila'
         and posted_at < (${toEx}::date)::timestamp at time zone 'Asia/Manila'
       group by supplier_id
    )
    select s.id, s.code, s.name, s.quality_status,
           coalesce(r.receipt_lines, 0) as receipt_lines, coalesce(r.on_time, 0) as on_time, coalesce(r.lots, 0) as lots,
           coalesce(r.discrepancies, 0) as discrepancies, r.avg_lead::text as avg_lead, r.avg_agreed::text as avg_agreed,
           coalesce(x.rejected, 0) as rejected, coalesce(c.completed, 0) as completed, coalesce(c.in_full, 0) as in_full,
           coalesce(rt.n, 0) as returns
      from suppliers s
      left join receipt r on r.supplier_id = s.id
      left join rejects x on x.supplier_id = s.id
      left join completed c on c.supplier_id = s.id
      left join returns rt on rt.supplier_id = s.id
     where s.organization_id = ${ctx.organizationId}::uuid ${sup}
       and (r.supplier_id is not null or c.supplier_id is not null or rt.supplier_id is not null)
     order by s.name`)) as unknown as Record<string, unknown>[];
  const n = (v: unknown) => Number(v ?? 0);
  const d1 = (v: unknown) => (v === null || v === undefined ? null : new Decimal(String(v)).toDecimalPlaces(1).toFixed(1));
  return {
    from,
    to,
    rows: rows.map((r) => ({
      supplierId: String(r.id),
      supplierCode: String(r.code),
      supplierName: String(r.name),
      qualityStatus: String(r.quality_status),
      receiptLines: n(r.receipt_lines),
      onTimeLines: n(r.on_time),
      onTimePct: pct(n(r.on_time), n(r.receipt_lines)),
      completedLines: n(r.completed),
      inFullLines: n(r.in_full),
      inFullPct: pct(n(r.in_full), n(r.completed)),
      lotsReceived: n(r.lots),
      lotsRejected: n(r.rejected),
      rejectPct: pct(n(r.rejected), n(r.lots)),
      discrepancies: n(r.discrepancies),
      avgLeadDays: d1(r.avg_lead),
      avgAgreedLeadDays: d1(r.avg_agreed),
      returnsPosted: n(r.returns),
    })),
  };
}

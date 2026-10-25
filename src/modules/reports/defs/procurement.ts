import "server-only";
import { sql } from "drizzle-orm";
import { supplierPerformance } from "@/modules/procurement";
import { inIds, select, totalsByUnit } from "../sql";
import type { ReportDefinition } from "../types";

/** Procurement reports (Wave 4 W4A; docs/analytics-kpis.md §5.1 RPT-PRO-*). Quantities only on the open-PO report; no prices. */

export const openPurchaseOrdersReport: ReportDefinition = {
  code: "RPT-PRO-OPEN-PO",
  title: "Open purchase order lines and expected receipts",
  category: "Procurement",
  description: "Lines of sent and partially received purchase orders: ordered, received, open quantity and due date, late lines first. No prices.",
  viewPermission: "procurement.purchase_order.view",
  exportPermission: null,
  sensitivity: "N",
  params: [
    {
      name: "late",
      kind: "select",
      label: "Lines",
      options: [
        { value: "all", label: "All open lines" },
        { value: "late", label: "Late only" },
      ],
      default: "all",
    },
  ],
  columns: [
    { key: "site", header: "Site" },
    { key: "po", header: "PO" },
    { key: "status", header: "PO status" },
    { key: "supplier", header: "Supplier" },
    { key: "materialCode", header: "Material code" },
    { key: "material", header: "Material" },
    { key: "ordered", header: "Ordered", numeric: true, unitKey: "unit" },
    { key: "received", header: "Received", numeric: true, unitKey: "unit" },
    { key: "open", header: "Open", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
    { key: "due", header: "Due" },
    { key: "late", header: "Late" },
  ],
  fetch: async ({ siteIds, params, limit, today }) => {
    const lateOnly = params.late === "late" ? sql`and coalesce(po.promised_date, pol.expected_date, po.expected_date) < ${today}::date` : sql``;
    return select(sql`
      select s.code as site, po.po_number as po, po.status, sp.name as supplier, m.code as "materialCode", m.name as material,
             trim_scale(pol.qty_base)::text as ordered, trim_scale(pol.qty_received_base)::text as received,
             trim_scale(greatest(pol.qty_base - pol.qty_received_base, 0))::text as open, pol.base_uom as unit,
             to_char(coalesce(po.promised_date, pol.expected_date, po.expected_date), 'YYYY-MM-DD') as due,
             case when coalesce(po.promised_date, pol.expected_date, po.expected_date) < ${today}::date then 'yes' else '' end as late,
             po.id::text as "_poId"
        from purchase_order_lines pol
        join purchase_orders po on po.id = pol.purchase_order_id
        join suppliers sp on sp.id = po.supplier_id
        join materials m on m.id = pol.material_id
        join sites s on s.id = po.site_id
       where ${inIds(sql`po.site_id`, siteIds)} and po.status in ('sent', 'partially_received') and pol.line_status = 'open' ${lateOnly}
       order by late desc, due nulls last, po.po_number, pol.line_no
       limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Open lines as of now; due = the supplier's promised date, else the line's expected date, else the PO's.",
  sources: "purchase_orders, purchase_order_lines, suppliers, materials",
  footnotes: ["Received = posted goods receipt lines against the PO line (reversed receipts subtracted).", "Prices are not shown on this report (docs/permissions-matrix.md §6)."],
  summarize: (rows) => [["Open quantity", totalsByUnit(rows, "open", "unit")]],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._poId ? `/procurement/orders/${r._poId}` : null),
};

export const supplierPerformanceReport: ReportDefinition = {
  code: "RPT-PRO-SUPPLIER",
  title: "Supplier performance",
  category: "Procurement",
  description: "On time, in full, QA rejects, discrepancies, lead time and returns per supplier in the period, at the viewer's sites.",
  viewPermission: "procurement.supplier_performance.view",
  exportPermission: null,
  sensitivity: "N",
  params: [{ name: "period", kind: "period", label: "Period", default: "last_30_days" }],
  columns: [
    { key: "supplier", header: "Supplier" },
    { key: "onTime", header: "On time %", numeric: true },
    { key: "receiptLines", header: "PO receipt lines", numeric: true },
    { key: "inFull", header: "In full %", numeric: true },
    { key: "completedLines", header: "Completed lines", numeric: true },
    { key: "rejects", header: "QA rejects %", numeric: true },
    { key: "lots", header: "Lots received", numeric: true },
    { key: "discrepancies", header: "Discrepancies", numeric: true },
    { key: "leadDays", header: "Average lead time (days)", numeric: true },
    { key: "agreedDays", header: "Agreed lead time (days)", numeric: true },
    { key: "returns", header: "Returns posted", numeric: true },
  ],
  fetch: async ({ ctx, period }) => {
    const p = period!;
    const toIncl = new Date(Date.parse(p.toExclusive + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
    const r = await supplierPerformance(ctx, { from: p.from, to: toIncl });
    return r.rows.map((x) => ({
      supplier: `${x.supplierName} (${x.supplierCode})`,
      onTime: x.onTimePct,
      receiptLines: x.receiptLines,
      inFull: x.inFullPct,
      completedLines: x.completedLines,
      rejects: x.rejectPct,
      lots: x.lotsReceived,
      discrepancies: x.discrepancies,
      leadDays: x.avgLeadDays,
      agreedDays: x.avgAgreedLeadDays,
      returns: x.returnsPosted,
    }));
  },
  valueLabel: "Actual",
  timeBasis: "Receipts by posting time; completed lines by their last change; returns by posting time (Asia/Manila days).",
  sources: "goods_receipts, goods_receipt_lines, purchase_orders, purchase_order_lines, dispositions, supplier_returns",
  footnotes: ["A blank ratio means no data in the period, not 0 %.", "Measures and grace days: src/modules/procurement/performance.ts (A-W4A-08); site filter = all sites where you hold supplier performance."],
  schedulable: true,
  defaultCadence: "monthly",
};

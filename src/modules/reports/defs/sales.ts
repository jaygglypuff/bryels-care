import "server-only";
import { sql } from "drizzle-orm";
import { countBy, dayStart, inIds, localTs, select, totalsByUnit } from "../sql";
import type { ReportDefinition } from "../types";

/** Sales reports: orders and fulfilment, shipments and delivery receipts (docs/analytics-kpis.md §2.5). Quantities only. */

export const salesOrdersReport: ReportDefinition = {
  code: "RPT-SAL-ORDERS",
  title: "Sales orders and fulfilment",
  category: "Sales",
  description: "Sales orders with requested delivery date, quantities ordered and shipped, and days past the requested date while unshipped.",
  viewPermission: "sales.sales_order.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "open", label: "Not yet fully shipped (confirmed to partially shipped)" },
        { value: "overdue", label: "Unshipped past the requested date" },
        { value: "period", label: "Created in the period" },
      ],
      default: "open",
    },
    { name: "period", kind: "period", label: "Period (for “created”)", default: "this_month" },
  ],
  columns: [
    { key: "order", header: "Order" },
    { key: "site", header: "Site" },
    { key: "customer", header: "Customer" },
    { key: "customerPo", header: "Customer PO" },
    { key: "status", header: "Status" },
    { key: "createdAt", header: "Created" },
    { key: "requestedOn", header: "Requested delivery" },
    { key: "lines", header: "Lines", numeric: true },
    { key: "qtyOrdered", header: "Units ordered", numeric: true },
    { key: "shipments", header: "Shipments", numeric: true },
    { key: "daysOverdue", header: "Days past requested date", numeric: true },
  ],
  fetch: async ({ siteIds, params, period, limit, today, tz }) => {
    const where =
      params.scope === "overdue"
        ? sql`so.status in ('confirmed','allocated','picking','packed','partially_shipped') and (case when so.requested_delivery_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then so.requested_delivery_on::date end) < ${today}::date`
        : params.scope === "period"
          ? sql`so.created_at >= ${dayStart(period!.from, tz)} and so.created_at < ${dayStart(period!.toExclusive, tz)}`
          : sql`so.status in ('confirmed','allocated','picking','packed','partially_shipped')`;
    return select(sql`
      select so.order_number as "order", s.code as site, c.name as customer, coalesce(so.customer_po_number, '') as "customerPo", so.status,
             ${localTs(sql`so.created_at`, tz)} as "createdAt", coalesce(so.requested_delivery_on, '') as "requestedOn",
             (select count(*)::int from sales_order_lines l where l.sales_order_id = so.id) as lines,
             (select trim_scale(coalesce(sum(l.qty_units), 0))::text from sales_order_lines l where l.sales_order_id = so.id) as "qtyOrdered",
             (select count(*)::int from shipments sh where sh.sales_order_id = so.id and sh.status in ('dispatched','delivered','returned')) as shipments,
             case when so.status in ('confirmed','allocated','picking','packed','partially_shipped') and (case when so.requested_delivery_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then so.requested_delivery_on::date end) < ${today}::date
                  then (${today}::date - (case when so.requested_delivery_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then so.requested_delivery_on::date end)) else 0 end as "daysOverdue",
             'pcs' as "_unit", so.id::text as "_id"
      from sales_orders so
      join customers c on c.id = so.customer_id
      join sites s on s.id = so.site_id
      where ${inIds(sql`so.site_id`, siteIds)} and ${where}
      order by so.requested_delivery_on nulls last, so.order_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Days past requested date = business date minus the requested delivery date, for orders not yet shipped.",
  sources: "sales_orders, sales_order_lines, shipments, customers",
  footnotes: ["Prices and order values are not shown: they need sales.price_list.view and arrive with pricing (Phase 4 pricing, docs/analytics-kpis.md §1.5).", "Units are finished-product units (pcs)."],
  summarize: (rows) => [
    ["Orders by status", countBy(rows, "status")],
    ["Units ordered (listed rows)", totalsByUnit(rows, "qtyOrdered", "_unit")],
  ],
  schedulable: true,
  defaultCadence: "daily",
  rowLink: (r) => (r._id ? `/sales/${r._id}` : null),
};

export const shipmentsReport: ReportDefinition = {
  code: "RPT-SAL-SHIPMENTS",
  title: "Shipments and delivery receipts",
  category: "Sales",
  description: "Shipments dispatched in the period with their delivery receipt, carrier and whether delivery was acknowledged.",
  viewPermission: "sales.shipment.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    { name: "period", kind: "period", label: "Period", default: "last_30_days" },
    {
      name: "ack",
      kind: "select",
      label: "Acknowledgement",
      options: [
        { value: "all", label: "All shipments" },
        { value: "unacknowledged", label: "Not yet acknowledged" },
        { value: "acknowledged", label: "Acknowledged" },
      ],
      default: "all",
    },
  ],
  columns: [
    { key: "dr", header: "Delivery receipt" },
    { key: "status", header: "Status" },
    { key: "site", header: "Site" },
    { key: "dispatchedAt", header: "Dispatched at" },
    { key: "order", header: "Order" },
    { key: "customer", header: "Customer" },
    { key: "carrier", header: "Carrier" },
    { key: "packages", header: "Packages", numeric: true },
    { key: "deliveredAt", header: "Delivered at" },
    { key: "receivedBy", header: "Received by", personalData: true },
    { key: "hoursOpen", header: "Hours without acknowledgement", numeric: true },
  ],
  fetch: async ({ siteIds, params, period, limit, tz, now }) => {
    const p = period!;
    const ack = params.ack === "unacknowledged" ? sql`and sh.delivered_at is null` : params.ack === "acknowledged" ? sql`and sh.delivered_at is not null` : sql``;
    return select(sql`
      select coalesce(sh.delivery_receipt_number, sh.shipment_number, '') as dr, sh.status, s.code as site, ${localTs(sql`sh.dispatched_at`, tz)} as "dispatchedAt", so.order_number as "order", c.name as customer,
             coalesce(sh.carrier, '') as carrier, sh.package_count as packages, ${localTs(sql`sh.delivered_at`, tz)} as "deliveredAt", coalesce(sh.received_by_name, '') as "receivedBy",
             case when sh.delivered_at is null then floor(extract(epoch from (${now.toISOString()}::timestamptz - sh.dispatched_at)) / 3600)::int else null end as "hoursOpen",
             so.id::text as "_orderId", sh.id::text as "_shipmentId"
      from shipments sh
      join sales_orders so on so.id = sh.sales_order_id
      join customers c on c.id = so.customer_id
      join sites s on s.id = sh.site_id
      where ${inIds(sql`sh.site_id`, siteIds)} and sh.status in ('dispatched','delivered','returned') and sh.dispatched_at >= ${dayStart(p.from, tz)} and sh.dispatched_at < ${dayStart(p.toExclusive, tz)} ${ack}
      order by sh.dispatched_at, sh.delivery_receipt_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By dispatch time (shipments.dispatched_at) of shipments that left the site (dispatched, delivered, returned; reversed ones are excluded); acknowledged = a delivery time and receiver were recorded.",
  sources: "shipments, sales_orders, customers",
  footnotes: ["A delivery receipt acknowledgement is evidence of receipt, not an electronic signature (A-RPT-14)."],
  summarize: (rows) => [
    ["Shipments", String(rows.length)],
    ["Not yet acknowledged", String(rows.filter((r) => !r.deliveredAt).length)],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._shipmentId ? `/sales/shipments/${r._shipmentId}` : r._orderId ? `/sales/${r._orderId}` : null),
};

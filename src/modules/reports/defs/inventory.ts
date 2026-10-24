import "server-only";
import { sql } from "drizzle-orm";
import { addDays } from "../params";
import { dayStart, inIds, likePattern, localTs, select, totalsByUnit, countBy } from "../sql";
import type { ReportDefinition } from "../types";

/** Inventory reports: stock on hand (no values), near-expiry, movements, goods receipts (docs/analytics-kpis.md §5.1). */

const LOT_STATUSES = ["quarantine", "released", "on_hold", "rejected", "expired", "recalled"];
const statusOptions = [{ value: "all", label: "All statuses" }, ...LOT_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))];
const itemKindOptions = [
  { value: "all", label: "Materials and products" },
  { value: "material", label: "Materials only" },
  { value: "product", label: "Finished products only" },
];

export const stockOnHandReport: ReportDefinition = {
  code: "RPT-INV-STOCK",
  title: "Stock on hand by lot and location",
  category: "Inventory",
  description: "Every lot with stock, where it is, its QA status and expiry. Quantities only; stock value needs costing (Phase 6).",
  viewPermission: "inventory.balance.view",
  exportPermission: "inventory.balance.export",
  sensitivity: "N",
  params: [
    { name: "itemKind", kind: "select", label: "Items", options: itemKindOptions, default: "all" },
    { name: "status", kind: "select", label: "QA status", options: statusOptions, default: "all" },
    { name: "q", kind: "text", label: "Item or lot contains", maxLength: 60, placeholder: "MAT-0012, coconut, L-26…" },
  ],
  columns: [
    { key: "site", header: "Site" },
    { key: "location", header: "Location" },
    { key: "lot", header: "Lot" },
    { key: "itemCode", header: "Item code" },
    { key: "item", header: "Item" },
    { key: "status", header: "QA status" },
    { key: "expiresOn", header: "Expires on" },
    { key: "qty", header: "On hand", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
  ],
  fetch: async ({ siteIds, params, limit }) => {
    const kind = params.itemKind !== "all" ? sql`and lot.item_kind = ${params.itemKind}` : sql``;
    const status = params.status !== "all" ? sql`and lot.quality_status = ${params.status}` : sql``;
    const q = params.q
      ? sql`and (lot.lot_number ilike ${likePattern(String(params.q))} or coalesce(m.code, p.sku_code) ilike ${likePattern(String(params.q))} or coalesce(m.name, p.name) ilike ${likePattern(String(params.q))})`
      : sql``;
    return select(sql`
      select s.code as site, l.code as location, lot.lot_number as lot, coalesce(m.code, p.sku_code) as "itemCode", coalesce(m.name, p.name) as item,
             lot.quality_status as status, lot.expires_on::text as "expiresOn", trim_scale(b.qty_base)::text as qty, lot.base_uom as unit, lot.id::text as "_lotId"
      from inventory_balances b
      join inventory_lots lot on lot.id = b.lot_id
      join locations l on l.id = b.location_id
      join sites s on s.id = b.site_id
      left join materials m on m.id = lot.material_id
      left join products p on p.id = lot.product_id
      where ${inIds(sql`b.site_id`, siteIds)} and b.qty_base > 0 ${kind} ${status} ${q}
      order by s.code, coalesce(m.code, p.sku_code), lot.lot_number, l.code
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Point in time: the balance at generation time.",
  sources: "inventory_balances (projection of stock_movements, ADR-006), inventory_lots, locations, materials, products",
  footnotes: [
    "On hand is the balance projection updated in the same transaction as each posted movement; the nightly reconciliation compares it with the ledger and reports differences (diagnostics).",
    "Quantities are in each item's base unit and are never added across units.",
    "Stock value is not shown: cost data arrives with finance (Phase 6, RPT-INV-VALUATION).",
  ],
  summarize: (rows) => [
    ["Total on hand (listed rows)", totalsByUnit(rows, "qty", "unit")],
    ["Rows by QA status", countBy(rows, "status")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._lotId ? `/inventory/${r._lotId}` : null),
};

export const expiryReport: ReportDefinition = {
  code: "RPT-INV-EXPIRY",
  title: "Near-expiry and expired stock",
  category: "Inventory",
  description: "Lots with stock that expire within the horizon (30/60/90-day buckets) or have expired, per site (KPI-INV-04).",
  viewPermission: "inventory.lot.view",
  exportPermission: "inventory.lot.export",
  sensitivity: "N",
  params: [
    { name: "horizonDays", kind: "number", label: "Horizon (days)", min: 1, max: 730, default: 90 },
    {
      name: "includeExpired",
      kind: "select",
      label: "Expired lots",
      options: [
        { value: "yes", label: "Include expired" },
        { value: "no", label: "Not yet expired only" },
      ],
      default: "yes",
    },
  ],
  columns: [
    { key: "site", header: "Site" },
    { key: "lot", header: "Lot" },
    { key: "itemCode", header: "Item code" },
    { key: "item", header: "Item" },
    { key: "status", header: "QA status" },
    { key: "expiresOn", header: "Expires on" },
    { key: "daysLeft", header: "Days left", numeric: true },
    { key: "bucket", header: "Bucket" },
    { key: "qty", header: "On hand", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
    { key: "locations", header: "Locations" },
  ],
  fetch: async ({ siteIds, params, limit, today }) => {
    const until = addDays(today, Number(params.horizonDays));
    const lower = params.includeExpired === "no" ? sql`and lot.expires_on >= ${today}::date` : sql``;
    return select(sql`
      select s.code as site, lot.lot_number as lot, coalesce(m.code, p.sku_code) as "itemCode", coalesce(m.name, p.name) as item,
             lot.quality_status as status, lot.expires_on::text as "expiresOn", (lot.expires_on - ${today}::date) as "daysLeft",
             case when lot.expires_on < ${today}::date then 'expired'
                  when lot.expires_on - ${today}::date <= 30 then '0–30 days'
                  when lot.expires_on - ${today}::date <= 60 then '31–60 days'
                  when lot.expires_on - ${today}::date <= 90 then '61–90 days'
                  else 'over 90 days' end as bucket,
             trim_scale(sum(b.qty_base))::text as qty, lot.base_uom as unit, string_agg(distinct l.code, ', ') as locations, lot.id::text as "_lotId"
      from inventory_lots lot
      join inventory_balances b on b.lot_id = lot.id and b.qty_base > 0
      join locations l on l.id = b.location_id
      join sites s on s.id = lot.site_id
      left join materials m on m.id = lot.material_id
      left join products p on p.id = lot.product_id
      where ${inIds(sql`lot.site_id`, siteIds)} and lot.expires_on is not null and lot.expires_on <= ${until}::date ${lower}
      group by s.code, lot.id, lot.lot_number, m.code, p.sku_code, m.name, p.name, lot.quality_status, lot.expires_on, lot.base_uom
      order by lot.expires_on, s.code, lot.lot_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Days left = expiry date minus the organization's business date at generation time.",
  sources: "inventory_lots.expires_on, inventory_balances (positive balances only)",
  footnotes: [
    "Buckets: expired, 0–30, 31–60, 61–90 days and over 90 days to expiry (docs/analytics-kpis.md KPI-INV-04).",
    "The daily expiry check (inventory.expiry_check) changes expired lots to status expired; a lot past its date may show its previous status until that job has run.",
  ],
  summarize: (rows) => [
    ["Lots by bucket", countBy(rows, "bucket")],
    ["Quantity (listed rows)", totalsByUnit(rows, "qty", "unit")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._lotId ? `/inventory/${r._lotId}` : null),
};

const MOVEMENT_TYPES = ["receipt", "issue", "transfer", "consumption", "output", "adjustment", "return", "shipment", "reversal"];

export const movementsReport: ReportDefinition = {
  code: "RPT-INV-MOVEMENTS",
  title: "Stock movements",
  category: "Inventory",
  description: "Every posted ledger movement in the period: receipts, issues, transfers, consumption, output, adjustments, shipments and reversals.",
  viewPermission: "inventory.movement.view",
  exportPermission: "inventory.movement.export",
  sensitivity: "N",
  params: [
    { name: "period", kind: "period", label: "Period", default: "last_7_days" },
    { name: "movementType", kind: "select", label: "Movement type", options: [{ value: "all", label: "All types" }, ...MOVEMENT_TYPES.map((t) => ({ value: t, label: t }))], default: "all" },
    { name: "q", kind: "text", label: "Lot or document contains", maxLength: 60 },
  ],
  columns: [
    { key: "postedAt", header: "Posted at" },
    { key: "site", header: "Site" },
    { key: "type", header: "Type" },
    { key: "lot", header: "Lot" },
    { key: "itemCode", header: "Item code" },
    { key: "from", header: "From" },
    { key: "to", header: "To" },
    { key: "qty", header: "Quantity", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
    { key: "statusAtPosting", header: "Status at posting" },
    { key: "document", header: "Source document" },
    { key: "postedBy", header: "Posted by", personalData: true },
    { key: "reason", header: "Reason" },
    { key: "reversal", header: "Reversal" },
  ],
  fetch: async ({ siteIds, params, period, limit, tz }) => {
    const p = period!;
    const type = params.movementType !== "all" ? sql`and mv.movement_type = ${params.movementType}` : sql``;
    const q = params.q ? sql`and (lot.lot_number ilike ${likePattern(String(params.q))} or mv.source_document_number ilike ${likePattern(String(params.q))})` : sql``;
    return select(sql`
      select ${localTs(sql`mv.posted_at`, tz)} as "postedAt", s.code as site, mv.movement_type as type, lot.lot_number as lot, coalesce(m.code, pr.sku_code) as "itemCode",
             fl.code as "from", tl.code as "to", trim_scale(mv.qty_base)::text as qty, mv.base_uom as unit, mv.quality_status_at_posting as "statusAtPosting",
             trim(concat_ws(' ', mv.source_document_type, mv.source_document_number)) as document, u.display_name as "postedBy", mv.reason,
             case when mv.reversal_of_id is not null then 'reversal of ' || coalesce(orig.source_document_number, left(orig.id::text, 8))
                  when rev.id is not null then 'reversed' else '' end as reversal, lot.id::text as "_lotId"
      from stock_movements mv
      join inventory_lots lot on lot.id = mv.lot_id
      join sites s on s.id = mv.site_id
      join users u on u.id = mv.posted_by
      left join materials m on m.id = lot.material_id
      left join products pr on pr.id = lot.product_id
      left join locations fl on fl.id = mv.from_location_id
      left join locations tl on tl.id = mv.to_location_id
      left join stock_movements orig on orig.id = mv.reversal_of_id
      left join stock_movements rev on rev.reversal_of_id = mv.id
      where ${inIds(sql`mv.site_id`, siteIds)} and mv.posted_at >= ${dayStart(p.from, tz)} and mv.posted_at < ${dayStart(p.toExclusive, tz)} ${type} ${q}
      order by mv.posted_at, mv.id
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By posting time (stock_movements.posted_at) in the organization's time zone; period is half-open.",
  sources: "stock_movements (immutable ledger), inventory_lots, locations, users",
  footnotes: [
    "Corrections are reversals plus replacements; both rows are listed and marked, nothing is edited (ADR-006).",
    "Quantities are in base units; a transfer moves stock between two locations of one site and does not change the site total.",
  ],
  summarize: (rows) => [
    ["Movements by type", countBy(rows, "type")],
    ["Quantity moved (listed rows)", totalsByUnit(rows, "qty", "unit")],
  ],
  schedulable: true,
  defaultCadence: "daily",
  rowLink: (r) => (r._lotId ? `/inventory/stock-card/${r._lotId}` : null),
};

export const receiptsReport: ReportDefinition = {
  code: "RPT-INV-RECEIPTS",
  title: "Goods receipts",
  category: "Inventory",
  description: "Posted and reversed goods receipts in the period, one row per line: supplier, material, lot, quantity, discrepancies and missing documents.",
  viewPermission: "procurement.goods_receipt.view",
  exportPermission: "procurement.goods_receipt.export",
  sensitivity: "N",
  params: [
    { name: "period", kind: "period", label: "Period", default: "last_30_days" },
    {
      name: "status",
      kind: "select",
      label: "Receipt status",
      options: [
        { value: "all", label: "Posted and reversed" },
        { value: "posted", label: "Posted" },
        { value: "reversed", label: "Reversed" },
      ],
      default: "all",
    },
  ],
  columns: [
    { key: "receivedAt", header: "Received at" },
    { key: "site", header: "Site" },
    { key: "receipt", header: "Receipt" },
    { key: "status", header: "Status" },
    { key: "kind", header: "Kind" },
    { key: "supplier", header: "Supplier" },
    { key: "materialCode", header: "Material code" },
    { key: "material", header: "Material" },
    { key: "lot", header: "Lot" },
    { key: "supplierLot", header: "Supplier lot" },
    { key: "qty", header: "Quantity", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
    { key: "initialStatus", header: "Initial QA status" },
    { key: "discrepancy", header: "Discrepancy" },
    { key: "documentMissing", header: "CoA missing" },
    { key: "receivedBy", header: "Received by", personalData: true },
  ],
  fetch: async ({ siteIds, params, period, limit, tz }) => {
    const p = period!;
    const status = params.status === "all" ? sql`gr.status in ('posted','reversed')` : sql`gr.status = ${params.status}`;
    return select(sql`
      select ${localTs(sql`gr.received_at`, tz)} as "receivedAt", s.code as site, gr.receipt_number as receipt, gr.status, gr.receipt_kind as kind, gr.supplier_name as supplier,
             m.code as "materialCode", m.name as material, lot.lot_number as lot, ln.supplier_lot_number as "supplierLot", trim_scale(ln.qty_base)::text as qty, m.base_uom as unit,
             ln.initial_quality_status as "initialStatus", coalesce(ln.discrepancy_kind, '') as discrepancy, case when ln.document_missing then 'yes' else '' end as "documentMissing",
             u.display_name as "receivedBy", gr.id::text as "_receiptId"
      from goods_receipts gr
      join goods_receipt_lines ln on ln.goods_receipt_id = gr.id
      join materials m on m.id = ln.material_id
      join sites s on s.id = gr.site_id
      join users u on u.id = gr.received_by
      left join inventory_lots lot on lot.id = ln.lot_id
      where ${inIds(sql`gr.site_id`, siteIds)} and ${status} and gr.received_at >= ${dayStart(p.from, tz)} and gr.received_at < ${dayStart(p.toExclusive, tz)}
      order by gr.received_at, gr.receipt_number, ln.line_no
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By receipt time (goods_receipts.received_at); drafts and cancelled receipts are excluded.",
  sources: "goods_receipts, goods_receipt_lines, inventory_lots, materials",
  footnotes: ["Supplier prices are not shown (masterdata.supplier_price.view, Phase 6).", "A reversed receipt keeps its lines; the ledger holds the reversal movements."],
  summarize: (rows) => [
    ["Lines by status", countBy(rows, "status")],
    ["Quantity received (listed rows)", totalsByUnit(rows.filter((r) => r.status === "posted"), "qty", "unit")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._receiptId ? `/inventory/receive/${r._receiptId}` : null),
};

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { plainDate } from "@/lib/plain-date";
import { getSetting } from "@/lib/settings";
import { actionKind } from "./kinds";

/**
 * Detectors: the conditions that put a record into the action centre (US-5-06). Each returns the
 * records that need action *now*, across every site of the organization; an item clears as soon as
 * its record stops matching. Thresholds are settings (action_centre.*, inventory.expiry.alert_days),
 * never fixed in code. Other modules (W3C imports) add detectors through `registerActionItemSource`.
 */

export type Candidate = {
  kind: string;
  siteId: string | null;
  entityType: string;
  entityId: string;
  recordNumber: string | null;
  title: string;
  detail: string | null;
  link: string;
  openedAt: Date;
};

export type ActionItemSource = { kind: string; detect: (organizationId: string, now: Date) => Promise<Candidate[]> };

const REGISTRY_KEY = "__bc_action_item_sources__";
type Registry = Map<string, ActionItemSource>;
function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  g[REGISTRY_KEY] ??= new Map();
  return g[REGISTRY_KEY]!;
}

/**
 * Plug-in point for other modules (e.g. W3C's import wizard: `kind: "failed_import"` from its
 * import_jobs table). A source with the same kind replaces the built-in detector of that kind.
 */
export function registerActionItemSource(source: ActionItemSource) {
  if (!actionKind(source.kind)) throw new Error(`Unknown action-centre kind ${source.kind}; add it to ACTION_KINDS first.`);
  registry().set(source.kind, source);
}

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const d = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

function localDate(now: Date, tz: string) {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

async function orgTz(organizationId: string) {
  const [r] = await run(sql`select timezone from organizations where id = ${organizationId}::uuid`);
  return String(r?.timezone ?? "Asia/Manila");
}

/** Where a late customer order is now, in the words of the order screens (no stored status codes). */
const ORDER_STEP_WORDS: Record<string, string> = {
  confirmed: "Now: confirmed, stock not set aside yet",
  allocated: "Now: stock set aside, not got from the shelf yet",
  picking: "Now: getting it from the shelf",
  packed: "Now: boxed and checked, not sent out yet",
  partially_shipped: "Now: partly sent out",
};

/** "1 day" / "3 days" (no "day(s)"). */
const days = (n: unknown) => (Number(n) === 1 ? "1 day" : `${n} days`);
/** A setting key in words for a card title ("platform.rate_limits" → "rate limits"), never the raw key (UX audit C #6). */
const settingWords = (key: string) => key.split(".").slice(-1)[0].replace(/_/g, " ");

const BUILT_IN: Record<string, (org: string, now: Date, today: string) => Promise<Candidate[]>> = {
  "approval.stock_adjustment": async (org) =>
    (await run(sql`select a.id, a.site_id, a.adjustment_number, a.reason_code, coalesce(a.submitted_at, a.created_at) as at, (select coalesce(m.name, p.name) from stock_adjustment_lines al left join inventory_lots l on l.id = al.lot_id left join materials m on m.id = coalesce(l.material_id, al.new_lot_material_id) left join products p on p.id = coalesce(l.product_id, al.new_lot_product_id) where al.stock_adjustment_id = a.id order by al.line_no limit 1) as name from stock_adjustments a where a.organization_id = ${org}::uuid and a.status = 'submitted'`)).map((r) => ({
      kind: "approval.stock_adjustment", siteId: String(r.site_id), entityType: "stock_adjustment", entityId: String(r.id), recordNumber: String(r.adjustment_number),
      title: r.name ? `Stock fix of ${r.name} waits for approval` : "A stock fix waits for approval", detail: `Why: ${String(r.reason_code).replace(/_/g, " ")}`, link: `/inventory/adjustments/${r.id}`, openedAt: d(r.at),
    })),
  "approval.stock_count": async (org) =>
    (await run(sql`select id, site_id, count_number, created_at as at from stock_counts where organization_id = ${org}::uuid and status = 'pending_approval'`)).map((r) => ({
      kind: "approval.stock_count", siteId: String(r.site_id), entityType: "stock_count", entityId: String(r.id), recordNumber: String(r.count_number),
      title: "A stock count difference waits for approval", detail: null, link: `/inventory/counts/${r.id}`, openedAt: d(r.at),
    })),
  // A production order (draft or planned work order) waits for Approve (approveProductionOrder); the row opens the order.
  "approval.production_order": async (org) =>
    (await run(sql`select w.id, w.site_id, w.work_order_number, coalesce(w.submitted_at, w.created_at) as at, p.name from work_orders w join products p on p.id = w.product_id where w.organization_id = ${org}::uuid and w.status in ('draft', 'planned')`)).map((r) => ({
      kind: "approval.production_order", siteId: String(r.site_id), entityType: "work_order", entityId: String(r.id), recordNumber: String(r.work_order_number),
      title: `Production order for ${r.name} waits for approval`, detail: null, link: `/production/orders/${r.id}`, openedAt: d(r.at),
    })),
  "approval.batch_disposition": async (org) =>
    (await run(sql`
      select b.id, b.site_id, b.batch_number, b.status, coalesce((select max(t.at) from batch_state_transitions t where t.batch_id = b.id), b.created_at) as at, p.name
      from batches b join products p on p.id = b.product_id where b.organization_id = ${org}::uuid and b.status in ('awaiting_qc','quarantined')`)).map((r) => ({
      kind: "approval.batch_disposition", siteId: String(r.site_id), entityType: "batch", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `${r.name}: a batch waits for the QA check`, detail: r.status === "awaiting_qc" ? "Made; nobody may use it until QA says OK." : "Waiting for QA check; kept apart until QA decides.", link: `/quality/check/${r.id}`, openedAt: d(r.at),
    })),
  "approval.inspection_review": async (org) =>
    (await run(sql`select id, site_id, inspection_number, created_at as at from inspections where organization_id = ${org}::uuid and status = 'awaiting_review'`)).map((r) => ({
      kind: "approval.inspection_review", siteId: String(r.site_id), entityType: "inspection", entityId: String(r.id), recordNumber: String(r.inspection_number),
      title: "A quality check waits for review", detail: null, link: `/quality/inspections/${r.id}`, openedAt: d(r.at),
    })),
  "approval.conditional_release": async (org) =>
    (await run(sql`select dr.id, dr.site_id, dr.batch_id, b.batch_number, dr.requested_at as at, p.name from disposition_requests dr join batches b on b.id = dr.batch_id join products p on p.id = b.product_id where dr.organization_id = ${org}::uuid and dr.status = 'pending'`)).map((r) => ({
      kind: "approval.conditional_release", siteId: String(r.site_id), entityType: "disposition_request", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `${r.name}: “OK with conditions” waits for a second QA person`, detail: null, link: `/quality/batches/${r.batch_id}`, openedAt: d(r.at),
    })),
  "approval.batch_reopen": async (org) =>
    (await run(sql`select rr.id, rr.site_id, rr.batch_id, b.batch_number, rr.requested_at as at, p.name from batch_reopen_requests rr join batches b on b.id = rr.batch_id join products p on p.id = b.product_id where rr.organization_id = ${org}::uuid and rr.status = 'pending'`)).map((r) => ({
      kind: "approval.batch_reopen", siteId: String(r.site_id), entityType: "batch_reopen_request", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `${r.name}: reopening a batch waits for approval`, detail: null, link: `/production/${r.batch_id}/closure`, openedAt: d(r.at),
    })),
  "approval.equipment_override": async (org) =>
    (await run(sql`select o.id, o.site_id, o.equipment_id, e.code, e.name, o.requested_at as at from equipment_override_requests o join equipment e on e.id = o.equipment_id where o.organization_id = ${org}::uuid and o.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.equipment_override", siteId: String(r.site_id), entityType: "equipment_override_request", entityId: String(r.id), recordNumber: String(r.code),
      title: `Using ${r.name} anyway waits for approval`, detail: null, link: `/masterdata/equipment/${r.equipment_id}`, openedAt: d(r.at),
    })),
  "approval.setting_change": async (org) =>
    (await run(sql`select id, site_id, key, created_at as at from setting_change_requests where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
      kind: "approval.setting_change", siteId: r.site_id ? String(r.site_id) : null, entityType: "setting_change_request", entityId: String(r.id), recordNumber: String(r.key),
      title: `A change to the setting “${settingWords(String(r.key))}” waits for approval`, detail: null, link: `/admin/settings`, openedAt: d(r.at),
    })),
  "approval.template_version": async (org) =>
    (await run(sql`
      select v.id, t.id as template_id, t.site_id, t.code, t.name, v.version_no, v.updated_at as at from document_template_versions v join document_templates t on t.id = v.document_template_id
      where t.organization_id = ${org}::uuid and v.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.template_version", siteId: r.site_id ? String(r.site_id) : null, entityType: "document_template_version", entityId: String(r.id), recordNumber: `${r.code} v${r.version_no}`,
      title: `Layout “${r.name}” version ${r.version_no} waits for approval`, detail: null, link: `/admin/templates/${r.template_id}`, openedAt: d(r.at),
    })),
  late_work_order: async (org, _now, today) => {
    const grace = await getSetting(db, org, "action_centre.work_order_late_grace_days");
    return (await run(sql`
      select w.id, w.site_id, w.work_order_number, w.status, w.planned_end::text as pe, (${today}::date - w.planned_end) as days, p.name from work_orders w join products p on p.id = w.product_id
      where w.organization_id = ${org}::uuid and w.status in ('planned','released','in_progress') and w.planned_end < (${today}::date - ${grace}::int)`)).map((r) => ({
      kind: "late_work_order", siteId: String(r.site_id), entityType: "work_order", entityId: String(r.id), recordNumber: String(r.work_order_number),
      title: `Production order for ${r.name} is ${days(r.days)} late`, detail: `Planned to finish on ${plainDate(String(r.pe))}`, link: `/production/orders/${r.id}`,
      openedAt: new Date(`${r.pe}T16:00:00Z`),
    }));
  },
  low_stock: async (org) =>
    (await run(sql`
      select ms.id, ms.site_id, p.id as product_id, p.sku_code, p.name, trim_scale(ms.min_stock_units)::text as min, trim_scale(coalesce(sum(b.qty_base), 0))::text as on_hand, ms.updated_at as at
      from product_min_stock ms
      join products p on p.id = ms.product_id
      left join inventory_lots lot on lot.product_id = ms.product_id and lot.site_id = ms.site_id and lot.quality_status = 'released'
      left join inventory_balances b on b.lot_id = lot.id and b.qty_base > 0
      where ms.organization_id = ${org}::uuid and ms.min_stock_units > 0
      group by ms.id, ms.site_id, p.id, p.sku_code, p.name, ms.min_stock_units, ms.updated_at
      having coalesce(sum(b.qty_base), 0) < ms.min_stock_units`)).map((r) => ({
      kind: "low_stock", siteId: String(r.site_id), entityType: "product_min_stock", entityId: String(r.id), recordNumber: String(r.sku_code),
      title: `${r.name} is running low`, detail: `Ready to use ${r.on_hand} pcs, minimum ${r.min} pcs`, link: `/inventory/items/product/${r.product_id}`, openedAt: d(r.at),
    })),
  expiring_lot: async (org, _now, today) => {
    const buckets = await getSetting(db, org, "inventory.expiry.alert_days");
    const horizon = Math.min(...buckets);
    return (await run(sql`
      select lot.id, lot.site_id, lot.lot_number, lot.expires_on::text as exp, (lot.expires_on - ${today}::date) as days, coalesce(m.name, p.name) as name
      from inventory_lots lot left join materials m on m.id = lot.material_id left join products p on p.id = lot.product_id
      where lot.organization_id = ${org}::uuid and lot.quality_status not in ('expired','rejected','recalled') and lot.expires_on is not null
        and lot.expires_on >= ${today}::date and lot.expires_on <= (${today}::date + ${horizon}::int)
        and exists (select 1 from inventory_balances b where b.lot_id = lot.id and b.qty_base > 0)`)).map((r) => ({
      kind: "expiring_lot", siteId: String(r.site_id), entityType: "inventory_lot", entityId: String(r.id), recordNumber: String(r.lot_number),
      title: `${r.name ?? "A lot"} goes out of date in ${days(r.days)}`, detail: `Expires on ${plainDate(String(r.exp))}`, link: `/inventory/${r.id}`, openedAt: new Date(Date.parse(`${r.exp}T00:00:00Z`) - horizon * 86_400_000),
    }));
  },
  expired_stock: async (org, _now, today) =>
    (await run(sql`
      select lot.id, lot.site_id, lot.lot_number, lot.expires_on::text as exp, coalesce(m.name, p.name) as name
      from inventory_lots lot left join materials m on m.id = lot.material_id left join products p on p.id = lot.product_id
      where lot.organization_id = ${org}::uuid and lot.expires_on is not null and lot.expires_on < ${today}::date and lot.quality_status not in ('rejected','recalled')
        and exists (select 1 from inventory_balances b where b.lot_id = lot.id and b.qty_base > 0)`)).map((r) => ({
      kind: "expired_stock", siteId: String(r.site_id), entityType: "inventory_lot", entityId: String(r.id), recordNumber: String(r.lot_number),
      title: `${r.name ?? "A lot"} went out of date on ${plainDate(String(r.exp))} and is still in stock`, detail: "Do not use it. Ask QA whether to throw it away.", link: `/inventory/${r.id}`, openedAt: new Date(`${r.exp}T16:00:00Z`),
    })),
  failed_job: async (org) =>
    (await run(sql`select id, site_id, job_kind, finished_at as at, left(coalesce(error_message, ''), 200) as err from background_jobs where organization_id = ${org}::uuid and status = 'failed' and job_kind not like '%import%'`)).map((r) => ({
      kind: "failed_job", siteId: r.site_id ? String(r.site_id) : null, entityType: "background_job", entityId: String(r.id), recordNumber: String(r.job_kind),
      title: `An automatic task failed (${String(r.job_kind).replace(/[._]/g, " ")})`, detail: String(r.err) || null, link: `/admin/diagnostics?job=${r.id}#jobs`, openedAt: d(r.at ?? new Date()),
    })),
  failed_import: async (org) =>
    (await run(sql`select id, site_id, job_kind, finished_at as at, left(coalesce(error_message, ''), 200) as err from background_jobs where organization_id = ${org}::uuid and status = 'failed' and job_kind like '%import%'`)).map((r) => ({
      kind: "failed_import", siteId: r.site_id ? String(r.site_id) : null, entityType: "background_job", entityId: String(r.id), recordNumber: String(r.job_kind),
      title: "Loading a spreadsheet failed", detail: String(r.err) || null, link: `/admin/diagnostics?job=${r.id}#jobs`, openedAt: d(r.at ?? new Date()),
    })),
  reconciliation_difference: async (org) =>
    (await run(sql`
      select distinct on (coalesce(site_id::text, ''), kind) id, site_id, kind, status, differences_count, created_at as at from reconciliation_runs
      where organization_id = ${org}::uuid and kind <> 'rebuild' order by coalesce(site_id::text, ''), kind, created_at desc`))
      .filter((r) => r.status === "differences")
      .map((r) => ({
        kind: "reconciliation_difference", siteId: r.site_id ? String(r.site_id) : null, entityType: "reconciliation_run", entityId: String(r.id), recordNumber: String(r.kind),
        title: `Stock check found ${Number(r.differences_count) === 1 ? "1 difference" : `${r.differences_count} differences`}`, detail: "The stock history and the stock totals do not agree. Ask IT to look before anything is rebuilt (runbook §9).", link: `/admin/diagnostics?run=${r.id}#reconciliation`, openedAt: d(r.at),
      })),
  open_hold: async (org) =>
    (await run(sql`select id, site_id, hold_number, reason_code, opened_at as at from quality_holds where organization_id = ${org}::uuid and status <> 'closed'`)).map((r) => ({
      kind: "open_hold", siteId: String(r.site_id), entityType: "quality_hold", entityId: String(r.id), recordNumber: String(r.hold_number),
      title: `Stopped by QA: ${String(r.reason_code).replace(/_/g, " ")}`, detail: `Why: ${String(r.reason_code).replace(/_/g, " ")}`, link: `/quality/holds/${r.id}`, openedAt: d(r.at),
    })),
  open_deviation: async (org) =>
    (await run(sql`select id, site_id, deviation_number, status, coalesce(severity, 'unclassified') as sev, raised_at as at from deviations where organization_id = ${org}::uuid and status <> 'closed'`)).map((r) => ({
      kind: "open_deviation", siteId: String(r.site_id), entityType: "deviation", entityId: String(r.id), recordNumber: String(r.deviation_number),
      title: `A problem report is ${String(r.status).replace(/_/g, " ")}`, detail: `How serious: ${String(r.sev).replace(/_/g, " ")}`, link: `/quality/deviations/${r.id}`, openedAt: d(r.at),
    })),
  // W3E: issued delivery receipts of shipments still out (not acknowledged), after
  // `sales.delivery_receipt.unacknowledged_days` (the same setting as the daily DR reminder job).
  unacknowledged_dr: async (org, now) => {
    const rows = await run(sql`
      select sh.id, sh.site_id, coalesce(dr.dr_number, sh.delivery_receipt_number) as dr_number, sh.shipment_number, sh.dispatched_at as at, c.name
      from shipments sh join delivery_receipts dr on dr.shipment_id = sh.id and dr.status = 'issued'
      join sales_orders so on so.id = sh.sales_order_id join customers c on c.id = so.customer_id
      where sh.organization_id = ${org}::uuid and sh.status = 'dispatched' and sh.dispatched_at is not null`);
    const out: Candidate[] = [];
    for (const r of rows) {
      const days = await getSetting(db, org, "sales.delivery_receipt.unacknowledged_days", String(r.site_id));
      if (now.getTime() - d(r.at).getTime() < days * 86_400_000) continue;
      out.push({
        kind: "unacknowledged_dr", siteId: String(r.site_id), entityType: "shipment", entityId: String(r.id), recordNumber: String(r.dr_number ?? r.shipment_number),
        title: `Delivery to ${r.name} has no signed receipt yet`, detail: `Sent out more than ${days === 1 ? "1 day" : `${days} days`} ago`, link: `/sales/shipments/${r.id}`, openedAt: new Date(d(r.at).getTime() + days * 86_400_000),
      });
    }
    return out;
  },
  unshipped_order: async (org, _now, today) => {
    const grace = await getSetting(db, org, "action_centre.order_late_grace_days");
    return (await run(sql`
      select so.id, so.site_id, so.order_number, so.status, so.requested_delivery_on as req, c.name from sales_orders so join customers c on c.id = so.customer_id
      where so.organization_id = ${org}::uuid and so.status in ('confirmed','allocated','picking','packed','partially_shipped')
        and (case when so.requested_delivery_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then so.requested_delivery_on::date end) < (${today}::date - ${grace}::int)`)).map((r) => ({
      kind: "unshipped_order", siteId: String(r.site_id), entityType: "sales_order", entityId: String(r.id), recordNumber: String(r.order_number),
      title: `Order for ${r.name} is not sent out yet; they wanted it on ${plainDate(String(r.req))}`, detail: ORDER_STEP_WORDS[String(r.status)] ?? null, link: `/sales/${r.id}`, openedAt: new Date(`${r.req}T16:00:00Z`),
    }));
  },
  // W3D: commercial approvals and credit holds.
  "approval.sales_order": async (org) =>
    (await run(sql`select so.id, so.site_id, so.order_number, coalesce(so.submitted_at, so.status_changed_at) as at, c.name from sales_orders so join customers c on c.id = so.customer_id where so.organization_id = ${org}::uuid and so.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.sales_order", siteId: String(r.site_id), entityType: "sales_order", entityId: String(r.id), recordNumber: String(r.order_number),
      title: `Order for ${r.name} waits for approval`, detail: null, link: `/sales/${r.id}`, openedAt: d(r.at),
    })),
  "approval.quote": async (org) =>
    (await run(sql`select q.id, q.site_id, q.quote_number, coalesce(q.submitted_at, q.created_at) as at, c.name from quotes q join customers c on c.id = q.customer_id where q.organization_id = ${org}::uuid and q.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.quote", siteId: String(r.site_id), entityType: "quote", entityId: String(r.id), recordNumber: String(r.quote_number),
      title: `Price offer for ${r.name} waits for approval`, detail: null, link: `/sales/quotations/${r.id}`, openedAt: d(r.at),
    })),
  "approval.price_list": async (org) =>
    (await run(sql`select id, code, name, version_no, coalesce(submitted_at, created_at) as at from price_lists where organization_id = ${org}::uuid and status = 'pending_approval'`)).map((r) => ({
      kind: "approval.price_list", siteId: null, entityType: "price_list", entityId: String(r.id), recordNumber: `${r.code} v${r.version_no}`,
      title: `Prices “${r.name ?? r.code}” version ${r.version_no} wait for approval`, detail: null, link: `/sales/price-lists/${r.id}`, openedAt: d(r.at),
    })),
  "approval.customer_requirement": async (org) =>
    (await run(sql`
      select r.id, r.customer_id, c.name, r.requirement_kind, r.version_no, coalesce(r.submitted_at, r.created_at) as at
      from customer_requirements r join customers c on c.id = r.customer_id where r.organization_id = ${org}::uuid and r.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.customer_requirement", siteId: null, entityType: "customer_requirement", entityId: String(r.id), recordNumber: `${String(r.requirement_kind).replace(/_/g, " ")} v${r.version_no}`,
      title: `Special rule of ${r.name} waits for approval`, detail: `${String(r.requirement_kind).replace(/_/g, " ")}, version ${r.version_no}`, link: `/sales/customers/${r.customer_id}`, openedAt: d(r.at),
    })),
  credit_hold: async (org) =>
    (await run(sql`
      select c.id, c.code, c.name, c.updated_at as at,
             (select count(*)::int from sales_orders so where so.customer_id = c.id and so.status in ('draft','submitted','pending_approval')) as waiting
      from customers c where c.organization_id = ${org}::uuid and c.status = 'on_hold'`)).map((r) => ({
      kind: "credit_hold", siteId: null, entityType: "customer", entityId: String(r.id), recordNumber: String(r.code),
      title: `${r.name} is stopped for unpaid bills`, detail: Number(r.waiting) ? `${Number(r.waiting) === 1 ? "1 order" : `${r.waiting} orders`} not accepted yet` : "New orders need an OK first", link: `/sales/customers/${r.id}`, openedAt: d(r.at),
    })),
  // W3F: complaints and customer returns.
  open_complaint: async (org) =>
    (await run(sql`select x.id, x.site_id, x.complaint_number, x.status, coalesce(x.severity, 'unclassified') as sev, x.received_at as at, c.name from complaints x left join customers c on c.id = x.customer_id where x.organization_id = ${org}::uuid and x.status in ('open','investigating')`)).map((r) => ({
      kind: "open_complaint", siteId: String(r.site_id), entityType: "complaint", entityId: String(r.id), recordNumber: String(r.complaint_number),
      title: `Complaint${r.name ? ` from ${r.name}` : ""}: ${r.status === "open" ? "new" : "being looked into"}`, detail: `How serious: ${String(r.sev).replace(/_/g, " ")}`, link: `/quality/complaints/${r.id}`, openedAt: d(r.at),
    })),
  "approval.customer_return": async (org) =>
    (await run(sql`select x.id, x.site_id, x.return_number, coalesce(x.submitted_at, x.created_at) as at, c.name from customer_returns x join customers c on c.id = x.customer_id where x.organization_id = ${org}::uuid and x.status = 'submitted'`)).map((r) => ({
      kind: "approval.customer_return", siteId: String(r.site_id), entityType: "customer_return", entityId: String(r.id), recordNumber: String(r.return_number),
      title: `Return from ${r.name} waits for approval`, detail: null, link: `/sales/returns/${r.id}`, openedAt: d(r.at),
    })),
  return_awaiting_qa: async (org) =>
    (await run(sql`select x.id, x.site_id, x.return_number, x.received_at as at, c.name from customer_returns x join customers c on c.id = x.customer_id where x.organization_id = ${org}::uuid and x.status = 'received'`)).map((r) => ({
      kind: "return_awaiting_qa", siteId: String(r.site_id), entityType: "customer_return", entityId: String(r.id), recordNumber: String(r.return_number),
      title: `Goods returned by ${r.name} wait for the QA check`, detail: "Kept apart until QA decides; QA decides each returned lot.", link: `/sales/returns/${r.id}`, openedAt: d(r.at),
    })),
};

/** Every current candidate of the organization (built-in detectors, replaced by registered sources of the same kind). */
export async function detectAll(organizationId: string, now: Date): Promise<Candidate[]> {
  const tz = await orgTz(organizationId);
  const today = localDate(now, tz);
  const reg = registry();
  const out: Candidate[] = [];
  for (const [kind, fn] of Object.entries(BUILT_IN)) {
    const src = reg.get(kind);
    out.push(...(src ? await src.detect(organizationId, now) : await fn(organizationId, now, today)));
  }
  for (const [kind, src] of reg) if (!BUILT_IN[kind]) out.push(...(await src.detect(organizationId, now)));
  return out;
}

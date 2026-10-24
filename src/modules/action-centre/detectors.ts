import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
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

const BUILT_IN: Record<string, (org: string, now: Date, today: string) => Promise<Candidate[]>> = {
  "approval.stock_adjustment": async (org) =>
    (await run(sql`select id, site_id, adjustment_number, reason_code, coalesce(submitted_at, created_at) as at from stock_adjustments where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
      kind: "approval.stock_adjustment", siteId: String(r.site_id), entityType: "stock_adjustment", entityId: String(r.id), recordNumber: String(r.adjustment_number),
      title: `Adjustment ${r.adjustment_number} waits for approval`, detail: `Reason ${r.reason_code}`, link: `/inventory/adjustments/${r.id}`, openedAt: d(r.at),
    })),
  "approval.stock_count": async (org) =>
    (await run(sql`select id, site_id, count_number, created_at as at from stock_counts where organization_id = ${org}::uuid and status = 'pending_approval'`)).map((r) => ({
      kind: "approval.stock_count", siteId: String(r.site_id), entityType: "stock_count", entityId: String(r.id), recordNumber: String(r.count_number),
      title: `Count ${r.count_number} variance waits for approval`, detail: null, link: `/inventory/counts/${r.id}`, openedAt: d(r.at),
    })),
  "approval.work_order_release": async (org) =>
    (await run(sql`select id, site_id, work_order_number, planned_start::text as ps, coalesce(submitted_at, status_changed_at) as at from work_orders where organization_id = ${org}::uuid and status = 'planned'`)).map((r) => ({
      kind: "approval.work_order_release", siteId: String(r.site_id), entityType: "work_order", entityId: String(r.id), recordNumber: String(r.work_order_number),
      title: `Work order ${r.work_order_number} waits for release`, detail: `Planned start ${r.ps}`, link: `/production/work-orders/${r.id}`, openedAt: d(r.at),
    })),
  "approval.batch_disposition": async (org) =>
    (await run(sql`
      select b.id, b.site_id, b.batch_number, b.status, coalesce((select max(t.at) from batch_state_transitions t where t.batch_id = b.id), b.created_at) as at
      from batches b where b.organization_id = ${org}::uuid and b.status in ('awaiting_qc','quarantined')`)).map((r) => ({
      kind: "approval.batch_disposition", siteId: String(r.site_id), entityType: "batch", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `Batch ${r.batch_number} waits for a QA decision`, detail: `Status ${String(r.status).replace("_", " ")}`, link: `/quality/batches/${r.id}`, openedAt: d(r.at),
    })),
  "approval.inspection_review": async (org) =>
    (await run(sql`select id, site_id, inspection_number, created_at as at from inspections where organization_id = ${org}::uuid and status = 'awaiting_review'`)).map((r) => ({
      kind: "approval.inspection_review", siteId: String(r.site_id), entityType: "inspection", entityId: String(r.id), recordNumber: String(r.inspection_number),
      title: `Inspection ${r.inspection_number} waits for review`, detail: null, link: `/quality/inspections/${r.id}`, openedAt: d(r.at),
    })),
  "approval.conditional_release": async (org) =>
    (await run(sql`select dr.id, dr.site_id, dr.batch_id, b.batch_number, dr.requested_at as at from disposition_requests dr join batches b on b.id = dr.batch_id where dr.organization_id = ${org}::uuid and dr.status = 'pending'`)).map((r) => ({
      kind: "approval.conditional_release", siteId: String(r.site_id), entityType: "disposition_request", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `Conditional release of ${r.batch_number} waits for a second QA approver`, detail: null, link: `/quality/batches/${r.batch_id}`, openedAt: d(r.at),
    })),
  "approval.batch_reopen": async (org) =>
    (await run(sql`select rr.id, rr.site_id, rr.batch_id, b.batch_number, rr.requested_at as at from batch_reopen_requests rr join batches b on b.id = rr.batch_id where rr.organization_id = ${org}::uuid and rr.status = 'pending'`)).map((r) => ({
      kind: "approval.batch_reopen", siteId: String(r.site_id), entityType: "batch_reopen_request", entityId: String(r.id), recordNumber: String(r.batch_number),
      title: `Reopen of ${r.batch_number} waits for approval`, detail: null, link: `/production/${r.batch_id}/closure`, openedAt: d(r.at),
    })),
  "approval.equipment_override": async (org) =>
    (await run(sql`select o.id, o.site_id, o.equipment_id, e.code, o.requested_at as at from equipment_override_requests o join equipment e on e.id = o.equipment_id where o.organization_id = ${org}::uuid and o.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.equipment_override", siteId: String(r.site_id), entityType: "equipment_override_request", entityId: String(r.id), recordNumber: String(r.code),
      title: `Override for equipment ${r.code} waits for approval`, detail: null, link: `/masterdata/equipment/${r.equipment_id}`, openedAt: d(r.at),
    })),
  "approval.setting_change": async (org) =>
    (await run(sql`select id, site_id, key, created_at as at from setting_change_requests where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
      kind: "approval.setting_change", siteId: r.site_id ? String(r.site_id) : null, entityType: "setting_change_request", entityId: String(r.id), recordNumber: String(r.key),
      title: `Change of setting ${r.key} waits for approval`, detail: null, link: `/admin/settings`, openedAt: d(r.at),
    })),
  "approval.template_version": async (org) =>
    (await run(sql`
      select v.id, t.id as template_id, t.site_id, t.code, v.version_no, v.updated_at as at from document_template_versions v join document_templates t on t.id = v.document_template_id
      where t.organization_id = ${org}::uuid and v.status = 'pending_approval'`)).map((r) => ({
      kind: "approval.template_version", siteId: r.site_id ? String(r.site_id) : null, entityType: "document_template_version", entityId: String(r.id), recordNumber: `${r.code} v${r.version_no}`,
      title: `Template ${r.code} version ${r.version_no} waits for approval`, detail: null, link: `/admin/templates/${r.template_id}`, openedAt: d(r.at),
    })),
  late_work_order: async (org, _now, today) => {
    const grace = await getSetting(db, org, "action_centre.work_order_late_grace_days");
    return (await run(sql`
      select id, site_id, work_order_number, status, planned_end::text as pe, (${today}::date - planned_end) as days from work_orders
      where organization_id = ${org}::uuid and status in ('planned','released','in_progress') and planned_end < (${today}::date - ${grace}::int)`)).map((r) => ({
      kind: "late_work_order", siteId: String(r.site_id), entityType: "work_order", entityId: String(r.id), recordNumber: String(r.work_order_number),
      title: `Work order ${r.work_order_number} is ${r.days} day(s) late`, detail: `Planned end ${r.pe} · ${String(r.status).replace("_", " ")}`, link: `/production/work-orders/${r.id}`,
      openedAt: new Date(`${r.pe}T16:00:00Z`),
    }));
  },
  low_stock: async (org) =>
    (await run(sql`
      select ms.id, ms.site_id, p.sku_code, p.name, trim_scale(ms.min_stock_units)::text as min, trim_scale(coalesce(sum(b.qty_base), 0))::text as on_hand, ms.updated_at as at
      from product_min_stock ms
      join products p on p.id = ms.product_id
      left join inventory_lots lot on lot.product_id = ms.product_id and lot.site_id = ms.site_id and lot.quality_status = 'released'
      left join inventory_balances b on b.lot_id = lot.id and b.qty_base > 0
      where ms.organization_id = ${org}::uuid and ms.min_stock_units > 0
      group by ms.id, ms.site_id, p.sku_code, p.name, ms.min_stock_units, ms.updated_at
      having coalesce(sum(b.qty_base), 0) < ms.min_stock_units`)).map((r) => ({
      kind: "low_stock", siteId: String(r.site_id), entityType: "product_min_stock", entityId: String(r.id), recordNumber: String(r.sku_code),
      title: `${r.sku_code} ${r.name} is below minimum stock`, detail: `Released on hand ${r.on_hand} pcs, minimum ${r.min} pcs`, link: `/production/plan`, openedAt: d(r.at),
    })),
  expiring_lot: async (org, _now, today) => {
    const buckets = await getSetting(db, org, "inventory.expiry.alert_days");
    const horizon = Math.min(...buckets);
    return (await run(sql`
      select lot.id, lot.site_id, lot.lot_number, lot.expires_on::text as exp, (lot.expires_on - ${today}::date) as days
      from inventory_lots lot
      where lot.organization_id = ${org}::uuid and lot.quality_status not in ('expired','rejected','recalled') and lot.expires_on is not null
        and lot.expires_on >= ${today}::date and lot.expires_on <= (${today}::date + ${horizon}::int)
        and exists (select 1 from inventory_balances b where b.lot_id = lot.id and b.qty_base > 0)`)).map((r) => ({
      kind: "expiring_lot", siteId: String(r.site_id), entityType: "inventory_lot", entityId: String(r.id), recordNumber: String(r.lot_number),
      title: `Lot ${r.lot_number} expires in ${r.days} day(s)`, detail: `Expires on ${r.exp}`, link: `/inventory/${r.id}`, openedAt: new Date(Date.parse(`${r.exp}T00:00:00Z`) - horizon * 86_400_000),
    }));
  },
  expired_stock: async (org, _now, today) =>
    (await run(sql`
      select lot.id, lot.site_id, lot.lot_number, lot.expires_on::text as exp
      from inventory_lots lot
      where lot.organization_id = ${org}::uuid and lot.expires_on is not null and lot.expires_on < ${today}::date and lot.quality_status not in ('rejected','recalled')
        and exists (select 1 from inventory_balances b where b.lot_id = lot.id and b.qty_base > 0)`)).map((r) => ({
      kind: "expired_stock", siteId: String(r.site_id), entityType: "inventory_lot", entityId: String(r.id), recordNumber: String(r.lot_number),
      title: `Lot ${r.lot_number} expired on ${r.exp} and still has stock`, detail: "Decide disposal or rejection; expired stock cannot be used.", link: `/inventory/${r.id}`, openedAt: new Date(`${r.exp}T16:00:00Z`),
    })),
  failed_job: async (org) =>
    (await run(sql`select id, site_id, job_kind, finished_at as at, left(coalesce(error_message, ''), 200) as err from background_jobs where organization_id = ${org}::uuid and status = 'failed' and job_kind not like '%import%'`)).map((r) => ({
      kind: "failed_job", siteId: r.site_id ? String(r.site_id) : null, entityType: "background_job", entityId: String(r.id), recordNumber: String(r.job_kind),
      title: `Background job ${r.job_kind} failed`, detail: String(r.err) || null, link: `/admin/diagnostics?job=${r.id}#jobs`, openedAt: d(r.at ?? new Date()),
    })),
  failed_import: async (org) =>
    (await run(sql`select id, site_id, job_kind, finished_at as at, left(coalesce(error_message, ''), 200) as err from background_jobs where organization_id = ${org}::uuid and status = 'failed' and job_kind like '%import%'`)).map((r) => ({
      kind: "failed_import", siteId: r.site_id ? String(r.site_id) : null, entityType: "background_job", entityId: String(r.id), recordNumber: String(r.job_kind),
      title: `Import ${r.job_kind} failed`, detail: String(r.err) || null, link: `/admin/diagnostics?job=${r.id}#jobs`, openedAt: d(r.at ?? new Date()),
    })),
  reconciliation_difference: async (org) =>
    (await run(sql`
      select distinct on (coalesce(site_id::text, ''), kind) id, site_id, kind, status, differences_count, created_at as at from reconciliation_runs
      where organization_id = ${org}::uuid and kind <> 'rebuild' order by coalesce(site_id::text, ''), kind, created_at desc`))
      .filter((r) => r.status === "differences")
      .map((r) => ({
        kind: "reconciliation_difference", siteId: r.site_id ? String(r.site_id) : null, entityType: "reconciliation_run", entityId: String(r.id), recordNumber: String(r.kind),
        title: `Reconciliation found ${r.differences_count} difference(s)`, detail: "Ledger and balance table disagree; investigate before rebuilding (runbook §9).", link: `/admin/diagnostics?run=${r.id}#reconciliation`, openedAt: d(r.at),
      })),
  open_hold: async (org) =>
    (await run(sql`select id, site_id, hold_number, reason_code, opened_at as at from quality_holds where organization_id = ${org}::uuid and status <> 'closed'`)).map((r) => ({
      kind: "open_hold", siteId: String(r.site_id), entityType: "quality_hold", entityId: String(r.id), recordNumber: String(r.hold_number),
      title: `Hold ${r.hold_number} is open`, detail: `Reason ${r.reason_code}`, link: `/quality/holds/${r.id}`, openedAt: d(r.at),
    })),
  open_deviation: async (org) =>
    (await run(sql`select id, site_id, deviation_number, status, coalesce(severity, 'unclassified') as sev, raised_at as at from deviations where organization_id = ${org}::uuid and status <> 'closed'`)).map((r) => ({
      kind: "open_deviation", siteId: String(r.site_id), entityType: "deviation", entityId: String(r.id), recordNumber: String(r.deviation_number),
      title: `Deviation ${r.deviation_number} is ${r.status}`, detail: `Severity ${r.sev}`, link: `/quality/deviations/${r.id}`, openedAt: d(r.at),
    })),
  unacknowledged_dr: async (org, now) => {
    const rows = await run(sql`select sh.id, sh.site_id, sh.sales_order_id, sh.delivery_receipt_number, sh.dispatched_at as at from shipments sh where sh.organization_id = ${org}::uuid and sh.delivered_at is null`);
    const out: Candidate[] = [];
    for (const r of rows) {
      const hours = await getSetting(db, org, "action_centre.dr_unacknowledged_hours", String(r.site_id));
      if (now.getTime() - d(r.at).getTime() < hours * 3_600_000) continue;
      out.push({
        kind: "unacknowledged_dr", siteId: String(r.site_id), entityType: "shipment", entityId: String(r.id), recordNumber: String(r.delivery_receipt_number),
        title: `Delivery receipt ${r.delivery_receipt_number} is not acknowledged`, detail: `Dispatched more than ${hours} h ago`, link: `/sales/${r.sales_order_id}`, openedAt: new Date(d(r.at).getTime() + hours * 3_600_000),
      });
    }
    return out;
  },
  unshipped_order: async (org, _now, today) => {
    const grace = await getSetting(db, org, "action_centre.order_late_grace_days");
    return (await run(sql`
      select so.id, so.site_id, so.order_number, so.requested_delivery_on as req from sales_orders so
      where so.organization_id = ${org}::uuid and so.status in ('confirmed','allocated')
        and (case when so.requested_delivery_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then so.requested_delivery_on::date end) < (${today}::date - ${grace}::int)`)).map((r) => ({
      kind: "unshipped_order", siteId: String(r.site_id), entityType: "sales_order", entityId: String(r.id), recordNumber: String(r.order_number),
      title: `Order ${r.order_number} is not shipped; requested for ${r.req}`, detail: null, link: `/sales/${r.id}`, openedAt: new Date(`${r.req}T16:00:00Z`),
    }));
  },
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

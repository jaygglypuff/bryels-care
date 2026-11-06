import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { lotsToPutAway } from "@/modules/inventory";
import { comingWords, siteOrderCover } from "@/modules/production";
import { FLOW_COUNT_DEFS, FLOW_STAGES, countWords, stageRow, type FlowCount, type FlowCountDef, type FlowCountKey, type FlowStage } from "./work-flow-stages";

/**
 * "How work flows" read model (ADR-106 §5, ADR-110 C0; docs/END_TO_END_FLOW.md C0). One row per stage of the 16, each
 * with its counts, the oldest item's age and the red rule ("waits on nobody": an item no message points to).
 *
 * - Site-scoped: the caller's current site only (`ctx.requireSite`); nothing from another site is counted.
 * - Permission-aware: every count needs its own view permissions at the site (FLOW_STAGES); a count the viewer may
 *   not see is not run, and a stage with no visible count is left out.
 * - One query per count. The four customer-order counts that depend on stock (short, coming, short with no
 *   production order, can now be set aside) share one read of the order-cover rule (`siteOrderCover`, production).
 * - Each count's items are the same query (`getWorkFlowItems`), so the list behind a number always matches it.
 *
 * Read only; it decides nothing. The screens it links to re-check everything.
 */

export const FLOW_ITEM_LIMIT = 500;

export type FlowItem = {
  id: string;
  /** The record number ("PR-26-00003"). */
  ref: string;
  /** What it is, in words ("Coconut Oil", "Isla Spa Supplies"). */
  label: string;
  since: Date;
  href: string;
  /** A message (notification) points to this record since it reached this stage. */
  told: boolean;
};

type Q = { org: string; site: string; today: string };
type Row = { id: string; ref: string; label: string | null; since: Date | string; href: string; told: boolean };

/** "A message points to the record since it got here" (C0 red rule). `ids` is the SQL of the record id(s). */
const toldSql = (ids: SQL, since: SQL, notKinds: readonly string[] = []) =>
  sql`exists (select 1 from notifications n where n.entity_id in (${ids}) and n.created_at >= ${since} - interval '5 seconds'${notKinds.length ? sql` and n.kind not in (${sql.join(notKinds.map((k) => sql`${k}`), sql`, `)})` : sql``})`;

const BATCH_HREF = sql`case when b.work_order_id is not null then '/production/orders/' || b.work_order_id::text else '/production/' || b.id::text end`;
/** A weighing of batch `b` that still waits for the second person's check (lines that need one; floor-tasks.ts rule). */
const UNCHECKED = sql`select 1 from dispense_records d join batch_materials bm on bm.id = d.batch_material_id
  where bm.batch_id = b.id and d.checker_id is null and d.voided_at is null
    and coalesce((select (e->>'requiresChecker')::boolean from jsonb_array_elements(b.formula_snapshot->'lines') e where (e->>'lineNo')::int = bm.line_no limit 1), true)`;
const RECEIVABLE = sql`('sent', 'partially_received')`;
const LOT_LABEL_JOB_OPEN = sql`('queued', 'rendering', 'ready', 'failed')`;

/** The SQL behind each count (all except the stock-based customer-order counts). Columns: id, ref, label, since, href, told. */
const QUERIES: Partial<Record<FlowCountKey, (q: Q) => SQL>> = {
  pr_waiting: (q) => sql`
    select pr.id, pr.request_number as ref,
           (select string_agg(m.name, ', ' order by l.line_no) from purchase_request_lines l join materials m on m.id = l.material_id where l.purchase_request_id = pr.id) as label,
           coalesce(pr.submitted_at, pr.status_changed_at) as since, '/procurement/requests/' || pr.id::text as href,
           ${toldSql(sql`pr.id`, sql`coalesce(pr.submitted_at, pr.status_changed_at)`)} as told
    from purchase_requests pr where pr.organization_id = ${q.org} and pr.site_id = ${q.site} and pr.status = 'submitted'`,
  pr_to_order: (q) => sql`
    select pr.id, pr.request_number as ref,
           (select string_agg(m.name, ', ' order by l.line_no) from purchase_request_lines l join materials m on m.id = l.material_id where l.purchase_request_id = pr.id) as label,
           coalesce(pr.approved_at, pr.status_changed_at) as since, '/procurement/requests/' || pr.id::text as href,
           ${toldSql(sql`pr.id`, sql`coalesce(pr.approved_at, pr.status_changed_at)`)} as told
    from purchase_requests pr
    where pr.organization_id = ${q.org} and pr.site_id = ${q.site} and pr.status = 'approved'
      and exists (select 1 from purchase_request_lines l where l.purchase_request_id = pr.id and l.converted_po_line_id is null)`,
  po_to_approve: (q) => sql`
    select po.id, po.po_number as ref, s.name as label, coalesce(po.submitted_at, po.status_changed_at) as since, '/procurement/orders/' || po.id::text as href,
           ${toldSql(sql`po.id`, sql`coalesce(po.submitted_at, po.status_changed_at)`)} as told
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.organization_id = ${q.org} and po.site_id = ${q.site} and po.status = 'submitted'`,
  po_to_send: (q) => sql`
    select po.id, po.po_number as ref, s.name as label, coalesce(po.approved_at, po.status_changed_at) as since, '/procurement/orders/' || po.id::text as href,
           ${toldSql(sql`po.id`, sql`coalesce(po.approved_at, po.status_changed_at)`)} as told
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.organization_id = ${q.org} and po.site_id = ${q.site} and po.status = 'approved' and not po.after_the_fact`,
  po_late: (q) => sql`
    select po.id, po.po_number as ref, s.name as label, coalesce(po.promised_date, po.expected_date)::timestamptz as since, '/inventory/receive?po=' || po.id::text as href,
           ${toldSql(sql`po.id`, sql`coalesce(po.sent_at, po.status_changed_at)`, ["purchase_order_approved"])} as told
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.organization_id = ${q.org} and po.site_id = ${q.site} and po.status in ${RECEIVABLE}
      and coalesce(po.promised_date, po.expected_date) < ${q.today}::date`,
  po_due_today: (q) => sql`
    select po.id, po.po_number as ref, s.name as label, coalesce(po.sent_at, po.status_changed_at) as since, '/inventory/receive?po=' || po.id::text as href,
           ${toldSql(sql`po.id`, sql`coalesce(po.sent_at, po.status_changed_at)`, ["purchase_order_approved"])} as told
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.organization_id = ${q.org} and po.site_id = ${q.site} and po.status in ${RECEIVABLE}
      and coalesce(po.promised_date, po.expected_date) = ${q.today}::date`,
  gr_draft: (q) => sql`
    select gr.id, gr.receipt_number as ref, gr.supplier_name as label, gr.created_at as since, '/inventory/receive/' || gr.id::text as href, true as told
    from goods_receipts gr where gr.organization_id = ${q.org} and gr.site_id = ${q.site} and gr.status = 'draft'`,
  labels_unprinted: (q) => sql`
    select lot.id, lot.lot_number as ref, coalesce(m.name, p.name) as label, min(j.requested_at) as since, '/inventory/' || lot.id::text as href, true as told
    from label_jobs j join inventory_lots lot on lot.id = j.entity_id
    left join materials m on m.id = lot.material_id left join products p on p.id = lot.product_id
    where j.organization_id = ${q.org} and j.site_id = ${q.site} and j.entity_type = 'inventory_lot' and j.status in ${LOT_LABEL_JOB_OPEN} and lot.item_kind = 'material'
    group by lot.id, lot.lot_number, m.name, p.name`,
  lots_waiting: (q) => sql`
    select lot.id, lot.lot_number as ref, coalesce(m.name, p.name) as label, lot.created_at as since, '/quality/lots/' || lot.id::text as href,
           ${toldSql(sql`lot.id, (select gl.goods_receipt_id from goods_receipt_lines gl where gl.lot_id = lot.id limit 1)`, sql`lot.created_at`)} as told
    from inventory_lots lot left join materials m on m.id = lot.material_id left join products p on p.id = lot.product_id
    where lot.organization_id = ${q.org} and lot.site_id = ${q.site} and lot.quality_status = 'quarantine' and lot.item_kind = 'material'`,
  lot_checks_second: (q) => sql`
    select i.id, i.inspection_number as ref, coalesce(m.name, '') || ' ' || lot.lot_number as label, i.status_changed_at as since, '/quality/inspections/' || i.id::text as href,
           ${toldSql(sql`i.id, lot.id`, sql`i.status_changed_at`)} as told
    from inspections i join inventory_lots lot on lot.id = i.lot_id left join materials m on m.id = lot.material_id
    where i.organization_id = ${q.org} and i.site_id = ${q.site} and i.status = 'awaiting_review' and i.batch_id is null`,
  so_to_approve: (q) => sql`
    select so.id, so.order_number as ref, c.name as label, coalesce(so.submitted_at, so.status_changed_at) as since, '/sales/' || so.id::text as href,
           ${toldSql(sql`so.id`, sql`coalesce(so.submitted_at, so.status_changed_at)`)} as told
    from sales_orders so join customers c on c.id = so.customer_id
    where so.organization_id = ${q.org} and so.site_id = ${q.site} and so.status in ('submitted', 'pending_approval')`,
  so_confirmed: (q) => sql`
    select so.id, so.order_number as ref, c.name as label, so.status_changed_at as since, '/sales/' || so.id::text as href,
           ${toldSql(sql`so.id`, sql`so.status_changed_at`)} as told
    from sales_orders so join customers c on c.id = so.customer_id
    where so.organization_id = ${q.org} and so.site_id = ${q.site} and so.status = 'confirmed'
      and not exists (select 1 from sales_order_lines l join stock_allocations a on a.sales_order_line_id = l.id where l.sales_order_id = so.id and a.status = 'open')`,
  wo_to_approve: (q) => sql`
    select w.id, w.work_order_number as ref, p.name as label, coalesce(w.submitted_at, w.status_changed_at) as since, '/production/orders/' || w.id::text as href,
           ${toldSql(sql`w.id`, sql`coalesce(w.submitted_at, w.status_changed_at)`)} as told
    from work_orders w join products p on p.id = w.product_id
    where w.organization_id = ${q.org} and w.site_id = ${q.site} and w.status = 'planned'`,
  batches_to_start: (q) => sql`
    select b.id, b.batch_number as ref, p.name as label, coalesce(w.approved_at, b.created_at) as since, ${BATCH_HREF} as href, true as told
    from batches b join products p on p.id = b.product_id left join work_orders w on w.id = b.work_order_id
    where b.organization_id = ${q.org} and b.site_id = ${q.site} and b.status in ('planned', 'materials_staged')
      and (b.work_order_id is null or w.status in ('released', 'in_progress'))`,
  batches_in_process: (q) => sql`
    select b.id, b.batch_number as ref, p.name as label, coalesce(b.started_at, b.created_at) as since, ${BATCH_HREF} as href, true as told
    from batches b join products p on p.id = b.product_id
    where b.organization_id = ${q.org} and b.site_id = ${q.site} and b.status in ('in_process', 'rework_approved')
      and not exists (select 1 from process_step_records r where r.batch_id = b.id and r.status = 'awaiting_check')
      and not exists (${UNCHECKED})`,
  batches_check_waiting: (q) => sql`
    select b.id, b.batch_number as ref, p.name as label,
           coalesce(least((select min(coalesce(r.performed_at, r.started_at)) from process_step_records r where r.batch_id = b.id and r.status = 'awaiting_check'),
                          (select min(d.recorded_at) from dispense_records d join batch_materials bm on bm.id = d.batch_material_id where bm.batch_id = b.id and d.checker_id is null and d.voided_at is null)),
                    b.started_at, b.created_at) as since,
           ${BATCH_HREF} as href,
           ${toldSql(sql`b.id, b.work_order_id`, sql`coalesce(b.started_at, b.created_at)`, ["work_order_approved", "approval_requested"])} as told
    from batches b join products p on p.id = b.product_id
    where b.organization_id = ${q.org} and b.site_id = ${q.site} and b.status in ('in_process', 'rework_approved')
      and (exists (select 1 from process_step_records r where r.batch_id = b.id and r.status = 'awaiting_check')
        or exists (${UNCHECKED}))`,
  batches_waiting_qa: (q) => sql`
    select b.id, b.batch_number as ref, p.name as label, coalesce(b.completed_at, b.created_at) as since, '/quality/check/' || b.id::text as href,
           ${toldSql(sql`b.id`, sql`coalesce(b.completed_at, b.created_at)`)} as told
    from batches b join products p on p.id = b.product_id
    where b.organization_id = ${q.org} and b.site_id = ${q.site} and b.status in ('awaiting_qc', 'quarantined')`,
  so_to_pick: (q) => sql`
    select so.id, so.order_number as ref, c.name as label, so.status_changed_at as since,
           coalesce((select '/sales/picking/' || pk.id::text from picks pk where pk.sales_order_id = so.id and pk.status in ('draft', 'in_progress') order by pk.created_at desc limit 1), '/sales/' || so.id::text) as href,
           ${toldSql(sql`so.id`, sql`so.status_changed_at`)} as told
    from sales_orders so join customers c on c.id = so.customer_id
    where so.organization_id = ${q.org} and so.site_id = ${q.site}
      and (so.status = 'allocated' or (so.status = 'picking' and exists (select 1 from picks pk where pk.sales_order_id = so.id and pk.status in ('draft', 'in_progress'))))`,
  shipments_to_check: (q) => sql`
    select s.id, s.shipment_number as ref, c.name as label,
           coalesce((select max(pk.completed_at) from picks pk where pk.shipment_id = s.id), s.created_at) as since, '/sales/packing/' || s.id::text as href,
           ${toldSql(sql`s.id`, sql`coalesce((select max(pk.completed_at) from picks pk where pk.shipment_id = s.id), s.created_at)`)} as told
    from shipments s join sales_orders so on so.id = s.sales_order_id join customers c on c.id = so.customer_id
    where s.organization_id = ${q.org} and s.site_id = ${q.site} and s.status = 'picked'`,
  shipments_to_send: (q) => sql`
    select s.id, s.shipment_number as ref, c.name as label, coalesce(s.packed_at, s.created_at) as since, '/sales/shipments/' || s.id::text as href,
           ${toldSql(sql`s.id`, sql`coalesce(s.packed_at, s.created_at)`)} as told
    from shipments s join sales_orders so on so.id = s.sales_order_id join customers c on c.id = so.customer_id
    where s.organization_id = ${q.org} and s.site_id = ${q.site} and s.status = 'packed'`,
  shipments_no_proof: (q) => sql`
    select s.id, s.shipment_number as ref, c.name as label, coalesce(s.dispatched_at, s.created_at) as since, '/sales/shipments/' || s.id::text as href, true as told
    from shipments s join sales_orders so on so.id = s.sales_order_id join customers c on c.id = so.customer_id
    where s.organization_id = ${q.org} and s.site_id = ${q.site} and s.status = 'dispatched' and s.delivered_at is null`,
  // The same rule as notInvoicedShipments (finance): sent or delivered, no invoice at all yet (not even a draft).
  not_billed: (q) => sql`
    select s.id, s.shipment_number as ref, c.name as label, coalesce(s.dispatched_at, s.created_at) as since, '/sales/shipments/' || s.id::text as href,
           ${toldSql(sql`s.id`, sql`coalesce(s.dispatched_at, s.created_at)`)} as told
    from shipments s join sales_orders so on so.id = s.sales_order_id join customers c on c.id = so.customer_id
    where s.organization_id = ${q.org} and s.site_id = ${q.site} and s.status in ('dispatched', 'delivered')
      and not exists (select 1 from invoices i where i.shipment_id = s.id and i.status not in ('cancelled', 'voided'))`,
  inv_draft: (q) => sql`
    select i.id, i.invoice_number as ref, c.name as label, i.created_at as since, '/finance/invoices/' || i.id::text as href,
           ${toldSql(sql`i.id, i.shipment_id`, sql`i.created_at`)} as told
    from invoices i join customers c on c.id = i.customer_id
    where i.organization_id = ${q.org} and i.site_id = ${q.site} and i.status = 'draft'`,
  inv_to_approve: (q) => sql`
    select i.id, i.invoice_number as ref, c.name as label, coalesce(i.submitted_at, i.created_at) as since, '/finance/invoices/' || i.id::text as href,
           ${toldSql(sql`i.id`, sql`coalesce(i.submitted_at, i.created_at)`)} as told
    from invoices i join customers c on c.id = i.customer_id
    where i.organization_id = ${q.org} and i.site_id = ${q.site} and i.status = 'submitted'`,
  inv_approved: (q) => sql`
    select i.id, i.invoice_number as ref, c.name as label, coalesce(i.approved_at, i.created_at) as since, '/finance/invoices/' || i.id::text as href,
           ${toldSql(sql`i.id`, sql`coalesce(i.approved_at, i.created_at)`)} as told
    from invoices i join customers c on c.id = i.customer_id
    where i.organization_id = ${q.org} and i.site_id = ${q.site} and i.status = 'approved'`,
};

const STOCK_KEYS: readonly FlowCountKey[] = ["so_short", "so_coming", "short_no_wo", "so_can_set_aside"];

/** May the viewer see this count at this site? Every permission of the count, at the site. */
export function maySeeCount(ctx: AuthContext, def: Pick<FlowCountDef, "permissions">, siteId: string): boolean {
  return def.permissions.every((p) => ctx.can(p) && ctx.canAt(p, siteId));
}

const toItem = (r: Row): FlowItem => ({ id: r.id, ref: r.ref, label: r.label ?? "", since: r.since instanceof Date ? r.since : new Date(r.since), href: r.href, told: !!r.told });

async function runQuery(build: (q: Q) => SQL, q: Q): Promise<FlowItem[]> {
  const rows = await db.execute<Row>(sql`select * from (${build(q)}) x order by x.since asc, x.ref asc limit ${FLOW_ITEM_LIMIT + 1}`);
  return [...rows].map(toItem);
}

/**
 * Customer orders against free stock and stock that is coming: the ONE order-cover rule (production
 * order-cover-rule.ts, shared with the planner's Home and the order's shortage card). Confirmed orders only (stage
 * 7 / 8 / 11): an order covered by free stock "can now be set aside"; one covered only with batches waiting for QA
 * or being made is "coming" (never red: nobody has to act, the stock is on its way); one still missing pieces is
 * "short: it needs making". One cover read for the four counts.
 */
type Cover = { short: FlowItem[]; shortNoWo: FlowItem[]; coming: FlowItem[]; canSetAside: (FlowItem & { productIds: string[] })[] };
async function orderCover(q: Q): Promise<Cover> {
  const cover = await siteOrderCover(db, q.org, q.site);
  const confirmed = cover.orders.filter((o) => o.status === "confirmed");
  const ids = confirmed.map((o) => o.orderId);
  const facts = ids.length
    ? await db.execute<{ id: string; has_wo: boolean; told: boolean }>(sql`
        select so.id, exists (select 1 from work_orders w where w.sales_order_id = so.id and w.status <> 'cancelled') as has_wo,
               ${toldSql(sql`so.id`, sql`so.status_changed_at`, ["sales_order_confirmed", "sales_order_approved", "sales_order_submitted"])} as told
          from sales_orders so where so.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)
    : [];
  const fact = new Map([...facts].map((f) => [f.id, f]));
  const out: Cover = { short: [], shortNoWo: [], coming: [], canSetAside: [] };
  for (const o of confirmed) {
    const item = { id: o.orderId, ref: o.orderNumber, label: o.customerName, since: o.statusChangedAt, href: `/sales/${o.orderId}`, told: !!fact.get(o.orderId)?.told };
    if (o.state === "can_set_aside") out.canSetAside.push({ ...item, productIds: o.lines.filter((l) => l.need.gt(0)).map((l) => l.productId) });
    else if (o.state === "coming") out.coming.push({ ...item, label: `${o.customerName} · ${comingWords(o.lines.flatMap((l) => l.coming))}`, told: true });
    else if (o.state === "short") {
      out.short.push(item);
      if (!fact.get(o.orderId)?.has_wo) out.shortNoWo.push({ ...item, href: `/production/orders/new?salesOrder=${o.orderId}` });
    }
  }
  const bySince = (a: FlowItem, b: FlowItem) => a.since.getTime() - b.since.getTime();
  return { short: out.short.sort(bySince), shortNoWo: out.shortNoWo.sort(bySince), coming: out.coming.sort(bySince), canSetAside: out.canSetAside.sort(bySince) };
}

/**
 * ADR-110 C10: after QA says OK to a batch, the customer orders for that product that can now be set aside in full
 * (the same rule as stage 11), the order the production order was made for first. Current site; needs
 * sales.sales_order.view (else empty).
 */
export async function ordersReadyForProduct(ctx: AuthContext, productId: string, preferSalesOrderId?: string | null): Promise<FlowItem[]> {
  const site = ctx.currentSiteId;
  ctx.requireSite(site);
  if (!maySeeCount(ctx, FLOW_COUNT_DEFS.get("so_can_set_aside")!, site)) return [];
  const c = await orderCover({ org: ctx.organizationId, site, today: await clock(ctx) });
  const mine = c.canSetAside.filter((o) => o.productIds.includes(productId)).map(({ productIds: _p, ...o }) => o);
  return mine.sort((a, b) => Number(b.id === preferSalesOrderId) - Number(a.id === preferSalesOrderId));
}

async function putAwayItems(ctx: AuthContext): Promise<FlowItem[]> {
  const rows = await lotsToPutAway(ctx, { limit: FLOW_ITEM_LIMIT });
  const byLot = new Map<string, FlowItem>();
  for (const r of rows) {
    if (byLot.has(r.lotId)) continue;
    byLot.set(r.lotId, { id: r.lotId, ref: r.lotNumber, label: `${r.itemName} · ${r.fromName || r.fromCode}`, since: r.releasedAt instanceof Date ? r.releasedAt : new Date(r.releasedAt as unknown as string), href: "/inventory/receive/put-away", told: true });
  }
  // The put-away message names the lot (ADR-109 model hand-off); a lot without one waits on nobody.
  const ids = [...byLot.keys()];
  if (ids.length) {
    const told = await db.execute<{ id: string }>(sql`select distinct n.entity_id as id from notifications n where n.entity_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    const t = new Set([...told].map((r) => r.id));
    for (const it of byLot.values()) it.told = t.has(it.id);
  }
  return [...byLot.values()].sort((a, b) => a.since.getTime() - b.since.getTime());
}

async function clock(ctx: AuthContext): Promise<string> {
  const [r] = await db.execute<{ today: string }>(sql`select ((now() at time zone coalesce((select timezone from organizations where id = ${ctx.organizationId}), 'Asia/Manila'))::date)::text as today`);
  return r.today;
}

function summarise(def: FlowCountDef, items: FlowItem[]): FlowCount {
  const capped = items.length > FLOW_ITEM_LIMIT;
  const list = capped ? items.slice(0, FLOW_ITEM_LIMIT) : items;
  const oldest = list.reduce<Date | null>((m, i) => (!m || i.since < m ? i.since : m), null);
  return { key: def.key, count: list.length, capped, oldestAt: oldest, untold: def.told === "told" ? list.filter((i) => !i.told).length : 0, words: countWords(def, list.length), itemIds: list.map((i) => i.id) };
}

/** Loads the items of the given counts (one query each; the three stock-based counts share orderCover). */
async function loadItems(ctx: AuthContext, keys: FlowCountKey[]): Promise<Map<FlowCountKey, FlowItem[]>> {
  const q: Q = { org: ctx.organizationId, site: ctx.currentSiteId, today: await clock(ctx) };
  let cover: ReturnType<typeof orderCover> | null = null;
  const stock = () => (cover ??= orderCover(q));
  const out = new Map<FlowCountKey, FlowItem[]>();
  await Promise.all(
    keys.map(async (k) => {
      let items: FlowItem[];
      if (k === "lots_to_put_away") items = await putAwayItems(ctx);
      else if (STOCK_KEYS.includes(k)) {
        const c = await stock();
        items = k === "so_short" ? c.short : k === "so_coming" ? c.coming : k === "short_no_wo" ? c.shortNoWo : c.canSetAside;
      } else items = await runQuery(QUERIES[k]!, q);
      out.set(k, items);
    }),
  );
  return out;
}

export type WorkFlow = { siteName: string; generatedAt: Date; stages: FlowStage[] };

/** The 16 stages at the caller's current site, with the counts the caller may see. */
export async function getWorkFlow(ctx: AuthContext): Promise<WorkFlow> {
  const site = ctx.currentSiteId;
  ctx.requireSite(site);
  const visible = FLOW_STAGES.map((s) => ({ s, counts: s.counts.filter((k) => maySeeCount(ctx, k, site)) })).filter((x) => x.counts.length > 0);
  const items = await loadItems(ctx, visible.flatMap((x) => x.counts.map((k) => k.key)));
  return {
    siteName: ctx.currentSite.name,
    generatedAt: new Date(),
    stages: visible.map((x) => stageRow(x.s, x.counts.map((k) => summarise(k, items.get(k.key) ?? [])))),
  };
}

/** Only some stages (Home work lists): the same counts, the same rules. */
export async function getWorkFlowCounts(ctx: AuthContext, keys: readonly FlowCountKey[]): Promise<FlowCount[]> {
  const site = ctx.currentSiteId;
  ctx.requireSite(site);
  const defs = keys.map((k) => FLOW_COUNT_DEFS.get(k)!).filter((d) => maySeeCount(ctx, d, site));
  const items = await loadItems(ctx, defs.map((d) => d.key));
  return defs.map((d) => summarise(d, items.get(d.key) ?? []));
}

/** The items behind one count (tapping the number). Refused when the viewer may not see that count at the site. */
export async function getWorkFlowItems(ctx: AuthContext, key: FlowCountKey): Promise<{ count: FlowCount; stage: FlowStage; items: FlowItem[] }> {
  const def = FLOW_COUNT_DEFS.get(key);
  if (!def) throw new DomainError("not_found", "That list does not exist.");
  const site = ctx.currentSiteId;
  ctx.requireSite(site);
  if (!maySeeCount(ctx, def, site)) throw new DomainError("forbidden", "Your role does not show this list at this site.");
  const items = (await loadItems(ctx, [key])).get(key) ?? [];
  const count = summarise(def, items);
  return { count, stage: stageRow(def.stage, [count]), items: items.slice(0, FLOW_ITEM_LIMIT) };
}

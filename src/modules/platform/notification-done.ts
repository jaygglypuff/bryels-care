import "server-only";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { type DbOrTx } from "@/db/client";
import { notifications } from "@/db/schema";

/**
 * Messages clear when the work is done (round 5, ADR-129; A report #6 and B10, B report #9 and B9, C report #6 and
 * B10). A message that asks someone to do something ("Production order waits for your approval", "put it on a
 * shelf", "Send it to the supplier", "check the boxes", "ask the planner…") is marked resolved as soon as the record
 * it points at has left the state the message asked about, whoever did it (the work is done, or it is no longer
 * theirs). Resolved messages leave the bell count and the open list; the history shows them as "Done".
 *
 * One rule per message kind, in one place (not per screen). Each rule reads the CURRENT state of the record the
 * message points at (entity id, or the record id kept in the dedupe key) and answers "still waiting?". A record that
 * no longer exists (a deleted draft) counts as done. Kinds without a rule never clear by themselves (informational
 * messages, alerts; action-centre messages are cleared by their own sweep, `refreshActionItems`).
 *
 * It runs for the signed-in person when their bell is counted or their messages are listed (bounded: open messages of
 * kinds with a rule, newest 300), and can run for a whole organisation (`resolveDoneNotifications(q, { organizationId })`,
 * used by tests and available to a job). It only ever sets `resolved_at` (and `read_at` when unread) on rows of the
 * given recipient or organisation; it never deletes and never changes another organisation's rows.
 */

type OpenRow = { id: string; kind: string; entityType: string | null; entityId: string | null; dedupeKey: string | null };

/** Ids (record ids) still waiting, among `ids`. */
type StillWaiting = (q: DbOrTx, organizationId: string, ids: string[], rows: OpenRow[]) => Promise<Set<string>>;

type DoneRule = {
  /** Message kinds this rule decides (exact). */
  kinds: readonly string[];
  /** Which record the message is about: the entity id (default) or a part of the dedupe key ("a:b:c" → part 1 = "b"). */
  recordId?: (r: OpenRow) => string | null;
  waiting: StillWaiting;
};

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
const textList = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

async function ids(q: DbOrTx, query: SQL): Promise<Set<string>> {
  const rows = (await q.execute(query)) as unknown as { id: string }[];
  return new Set(rows.map((r) => String(r.id)));
}

/** Still waiting = the record's status is one of `waiting`. `org`: the table has organization_id. */
function byStatus(table: string, waiting: readonly string[], opts: { org?: boolean; column?: string } = {}): StillWaiting {
  const col = opts.column ?? "status";
  return (q, organizationId, recordIds) =>
    ids(q, sql`select id::text as id from ${sql.raw(table)} where id in (${idList(recordIds)}) and ${sql.raw(col)} in (${textList(waiting)})
      ${opts.org === false ? sql`` : sql`and organization_id = ${organizationId}::uuid`}`);
}

/** Part `n` of the dedupe key ("handoff.weighing_check:<batch>:<record>" → part 2). */
const dedupePart = (n: number) => (r: OpenRow) => {
  const p = (r.dedupeKey ?? "").split(":")[n];
  return p && uuidRe.test(p) ? p : null;
};

/** By the message's record type (one kind used for several types, such as "approval_requested"). */
function byEntityType(map: Record<string, StillWaiting>): StillWaiting {
  return async (q, organizationId, recordIds, rows) => {
    const out = new Set<string>();
    for (const [type, check] of Object.entries(map)) {
      const mine = recordIds.filter((id) => rows.some((r) => r.entityId === id && r.entityType === type));
      if (mine.length) for (const id of await check(q, organizationId, mine, rows)) out.add(id);
    }
    // Record types without a check never clear by themselves.
    for (const id of recordIds) if (!rows.some((r) => r.entityId === id && r.entityType && map[r.entityType])) out.add(id);
    return out;
  };
}

export const DONE_RULES: readonly DoneRule[] = [
  // Production order waits for approval (draft or planned on the old screen).
  { kinds: ["production.order.to_approve", "handoff.production_order"], waiting: byStatus("work_orders", ["draft", "planned"]) },
  // Purchase order waits for approval / approved: send it to the supplier / coming: receive it.
  { kinds: ["purchase_order_submitted", "handoff.purchase_order"], waiting: byStatus("purchase_orders", ["submitted"]) },
  { kinds: ["purchase_order_approved", "handoff.purchase_order_send"], waiting: byStatus("purchase_orders", ["approved"]) },
  { kinds: ["handoff.delivery_coming"], waiting: byStatus("purchase_orders", ["approved", "sent", "partially_received"]) },
  { kinds: ["handoff.purchase_request"], waiting: byStatus("purchase_requests", ["submitted"]) },
  // ADR-131: a delivery problem waits until purchasing decided every problem line of that purchase order's deliveries.
  {
    kinds: ["procurement.delivery_problem"],
    waiting: (q, org, poIds) =>
      ids(q, sql`select distinct pol.purchase_order_id::text as id from goods_receipt_lines gl
        join goods_receipts gr on gr.id = gl.goods_receipt_id and gr.status = 'posted'
        join purchase_order_lines pol on pol.id = gl.purchase_order_line_id
        where pol.purchase_order_id in (${idList(poIds)}) and gr.organization_id = ${org}::uuid
          and gl.discrepancy_kind in ('short', 'damaged', 'wrong_item')
          and not exists (select 1 from delivery_problem_decisions d where d.goods_receipt_line_id = gl.id)`),
  },
  { kinds: ["handoff.supplier_return"], waiting: byStatus("supplier_returns", ["submitted"]) },
  // Customer order confirmed: set the stock aside / ready to set aside after QA.
  { kinds: ["sales_order_confirmed", "handoff.set_aside"], waiting: byStatus("sales_orders", ["confirmed"]) },
  // Get it from the shelf: waiting while set aside, or while a pick list is still open (same rule as "How work flows").
  {
    kinds: ["handoff.pick"],
    waiting: (q, org, recordIds) =>
      ids(q, sql`select so.id::text as id from sales_orders so where so.id in (${idList(recordIds)}) and so.organization_id = ${org}::uuid
        and (so.status = 'allocated' or (so.status = 'picking' and exists (select 1 from picks pk where pk.sales_order_id = so.id and pk.status in ('draft', 'in_progress'))))`),
  },
  // "Ask the planner to make it" (dedupe make-for:<order line>:<missing>): waiting until a production order covers the
  // line or the customer order is no longer open.
  {
    kinds: ["production.make_for_order.asked"],
    recordId: dedupePart(1),
    waiting: (q, org, lineIds) =>
      ids(q, sql`select l.id::text as id from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
        where l.id in (${idList(lineIds)}) and so.organization_id = ${org}::uuid
          and so.status in ('confirmed', 'allocated', 'picking', 'packed', 'partially_shipped', 'submitted', 'pending_approval')
          and not exists (select 1 from work_orders w where w.sales_order_id = so.id and w.product_id = l.product_id and w.status <> 'cancelled')`),
  },
  // Approvals asked by message (price offers, customer orders over the limit, price lists).
  {
    kinds: ["approval_requested"],
    waiting: byEntityType({
      quote: byStatus("quotes", ["pending_approval"]),
      sales_order: byStatus("sales_orders", ["submitted", "pending_approval"]),
      price_list: byStatus("price_lists", ["pending_approval"]),
    }),
  },
  // Check the boxes (second person): a delivery taken off the shelf, or a box check; then send it out.
  {
    kinds: ["handoff.pack_check"],
    waiting: byEntityType({ shipment: byStatus("shipments", ["draft", "picked"]), pack: byStatus("packs", ["open"]) }),
  },
  { kinds: ["handoff.dispatch"], waiting: byStatus("shipments", ["draft", "picked", "packed"]) },
  // A finished batch waits for the QA decision.
  { kinds: ["handoff.batch_qa"], waiting: byStatus("batches", ["awaiting_qc", "quarantined"]) },
  // A received lot waits for the QA check (dedupe goods_receipt.posted.qa:<receipt>:<lot>).
  { kinds: ["quality.lots.received"], recordId: dedupePart(2), waiting: byStatus("inventory_lots", ["quarantine"], { column: "quality_status" }) },
  // A released lot waits to be put away: some of it is still in a QA, hold or receiving place (put-away-queue.ts rule).
  {
    kinds: ["inventory.lot.ready_to_put_away"],
    waiting: (q, org, lotIds) =>
      ids(q, sql`select distinct lot.id::text as id from inventory_lots lot
        join inventory_balances b on b.lot_id = lot.id and b.qty_base > 0
        join locations l on l.id = b.location_id
        where lot.id in (${idList(lotIds)}) and lot.organization_id = ${org}::uuid and lot.quality_status = 'released'
          and l.kind in ('quarantine', 'hold', 'receiving')`),
  },
  // Test results wait for the second QA person.
  { kinds: ["handoff.qa_review"], waiting: byStatus("inspections", ["awaiting_review"]) },
  { kinds: ["handoff.qa_result_correction"], waiting: byStatus("qa_result_corrections", ["pending"]) },
  // Recipe, steps, how-to sheet and check plan versions wait for approval.
  { kinds: ["handoff.recipe_revision"], waiting: byStatus("formula_revisions", ["pending_approval"], { org: false }) },
  { kinds: ["handoff.routing_revision"], waiting: byStatus("routing_revisions", ["pending_approval"], { org: false }) },
  { kinds: ["handoff.work_instruction_revision"], waiting: byStatus("work_instruction_revisions", ["pending_approval"], { org: false }) },
  { kinds: ["handoff.inspection_plan_revision"], waiting: byStatus("inspection_plans", ["pending_approval"]) },
  { kinds: ["handoff.customer_requirement"], waiting: byStatus("customer_requirements", ["pending_approval"]) },
  // Stock fixes and counts.
  { kinds: ["handoff.stock_adjustment"], waiting: byStatus("stock_adjustments", ["submitted"]) },
  { kinds: ["handoff.stock_adjustment_post"], waiting: byStatus("stock_adjustments", ["approved"]) },
  { kinds: ["handoff.count_variance"], waiting: byStatus("stock_counts", ["pending_approval"]) },
  { kinds: ["handoff.setting_change"], waiting: byStatus("setting_change_requests", ["submitted"]) },
  // Floor checks: the weighing (dedupe handoff.weighing_check:<batch>:<record>) and the step (handoff.step_check:<record>:<time>).
  {
    kinds: ["handoff.weighing_check"],
    recordId: dedupePart(2),
    waiting: (q, _org, recIds) => ids(q, sql`select id::text as id from dispense_records where id in (${idList(recIds)}) and checker_id is null and voided_at is null`),
  },
  {
    kinds: ["handoff.step_check", "handoff.start_check"],
    recordId: dedupePart(1),
    waiting: (q, _org, recIds) => ids(q, sql`select id::text as id from process_step_records where id in (${idList(recIds)}) and status = 'awaiting_check'`),
  },
  // ADR-133: Finish counts sent to be checked (dedupe handoff.finish_check:<check>).
  {
    kinds: ["handoff.finish_check"],
    recordId: dedupePart(1),
    waiting: (q, _org, recIds) => ids(q, sql`select id::text as id from batch_finish_checks where id in (${idList(recIds)}) and status = 'waiting'`),
  },
];

const RULE_BY_KIND: ReadonlyMap<string, DoneRule> = new Map(DONE_RULES.flatMap((r) => r.kinds.map((k) => [k, r] as const)));
export const RESOLVABLE_KINDS: readonly string[] = [...RULE_BY_KIND.keys()];

/** Most open messages looked at per run (newest first). */
const SCAN_LIMIT = 300;

/**
 * Marks open messages whose work is done as resolved. Scope: one recipient (`recipientUserId`, the bell) or a whole
 * organisation. Returns the ids it resolved. Never throws for one failing rule (the bell must still load).
 */
export async function resolveDoneNotifications(q: DbOrTx, scope: { organizationId: string; recipientUserId?: string }, now: Date = new Date()): Promise<string[]> {
  const conds = [eq(notifications.organizationId, scope.organizationId), isNull(notifications.resolvedAt), inArray(notifications.kind, RESOLVABLE_KINDS as string[])];
  if (scope.recipientUserId) conds.push(eq(notifications.recipientUserId, scope.recipientUserId));
  const open = await q
    .select({ id: notifications.id, kind: notifications.kind, entityType: notifications.entityType, entityId: notifications.entityId, dedupeKey: notifications.dedupeKey })
    .from(notifications)
    .where(and(...conds))
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(SCAN_LIMIT);
  if (!open.length) return [];
  const done: string[] = [];
  for (const rule of DONE_RULES) {
    const rows = open.filter((r) => rule.kinds.includes(r.kind));
    if (!rows.length) continue;
    const recordOf = (r: OpenRow) => (rule.recordId ? rule.recordId(r) : r.entityId && uuidRe.test(r.entityId) ? r.entityId : null);
    const recordIds = [...new Set(rows.map(recordOf).filter((x): x is string => !!x))];
    if (!recordIds.length) continue;
    try {
      const still = await rule.waiting(q, scope.organizationId, recordIds, rows);
      for (const r of rows) {
        const rec = recordOf(r);
        if (rec && !still.has(rec)) done.push(r.id);
      }
    } catch (e) {
      console.error("resolveDoneNotifications", rule.kinds.join(","), e);
    }
  }
  if (!done.length) return [];
  await q
    .update(notifications)
    .set({ resolvedAt: now, readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.organizationId, scope.organizationId), inArray(notifications.id, done), isNull(notifications.resolvedAt)));
  return done;
}

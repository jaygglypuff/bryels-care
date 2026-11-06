import type { Permission } from "@/lib/permissions";
import { fmtDayMonth } from "@/lib/qty";

/**
 * "How work flows" (ADR-106 §5, ADR-110 C0; docs/END_TO_END_FLOW.md C0 table): the 16 stages of one order, from
 * "Ask to buy" to "Invoice", in the words shown on the page. Pure data and helpers (no I/O) so they can be unit
 * tested (tests/unit/work-flow.test.ts) and shared by the page, the Home work lists and the record stepper.
 *
 * Every stage has one or more counts. Each count is one query in `getWorkFlow` (work-flow.ts) and needs its own
 * view permission: a count the viewer may not see is left out, and a stage with no count left is hidden.
 */

export type FlowStageKey =
  | "ask_to_buy"
  | "order"
  | "delivery_coming"
  | "receive"
  | "qa_incoming"
  | "put_away"
  | "customer_orders"
  | "make_it"
  | "making"
  | "qa_batches"
  | "set_aside"
  | "pick"
  | "second_check"
  | "send_out"
  | "proof"
  | "invoice";

export type FlowCountKey =
  | "pr_waiting"
  | "pr_to_order"
  | "po_to_approve"
  | "po_to_send"
  | "po_coming"
  | "po_late"
  | "po_due_today"
  | "gr_draft"
  | "labels_unprinted"
  | "lots_waiting"
  | "lot_checks_second"
  | "lots_to_put_away"
  | "so_to_approve"
  | "so_confirmed"
  | "so_short"
  | "so_coming"
  | "short_no_wo"
  | "wo_to_approve"
  | "batches_to_start"
  | "batches_in_process"
  | "batches_check_waiting"
  | "batches_waiting_qa"
  | "so_can_set_aside"
  | "so_to_pick"
  | "shipments_to_check"
  | "shipments_to_send"
  | "shipments_no_proof"
  | "not_billed"
  | "inv_draft"
  | "inv_to_approve"
  | "inv_approved";

/**
 * Who must act on the items of a count, for the red rule. "told": the next person must be told (a message or a
 * Home line, C9); an item without a message about it waits on nobody. "self": the same person carries on with
 * their own unfinished work (a receipt they started, a batch they are making); never red.
 */
export type ToldRule = "told" | "self";

export type FlowCountDef = {
  key: FlowCountKey;
  /** Plural words after the number ("3 requests waiting for approval"). */
  many: string;
  /** Singular words ("1 request waiting for approval"). */
  one: string;
  /** All of these are needed to see the count and its items (server-checked in getWorkFlow). */
  permissions: readonly Permission[];
  told: ToldRule;
};

export type FlowStageDef = {
  n: number;
  key: FlowStageKey;
  /** The stage in plain words (C0 table "Stage (words on the page)"). */
  title: string;
  /** Who does it (C0 table "Who"). */
  who: string;
  /** The one button: where that person does it. */
  button: { label: string; href: string };
  counts: readonly FlowCountDef[];
};

const c = (key: FlowCountKey, one: string, many: string, permissions: readonly Permission[], told: ToldRule = "told"): FlowCountDef => ({ key, one, many, permissions, told });

export const FLOW_STAGES: readonly FlowStageDef[] = [
  {
    n: 1,
    key: "ask_to_buy",
    title: "Ask to buy",
    who: "Anyone asks · the manager approves",
    button: { label: "Open requests to buy", href: "/procurement/requests?status=submitted" },
    counts: [c("pr_waiting", "request waiting for approval", "requests waiting for approval", ["procurement.purchase_request.view"])],
  },
  {
    n: 2,
    key: "order",
    title: "Order from the supplier",
    who: "Purchasing",
    button: { label: "Open purchase orders", href: "/procurement/orders?status=approved" },
    counts: [
      c("pr_to_order", "approved request not ordered yet", "approved requests not ordered yet", ["procurement.purchase_request.view"]),
      c("po_to_approve", "purchase order waiting for approval", "purchase orders waiting for approval", ["procurement.purchase_order.view"]),
      c("po_to_send", "purchase order approved, not sent", "purchase orders approved, not sent", ["procurement.purchase_order.view"]),
    ],
  },
  {
    n: 3,
    key: "delivery_coming",
    title: "Delivery coming",
    who: "Warehouse",
    button: { label: "Open Receive a delivery", href: "/inventory/receive" },
    counts: [
      // Live check 2026-11-06: a sent order expected later is shown too ("1 coming (11 Nov)"), not only late and today.
      c("po_coming", "coming", "coming", ["procurement.purchase_order.view"]),
      c("po_late", "delivery late", "deliveries late", ["procurement.purchase_order.view"]),
      c("po_due_today", "delivery due today", "deliveries due today", ["procurement.purchase_order.view"]),
    ],
  },
  {
    n: 4,
    key: "receive",
    title: "Receive and label",
    who: "Warehouse",
    button: { label: "Open Receive a delivery", href: "/inventory/receive" },
    counts: [
      c("gr_draft", "delivery not finished", "deliveries not finished", ["procurement.goods_receipt.view"], "self"),
      c("labels_unprinted", "lot with labels not printed", "lots with labels not printed", ["inventory.label_job.view"], "self"),
    ],
  },
  {
    n: 5,
    key: "qa_incoming",
    title: "QA check of deliveries",
    who: "QA (two people)",
    button: { label: "Open Check a batch or delivery", href: "/quality#lots" },
    counts: [
      c("lots_waiting", "lot waiting for the QA check", "lots waiting for the QA check", ["quality.disposition.view"]),
      c("lot_checks_second", "check waiting for a second QA person", "checks waiting for a second QA person", ["quality.inspection.view"]),
    ],
  },
  {
    n: 6,
    key: "put_away",
    title: "Put away",
    who: "Warehouse",
    button: { label: "Open Put away", href: "/inventory/receive/put-away" },
    counts: [c("lots_to_put_away", "lot OK, waiting for a shelf", "lots OK, waiting for a shelf", ["inventory.lot.view"])],
  },
  {
    n: 7,
    key: "customer_orders",
    title: "Customer orders",
    who: "Sales",
    button: { label: "Open Customer orders", href: "/sales?status=confirmed" },
    counts: [
      c("so_to_approve", "order waiting for approval", "orders waiting for approval", ["sales.sales_order.view"]),
      c("so_confirmed", "order confirmed, nothing set aside yet", "orders confirmed, nothing set aside yet", ["sales.sales_order.view"]),
      c("so_short", "order short: it needs making", "orders short: they need making", ["sales.sales_order.view"]),
      // Finding 1 (live check 2026-11-06): stock waiting for QA or being made covers it; nobody has to act.
      c("so_coming", "order waiting for stock that is coming", "orders waiting for stock that is coming", ["sales.sales_order.view", "production.work_order.view"], "self"),
    ],
  },
  {
    n: 8,
    key: "make_it",
    title: "Make it",
    who: "Planner · the manager approves",
    button: { label: "Open Production orders", href: "/production/orders" },
    counts: [
      c("short_no_wo", "short order with no production order", "short orders with no production order", ["sales.sales_order.view", "production.work_order.view"]),
      c("wo_to_approve", "production order waiting for approval", "production orders waiting for approval", ["production.work_order.view"]),
    ],
  },
  {
    n: 9,
    key: "making",
    title: "Get materials · weigh · steps · pack · finish",
    who: "Operator and a second person",
    button: { label: "Open Production orders", href: "/production/orders" },
    counts: [
      c("batches_to_start", "batch to start", "batches to start", ["production.work_order.view"], "self"),
      c("batches_in_process", "batch being made", "batches being made", ["production.work_order.view"], "self"),
      c("batches_check_waiting", "batch waiting for a second person's check", "batches waiting for a second person's check", ["production.work_order.view"]),
    ],
  },
  {
    n: 10,
    key: "qa_batches",
    title: "QA OK of batches",
    who: "QA",
    button: { label: "Open Check a batch or delivery", href: "/quality#batches" },
    counts: [c("batches_waiting_qa", "batch waiting for the QA check", "batches waiting for the QA check", ["quality.disposition.view"])],
  },
  {
    n: 11,
    key: "set_aside",
    title: "Set aside",
    who: "Warehouse or sales",
    button: { label: "Open Customer orders", href: "/sales?status=confirmed" },
    counts: [c("so_can_set_aside", "order that can now be fully set aside", "orders that can now be fully set aside", ["sales.sales_order.view"])],
  },
  {
    n: 12,
    key: "pick",
    title: "Get from shelf",
    who: "Warehouse",
    button: { label: "Open To get from shelf", href: "/sales/picking" },
    counts: [c("so_to_pick", "order set aside, not taken from the shelf", "orders set aside, not taken from the shelf", ["sales.pick.view"])],
  },
  {
    n: 13,
    key: "second_check",
    title: "Second check of the box",
    who: "A different warehouse person",
    button: { label: "Open Send out", href: "/sales/dispatch#check" },
    counts: [c("shipments_to_check", "delivery taken from the shelf, not checked", "deliveries taken from the shelf, not checked", ["sales.shipment.view"])],
  },
  {
    n: 14,
    key: "send_out",
    title: "Send out",
    who: "Dispatch",
    button: { label: "Open Send out", href: "/sales/dispatch#ready" },
    counts: [c("shipments_to_send", "delivery checked, not sent", "deliveries checked, not sent", ["sales.shipment.view"])],
  },
  {
    n: 15,
    key: "proof",
    title: "Proof of delivery",
    who: "Dispatch",
    button: { label: "Open Send out", href: "/sales/dispatch#proof" },
    counts: [c("shipments_no_proof", "delivery sent, no proof yet", "deliveries sent, no proof yet", ["sales.shipment.view"], "self")],
  },
  {
    n: 16,
    key: "invoice",
    title: "Invoice",
    who: "Finance (two people)",
    button: { label: "Open Invoices", href: "/finance/invoices?status=draft" },
    counts: [
      c("not_billed", "delivery sent, no invoice yet", "deliveries sent, no invoice yet", ["finance.invoice.view", "sales.shipment.view"]),
      c("inv_draft", "invoice draft to check", "invoice drafts to check", ["finance.invoice.view"]),
      c("inv_to_approve", "invoice waiting for approval", "invoices waiting for approval", ["finance.invoice.view"]),
      c("inv_approved", "invoice approved, not saved to the books", "invoices approved, not saved to the books", ["finance.invoice.view"]),
    ],
  },
];

export const FLOW_COUNT_DEFS: ReadonlyMap<FlowCountKey, FlowCountDef & { stage: FlowStageDef }> = new Map(FLOW_STAGES.flatMap((s) => s.counts.map((k) => [k.key, { ...k, stage: s }] as const)));

export function isFlowCountKey(v: string): v is FlowCountKey {
  return FLOW_COUNT_DEFS.has(v as FlowCountKey);
}

/** "3 requests waiting for approval" / "1 request waiting for approval". */
export function countWords(def: Pick<FlowCountDef, "one" | "many">, n: number): string {
  return `${n.toLocaleString("en-PH")} ${n === 1 ? def.one : def.many}`;
}

/** "1 coming (11 Nov)": the count's words with the nearest expected date, when the count has dates. */
export function withDueWords(words: string, nextDueOn: string | null | undefined): string {
  return nextDueOn ? `${words} (${fmtDayMonth(nextDueOn)})` : words;
}

/** The oldest item's age in plain words: "today", "1 day", "5 days" (whole days, never negative). */
export function ageWords(since: Date | null, now: Date = new Date()): string | null {
  if (!since) return null;
  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** One count's result: the items found and how many of them nobody was told about. */
export type FlowCount = {
  key: FlowCountKey;
  count: number;
  /** True when the list stopped at the query limit (the count shows "500+"). */
  capped: boolean;
  oldestAt: Date | null;
  /** Items no message points to (only for "told" counts; 0 for "self"). */
  untold: number;
  words: string;
  /** The nearest expected date of the items ("YYYY-MM-DD"), for counts of things still coming; else null. */
  nextDueOn?: string | null;
  /** The records counted (to count a record once per stage when two counts of a stage overlap). */
  itemIds: readonly string[];
};

export type FlowStage = {
  n: number;
  key: FlowStageKey;
  title: string;
  who: string;
  button: { label: string; href: string };
  counts: FlowCount[];
  total: number;
  oldestAt: Date | null;
  /** C0: "red when a count waits on nobody" — something is waiting and no message was sent about it. */
  waitsOnNobody: boolean;
};

/** Combines a stage's visible counts into the row shown on the page. */
export function stageRow(def: FlowStageDef, counts: FlowCount[]): FlowStage {
  const oldest = counts.map((k) => k.oldestAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return {
    n: def.n,
    key: def.key,
    title: def.title,
    who: def.who,
    button: def.button,
    counts,
    // A record in two counts of one stage (a confirmed order that is also short) is one thing waiting.
    total: new Set(counts.flatMap((k) => k.itemIds)).size + counts.filter((k) => k.capped).length,
    oldestAt: oldest,
    waitsOnNobody: counts.some((k) => k.untold > 0),
  };
}

/** The stage a sales order's status is in, for the order stepper (the 16 stages, order part: 7, 11–16). */
export const SALES_ORDER_FLOW_TITLES = ["Customer orders", "Set aside", "Get from shelf", "Second check of the box", "Send out", "Proof of delivery", "Invoice"] as const;

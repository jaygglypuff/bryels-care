/**
 * Recent activity in plain sentences (Home, mockup panel 1 "Recent Activity"): "Ana Villanueva released
 * batch B-26-0004". Pure mapping from an audit action (`module.entity.event`) and the record it points
 * to; no I/O so it is unit tested (tests/unit/activity-sentence.test.ts). Unknown events fall back to
 * the event's own words, never to a code.
 */

/** What the record is, in plain words (by the audit event's entity type). */
const NOUN: Record<string, string> = {
  sales_order: "customer order",
  goods_receipt: "delivery",
  inventory_lot: "lot",
  lot: "lot",
  batch: "batch",
  shipment: "shipment",
  customer: "customer",
  customer_requirement: "customer requirement",
  price_list: "price list",
  invoice: "invoice",
  payment_record: "payment",
  credit_note: "credit note",
  work_order: "production order",
  quote: "quotation",
  purchase_order: "purchase order",
  purchase_request: "purchase request",
  stock_movement: "stock move",
  stock_adjustment: "stock adjustment",
  stock_count: "stock count",
  container: "box",
  portal_user: "portal user",
  customer_portal_tenant: "customer portal",
  accounting_period: "accounting period",
  supplier: "supplier",
  material: "material",
  product: "product",
  user: "user",
  role: "role",
  hold: "quality hold",
  complaint: "complaint",
  customer_return: "customer return",
};

/** Verb for `module.entity.event` (exact) or for the event alone. */
const EXACT: Record<string, string> = {
  "inventory.goods_receipt.posted": "received",
  "sales.sales_order.placed_in_portal": "placed in the customer portal",
  "sales.customer.credit_terms_changed": "changed the credit terms of",
  "sales.customer.credit_hold_placed": "put on credit hold",
  "sales.customer.credit_hold_lifted": "lifted the credit hold of",
  "sales.portal_user.invitation_accepted": "accepted the portal invitation as",
  "platform.demo.seeded": "loaded the demo data for",
};
const VERB: Record<string, string> = {
  created: "created",
  submitted: "submitted",
  approved: "approved",
  confirmed: "confirmed",
  posted: "posted",
  released: "released",
  rejected: "rejected",
  dispatched: "dispatched",
  delivered: "recorded the delivery of",
  cancelled: "cancelled",
  voided: "voided",
  reversed: "reversed",
  sent: "sent",
  invited: "invited",
  enabled: "turned on",
  disabled: "turned off",
  locked: "locked",
  unlocked: "unlocked",
  updated: "changed",
  edited: "changed",
  deleted: "deleted",
  allocated: "reserved stock for",
  picked: "picked",
  packed: "packed",
  received: "received",
  closed: "closed",
  started: "started",
  completed: "finished",
  placed: "placed",
  lifted: "lifted",
};

export type ActivityInput = { action: string; entityType: string; entityNumber: string | null; actorName: string | null };

/** "{who} {did} {what} {number}" — the number is returned separately so the caller can link it. */
export function activitySentence(r: ActivityInput): { who: string; text: string; number: string | null } {
  const parts = r.action.split(".");
  const event = parts[parts.length - 1] ?? "";
  const verb = EXACT[r.action] ?? VERB[event] ?? event.replace(/_/g, " ");
  const noun = NOUN[r.entityType] ?? r.entityType.replace(/_/g, " ");
  return { who: r.actorName ?? "The system", text: `${verb} ${noun}`.trim(), number: r.entityNumber };
}

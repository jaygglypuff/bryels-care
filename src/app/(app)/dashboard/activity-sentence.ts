/**
 * Recent activity in plain sentences (Home, mockup panel 1 "Recent Activity"): "Ana Villanueva said OK to the
 * batch of Acapulco Soap 135 g", with the record number shown small and grey after the sentence (UX audit C #6,
 * round 2 part 2: names first, codes after). Pure mapping from an audit action (`module.entity.event`), the
 * record it points to and that record's name (customer, supplier, product); no I/O so it is unit tested
 * (tests/unit/activity-sentence.test.ts). Unknown events fall back to the event's own words, never to a code.
 */

/** What the record is, in plain words (by the audit event's entity type). */
const NOUN: Record<string, string> = {
  sales_order: "customer order",
  goods_receipt: "delivery",
  inventory_lot: "lot",
  lot: "lot",
  batch: "batch",
  shipment: "delivery to a customer",
  customer: "customer",
  customer_requirement: "customer requirement",
  price_list: "price list",
  invoice: "invoice",
  payment_record: "payment",
  credit_note: "credit (money back)",
  work_order: "production order",
  quote: "price offer",
  purchase_order: "purchase order",
  purchase_request: "request to buy",
  stock_movement: "stock move",
  stock_adjustment: "stock fix",
  stock_count: "stock count",
  container: "box",
  portal_user: "portal user",
  customer_portal_tenant: "customer portal",
  accounting_period: "month",
  supplier: "supplier",
  material: "material",
  product: "product",
  user: "person",
  role: "job (role)",
  hold: "QA stop",
  complaint: "complaint",
  customer_return: "customer return",
  generated_document: "paper",
  label_job: "labels",
  action_item: "problem",
  organization: "company",
  pick: "pick list",
  pack: "box check",
};

/** How the record's name joins the sentence ("for Isla Spa", "from Laguna Oleo", "of Coconut Oil"). */
const JOIN: Record<string, string> = {
  sales_order: "for",
  shipment: "for",
  invoice: "for",
  quote: "for",
  customer_return: "from",
  complaint: "from",
  credit_note: "for",
  payment_record: "from",
  goods_receipt: "from",
  purchase_order: "to",
  purchase_request: "for",
  batch: "of",
  work_order: "of",
  inventory_lot: "of",
  lot: "of",
  label_job: "for",
};

/** Verb for `module.entity.event` (exact) or for the event alone. */
const EXACT: Record<string, string> = {
  "inventory.goods_receipt.posted": "received",
  "procurement.goods_receipt.created": "started",
  "sales.sales_order.placed_in_portal": "placed in the customer portal",
  "sales.customer.credit_terms_changed": "changed the days to pay of",
  "sales.customer.credit_hold_placed": "stopped the orders of",
  "sales.customer.credit_hold_lifted": "allowed the orders of",
  "sales.portal_user.invitation_accepted": "accepted the portal invitation as",
  "platform.demo.seeded": "loaded the demo data for",
  "documents.generated_document.generated": "made",
  "documents.generated_document.reprinted": "printed again",
  "documents.generated_document.superseded": "replaced",
  "governance.owner_override.used": "used the owner's override on",
  "platform.action_item.resolved": "closed",
  "quality.disposition.released": "said OK to",
  "quality.disposition.rejected": "said not OK to",
  "quality.disposition.expired": "marked out of date",
  "finance.accounting_period.locked": "closed",
  // Live check 2026-11-06: the audit event names what was done, not the record it is filed under ("Lito Pascual set
  // aside stock for the customer order", not "made the customer order").
  "inventory.stock_allocation.created": "set aside stock for",
  "inventory.stock_allocation.released": "gave back the stock set aside for",
  "inventory.stock_reservation.created": "reserved stock for",
  "inventory.stock_reservation.converted": "used the reserved stock for",
  "inventory.stock_reservation.released": "gave back the reserved stock for",
  "procurement.purchase_order.receipt_posted": "received goods for",
  "production.pick_line.confirmed": "got the materials for",
  // Round 5 B12: "Lito Pascual entered a box by hand on the pick list", not "manual entry the pick list".
  "sales.pick_line.manual_entry": "entered a box by hand on",
};
const VERB: Record<string, string> = {
  created: "made",
  submitted: "sent for approval",
  approved: "approved",
  confirmed: "confirmed",
  posted: "saved",
  released: "said OK to",
  rejected: "said no to",
  dispatched: "sent out",
  delivered: "recorded the delivery of",
  cancelled: "cancelled",
  voided: "cancelled (kept on record)",
  reversed: "undid (kept on record)",
  sent: "sent",
  invited: "invited",
  enabled: "turned on",
  disabled: "turned off",
  locked: "locked",
  unlocked: "unlocked",
  updated: "changed",
  edited: "changed",
  deleted: "deleted",
  allocated: "set aside stock for",
  picked: "got from the shelf",
  packed: "boxed",
  received: "received",
  closed: "closed",
  started: "started",
  completed: "finished",
  placed: "placed",
  lifted: "lifted",
  resolved: "closed",
  printed: "printed",
  expired: "marked out of date",
  status_changed: "moved on",
  verified: "checked",
  scanned: "scanned",
};

/** What happened to a problem or alert ("escalated" is the system telling the managers; people never see the word). */
const PROBLEM_VERB: Record<string, string> = {
  escalated: "raised a problem",
  resolved: "closed the problem",
  acknowledged: "is dealing with the problem",
  created: "raised a problem",
};

export type ActivityInput = { action: string; entityType: string; entityNumber: string | null; actorName: string | null; entityName?: string | null };

/**
 * "{who} {did} the {what} {for|from|of} {name}"; the record number is returned separately so the caller shows it
 * small and grey after the sentence (and links it). A paper ("generated document") is called by its kind.
 */
export function activitySentence(r: ActivityInput): { who: string; text: string; number: string | null } {
  const who = r.actorName ?? "The system";
  // Problems and alerts (round 4, UX re-audit C N1): their title is the sentence people need, so it follows a
  // colon ("The system raised a problem: Order for Mabuhay Pharmacy Group is late"); the record number stays grey after.
  if (r.entityType === "action_item") {
    const event = r.action.split(".").pop() ?? "";
    const verb = PROBLEM_VERB[event] ?? `${VERB[event] ?? event.replace(/_/g, " ")} the problem`;
    const title = r.entityName?.trim();
    return { who, text: title ? `${verb}: ${title}` : verb, number: r.entityNumber };
  }
  const parts = r.action.split(".");
  const event = parts[parts.length - 1] ?? "";
  const verb = EXACT[r.action] ?? VERB[event] ?? event.replace(/_/g, " ");
  const name = r.entityName?.trim() || null;
  let noun = NOUN[r.entityType] ?? r.entityType.replace(/_/g, " ");
  let tail = "";
  if (r.entityType === "generated_document" && name) noun = name;
  else if (name && ["customer", "supplier", "material", "product", "user", "role", "price_list"].includes(r.entityType)) noun = `${noun} ${name}`;
  else if (name) tail = ` ${JOIN[r.entityType] ?? "·"} ${name}`;
  return { who, text: `${verb} the ${noun}${tail}`.replace(/\s+/g, " ").trim(), number: r.entityNumber };
}

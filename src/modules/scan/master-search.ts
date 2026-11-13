import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import type { Permission } from "@/lib/permissions";
import { fmtDate } from "@/lib/qty";
import { endsWithNumberRegex, likeFragment, parseNumberQuery, parseShortNumber, wantsPartial, type NumberQuery, type ShortNumber } from "./number-query";
import { searchTerms } from "./search";

/**
 * Master search (owner request 2026-11-08: "search for a category, say Bills, or Lot, or Master Data etc., plus any
 * code like BILL-26-00001"). Records only; the screens part ("bills" → Supplier bills) is built from the menu in
 * `src/app/(app)/search-screens.ts` because menus live with the app.
 *
 * | What is typed                      | What is searched                                                            |
 * |------------------------------------|-----------------------------------------------------------------------------|
 * | a number or code ("BILL-26-00001") | `RECORD_TYPES` by number: exact first (index on the number column), then    |
 * |                                    | numbers that end with or contain it ("26-00001")                            |
 * | words ("coconut", "cebu")          | names of materials, products, customers, suppliers, lots, batches, orders… |
 *
 * Security (CLAUDE.md, ADR-085): every record type has its own view permission. A type the caller may not view is
 * not queried at all (no count, no hint that it exists). Site records are limited to the sites where the caller holds
 * that permission (`canAt`); organisation records (master data, recalls) need the permission itself. Every query is
 * limited to the caller's organisation. Expense claims follow the claims screen: others' claims need view, approve or
 * post at the site; with only "create", a person finds their own claims. Reads only, no audit.
 */

export type HitIcon =
  | "money" | "buying" | "sales" | "delivery" | "production" | "lot" | "box" | "stock" | "quality" | "repair" | "document"
  | "material" | "product" | "customer" | "supplier" | "shelf" | "equipment" | "recipe" | "person";

export type MasterHit = {
  /** Record type key (RECORD_TYPES). */
  type: string;
  icon: HitIcon;
  /** Name first: "Supplier bill · Cebu Chemicals", "Coconut oil". */
  name: string;
  /** The record number or code, shown small and grey. */
  number: string;
  /** One plain line: what it is, status in words, date, site. */
  detail: string;
  href: string;
  /** The typed text is this record's number (capitals and dashes aside). */
  exact: boolean;
};

export type MasterGroupKey = "numbers" | "items" | "parties" | "stock" | "orders" | "money" | "quality" | "setup" | "people";
export type MasterGroup = { key: MasterGroupKey; label: string; hits: MasterHit[] };

export const MASTER_GROUP_LABEL: Record<MasterGroupKey, string> = {
  numbers: "Records by number",
  items: "Products and materials",
  parties: "Customers and suppliers",
  stock: "Batches and lots",
  orders: "Orders",
  money: "Money",
  quality: "Quality",
  setup: "Set-up and machines",
  people: "People",
};

/** Rows per record type and query (each type query has its own LIMIT). */
export const TYPE_LIMIT = 5;
/** Rows in "Records by number" (exact matches first). */
export const NUMBER_GROUP_LIMIT = 30;
/** Longest text looked up (longer input is cut). */
export const MAX_QUERY_LENGTH = 80;

type Row = { k: string; id: string; number: string; name: string | null; status: string | null; at: string | null; site: string | null; extra: string | null; rank: number };

type RecordType = {
  key: string;
  /** What it is, in plain words ("Supplier bill"). */
  noun: string;
  icon: HitIcon;
  /** Number prefixes this type issues (narrows the look-up when the typed text starts with one). */
  prefixes: readonly string[];
  /** FROM clause; the record is aliased `t`. Static SQL, never user input. */
  from: string;
  /** The organisation column (default `t.organization_id`; shelves and warehouses belong to it through their site). */
  org?: string;
  /** The number or code column. */
  num: string;
  /** More columns that hold a number people type (old paper number, supplier's own number). */
  alsoNum?: readonly string[];
  /** The name shown first (party, product, title). */
  name?: string;
  status?: string;
  /** Date shown in the detail line and used for "newest first". */
  date?: string;
  /** Extra value the link needs (the product of a sellable item, the delivery of a delivery receipt). */
  extra?: string;
  where?: string;
  /** "site": records of a site; "org": organisation records; "org_or_site": a site, or none (equipment). */
  scope: "site" | "org" | "org_or_site";
  /** Any one of these lets the caller view the type. */
  view: readonly Permission[];
  href: (r: Row, ctx: AuthContext) => string;
  /** Master data: the row title is the record's name, the noun goes into the detail. */
  master?: boolean;
  /** Words search: SQL expressions that each typed word may match, and the result group. */
  words?: { cols: readonly string[]; group: Exclude<MasterGroupKey, "numbers">; order?: "name" };
};

const id = (base: string) => (r: Row) => `${base}/${r.id}`;

/**
 * Every record type that has a number, with its permission and page (owner request 2026-11-08 list). Label jobs
 * and transfers have no number of their own (a label job carries the number of what it labels) and are left out.
 */
/** Address words of a customer ("pasig", "rizal st"): every saved address (ADR-132 §4, C report #15). */
const CUSTOMER_ADDRESSES = "(select string_agg(concat_ws(' ', a.line1, a.line2, a.city, a.province), ' ') from customer_addresses a where a.customer_id = t.id and a.deleted_at is null)";

export const RECORD_TYPES: readonly RecordType[] = [
  // ---------------------------------------------------------------- money
  { key: "supplier_bill", noun: "Supplier bill", icon: "money", prefixes: ["BILL"], from: "supplier_bills t join suppliers p on p.id = t.supplier_id", num: "t.bill_number", alsoNum: ["t.supplier_reference"], name: "p.name", status: "t.status", date: "t.bill_date", scope: "site", view: ["finance.supplier_bill.view"], href: id("/finance/bills"), words: { cols: ["p.name"], group: "money" } },
  { key: "invoice", noun: "Invoice", icon: "money", prefixes: ["INV"], from: "invoices t join customers p on p.id = t.customer_id", num: "t.invoice_number", name: "p.name", status: "t.status", date: "coalesce(t.issue_date, t.created_at::date)", scope: "site", view: ["finance.invoice.view"], href: id("/finance/invoices"), words: { cols: ["p.name"], group: "money" } },
  { key: "payment", noun: "Payment", icon: "money", prefixes: ["PAY"], from: "payment_records t left join customers c on c.id = t.customer_id left join suppliers s on s.id = t.supplier_id", num: "t.payment_number", name: "coalesce(c.name, s.name)", status: "t.status", date: "t.paid_on", scope: "site", view: ["finance.payment_record.view"], href: id("/finance/payments") },
  { key: "credit_note", noun: "Credit (money back)", icon: "money", prefixes: ["CN"], from: "credit_notes t join customers p on p.id = t.customer_id", num: "t.credit_note_number", name: "p.name", status: "t.status", date: "coalesce(t.issue_date, t.created_at::date)", scope: "site", view: ["finance.credit_note.view"], href: id("/finance/credit-notes") },
  { key: "expense_claim", noun: "Expense claim", icon: "money", prefixes: ["EXP"], from: "expense_claims t", num: "t.claim_number", name: "t.description", status: "t.status", date: "t.expense_date", scope: "site", view: ["finance.expense_claim.view", "finance.expense_claim.approve", "finance.expense_claim.post"], href: id("/finance/expenses") },
  // ---------------------------------------------------------------- buying
  { key: "purchase_request", noun: "Request to buy", icon: "buying", prefixes: ["PR"], from: "purchase_requests t", num: "t.request_number", status: "t.status", date: "t.created_at", scope: "site", view: ["procurement.purchase_request.view"], href: id("/procurement/requests") },
  { key: "purchase_order", noun: "Purchase order", icon: "buying", prefixes: ["PO"], from: "purchase_orders t join suppliers p on p.id = t.supplier_id", num: "t.po_number", alsoNum: ["t.legacy_number"], name: "p.name", status: "t.status", date: "coalesce(t.order_date, t.created_at::date)", scope: "site", view: ["procurement.purchase_order.view"], href: id("/procurement/orders"), words: { cols: ["p.name"], group: "orders" } },
  { key: "goods_receipt", noun: "Delivery received", icon: "buying", prefixes: ["GR"], from: "goods_receipts t left join suppliers p on p.id = t.supplier_id", num: "t.receipt_number", alsoNum: ["t.supplier_document_number"], name: "p.name", status: "t.status", date: "coalesce(t.received_at, t.created_at)", scope: "site", view: ["procurement.goods_receipt.view"], href: id("/inventory/receive") },
  { key: "supplier_return", noun: "Sent back to supplier", icon: "buying", prefixes: ["SRT"], from: "supplier_returns t join suppliers p on p.id = t.supplier_id", num: "t.return_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["procurement.supplier_return.view"], href: id("/procurement/returns") },
  // ---------------------------------------------------------------- sales and deliveries
  { key: "sales_order", noun: "Customer order", icon: "sales", prefixes: ["SO"], from: "sales_orders t join customers p on p.id = t.customer_id", num: "t.order_number", alsoNum: ["t.customer_po_number"], name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["sales.sales_order.view"], href: id("/sales"), words: { cols: ["p.name"], group: "orders" } },
  { key: "quote", noun: "Price offer", icon: "sales", prefixes: ["QT"], from: "quotes t join customers p on p.id = t.customer_id", num: "t.quote_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["sales.quote.view"], href: id("/sales/quotations") },
  { key: "shipment", noun: "Delivery", icon: "delivery", prefixes: ["SH"], from: "shipments t left join sales_orders o on o.id = t.sales_order_id left join customers p on p.id = o.customer_id", num: "t.shipment_number", name: "p.name", status: "t.status", date: "coalesce(t.dispatched_at, t.created_at)", scope: "site", view: ["sales.shipment.view"], href: id("/sales/shipments") },
  { key: "delivery_receipt", noun: "Delivery receipt", icon: "delivery", prefixes: ["DR"], from: "delivery_receipts t join shipments s on s.id = t.shipment_id left join sales_orders o on o.id = s.sales_order_id left join customers p on p.id = o.customer_id", num: "t.dr_number", alsoNum: ["t.legacy_number"], name: "p.name", status: "t.status", date: "coalesce(t.issued_at, t.created_at)", extra: "t.shipment_id::text", scope: "site", view: ["sales.shipment.view"], href: (r) => `/sales/shipments/${r.extra}` },
  { key: "pick", noun: "To get from shelf", icon: "delivery", prefixes: ["PK"], from: "picks t left join sales_orders o on o.id = t.sales_order_id left join customers p on p.id = o.customer_id", num: "t.pick_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["sales.pick.view"], href: id("/sales/picking") },
  { key: "pack", noun: "Boxing", icon: "box", prefixes: ["PA"], from: "packs t left join products p on p.id = t.product_id", num: "t.pack_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["inventory.pack.view"], href: id("/warehouse/packs") },
  { key: "customer_return", noun: "Customer return", icon: "sales", prefixes: ["RT"], from: "customer_returns t join customers p on p.id = t.customer_id", num: "t.return_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["sales.customer_return.view"], href: id("/sales/returns") },
  // ---------------------------------------------------------------- production
  { key: "work_order", noun: "Production order", icon: "production", prefixes: ["WO"], from: "work_orders t join products p on p.id = t.product_id", num: "t.work_order_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["production.work_order.view"], href: id("/production/orders") },
  { key: "production_plan", noun: "Production plan", icon: "production", prefixes: ["PP"], from: "production_plans t", num: "t.plan_number", status: "t.status", date: "t.created_at", scope: "site", view: ["production.production_plan.view"], href: id("/production/plan") },
  { key: "batch", noun: "Batch", icon: "production", prefixes: ["B"], from: "batches t join products p on p.id = t.product_id", num: "t.batch_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["production.batch.view"], href: id("/production"), words: { cols: ["p.name", "p.sku_code"], group: "stock" } },
  // ---------------------------------------------------------------- stock
  { key: "lot", noun: "Lot", icon: "lot", prefixes: ["L", "B"], from: "inventory_lots t left join materials m on m.id = t.material_id left join products p on p.id = t.product_id", num: "t.lot_number", alsoNum: ["t.legacy_number", "t.supplier_lot_number"], name: "coalesce(m.name, p.name)", status: "t.quality_status", date: "t.created_at", scope: "site", view: ["inventory.lot.view"], href: id("/inventory"), words: { cols: ["m.name", "p.name", "t.supplier_lot_number"], group: "stock" } },
  { key: "box", noun: "Box or sack", icon: "box", prefixes: ["BX"], from: "containers t", num: "t.container_number", status: "t.status", date: "t.created_at", scope: "site", view: ["inventory.container.view"], href: id("/inventory/containers") },
  { key: "movement", noun: "Stock change", icon: "stock", prefixes: ["MOV"], from: "stock_movements t join inventory_lots l on l.id = t.lot_id left join materials m on m.id = l.material_id left join products p on p.id = l.product_id", num: "t.source_document_number", name: "coalesce(m.name, p.name)", status: "t.movement_type", date: "t.posted_at", where: "t.source_document_type in ('stock_transfer', 'put_away')", scope: "site", view: ["inventory.movement.view"], href: id("/inventory/movements") },
  { key: "reservation", noun: "Set aside", icon: "stock", prefixes: ["RSV"], from: "stock_reservations t join inventory_lots l on l.id = t.lot_id left join materials m on m.id = l.material_id left join products p on p.id = l.product_id", num: "t.reservation_number", name: "coalesce(m.name, p.name)", status: "t.status", date: "t.created_at", scope: "site", view: ["inventory.reservation.view"], href: () => "/inventory/lots/reservations" },
  { key: "stock_count", noun: "Stock count", icon: "stock", prefixes: ["CNT"], from: "stock_counts t", num: "t.count_number", status: "t.status", date: "t.created_at", scope: "site", view: ["inventory.stock_count.view"], href: id("/inventory/counts") },
  { key: "stock_adjustment", noun: "Stock fix", icon: "stock", prefixes: ["ADJ"], from: "stock_adjustments t", num: "t.adjustment_number", status: "t.status", date: "t.created_at", scope: "site", view: ["inventory.adjustment.view"], href: id("/inventory/adjustments") },
  // ---------------------------------------------------------------- quality
  { key: "quality_hold", noun: "Stopped by QA", icon: "quality", prefixes: ["QH"], from: "quality_holds t", num: "t.hold_number", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.hold.view"], href: id("/quality/holds") },
  { key: "inspection", noun: "Quality test", icon: "quality", prefixes: ["INS"], from: "inspections t", num: "t.inspection_number", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.inspection.view"], href: id("/quality/inspections") },
  { key: "deviation", noun: "Problem report", icon: "quality", prefixes: ["DEV"], from: "deviations t", num: "t.deviation_number", name: "left(t.description, 80)", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.deviation.view"], href: id("/quality/deviations") },
  { key: "capa", noun: "Fix-and-prevent plan", icon: "quality", prefixes: ["CAPA"], from: "capas t", num: "t.capa_number", name: "t.title", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.capa.view"], href: id("/quality/capa"), words: { cols: ["t.title"], group: "quality" } },
  { key: "complaint", noun: "Customer complaint", icon: "quality", prefixes: ["CMP"], from: "complaints t left join customers p on p.id = t.customer_id", num: "t.complaint_number", name: "p.name", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.complaint.view"], href: id("/quality/complaints") },
  { key: "recall", noun: "Product recall", icon: "quality", prefixes: ["RC"], from: "recall_cases t", num: "t.recall_number", name: "t.title", status: "t.status", date: "t.created_at", scope: "org", view: ["quality.recall_case.view"], href: id("/quality/recalls"), words: { cols: ["t.title"], group: "quality" } },
  { key: "change_request", noun: "Change request", icon: "quality", prefixes: ["CC"], from: "change_controls t", num: "t.change_number", name: "t.title", status: "t.status", date: "t.created_at", scope: "site", view: ["quality.change_control.view"], href: id("/quality/changes"), words: { cols: ["t.title"], group: "quality" } },
  // ---------------------------------------------------------------- maintenance, documents
  { key: "repair_job", noun: "Repair job", icon: "repair", prefixes: ["MWO"], from: "maintenance_work_orders t", num: "t.work_order_number", name: "t.title", status: "t.status", date: "t.created_at", scope: "site", view: ["maintenance.work_order.view"], href: id("/maintenance/work-orders"), words: { cols: ["t.title"], group: "setup" } },
  { key: "maintenance_plan", noun: "Regular maintenance", icon: "repair", prefixes: ["PM"], from: "maintenance_plans t", num: "t.plan_number", name: "t.title", status: "t.status", date: "t.created_at", scope: "site", view: ["maintenance.plan.view"], href: id("/maintenance/plans") },
  { key: "document", noun: "Document", icon: "document", prefixes: ["DOC"], from: "generated_documents t", num: "t.document_number", name: "replace(t.document_kind, '_', ' ')", status: "t.status", date: "t.generated_at", scope: "site", view: ["documents.generated_document.view"], href: id("/documents") },
  { key: "import_job", noun: "Spreadsheet load", icon: "document", prefixes: ["IMP"], from: "import_jobs t", num: "t.import_number", status: "t.status", date: "t.created_at", scope: "site", view: ["platform.import_job.view"], href: id("/admin/imports") },
  // ---------------------------------------------------------------- master data (codes)
  { key: "material", noun: "Material", icon: "material", prefixes: ["MAT"], from: "materials t", num: "t.code", name: "t.name", status: "t.status", scope: "org", view: ["masterdata.material.view"], href: id("/masterdata/materials"), master: true, words: { cols: ["t.name", "t.code", "t.common_name"], group: "items", order: "name" } },
  { key: "product", noun: "Product", icon: "product", prefixes: ["PRD"], from: "products t", num: "t.sku_code", name: "t.name", status: "t.status", scope: "org", view: ["masterdata.product.view"], href: id("/masterdata/products"), master: true, words: { cols: ["t.name", "t.sku_code"], group: "items", order: "name" } },
  { key: "sku", noun: "Sellable item", icon: "product", prefixes: ["SKU"], from: "skus t", num: "t.code", name: "t.name", status: "t.status", extra: "t.product_id::text", scope: "org", view: ["masterdata.sku.view"], href: (r) => `/masterdata/products/${r.extra}/skus/${r.id}`, master: true },
  { key: "supplier", noun: "Supplier", icon: "supplier", prefixes: ["SUP"], from: "suppliers t", num: "t.code", alsoNum: ["t.legacy_number"], name: "t.name", scope: "org", view: ["masterdata.supplier.view"], href: id("/procurement/suppliers"), master: true, words: { cols: ["t.name", "t.code", "t.contact_name", "t.address_line1", "t.city"], group: "parties", order: "name" } },
  { key: "customer", noun: "Customer", icon: "customer", prefixes: ["CUS"], from: "customers t", num: "t.code", name: "t.name", status: "t.status", scope: "org", view: ["masterdata.customer.view"], href: id("/sales/customers"), master: true, words: { cols: ["t.name", "t.code", "t.contact_name", "t.ship_to_address", CUSTOMER_ADDRESSES], group: "parties", order: "name" } },
  { key: "shelf", noun: "Shelf or area", icon: "shelf", prefixes: ["LOC"], from: "locations t join sites so on so.id = t.site_id", org: "so.organization_id", num: "t.code", name: "t.name", status: "t.status", scope: "site", view: ["masterdata.location.view"], href: id("/inventory/locations"), master: true, words: { cols: ["t.name"], group: "setup", order: "name" } },
  { key: "warehouse", noun: "Warehouse", icon: "shelf", prefixes: ["WH"], from: "warehouses t join sites so on so.id = t.site_id", org: "so.organization_id", num: "t.code", name: "t.name", scope: "site", view: ["masterdata.warehouse.view"], href: id("/masterdata/warehouses"), master: true },
  { key: "line", noun: "Making area / line", icon: "equipment", prefixes: ["LINE"], from: "production_lines t", num: "t.code", name: "t.name", status: "t.status", scope: "site", view: ["masterdata.production_line.view"], href: id("/masterdata/lines"), master: true },
  { key: "equipment", noun: "Machine or tool", icon: "equipment", prefixes: ["EQP"], from: "equipment t", num: "t.code", name: "t.name", status: "t.status", scope: "org_or_site", view: ["masterdata.equipment.view"], href: id("/masterdata/equipment"), master: true, words: { cols: ["t.name", "t.code"], group: "setup", order: "name" } },
  { key: "recipe", noun: "Recipe", icon: "recipe", prefixes: ["F"], from: "formulas t", num: "t.code", name: "t.name", scope: "org", view: ["masterdata.formula.view"], href: (r, ctx) => (ctx.can("masterdata.routing.view") ? `/masterdata/recipes/${r.id}` : `/masterdata/formulas/${r.id}`), master: true, words: { cols: ["t.name", "t.code"], group: "setup", order: "name" } },
  { key: "steps", noun: "Steps", icon: "recipe", prefixes: ["R"], from: "routings t", num: "t.code", name: "t.name", scope: "org", view: ["masterdata.routing.view"], href: id("/masterdata/routings"), master: true },
  { key: "how_to", noun: "How-to sheet", icon: "recipe", prefixes: ["WI"], from: "work_instructions t", num: "t.code", name: "t.name", scope: "org", view: ["masterdata.work_instruction.view"], href: id("/masterdata/work-instructions"), master: true },
  // ---------------------------------------------------------------- people (round 5, B report: "Dino" found nothing)
  // People who hold a job at a site where the caller may view people, or organisation-wide (scopeFor "person").
  { key: "person", noun: "Person who uses the app", icon: "person", prefixes: [], from: "users t", num: "t.email", name: "t.display_name", status: "t.status", scope: "org", view: ["identity.user.view"], href: id("/admin/users"), master: true, words: { cols: ["t.display_name"], group: "people", order: "name" } },
];

/**
 * Round 5 leftovers (ADR-132 §4): the records floor people (operator, checker, warehouse) look for. Their search shows
 * only these record types; everything else they may view still opens by link and by its whole number on the Scan
 * screen. The permission and site of every type are checked as for everyone (`viewableTypes`).
 */
export const FLOOR_RECORD_TYPES: readonly string[] = ["batch", "lot", "box", "shelf", "sales_order", "work_order", "shipment", "delivery_receipt", "goods_receipt"];

/**
 * Record types that are only noise in a short-number search (round 5, A report #15, C report #15: "Set
 * aside · RSV-…", "Stock change · MOV-…", "Document · label DOC-…" under "0003"). They still open when their whole
 * number is typed.
 */
export const EXACT_ONLY_TYPES: readonly string[] = ["reservation", "movement", "document", "import_job"];

/** Order of record types in "Records by number" for the same match quality: the records people ask for by number first. */
const NUMBER_TYPE_ORDER: readonly string[] = ["batch", "sales_order", "lot", "work_order", "purchase_order", "invoice", "shipment", "box", "supplier_bill", "goods_receipt", "quote", "purchase_request", "payment", "customer", "supplier", "product", "material"];
const typeRank = (k: string) => {
  const i = NUMBER_TYPE_ORDER.indexOf(k);
  return i < 0 ? NUMBER_TYPE_ORDER.length : i;
};

/** Grade-5 words for stored states (fallback: the code with spaces). */
const STATUS_WORDS: Record<string, string> = {
  draft: "draft", submitted: "waiting for approval", pending_approval: "waiting for approval", approved: "approved", rejected: "rejected",
  posted: "posted", partially_paid: "partly paid", paid: "paid", voided: "cancelled", void: "cancelled", cancelled: "cancelled", closed: "closed",
  sent: "sent", partially_received: "partly received", received: "received", confirmed: "confirmed", allocated: "stock set aside",
  picking: "being picked", packed: "packed", partially_shipped: "partly sent", shipped: "sent", invoiced: "invoiced", dispatched: "sent out",
  delivered: "delivered", planned: "planned", released: "ready to use", in_process: "being made", in_progress: "in progress",
  materials_staged: "materials ready", awaiting_qc: "waiting for quality check", quarantine: "waiting for QA check", quarantined: "waiting for QA check",
  on_hold: "stopped by QA", expired: "expired", recalled: "recalled", open: "open", completed: "done", done: "done", active: "in use",
  inactive: "not in use", discontinued: "not in use any more", blocked: "blocked", issued: "issued", acknowledged: "signed by customer",
  ready: "ready", disputed: "being checked with the supplier", applied: "used", picked: "picked", superseded: "replaced by a newer copy", transfer: "moved", put_away: "put away", queued: "waiting",
};
export const statusWords = (s: string | null | undefined): string | null => (s ? (STATUS_WORDS[s] ?? s.replace(/_/g, " ")) : null);

const inList = (ids: readonly string[]) => sql.join(ids.map((s) => sql`${s}::uuid`), sql`, `);

/** The sites where the caller may view this type (site records), or "org" / null for organisation records. */
function scopeFor(ctx: AuthContext, t: RecordType): SQL | null {
  if (t.key === "expense_claim") {
    const sites = ctx.allowedSiteIds.filter((s) => t.view.some((p) => ctx.canAt(p, s)));
    const own = ctx.can("finance.expense_claim.create") ? sql`(t.claimant_user_id = ${ctx.userId}::uuid and t.site_id in (${inList(ctx.allowedSiteIds)}))` : null;
    const others = sites.length ? sql`t.site_id in (${inList(sites)})` : null;
    if (!own && !others) return null;
    return own && others ? sql`(${others} or ${own})` : (others ?? own);
  }
  if (t.key === "person") {
    // Round 5: people with a current job at a site where the caller may view people, or with an organisation-wide job.
    // A site manager never finds the people of another site (tests/integration/scan/search-round5.test.ts).
    const sites = ctx.allowedSiteIds.filter((s) => t.view.some((p) => ctx.canAt(p, s)));
    if (!sites.length) return null;
    return sql`t.status = 'active' and exists (select 1 from user_site_assignments a where a.user_id = t.id
      and (a.site_id in (${inList(sites)}) or a.is_organization_wide) and a.revoked_at is null and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now()))`;
  }
  if (t.scope === "org") return t.view.some((p) => ctx.can(p)) ? sql`true` : null;
  const sites = ctx.allowedSiteIds.filter((s) => t.view.some((p) => ctx.canAt(p, s)));
  if (!sites.length) return null;
  return t.scope === "org_or_site" ? sql`(t.site_id is null or t.site_id in (${inList(sites)}))` : sql`t.site_id in (${inList(sites)})`;
}

/** The record types this caller may view, with their scope condition. */
export function viewableTypes(ctx: AuthContext): { type: RecordType; scope: SQL }[] {
  return RECORD_TYPES.flatMap((type) => {
    const scope = scopeFor(ctx, type);
    return scope ? [{ type, scope }] : [];
  });
}

function selectList(t: RecordType, rank: SQL): SQL {
  return sql`${t.key}::text as k, t.id::text as id, ${sql.raw(t.num)} as number, ${sql.raw(t.name ?? "null")}::text as name, ${sql.raw(t.status ?? "null")}::text as status,
    ${sql.raw(t.date ?? "null")}::text as at, ${sql.raw(t.scope === "org" ? "null" : "t.site_id")}::text as site, ${sql.raw(t.extra ?? "null")}::text as extra, ${rank} as rank`;
}

const orderBy = (t: RecordType) => sql.raw(t.words?.order === "name" || !t.date ? `${t.name ?? t.num} asc` : `${t.date} desc nulls last`);

/** Exact: the number column equals one of the typed forms (uses the (organization_id, number) index). */
function exactBranch(ctx: AuthContext, t: RecordType, scope: SQL, q: NumberQuery): SQL {
  const cols = [t.num, ...(t.alsoNum ?? [])];
  const forms = sql.join(q.exact.map((f) => sql`${f}`), sql`, `);
  const match = sql.join(cols.map((c) => sql`${sql.raw(c)} in (${forms})`), sql` or `);
  return sql`(select ${selectList(t, sql`0`)} from ${sql.raw(t.from)}
    where ${sql.raw(t.org ?? "t.organization_id")} = ${ctx.organizationId}::uuid and ${scope} ${t.where ? sql`and ${sql.raw(t.where)}` : sql``} and (${match})
    limit ${TYPE_LIMIT})`;
}

/** Partial: the number (any capitals, with or without dashes) ends with or contains the typed text. */
function partialBranch(ctx: AuthContext, t: RecordType, scope: SQL, q: NumberQuery): SQL {
  const cols = [t.num, ...(t.alsoNum ?? [])];
  const text = likeFragment(q.text);
  const compact = likeFragment(q.compact);
  const exactForms = sql.join(q.exact.map((f) => sql`${f}`), sql`, `);
  const flat = (c: string) => sql`regexp_replace(${sql.raw(c)}, '[^A-Za-z0-9]', '', 'g')`;
  const match = sql.join(cols.map((c) => sql`(${sql.raw(c)} ilike ${`%${text}%`} or ${flat(c)} ilike ${`%${compact}%`})`), sql` or `);
  const rank = sql`case when upper(${sql.raw(t.num)}) in (${exactForms}) or upper(${flat(t.num)}) = ${q.compact} then 0
    when ${sql.raw(t.num)} ilike ${`%${text}`} or ${flat(t.num)} ilike ${`%${compact}`} then 1 else 2 end`;
  return sql`(select ${selectList(t, rank)} from ${sql.raw(t.from)}
    where ${sql.raw(t.org ?? "t.organization_id")} = ${ctx.organizationId}::uuid and ${scope} ${t.where ? sql`and ${sql.raw(t.where)}` : sql``} and (${match})
    order by 9 asc, ${orderBy(t)} limit ${TYPE_LIMIT})`;
}

/** Short number (round 5): the number ends with the typed number, any zeros before it ("4" → SO-26-00004). */
function shortBranch(ctx: AuthContext, t: RecordType, scope: SQL, s: ShortNumber): SQL {
  return sql`(select ${selectList(t, sql`1`)} from ${sql.raw(t.from)}
    where ${sql.raw(t.org ?? "t.organization_id")} = ${ctx.organizationId}::uuid and ${scope} ${t.where ? sql`and ${sql.raw(t.where)}` : sql``}
      and ${sql.raw(t.num)} ~ ${endsWithNumberRegex(s.n)}
    order by ${orderBy(t)} limit ${TYPE_LIMIT})`;
}

/** Words: every typed word matches one of the type's name columns (any capitals). */
function wordsBranch(ctx: AuthContext, t: RecordType, scope: SQL, words: string[]): SQL {
  const cols = t.words!.cols;
  const all = sql.join(
    words.map((w) => sql`(${sql.join(cols.map((c) => sql`coalesce(${sql.raw(c)}, '') ilike ${`%${w}%`}`), sql` or `)})`),
    sql` and `,
  );
  const live = t.master && t.status ? sql`and coalesce(${sql.raw(t.status)}, '') not in ('discontinued', 'archived')` : sql``;
  return sql`(select ${selectList(t, sql`3`)} from ${sql.raw(t.from)}
    where ${sql.raw(t.org ?? "t.organization_id")} = ${ctx.organizationId}::uuid and ${scope} ${t.where ? sql`and ${sql.raw(t.where)}` : sql``} ${live} and ${all}
    order by ${orderBy(t)} limit ${TYPE_LIMIT})`;
}

async function run(branches: SQL[]): Promise<Row[]> {
  if (!branches.length) return [];
  return (await db.execute(sql.join(branches, sql` union all `))) as unknown as Row[];
}

function toHit(ctx: AuthContext, t: RecordType, r: Row): MasterHit {
  const site = r.site && ctx.allowedSites.length > 1 ? (ctx.allowedSites.find((s) => s.id === r.site)?.code ?? null) : null;
  const when = r.at ? fmtDate(r.at) : null;
  const status = statusWords(r.status);
  const name = t.master ? (r.name ?? r.number) : r.name ? `${t.noun} · ${r.name}` : t.noun;
  const detail = t.key === "person" ? t.noun : (t.master ? [t.noun, status, site] : [status, when, site]).filter(Boolean).join(" · ");
  return { type: t.key, icon: t.icon, name, number: r.number, detail, href: t.href(r, ctx), exact: Number(r.rank) === 0 };
}

/** ADR-126: refusal when the search is limited to people who may see stock. */
export const SEARCH_NEEDS_STOCK_ACCESS = "The search is only for people who may see stock. Ask your manager if you need it.";

/**
 * ADR-126: whether this person may use the master search and the Scan or search screen. Open to everyone while
 * `scan.search_open_to_everyone` is on (default); off, it needs `inventory.lot.view` (as before ADR-121).
 */
export async function searchAllowed(ctx: AuthContext): Promise<boolean> {
  if (ctx.can("inventory.lot.view")) return true;
  return getSetting(db, ctx.organizationId, "scan.search_open_to_everyone");
}

/** ADR-126: throws `forbidden` when `searchAllowed` is false (the search action, `masterSearch`, the page). */
export async function requireSearchAccess(ctx: AuthContext): Promise<void> {
  if (!(await searchAllowed(ctx))) throw new DomainError("forbidden", SEARCH_NEEDS_STOCK_ACCESS, { permission: "inventory.lot.view", setting: "scan.search_open_to_everyone" });
}

export type MasterSearchResult = { groups: MasterGroup[]; /** The one record whose number was typed exactly, if there is exactly one. */ exactHref: string | null };

/**
 * Records for typed text: numbers first (exact, then partial), then words by name. Groups in a fixed order; empty
 * groups are left out. Text shorter than 2 letters or digits finds nothing.
 */
export async function masterSearch(ctx: AuthContext, input: string, opts: { onlyTypes?: readonly string[] } = {}): Promise<MasterSearchResult> {
  await requireSearchAccess(ctx);
  const raw = String(input ?? "").slice(0, MAX_QUERY_LENGTH).trim();
  const q = parseNumberQuery(raw);
  // Round 5: a short number ("4", "SO 4", "order 4", "0003") finds the records whose number ends with it.
  const short = parseShortNumber(raw);
  if (q.compact.length < 2 && !short) return { groups: [], exactHref: null };
  // ADR-132 §4: floor people see their record types only (never more than they may view).
  const types = viewableTypes(ctx).filter((x) => !opts.onlyTypes || opts.onlyTypes.includes(x.type.key));
  const byKey = new Map(types.map((x) => [x.type.key, x.type]));
  const notNoise = (x: { type: RecordType }) => !EXACT_ONLY_TYPES.includes(x.type.key);

  // Numbers: a known prefix narrows the look-up to the types that issue it ("BILL" → supplier bills only).
  const numberTypes = q.prefix ? types.filter((x) => x.type.prefixes.includes(q.prefix!)) : types;
  const shortTypes = short ? types.filter((x) => x.type.prefixes.length > 0 && notNoise(x) && (!short.prefixes || x.type.prefixes.some((p) => short.prefixes!.includes(p)))) : [];
  // Exact codes also without digits ("SHP", "WI-SOAP-MIX"): one word, index look-ups only.
  const oneWord = !/\s/.test(raw);
  const numberSearch = q.numberLike || q.prefix !== null || oneWord;
  // Words: names, unless the text is a prefixed number ("BILL-26-00001", "MAT-0001") or a short number ("order 4").
  const words = (q.prefix && q.numberLike) || short ? [] : searchTerms(raw).filter((w) => /[a-z]/.test(w));
  // Contains-search for longer partial numbers ("26-00001"); a short number uses "ends with" instead.
  const partialOn = !short && (q.numberLike || q.prefix !== null) && wantsPartial(q);

  const [exact, partial, ending, named] = await Promise.all([
    numberSearch && q.exact.length && q.compact.length >= 2 ? run(numberTypes.map((x) => exactBranch(ctx, x.type, x.scope, q))) : Promise.resolve([] as Row[]),
    partialOn ? run(numberTypes.map((x) => partialBranch(ctx, x.type, x.scope, q))) : Promise.resolve([] as Row[]),
    short && shortTypes.length ? run(shortTypes.map((x) => shortBranch(ctx, x.type, x.scope, short))) : Promise.resolve([] as Row[]),
    words.length ? run(types.filter((x) => x.type.words).map((x) => wordsBranch(ctx, x.type, x.scope, words))) : Promise.resolve([] as Row[]),
  ]);

  const seen = new Set<string>();
  const numberRows = [...exact, ...partial, ...ending]
    // Same match quality: the records people ask for by number first (batch before a QA test, round 5 A-B14), then newest.
    .sort((a, b) => Number(a.rank) - Number(b.rank) || typeRank(a.k) - typeRank(b.k) || String(b.at ?? "").localeCompare(String(a.at ?? "")))
    .filter((r) => {
      const k = `${r.k}:${r.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, NUMBER_GROUP_LIMIT);
  const numberHits = numberRows.map((r) => toHit(ctx, byKey.get(r.k)!, r));

  const groups: MasterGroup[] = [];
  if (numberHits.length) groups.push({ key: "numbers", label: MASTER_GROUP_LABEL.numbers, hits: numberHits });
  const order: Exclude<MasterGroupKey, "numbers">[] = ["people", "items", "parties", "stock", "orders", "money", "quality", "setup"];
  for (const key of order) {
    const hits = named
      .filter((r) => byKey.get(r.k)?.words?.group === key && !seen.has(`${r.k}:${r.id}`))
      .map((r) => toHit(ctx, byKey.get(r.k)!, r));
    if (hits.length) groups.push({ key, label: MASTER_GROUP_LABEL[key], hits });
  }
  const exactHits = numberHits.filter((h) => h.exact);
  return { groups, exactHref: exactHits.length === 1 ? exactHits[0].href : null };
}

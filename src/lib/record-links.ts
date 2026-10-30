/**
 * Where a notification or action-centre item takes you (ADR-075, owner request "I cannot click a
 * notification to go to the issue"). The page of a record is derived from its entity type and id;
 * types whose page needs a parent id (a CAPA action lives on its CAPA) use the link stored with the
 * notification; anything else falls back to the action centre, never to a dead link.
 *
 * Pure module (no server imports): used by server pages, client components and unit tests.
 */

/** Entity type → page of one record. Keep in step with the entity types that notify (unit test). */
export const RECORD_ROUTES: Record<string, (id: string) => string> = {
  // inventory and warehouse
  inventory_lot: (id) => `/inventory/${id}`,
  goods_receipt: (id) => `/inventory/receive/${id}`,
  stock_adjustment: (id) => `/inventory/adjustments/${id}`,
  stock_count: (id) => `/inventory/counts/${id}`,
  stock_reservation: () => "/inventory/lots/reservations",
  container: (id) => `/inventory/containers/${id}`,
  location: (id) => `/masterdata/locations/${id}`,
  label_job: (id) => `/labels/jobs/${id}`,
  // production and maintenance
  batch: (id) => `/production/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  product_min_stock: () => "/production/plan",
  maintenance_work_order: (id) => `/maintenance/work-orders/${id}`,
  maintenance_plan: (id) => `/maintenance/plans/${id}`,
  equipment: (id) => `/masterdata/equipment/${id}`,
  // quality
  inspection: (id) => `/quality/inspections/${id}`,
  deviation: (id) => `/quality/deviations/${id}`,
  quality_hold: (id) => `/quality/holds/${id}`,
  complaint: (id) => `/quality/complaints/${id}`,
  capa: (id) => `/quality/capa/${id}`,
  change_control: (id) => `/quality/changes/${id}`,
  recall_case: (id) => `/quality/recalls/${id}`,
  // sales
  sales_order: (id) => `/sales/${id}`,
  quote: (id) => `/sales/quotations/${id}`,
  price_list: (id) => `/sales/price-lists/${id}`,
  customer: (id) => `/sales/customers/${id}`,
  customer_return: (id) => `/sales/returns/${id}`,
  shipment: (id) => `/sales/shipments/${id}`,
  // procurement
  purchase_request: (id) => `/procurement/requests/${id}`,
  purchase_order: (id) => `/procurement/orders/${id}`,
  supplier_return: (id) => `/procurement/returns/${id}`,
  supplier: (id) => `/masterdata/suppliers/${id}`,
  supplier_material_change: () => "/procurement/suppliers",
  // finance
  invoice: (id) => `/finance/invoices/${id}`,
  supplier_bill: (id) => `/finance/bills/${id}`,
  payment_record: (id) => `/finance/payments/${id}`,
  credit_note: (id) => `/finance/credit-notes/${id}`,
  expense_claim: (id) => `/finance/expenses/${id}`,
  accounting_period: () => "/finance/periods",
  tax_configuration: () => "/finance/tax",
  // master data
  material: (id) => `/masterdata/materials/${id}`,
  product: (id) => `/masterdata/products/${id}`,
  // platform, documents, reports
  background_job: (id) => `/admin/diagnostics?job=${id}#jobs`,
  reconciliation_run: (id) => `/admin/diagnostics?run=${id}#reconciliation`,
  import_job: (id) => `/admin/imports/${id}`,
  setting_change_request: () => "/admin/settings",
  notification_rule: () => "/admin/notification-rules",
  purge_runs: () => "/admin/retention",
  generated_document: (id) => `/documents/${id}`,
  report_run: (id) => `/reports/runs/${id}`,
  scheduled_report: (id) => `/reports/schedules/${id}`,
  kpi_refresh_log: () => "/analytics",
};

/**
 * Types whose page needs another id than their own (the producer stores the exact link): a
 * disposition request opens its batch, a CAPA action its CAPA, a template version its template.
 */
export const LINK_ONLY_TYPES = ["batch_reopen_request", "disposition_request", "equipment_override_request", "customer_requirement", "document_template_version", "capa_action"] as const;

export const FALLBACK_HREF = "/action-centre";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A same-site path only (never an absolute or protocol-relative URL). */
export function isInternalPath(link: string | null | undefined): link is string {
  return !!link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\");
}

/** The page of a record from its entity type and id, or null when the type has no own page. */
export function recordHref(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  if (!entityType || !entityId || !UUID.test(entityId)) return null;
  const route = RECORD_ROUTES[entityType];
  return route ? route(entityId) : null;
}

/**
 * Where tapping a notification goes: the link the producer stored (it knows the exact screen),
 * else the page derived from the entity type and id, else the action centre.
 */
export function notificationHref(n: { entityType?: string | null; entityId?: string | null; link?: string | null }): string {
  if (isInternalPath(n.link) && n.link !== "/notifications") return n.link;
  return recordHref(n.entityType, n.entityId) ?? FALLBACK_HREF;
}

/** ADR-075: every notification and action-centre item opens the record it is about. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_HREF, LINK_ONLY_TYPES, RECORD_ROUTES, notificationHref, recordHref } from "@/lib/record-links";

const ID = "01a18abf-6191-7ac6-8701-ea7a8b336232";

/**
 * Entity types that produce notifications (notifyUsers / notifyRoles) or action-centre items
 * (detectors and registered sources), from src/modules. Add a type here when a module starts
 * notifying about it, then give it a route or list it in LINK_ONLY_TYPES.
 */
const NOTIFYING_TYPES = [
  "accounting_period", "background_job", "batch", "batch_reopen_request", "capa", "capa_action", "change_control", "complaint",
  "customer", "customer_requirement", "customer_return", "deviation", "disposition_request", "document_template_version",
  "equipment_override_request", "expense_claim", "generated_document", "goods_receipt", "import_job", "inspection", "inventory_lot",
  "invoice", "kpi_refresh_log", "maintenance_plan", "maintenance_work_order", "price_list", "product_min_stock", "purchase_order",
  "purchase_request", "purge_runs", "quality_hold", "quote", "recall_case", "reconciliation_run", "report_run", "sales_order",
  "setting_change_request", "shipment", "stock_adjustment", "stock_count", "stock_reservation", "supplier_bill",
  "supplier_material_change", "supplier_return", "work_order",
];

const APP = path.resolve(__dirname, "../../src/app/(app)");

/** True when an App Router page answers the path (static segment first, else a [param] folder). */
function pageExists(href: string): boolean {
  const segs = href.split(/[?#]/)[0].split("/").filter(Boolean);
  let dir = APP;
  for (const s of segs) {
    if (existsSync(path.join(dir, s))) dir = path.join(dir, s);
    else {
      const dyn = readdirSync(dir, { withFileTypes: true }).find((d) => d.isDirectory() && /^\[[^.\]]+\]$/.test(d.name));
      if (!dyn) return false;
      dir = path.join(dir, dyn.name);
    }
  }
  return existsSync(path.join(dir, "page.tsx"));
}

describe("record links (ADR-075)", () => {
  it("every notifying entity type has a page route or stores its own link", () => {
    const missing = NOTIFYING_TYPES.filter((t) => !RECORD_ROUTES[t] && !(LINK_ONLY_TYPES as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });

  it("every derived route points at a page that exists", () => {
    const broken = Object.entries(RECORD_ROUTES)
      .map(([t, r]) => [t, r(ID)] as const)
      .filter(([, href]) => !pageExists(href));
    expect(broken).toEqual([]);
  });

  it("derives the page from type + id, e.g. a purchase order", () => {
    expect(recordHref("purchase_order", ID)).toBe(`/procurement/orders/${ID}`);
    expect(recordHref("sales_order", ID)).toBe(`/sales/${ID}`);
    expect(recordHref("unknown_type", ID)).toBeNull();
    expect(recordHref("sales_order", "not-a-uuid")).toBeNull();
  });

  it("prefers the producer's internal link, then the derived page, then the action centre", () => {
    expect(notificationHref({ entityType: "batch", entityId: ID, link: `/quality/batches/${ID}` })).toBe(`/quality/batches/${ID}`);
    expect(notificationHref({ entityType: "batch", entityId: ID, link: null })).toBe(`/production/${ID}`);
    expect(notificationHref({ entityType: "capa_action", entityId: ID, link: null })).toBe(FALLBACK_HREF);
    expect(notificationHref({ entityType: null, entityId: null, link: null })).toBe(FALLBACK_HREF);
  });

  it("never follows an outside or protocol-relative link", () => {
    expect(notificationHref({ entityType: "quote", entityId: ID, link: "https://evil.example/x" })).toBe(`/sales/quotations/${ID}`);
    expect(notificationHref({ entityType: null, entityId: null, link: "//evil.example" })).toBe(FALLBACK_HREF);
  });
});

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accountingPeriods, auditEvents, customers, inventoryLots, locations, products, settings, shipments, taxConfigurations } from "@/db/schema";
import { postMovement } from "@/modules/inventory/ledger";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { allocateOrder, confirmOrder, createOrder, manilaToday } from "@/modules/sales";
import { approveTaxConfiguration, proposeTaxConfiguration } from "@/modules/finance";
import { registerAppHooks } from "@/modules/wiring";
import { asUser, loadKit, type Kit } from "./kit";
import { shipOrder } from "./w3e";

/**
 * Wave 4 W4B finance fixtures (fictional data only; demo accounts use demo1234). Two finance people are
 * needed for separation of duties: Rosa Lim (finance@) and, as a second finance clerk in tests, the
 * auditor's account acting with the finance bundle (`finance2`, SoD compares user ids). The demo seed adds
 * a real second finance account (finance2@bryels-care.test) for the "Try the demo" panel.
 */
export const PW = "demo1234";

export type W4b = Kit & {
  finance: AuthContext;
  finance2: AuthContext;
  owner: AuthContext;
  sales: AuthContext;
  manager: AuthContext;
  managerRvs: AuthContext;
  warehouse: AuthContext;
  operator: AuthContext;
  auditor: AuthContext;
  admin: AuthContext;
  qa: AuthContext;
  procurement: AuthContext;
};

export async function loadW4b(): Promise<W4b> {
  registerAppHooks();
  const kit = await loadKit();
  const both = [kit.nfd, kit.rvs];
  return {
    ...kit,
    finance: await asUser(kit, "finance@bryels-care.test", "finance", both),
    finance2: await asUser(kit, "auditor@bryels-care.test", "finance", both),
    owner: await asUser(kit, "owner@bryels-care.test", "owner_director", both),
    sales: await asUser(kit, "sales@bryels-care.test", "sales_cs", both),
    manager: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]),
    managerRvs: await asUser(kit, "warehouse.rvs@bryels-care.test", "site_manager", [kit.rvs]),
    warehouse: await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]),
    operator: await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]),
    auditor: await asUser(kit, "auditor@bryels-care.test", "auditor", both),
    admin: await asUser(kit, "admin@bryels-care.test", "system_admin", both),
    qa: await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", both),
    procurement: await asUser(kit, "checker.nfd@bryels-care.test", "procurement", [kit.nfd]),
  };
}

/** A context for a user with an explicit permission set (role-escalation tests). */
export function withPermissions(base: AuthContext, permissions: readonly string[], roleCodes: string[] = base.roleCodes, sites: SiteRef[] = base.allowedSites) {
  return new AuthContext(base.userId, base.organizationId, base.displayName, base.email, roleCodes, new Set(permissions), sites, sites[0].id);
}

export const bundle = (role: string) => ROLE_BUNDLES[role].permissions;

export async function customerByCode(code: string) {
  const [c] = await db.select().from(customers).where(eq(customers.code, code));
  return c;
}

export async function productBySku(sku: string) {
  const [p] = await db.select().from(products).where(eq(products.skuCode, sku));
  return p;
}

/** Released, long-dated finished-goods stock at NFD FG-01 (loose) so the tests can ship as many orders as they need. */
export async function stockUp(w: W4b, skus: string[] = ["ACS-135", "GBS-135"], qty = "5000") {
  const [fg] = await db.select().from(locations).where(and(eq(locations.siteId, w.nfd.id), eq(locations.code, "FG-01")));
  const expires = new Date(Date.now() + 900 * 86_400_000).toISOString().slice(0, 10);
  for (const sku of skus) {
    const p = await productBySku(sku);
    const [lot] = await db
      .insert(inventoryLots)
      .values({ organizationId: w.orgId, siteId: w.nfd.id, lotNumber: `L-W4B-${sku}-${Date.now().toString(36).toUpperCase()}`, itemKind: "product", productId: p.id, expiresOn: expires, manufacturedOn: today(), qualityStatus: "released", baseUom: "pcs" })
      .returning();
    await db.transaction((tx) => postMovement(tx, w.manager, { movementType: "receipt", lotId: lot.id, toLocationId: fg.id, qtyBase: qty, sourceDocumentType: "test_fixture" }));
  }
}

/** Creates, confirms, allocates and ships an NFD order through W3E's real services. */
export async function shipNfdOrder(w: W4b, customerCode: string, lines: { sku: string; qty: string; price: string }[]) {
  const c = await customerByCode(customerCode);
  const ls = [];
  for (const l of lines) ls.push({ productId: (await productBySku(l.sku)).id, qtyUnits: l.qty, unitPrice: l.price });
  const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: d < manilaToday() ? manilaToday() : d, lines: ls });
  await confirmOrder(w.sales, o.id);
  await allocateOrder(w.warehouse, o.id);
  const shipment = await shipOrder({ picker: w.warehouse, checker: w.manager, dispatcher: w.warehouse }, o.id);
  return { orderId: o.id, shipment, customer: c };
}

export async function shipmentRow(id: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, id));
  return s;
}

/** Proposes (A) and approves (B) a tax rate so it is effective from `from`. */
export async function approvedTax(w: W4b, code: string, ratePct: string, opts: { appliesTo?: "sales" | "purchases" | "expenses"; inclusive?: boolean; from?: string } = {}) {
  const row = await proposeTaxConfiguration(
    w.finance,
    { code, name: `Fictional ${code}`, kind: opts.appliesTo === "purchases" ? "vat_input" : "vat_output", ratePct, inclusive: opts.inclusive ?? false, appliesTo: opts.appliesTo ?? "sales", rounding: "line", effectiveFrom: opts.from ?? "2026-01-01", sourceNote: "FICTIONAL test rate" },
    { password: PW },
  );
  return approveTaxConfiguration(w.finance2, row.id, { note: "Reviewed (test)", password: PW });
}

export async function setOrgSetting(orgId: string, key: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
  await db.insert(settings).values({ organizationId: orgId, scope: "organization", key, value: value as object });
}

export async function clearOrgSetting(orgId: string, key: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
}

export async function auditCount(entityId: string, action: string) {
  return (await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)))).length;
}

/** Direct period state for setup (the services are tested separately). */
export async function periodRow(orgId: string, code: string) {
  const [p] = await db.select().from(accountingPeriods).where(and(eq(accountingPeriods.organizationId, orgId), eq(accountingPeriods.periodCode, code)));
  return p;
}

export async function taxRows(orgId: string, code: string) {
  return db.select().from(taxConfigurations).where(and(eq(taxConfigurations.organizationId, orgId), eq(taxConfigurations.code, code)));
}

export const today = () => manilaToday();
export const thisPeriod = () => manilaToday().slice(0, 7);
export const lastMonthDate = () => {
  const [y, m] = manilaToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 15));
  return d.toISOString().slice(0, 10);
};

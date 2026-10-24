import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customers, products, settings } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createCustomer, manilaToday, setCreditTerms } from "@/modules/sales";
import { asUser, loadKit, type Kit } from "./kit";

/** Fixtures for the Wave 3 W3D commercial tests (fictional data only; seed accounts use demo1234). */
export type W3d = Kit & {
  sales: AuthContext;
  sales2: AuthContext;
  finance: AuthContext;
  owner: AuthContext;
  manager: AuthContext;
  warehouse: AuthContext;
  warehouseRvs: AuthContext;
  qa: AuthContext;
  admin: AuthContext;
  auditor: AuthContext;
};

export async function loadW3d(): Promise<W3d> {
  const kit = await loadKit();
  const both = [kit.nfd, kit.rvs];
  return {
    ...kit,
    sales: await asUser(kit, "sales@bryels-care.test", "sales_cs", both),
    sales2: await asUser(kit, "sales2@bryels-care.test", "sales_cs", [kit.nfd]),
    finance: await asUser(kit, "finance@bryels-care.test", "finance", both),
    owner: await asUser(kit, "owner@bryels-care.test", "owner_director", both),
    manager: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]),
    warehouse: await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]),
    warehouseRvs: await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]),
    qa: await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", both),
    admin: await asUser(kit, "admin@bryels-care.test", "system_admin", both),
    auditor: await asUser(kit, "auditor@bryels-care.test", "auditor", both),
  };
}

/** A context for an existing user with an explicit permission set and role codes (role-escalation tests). */
export function withPermissions(base: AuthContext, permissions: readonly string[], roleCodes: string[] = base.roleCodes, sites: SiteRef[] = base.allowedSites) {
  return new AuthContext(base.userId, base.organizationId, base.displayName, base.email, roleCodes, new Set(permissions), sites, sites[0].id);
}

export const bundle = (role: string) => ROLE_BUNDLES[role].permissions;

let seq = 0;
/** A fresh fictional customer with optional credit terms (set by finance). */
export async function newCustomer(w: W3d, opts: { creditLimit?: string | null; minShelfLifeDays?: number; name?: string } = {}) {
  seq += 1;
  const code = `T3D-${Date.now().toString(36).slice(-5).toUpperCase()}${seq}`;
  const c = await createCustomer(w.sales, {
    code,
    name: opts.name ?? `Fictional Test Buyer ${seq}`,
    minShelfLifeDays: opts.minShelfLifeDays ?? 90,
    shipTo: { label: "Main store", line1: `${seq} Sampaguita St.`, city: "Santa Rosa", province: "Laguna" },
    contactName: "Test Contact",
    phone: "+63 900 000 0000",
  });
  if (opts.creditLimit !== undefined) await setCreditTerms(w.finance, c.id, { creditLimitAmount: opts.creditLimit, paymentTermsDays: 30, reason: "Test terms" });
  const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
  return row;
}

export async function productId(sku: string) {
  const [p] = await db.select().from(products).where(eq(products.skuCode, sku));
  return p.id;
}

export function inDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return d < manilaToday() ? manilaToday() : d;
}

export async function auditCount(entityId: string, action: string) {
  return (await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)))).length;
}

export async function setOrgSetting(orgId: string, key: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
  await db.insert(settings).values({ organizationId: orgId, scope: "organization", key, value: value as object });
}

export async function clearOrgSetting(orgId: string, key: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
}

/** Shared fixtures for the W2A planning tests (work orders, batches from work orders, staging, board, plans). */
import { expect } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots, locations, organizations, products, settings, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import type { SettingKey } from "@/lib/settings";

/** YYYY-MM-DD in Asia/Manila, `days` from today. */
export const day = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export type World = {
  orgId: string;
  nfd: SiteRef;
  rvs: SiteRef;
  planner: AuthContext;
  plannerRvs: AuthContext;
  manager: AuthContext;
  warehouse: AuthContext;
  warehouseRvs: AuthContext;
  operator: AuthContext;
  qa: AuthContext;
  owner: AuthContext;
  auditor: AuthContext;
  sales: AuthContext;
};

export async function ctxFor(orgId: string, email: string, role: keyof typeof ROLE_BUNDLES, siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, [role], new Set(ROLE_BUNDLES[role].permissions), siteList, siteList[0].id);
}

export async function loadWorld(): Promise<World> {
  const [org] = await db.select().from(organizations);
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  const nfd = all.find((s) => s.code === "NFD")!;
  const rvs = all.find((s) => s.code === "RVS")!;
  return {
    orgId: org.id,
    nfd,
    rvs,
    planner: await ctxFor(org.id, "planner.nfd@bryels-care.test", "production_planner", [nfd]),
    plannerRvs: await ctxFor(org.id, "planner.nfd@bryels-care.test", "production_planner", [rvs]),
    manager: await ctxFor(org.id, "manager.nfd@bryels-care.test", "site_manager", [nfd]),
    warehouse: await ctxFor(org.id, "warehouse.nfd@bryels-care.test", "warehouse_operator", [nfd]),
    warehouseRvs: await ctxFor(org.id, "warehouse.rvs@bryels-care.test", "warehouse_operator", [rvs]),
    operator: await ctxFor(org.id, "operator.nfd@bryels-care.test", "production_operator", [nfd]),
    qa: await ctxFor(org.id, "qa.nfd@bryels-care.test", "qa_qc", [nfd, rvs]),
    owner: await ctxFor(org.id, "owner@bryels-care.test", "owner_director", [nfd, rvs]),
    auditor: await ctxFor(org.id, "auditor@bryels-care.test", "auditor", [nfd, rvs]),
    sales: await ctxFor(org.id, "sales@bryels-care.test", "sales_cs", [nfd, rvs]),
  };
}

export async function productId(sku: string) {
  const [p] = await db.select().from(products).where(eq(products.skuCode, sku));
  return p.id;
}

/** Seed lot by supplier lot number (internal numbers depend on the seed month). */
export async function lotBySupplier(supplierLot: string) {
  const [l] = await db.select().from(inventoryLots).where(eq(inventoryLots.supplierLotNumber, supplierLot));
  return l;
}

export async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}

/** Writes an organization-scope setting row (replacing an earlier one). */
export async function setOrgSetting(orgId: string, key: SettingKey, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key), eq(settings.scope, "organization"), isNull(settings.siteId)));
  await db.insert(settings).values({ organizationId: orgId, scope: "organization", key, value: value as object });
}

export async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((e as DomainError).code, (e as Error).message).toBe(code);
  return e as DomainError;
}

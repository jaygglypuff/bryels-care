/** Shared fixtures for the W1C inventory tests (scan-move, containers, counts, adjustments, reservations). */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, inventoryBalances, inventoryLots, locations, materials, organizations, products, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { postMovement } from "@/modules/inventory/ledger";

export const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export type World = {
  orgId: string;
  nfd: SiteRef;
  rvs: SiteRef;
  /** warehouse_operator at NFD (first counter) */
  wh: AuthContext;
  /** the second warehouse_operator at NFD, seeded by src/db/seeds/w1c.ts */
  wh2: AuthContext;
  /** warehouse_operator at RVS only */
  whRvs: AuthContext;
  /** warehouse_operator at both sites (inter-site tests) */
  whBoth: AuthContext;
  manager: AuthContext;
  owner: AuthContext;
  auditor: AuthContext;
  sales: AuthContext;
};

async function ctxFor(orgId: string, email: string, role: keyof typeof ROLE_BUNDLES, siteList: SiteRef[]) {
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
    wh: await ctxFor(org.id, "warehouse.nfd@bryels-care.test", "warehouse_operator", [nfd]),
    wh2: await ctxFor(org.id, "warehouse2.nfd@bryels-care.test", "warehouse_operator", [nfd]),
    whRvs: await ctxFor(org.id, "warehouse.rvs@bryels-care.test", "warehouse_operator", [rvs]),
    whBoth: await ctxFor(org.id, "operator.nfd@bryels-care.test", "warehouse_operator", [nfd, rvs]),
    manager: await ctxFor(org.id, "manager.nfd@bryels-care.test", "site_manager", [nfd]),
    owner: await ctxFor(org.id, "owner@bryels-care.test", "owner_director", [nfd, rvs]),
    auditor: await ctxFor(org.id, "auditor@bryels-care.test", "auditor", [nfd, rvs]),
    sales: await ctxFor(org.id, "sales@bryels-care.test", "sales_cs", [nfd, rvs]),
  };
}

export async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}

export async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b ? String(Number(b.qtyBase)) : "0";
}

let seq = 0;
/** Creates a fictional lot with stock at a location (test setup only; posts a receipt movement). */
export async function makeLot(
  ctx: AuthContext,
  o: { siteId: string; locCode: string; qty: string; materialCode?: string; productSku?: string; status?: string; expiresIn?: number | null; madeDaysAgo?: number },
) {
  const [m] = o.materialCode ? await db.select().from(materials).where(eq(materials.code, o.materialCode)) : [];
  const [p] = o.productSku ? await db.select().from(products).where(eq(products.skuCode, o.productSku)) : [];
  seq += 1;
  const [lot] = await db
    .insert(inventoryLots)
    .values({
      organizationId: ctx.organizationId,
      siteId: o.siteId,
      lotNumber: `T-W1C-${Date.now().toString(36).toUpperCase()}-${seq}`,
      itemKind: m ? "material" : "product",
      materialId: m?.id ?? null,
      productId: p?.id ?? null,
      supplierName: "Laguna Oleo Supply (fictional)",
      manufacturedOn: o.madeDaysAgo !== undefined ? future(-o.madeDaysAgo) : null,
      expiresOn: o.expiresIn === null ? null : future(o.expiresIn ?? 365),
      qualityStatus: o.status ?? "released",
      baseUom: (m ?? p)!.baseUom,
    })
    .returning();
  const l = await loc(o.siteId, o.locCode);
  await db.transaction((tx) => postMovement(tx, ctx, { movementType: "receipt", lotId: lot.id, toLocationId: l.id, qtyBase: o.qty, sourceDocumentType: "test_fixture", reason: "W1C test fixture" }));
  return lot;
}

export async function expectDomain(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}

export async function auditCount(action: string, entityId?: string | null) {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(entityId ? and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId)) : eq(auditEvents.action, action));
  return rows.length;
}

export const key = () => randomUUID();

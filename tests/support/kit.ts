import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { expect } from "vitest";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, organizations, sites, users } from "@/db/schema";
import { AuthContext, type ContextOptions, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { postMovement } from "@/modules/inventory/ledger";

/** Shared fixtures for Wave 1 integration tests (fictional seed data only). */
export type Kit = { orgId: string; nfd: SiteRef; rvs: SiteRef };

export async function loadKit(): Promise<Kit> {
  const [org] = await db.select().from(organizations);
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  return { orgId: org.id, nfd: all.find((s) => s.code === "NFD")!, rvs: all.find((s) => s.code === "RVS")! };
}

/** An AuthContext for a seeded user with a seeded role bundle (or explicit permissions). */
export async function asUser(
  kit: Kit,
  email: string,
  role: keyof typeof ROLE_BUNDLES | string[],
  siteList: SiteRef[],
  options: ContextOptions = {},
): Promise<AuthContext> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const roles = Array.isArray(role) ? role : [role];
  const perms = new Set(roles.flatMap((r) => ROLE_BUNDLES[r]?.permissions ?? []));
  return new AuthContext(u.id, kit.orgId, u.displayName, u.email, roles, perms, siteList, siteList[0].id, options);
}

export async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  if (!l) throw new Error(`no location ${code}`);
  return l;
}

export async function onHand(lotId: string, locationId: string): Promise<string> {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b ? String(Number(b.qtyBase)) : "0";
}

let lotSeq = 0;
/** Creates a fresh released material lot with stock at the given location (posted as a receipt). */
export async function makeLot(
  ctx: AuthContext,
  siteId: string,
  locationId: string,
  qty: string,
  opts: { status?: string; expiresOn?: string | null; materialCode?: string } = {},
) {
  const [m] = await db.select().from(materials).where(eq(materials.code, opts.materialCode ?? "MAT-0012"));
  lotSeq += 1;
  const [lot] = await db
    .insert(inventoryLots)
    .values({
      organizationId: ctx.organizationId,
      siteId,
      lotNumber: `T-${Date.now().toString(36)}-${lotSeq}-${uuidv7().slice(-4)}`.toUpperCase(),
      itemKind: "material",
      materialId: m.id,
      supplierName: "Laguna Oleo Supply (fictional)",
      expiresOn: opts.expiresOn === undefined ? "2030-01-31" : opts.expiresOn,
      qualityStatus: opts.status ?? "released",
      baseUom: m.baseUom,
    })
    .returning();
  await db.transaction((tx) => postMovement(tx, ctx, { movementType: "receipt", lotId: lot.id, toLocationId: locationId, qtyBase: qty, sourceDocumentType: "test_fixture" }));
  return lot;
}

export async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}

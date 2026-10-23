import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db/client";
import { inventoryBalances, locations, materials, organizations, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/** Shared helpers for the Wave 1 W1B integration tests (contexts built from real seeded users). */
export async function loadSites() {
  const [org] = await db.select().from(organizations);
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  return { orgId: org.id, nfd: all.find((s) => s.code === "NFD")! as SiteRef, rvs: all.find((s) => s.code === "RVS")! as SiteRef };
}

export async function ctxFor(orgId: string, email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`no seeded user ${email}`);
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}

export async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}

export async function mat(code: string) {
  const [m] = await db.select().from(materials).where(eq(materials.code, code));
  return m;
}

export async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b?.qtyBase ?? "0";
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

export const future = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

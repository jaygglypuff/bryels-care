import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db/client";
import { organizations, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { resetTestDatabase } from "../../support/db";

/**
 * Resets the database through the normal migrate path (which includes the W1D custom SQL
 * migration 0002_w1d_custom_sql: triggers, exclusion constraints) and loads the demo seed.
 */
export async function setupW1D() {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  const nfd = all.find((s) => s.code === "NFD")!;
  const rvs = all.find((s) => s.code === "RVS")!;
  const ctxFor = async (email: string, role: keyof typeof ROLE_BUNDLES, siteList: SiteRef[]) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return new AuthContext(u.id, org.id, u.displayName, u.email, [role], new Set(ROLE_BUNDLES[role].permissions), siteList, siteList[0].id);
  };
  return { orgId: org.id, nfd, rvs, ctxFor };
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

/** Expects a raw database error raised by a W1D trigger or constraint. */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "expected a database error").toBeTruthy();
  const msg = String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
  expect(msg).toMatch(pattern);
}

export function manilaDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

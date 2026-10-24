import "server-only";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { departments, inventoryBalances, organizations, productionLines, sites, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertUuid, diff, isReferenced, optText, reqText, uniqueConflict } from "./org-common";
import { parseInput } from "./schemas";

/**
 * Sites (US-1-20 AC2). Organization structure: every user with `masterdata.site.view` sees all
 * sites by name (pickers, transfers); `masterdata.site.admin` (restricted, organization-wide
 * system_admin) creates and edits them. The site code feeds the `{SITE}` numbering token, so it is
 * 1–6 capital letters/digits and fixed once anything references the site. Sites are deactivated,
 * never deleted, and only when no stock is held there.
 */
export const SITE_CODE_RE = /^[A-Z0-9]{1,6}$/;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const SiteInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(SITE_CODE_RE, "Site code: 1 to 6 capital letters or digits (used in document numbers), e.g. NFD."),
    name: reqText("the site name", 120),
    timezone: optText(64).refine((v) => v === null || validTimeZone(v), "Choose a valid time zone, e.g. Asia/Manila."),
    addressLine1: optText(200),
    city: optText(120),
    province: optText(120),
    country: optText(2).refine((v) => v === null || /^[A-Za-z]{2}$/.test(v), "Use the two-letter country code, e.g. PH.").transform((v) => (v ? v.toUpperCase() : null)),
  })
  .strict();
export type SiteInput = z.input<typeof SiteInput>;

const SITE_FIELDS = ["code", "name", "timezone", "addressLine1", "city", "province", "country", "isActive"] as const;

export async function listSites(ctx: AuthContext, opts: { includeInactive?: boolean } = {}) {
  ctx.require("masterdata.site.view");
  return db
    .select({
      id: sites.id,
      code: sites.code,
      name: sites.name,
      timezone: sites.timezone,
      city: sites.city,
      country: sites.country,
      isActive: sites.isActive,
      warehouses: sql<number>`(select count(*) from ${warehouses} w where w.site_id = "sites"."id" and w.is_active)::int`,
      departments: sql<number>`(select count(*) from ${departments} d where d.site_id = "sites"."id" and d.is_active)::int`,
      lines: sql<number>`(select count(*) from ${productionLines} l where l.site_id = "sites"."id" and l.status <> 'inactive')::int`,
    })
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(sites.isActive, true)))
    .orderBy(asc(sites.code));
}

export async function getSite(ctx: AuthContext, siteId: string) {
  ctx.require("masterdata.site.view");
  assertUuid(siteId, "Site");
  const [s] = await db.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.organizationId, ctx.organizationId))).limit(1);
  if (!s) throw new DomainError("not_found", "Site not found.");
  return s;
}

async function orgTimezone(ctx: AuthContext) {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  return o?.tz ?? "Asia/Manila";
}

export async function createSite(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.site.admin");
  const v = parseInput(SiteInput, raw);
  const timezone = v.timezone ?? (await orgTimezone(ctx));
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(sites)
      .values({ organizationId: ctx.organizationId, code: v.code, name: v.name, timezone, addressLine1: v.addressLine1, city: v.city, province: v.province, country: v.country ?? "PH" })
      .returning()
      .catch((e) => uniqueConflict(e, `Site code ${v.code} is already in use.`));
    await audit(tx, ctx, { action: "masterdata.site.created", entityType: "site", entityId: s.id, entityNumber: s.code, siteId: s.id, after: { ...v, timezone } });
    return s;
  });
}

/** Edits a site; writes masterdata.site.changed with before/after. The code changes only while nothing references the site. */
export async function updateSite(ctx: AuthContext, siteId: string, raw: unknown) {
  ctx.require("masterdata.site.admin");
  assertUuid(siteId, "Site");
  const v = parseInput(SiteInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Site not found.");
    if (before.isActive) ctx.requireSite(before.id);
    if (v.code !== before.code) {
      const ref = await isReferenced(tx, "sites", before.id);
      if (ref.referenced) throw new DomainError("state", `Site code ${before.code} is already used (${ref.by.slice(0, 3).join(", ")}); it can no longer change.`, { field: "code" });
    }
    const [after] = await tx
      .update(sites)
      .set({ code: v.code, name: v.name, timezone: v.timezone ?? before.timezone, addressLine1: v.addressLine1, city: v.city, province: v.province, country: v.country ?? before.country })
      .where(eq(sites.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Site code ${v.code} is already in use.`));
    const d = diff(before, after, SITE_FIELDS);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.site.changed", entityType: "site", entityId: after.id, entityNumber: after.code, siteId: after.id, before: d.before, after: d.after });
    return after;
  });
}

/**
 * Deactivates or reactivates a site (never deleted). A site holding stock, or the last active site,
 * cannot be deactivated. Writes masterdata.site.changed (is_active before/after) and
 * masterdata.site.deactivated / .reactivated with the reason.
 */
export async function setSiteActive(ctx: AuthContext, input: { siteId: string; active: boolean; reason: string }) {
  ctx.require("masterdata.site.admin");
  assertUuid(input.siteId, "Site");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new DomainError("validation", "Give the reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(sites).where(and(eq(sites.id, input.siteId), eq(sites.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Site not found.");
    if (before.isActive === input.active) return before;
    if (!input.active) {
      ctx.requireSite(before.id);
      const [stock] = await tx.select({ id: inventoryBalances.id }).from(inventoryBalances).where(and(eq(inventoryBalances.siteId, before.id), gt(inventoryBalances.qtyBase, "0"))).limit(1);
      if (stock) throw new DomainError("state", `${before.code} still holds stock. Move or adjust it out before deactivating the site.`);
      const [other] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.isActive, true), ne(sites.id, before.id))).limit(1);
      if (!other) throw new DomainError("state", "This is the last active site; it cannot be deactivated.");
    }
    const [after] = await tx.update(sites).set({ isActive: input.active }).where(eq(sites.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.site.changed", entityType: "site", entityId: after.id, entityNumber: after.code, siteId: after.id, reason, before: { isActive: before.isActive }, after: { isActive: after.isActive } });
    await audit(tx, ctx, { action: input.active ? "masterdata.site.reactivated" : "masterdata.site.deactivated", entityType: "site", entityId: after.id, entityNumber: after.code, siteId: after.id, reason });
    return after;
  });
}

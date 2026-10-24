import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { SPECIAL_LOCATION_ROLES, inventoryBalances, locations, sites, warehouseSpecialLocations, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertUuid, diff, isReferenced, reqText, scanCode, uniqueConflict } from "./org-common";
import { parseInput } from "./schemas";

/**
 * Warehouses per site and their special locations (US-1-20 AC1). After a warehouse is created
 * the admin designates one location per special role (receiving, staging, quarantine, hold,
 * rejected, recall); `missingSpecialLocations` lists what is still missing. Put-away and
 * dispositions can ask `specialLocationFor(warehouseId, role)`.
 */
export const WAREHOUSE_KINDS = ["raw_materials", "packaging", "finished_goods", "general"] as const;
export const WAREHOUSE_KIND_LABELS: Record<(typeof WAREHOUSE_KINDS)[number], string> = {
  raw_materials: "Raw materials",
  packaging: "Packaging",
  finished_goods: "Finished goods",
  general: "General",
};
export type SpecialRole = (typeof SPECIAL_LOCATION_ROLES)[number];
export const SPECIAL_ROLE_LABELS: Record<SpecialRole, string> = {
  receiving: "Receiving",
  staging: "Staging",
  quarantine: "Quarantine",
  hold: "QA hold",
  rejected: "Rejected",
  recall: "Recall",
};
/** Location kind a special role requires (the location class drives put-away and move rules). */
export const SPECIAL_ROLE_KIND: Record<SpecialRole, string> = {
  receiving: "receiving",
  staging: "staging",
  quarantine: "quarantine",
  hold: "hold",
  rejected: "rejected",
  recall: "recall",
};

const WarehouseInput = z
  .object({
    siteId: z.string().uuid("Choose a site."),
    code: scanCode("Warehouse code", "WH2"),
    name: reqText("the warehouse name", 120),
    warehouseKind: z.enum(WAREHOUSE_KINDS, { message: "Choose the warehouse kind." }),
  })
  .strict();

export async function listWarehouses(ctx: AuthContext, opts: { siteId?: string; includeInactive?: boolean } = {}) {
  ctx.require("masterdata.warehouse.view");
  const siteIds = opts.siteId && ctx.allowedSiteIds.includes(opts.siteId) ? [opts.siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return [];
  const rows = await db
    .select({
      id: warehouses.id,
      siteId: warehouses.siteId,
      siteCode: sites.code,
      code: warehouses.code,
      name: warehouses.name,
      warehouseKind: warehouses.warehouseKind,
      isActive: warehouses.isActive,
      locations: sql<number>`(select count(*) from ${locations} l where l.warehouse_id = "warehouses"."id" and l.is_active)::int`,
      designated: sql<string[]>`coalesce((select array_agg(s.role) from ${warehouseSpecialLocations} s where s.warehouse_id = "warehouses"."id"), '{}')`,
    })
    .from(warehouses)
    .innerJoin(sites, eq(sites.id, warehouses.siteId))
    .where(and(eq(sites.organizationId, ctx.organizationId), inArray(warehouses.siteId, siteIds), opts.includeInactive ? undefined : eq(warehouses.isActive, true)))
    .orderBy(asc(sites.code), asc(warehouses.code));
  return rows.map((r) => ({ ...r, missing: SPECIAL_LOCATION_ROLES.filter((role) => !r.designated.includes(role)) }));
}

async function loadWarehouse(q: DbOrTx, ctx: AuthContext, warehouseId: string, lock = false) {
  assertUuid(warehouseId, "Warehouse");
  const base = q
    .select({ w: warehouses, organizationId: sites.organizationId, siteCode: sites.code })
    .from(warehouses)
    .innerJoin(sites, eq(sites.id, warehouses.siteId))
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  const [row] = lock ? await base.for("update", { of: warehouses }) : await base;
  if (!row || row.organizationId !== ctx.organizationId) throw new DomainError("not_found", "Warehouse not found.");
  ctx.requireSite(row.w.siteId);
  return { ...row.w, siteCode: row.siteCode };
}

export async function getWarehouse(ctx: AuthContext, warehouseId: string) {
  ctx.require("masterdata.warehouse.view");
  const w = await loadWarehouse(db, ctx, warehouseId);
  const designations = await db
    .select({ role: warehouseSpecialLocations.role, locationId: locations.id, locationCode: locations.code, locationName: locations.name, designatedAt: warehouseSpecialLocations.designatedAt })
    .from(warehouseSpecialLocations)
    .innerJoin(locations, eq(locations.id, warehouseSpecialLocations.locationId))
    .where(eq(warehouseSpecialLocations.warehouseId, w.id));
  const locs = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind, status: locations.status })
    .from(locations)
    .where(eq(locations.warehouseId, w.id))
    .orderBy(asc(locations.code));
  return { ...w, designations, locations: locs, missing: SPECIAL_LOCATION_ROLES.filter((r) => !designations.some((d) => d.role === r)) };
}

/** Roles still without a designated location in the warehouse (US-1-20 AC1 validation list). */
export async function missingSpecialLocations(q: DbOrTx, warehouseId: string): Promise<SpecialRole[]> {
  const rows = await q.select({ role: warehouseSpecialLocations.role }).from(warehouseSpecialLocations).where(eq(warehouseSpecialLocations.warehouseId, warehouseId));
  return SPECIAL_LOCATION_ROLES.filter((r) => !rows.some((x) => x.role === r));
}

/** The designated location for a role, or null (for put-away defaults and dispositions). */
export async function specialLocationFor(q: DbOrTx, warehouseId: string, role: SpecialRole): Promise<string | null> {
  const [r] = await q
    .select({ locationId: warehouseSpecialLocations.locationId })
    .from(warehouseSpecialLocations)
    .where(and(eq(warehouseSpecialLocations.warehouseId, warehouseId), eq(warehouseSpecialLocations.role, role)))
    .limit(1);
  return r?.locationId ?? null;
}

export async function createWarehouse(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.warehouse.admin");
  const v = parseInput(WarehouseInput, raw);
  ctx.requireSite(v.siteId);
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(warehouses)
      .values({ siteId: v.siteId, code: v.code, name: v.name, warehouseKind: v.warehouseKind })
      .returning()
      .catch((e) => uniqueConflict(e, `Warehouse code ${v.code} already exists at this site.`));
    await audit(tx, ctx, { action: "masterdata.warehouse.created", entityType: "warehouse", entityId: w.id, entityNumber: w.code, siteId: w.siteId, after: v });
    return { ...w, missing: [...SPECIAL_LOCATION_ROLES] as SpecialRole[] };
  });
}

export async function updateWarehouse(ctx: AuthContext, warehouseId: string, raw: unknown) {
  ctx.require("masterdata.warehouse.admin");
  const v = parseInput(WarehouseInput.omit({ siteId: true }), raw);
  return db.transaction(async (tx) => {
    const before = await loadWarehouse(tx, ctx, warehouseId, true);
    if (v.code !== before.code && (await isReferenced(tx, "warehouses", before.id)).referenced) {
      throw new DomainError("state", `Warehouse code ${before.code} is in use; it can no longer change.`, { field: "code" });
    }
    const [after] = await tx
      .update(warehouses)
      .set({ code: v.code, name: v.name, warehouseKind: v.warehouseKind })
      .where(eq(warehouses.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Warehouse code ${v.code} already exists at this site.`));
    const d = diff(before, after, ["code", "name", "warehouseKind"]);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.warehouse.updated", entityType: "warehouse", entityId: after.id, entityNumber: after.code, siteId: after.siteId, before: d.before, after: d.after });
    return after;
  });
}

/** Deactivates (never deletes) a warehouse once its locations are inactive; reactivation is allowed. */
export async function setWarehouseActive(ctx: AuthContext, input: { warehouseId: string; active: boolean; reason: string }) {
  ctx.require("masterdata.warehouse.admin");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new DomainError("validation", "Give the reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const before = await loadWarehouse(tx, ctx, input.warehouseId, true);
    if (before.isActive === input.active) return before;
    if (!input.active) {
      const [active] = await tx.select({ code: locations.code }).from(locations).where(and(eq(locations.warehouseId, before.id), eq(locations.isActive, true))).limit(1);
      if (active) throw new DomainError("state", `Location ${active.code} in this warehouse is still active. Deactivate its locations first.`);
    }
    const [after] = await tx.update(warehouses).set({ isActive: input.active }).where(eq(warehouses.id, before.id)).returning();
    await audit(tx, ctx, { action: input.active ? "masterdata.warehouse.reactivated" : "masterdata.warehouse.deactivated", entityType: "warehouse", entityId: after.id, entityNumber: after.code, siteId: after.siteId, reason, before: { isActive: before.isActive }, after: { isActive: after.isActive } });
    return after;
  });
}

const DesignateInput = z.object({ warehouseId: z.string().uuid(), role: z.enum(SPECIAL_LOCATION_ROLES, { message: "Choose a special role." }), locationId: z.string().uuid("Choose a location.") }).strict();

/**
 * Designates the location that plays a special role in a warehouse (US-1-20 AC1). The location
 * must be active, belong to the warehouse and be of the matching class. Writes
 * masterdata.location.special_designated with the previous and new location.
 */
export async function designateSpecialLocation(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.location.admin");
  const v = parseInput(DesignateInput, raw);
  return db.transaction(async (tx) => {
    const w = await loadWarehouse(tx, ctx, v.warehouseId, true);
    const [loc] = await tx.select().from(locations).where(eq(locations.id, v.locationId)).limit(1);
    if (!loc || loc.warehouseId !== w.id) throw new DomainError("validation", "Choose a location of this warehouse.", { field: "locationId" });
    if (loc.status !== "active") throw new DomainError("state", `Location ${loc.code} is ${loc.status}; choose an active location.`, { field: "locationId" });
    const kind = SPECIAL_ROLE_KIND[v.role];
    if (loc.kind !== kind) throw new DomainError("validation", `The ${SPECIAL_ROLE_LABELS[v.role].toLowerCase()} location must be a ${kind} location; ${loc.code} is ${loc.kind}.`, { field: "locationId" });
    const [prev] = await tx.select().from(warehouseSpecialLocations).where(and(eq(warehouseSpecialLocations.warehouseId, w.id), eq(warehouseSpecialLocations.role, v.role))).limit(1);
    if (prev?.locationId === loc.id) return { designated: v.role, locationId: loc.id, missing: await missingSpecialLocations(tx, w.id) };
    if (prev) await tx.update(warehouseSpecialLocations).set({ locationId: loc.id, designatedBy: ctx.userId, designatedAt: new Date() }).where(eq(warehouseSpecialLocations.id, prev.id));
    else await tx.insert(warehouseSpecialLocations).values({ organizationId: ctx.organizationId, siteId: w.siteId, warehouseId: w.id, role: v.role, locationId: loc.id, designatedBy: ctx.userId });
    let prevCode: string | null = null;
    if (prev) [{ code: prevCode }] = await tx.select({ code: locations.code }).from(locations).where(eq(locations.id, prev.locationId));
    await audit(tx, ctx, {
      action: "masterdata.location.special_designated",
      entityType: "location",
      entityId: loc.id,
      entityNumber: loc.code,
      siteId: w.siteId,
      before: prev ? { role: v.role, locationId: prev.locationId, locationCode: prevCode } : null,
      after: { role: v.role, warehouseId: w.id, warehouseCode: w.code, locationId: loc.id, locationCode: loc.code },
    });
    return { designated: v.role, locationId: loc.id, missing: await missingSpecialLocations(tx, w.id) };
  });
}

/** Non-zero stock held in any of these locations (deactivation checks). */
export async function locationsHoldStock(q: DbOrTx, locationIds: string[]): Promise<boolean> {
  if (!locationIds.length) return false;
  const [r] = await q
    .select({ id: inventoryBalances.id })
    .from(inventoryBalances)
    .where(and(inArray(inventoryBalances.locationId, locationIds), sql`${inventoryBalances.qtyBase} <> 0`))
    .limit(1);
  return !!r;
}

import "server-only";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { inventoryBalances, locations, sites, warehouseSpecialLocations, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { assertTransition, assertUuid, bool, diff, isReferenced, optUuid, optionalCode, reqText, scanCode } from "./org-common";
import { assignMasterCode } from "@/lib/numbering";
import { parseInput } from "./schemas";
import { locationsHoldStock } from "./warehouses";
import { runInTx, type InTx } from "@/lib/tx";
import { LOCATION_SECTIONS, sectionSql } from "./location-sections";

/**
 * Locations (US-1-20). The location class (`kind`) drives put-away and move rules elsewhere
 * (receiving accepts receiving/quarantine/hold/storage per lot status; production operators move to
 * and from production; reservations pick from storage). `status`: active | blocked (no movements in
 * or out; enforced by `assertLocationsOpen` in the ledger) | inactive (deactivated, never deleted).
 * Codes are organization-unique for new and renamed locations (scan payload BC:LOC:<code>).
 */
export const LOCATION_KINDS = ["receiving", "staging", "storage", "quarantine", "hold", "rejected", "recall", "production", "shipping"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  receiving: "Receiving",
  staging: "Staging",
  storage: "Storage (zone, rack or bin)",
  quarantine: "Quarantine",
  hold: "QA hold",
  rejected: "Rejected",
  recall: "Recall",
  production: "Production",
  shipping: "Shipping / dispatch",
};
export const LOCATION_STATUSES = ["active", "blocked", "inactive"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];
export const LOCATION_TRANSITIONS: Record<LocationStatus, readonly LocationStatus[]> = {
  active: ["blocked", "inactive"],
  blocked: ["active", "inactive"],
  inactive: ["active"],
};

const LocationInput = z
  .object({
    warehouseId: z.string().uuid("Choose a warehouse."),
    code: scanCode("Location code", "A-03"),
    name: reqText("the location name", 120),
    kind: z.enum(LOCATION_KINDS, { message: "Choose the location class." }),
    parentLocationId: optUuid,
    isPickable: bool(true),
    /** S6 (ADR-077): warehouse section; "" = derived from the class and warehouse kind; omitted = unchanged on edit. */
    section: z
      .union([z.enum(LOCATION_SECTIONS, { message: "Choose a section." }), z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .strict();
/** Create: the code may be left blank; the next LOC-nnnn is assigned (ADR-075). */
const CreateLocationInput = LocationInput.extend({ code: optionalCode(scanCode("Location code", "A-03")) }).strict();

export type LocationFilter = { siteId?: string; warehouseId?: string; kind?: string; q?: string; includeInactive?: boolean };

/**
 * Locations in the caller's sites (US-1-20 AC3): a siteId outside the caller's scope is ignored,
 * so a site manager at Site A asking for Site B still sees only Site A rows.
 */
export async function listLocations(ctx: AuthContext, f: LocationFilter = {}) {
  ctx.require("masterdata.location.view");
  const siteIds = f.siteId && ctx.allowedSiteIds.includes(f.siteId) ? [f.siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return [];
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  return db
    .select({
      id: locations.id,
      siteId: locations.siteId,
      siteCode: sites.code,
      warehouseId: locations.warehouseId,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      code: locations.code,
      name: locations.name,
      kind: locations.kind,
      status: locations.status,
      isActive: locations.isActive,
      isPickable: locations.isPickable,
      section: locations.section,
      effectiveSection: sql<string>`${sectionSql("locations", "warehouses")}`,
      parentLocationId: locations.parentLocationId,
      parentCode: sql<string | null>`(select p.code from ${locations} p where p.id = "locations"."parent_location_id")`,
      lotCount: sql<number>`(select count(distinct b.lot_id) from ${inventoryBalances} b where b.location_id = "locations"."id" and b.qty_base > 0)::int`,
      specialRoles: sql<string[]>`coalesce((select array_agg(s.role) from ${warehouseSpecialLocations} s where s.location_id = "locations"."id"), '{}')`,
    })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(
      and(
        eq(sites.organizationId, ctx.organizationId),
        inArray(locations.siteId, siteIds),
        f.warehouseId ? eq(locations.warehouseId, f.warehouseId) : undefined,
        f.kind && (LOCATION_KINDS as readonly string[]).includes(f.kind) ? eq(locations.kind, f.kind) : undefined,
        f.includeInactive ? undefined : ne(locations.status, "inactive"),
        like ? or(ilike(locations.code, like), ilike(locations.name, like)) : undefined,
      ),
    )
    .orderBy(asc(sites.code), asc(warehouses.code), asc(locations.code));
}

async function loadLocation(q: DbOrTx, ctx: AuthContext, locationId: string, lock = false) {
  assertUuid(locationId, "Location");
  const base = q
    .select({ l: locations, organizationId: sites.organizationId })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(eq(locations.id, locationId))
    .limit(1);
  const [row] = lock ? await base.for("update", { of: locations }) : await base;
  if (!row || row.organizationId !== ctx.organizationId) throw new DomainError("not_found", "Location not found.");
  ctx.requireSite(row.l.siteId);
  return row.l;
}

export async function getLocation(ctx: AuthContext, locationId: string) {
  ctx.require("masterdata.location.view");
  const l = await loadLocation(db, ctx, locationId);
  const [w] = await db.select().from(warehouses).where(eq(warehouses.id, l.warehouseId));
  const children = await db.select({ id: locations.id, code: locations.code, name: locations.name, status: locations.status }).from(locations).where(eq(locations.parentLocationId, l.id)).orderBy(asc(locations.code));
  const roles = await db.select({ role: warehouseSpecialLocations.role }).from(warehouseSpecialLocations).where(eq(warehouseSpecialLocations.locationId, l.id));
  const [stock] = await db.select({ lots: sql<number>`count(distinct ${inventoryBalances.lotId})::int` }).from(inventoryBalances).where(and(eq(inventoryBalances.locationId, l.id), sql`${inventoryBalances.qtyBase} > 0`));
  const parentRow = l.parentLocationId ? (await db.select({ id: locations.id, code: locations.code, name: locations.name }).from(locations).where(eq(locations.id, l.parentLocationId)))[0] : null;
  return { ...l, warehouse: w, parent: parentRow ?? null, children, specialRoles: roles.map((r) => r.role), lotsInStock: stock?.lots ?? 0 };
}

async function assertOrgUniqueCode(q: DbOrTx, ctx: AuthContext, code: string, exceptId?: string) {
  // Serializes concurrent creates/renames of the same code across sites (the DB index is per site, A-W2G-01).
  await q.execute(sql`select pg_advisory_xact_lock(hashtext(${`location_code:${ctx.organizationId}:${code}`}))`);
  const [clash] = await q
    .select({ id: locations.id, siteCode: sites.code })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(locations.code, code), exceptId ? ne(locations.id, exceptId) : undefined))
    .limit(1);
  if (clash) throw new DomainError("conflict", `Location code ${code} is already used (site ${clash.siteCode}). Location codes are unique across the organization so a scanned label finds one place.`, { field: "code" });
}

async function assertParent(q: DbOrTx, warehouseId: string, parentId: string | null, selfId?: string) {
  if (!parentId) return;
  const seen = new Set<string>(selfId ? [selfId] : []);
  let cur: string | null = parentId;
  let first = true;
  while (cur) {
    if (seen.has(cur)) throw new DomainError("validation", "A location cannot be inside itself.", { field: "parentLocationId" });
    seen.add(cur);
    const [p]: { id: string; warehouseId: string; parentLocationId: string | null; status: string }[] = await q
      .select({ id: locations.id, warehouseId: locations.warehouseId, parentLocationId: locations.parentLocationId, status: locations.status })
      .from(locations)
      .where(eq(locations.id, cur))
      .limit(1);
    if (!p) throw new DomainError("validation", "Parent location not found.", { field: "parentLocationId" });
    if (first) {
      if (p.warehouseId !== warehouseId) throw new DomainError("validation", "The parent must be in the same warehouse.", { field: "parentLocationId" });
      if (p.status === "inactive") throw new DomainError("validation", "The parent location is inactive.", { field: "parentLocationId" });
      first = false;
    }
    cur = p.parentLocationId;
  }
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createLocation(ctx: AuthContext, raw: unknown, opts?: InTx) {
  ctx.require("masterdata.location.create");
  const parsed = parseInput(CreateLocationInput, raw);
  return runInTx(opts, async (tx) => {
    const [w] = await tx
      .select({ id: warehouses.id, siteId: warehouses.siteId, isActive: warehouses.isActive, organizationId: sites.organizationId })
      .from(warehouses)
      .innerJoin(sites, eq(sites.id, warehouses.siteId))
      .where(eq(warehouses.id, parsed.warehouseId))
      .limit(1);
    if (!w || w.organizationId !== ctx.organizationId) throw new DomainError("not_found", "Warehouse not found.", { field: "warehouseId" });
    ctx.requireSite(w.siteId);
    if (!w.isActive) throw new DomainError("state", "This warehouse is inactive.", { field: "warehouseId" });
    const code =
      parsed.code ??
      (await assignMasterCode(tx, ctx.organizationId, "LOC", async (c) => {
        const r = await tx.select({ id: locations.id }).from(locations).innerJoin(sites, eq(sites.id, locations.siteId)).where(and(eq(sites.organizationId, ctx.organizationId), eq(locations.code, c))).limit(1);
        return r.length > 0;
      }));
    const v = { ...parsed, code };
    await assertOrgUniqueCode(tx, ctx, v.code);
    await assertParent(tx, w.id, v.parentLocationId);
    const [l] = await tx
      .insert(locations)
      .values({ siteId: w.siteId, warehouseId: w.id, code: v.code, name: v.name, kind: v.kind, parentLocationId: v.parentLocationId, isPickable: v.isPickable, section: v.section ?? null })
      .returning();
    await audit(tx, ctx, { action: "masterdata.location.created", entityType: "location", entityId: l.id, entityNumber: l.code, siteId: l.siteId, after: { ...v } });
    return l;
  });
}

/**
 * Edits a location. The code changes only while no stock record references it; the class changes
 * only while the location is empty and not designated for a special role.
 */
export async function updateLocation(ctx: AuthContext, locationId: string, raw: unknown) {
  ctx.require("masterdata.location.edit");
  // ADR-088: the code may be left blank on edit (kept as is).
  const p = parseInput(LocationInput.omit({ warehouseId: true }).extend({ code: optionalCode(scanCode("Location code", "A-03")) }), raw);
  return db.transaction(async (tx) => {
    const before = await loadLocation(tx, ctx, locationId, true);
    const v = { ...p, code: p.code ?? before.code };
    if (v.code !== before.code) {
      if ((await isReferenced(tx, "locations", before.id, ["locations"])).referenced) throw new DomainError("state", `Location ${before.code} has been used; its code can no longer change.`, { field: "code" });
      await assertOrgUniqueCode(tx, ctx, v.code, before.id);
    }
    if (v.kind !== before.kind) {
      if (await locationsHoldStock(tx, [before.id])) throw new DomainError("state", `Location ${before.code} holds stock; empty it before changing its class.`, { field: "kind" });
      const [role] = await tx.select({ role: warehouseSpecialLocations.role }).from(warehouseSpecialLocations).where(eq(warehouseSpecialLocations.locationId, before.id)).limit(1);
      if (role) throw new DomainError("state", `Location ${before.code} is the warehouse's ${role.role} location; designate another location first.`, { field: "kind" });
    }
    await assertParent(tx, before.warehouseId, v.parentLocationId, before.id);
    const [after] = await tx.update(locations).set({ code: v.code, name: v.name, kind: v.kind, parentLocationId: v.parentLocationId, isPickable: v.isPickable, section: v.section === undefined ? before.section : v.section }).where(eq(locations.id, before.id)).returning();
    const d = diff(before, after, ["code", "name", "kind", "parentLocationId", "isPickable", "section"]);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.location.updated", entityType: "location", entityId: after.id, entityNumber: after.code, siteId: after.siteId, before: d.before, after: d.after });
    return after;
  });
}

const StatusInput = z.object({ locationId: z.string().uuid(), status: z.enum(LOCATION_STATUSES), reason: reqText("the reason", 500) }).strict();

/**
 * Blocks, unblocks, deactivates or reactivates a location (state machine LOCATION_TRANSITIONS).
 * Deactivating needs `masterdata.location.admin` and is refused while the location holds stock
 * (US-1-20 AC2), is a designated special location or has active child locations.
 */
export async function changeLocationStatus(ctx: AuthContext, raw: unknown) {
  const v = parseInput(StatusInput, raw);
  ctx.require(v.status === "inactive" ? "masterdata.location.admin" : "masterdata.location.edit");
  return db.transaction(async (tx) => {
    const before = await loadLocation(tx, ctx, v.locationId, true);
    if (before.status === v.status) return before;
    assertTransition(LOCATION_TRANSITIONS, before.status as LocationStatus, v.status, `Location ${before.code}`);
    if (before.status === "inactive") ctx.require("masterdata.location.admin");
    if (v.status === "inactive") {
      if (await locationsHoldStock(tx, [before.id])) throw new DomainError("state", `Location ${before.code} still holds stock. Move it out before deactivating.`);
      const [role] = await tx.select({ role: warehouseSpecialLocations.role }).from(warehouseSpecialLocations).where(eq(warehouseSpecialLocations.locationId, before.id)).limit(1);
      if (role) throw new DomainError("state", `Location ${before.code} is the warehouse's ${role.role} location; designate another location first.`);
      const [child] = await tx.select({ code: locations.code }).from(locations).where(and(eq(locations.parentLocationId, before.id), ne(locations.status, "inactive"))).limit(1);
      if (child) throw new DomainError("state", `Location ${child.code} inside ${before.code} is still active; deactivate it first.`);
    }
    if (v.status !== "inactive" && before.status === "inactive") {
      const [w] = await tx.select({ isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, before.warehouseId));
      if (!w?.isActive) throw new DomainError("state", "Reactivate the warehouse first.");
    }
    const [after] = await tx.update(locations).set({ status: v.status, isActive: v.status !== "inactive" }).where(eq(locations.id, before.id)).returning();
    const action = v.status === "inactive" ? "masterdata.location.deactivated" : before.status === "inactive" ? "masterdata.location.reactivated" : v.status === "blocked" ? "masterdata.location.blocked" : "masterdata.location.unblocked";
    await audit(tx, ctx, { action, entityType: "location", entityId: after.id, entityNumber: after.code, siteId: after.siteId, reason: v.reason, before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

/**
 * Ledger rule (called by postMovement): a blocked or inactive location takes no movement in or out.
 * Shares the location rows with status changes (FOR SHARE), so a block and a posting serialize.
 */
export async function assertLocationsOpen(q: DbOrTx, locationIds: string[]): Promise<void> {
  if (!locationIds.length) return;
  const rows = await q.select({ code: locations.code, status: locations.status }).from(locations).where(inArray(locations.id, [...new Set(locationIds)].sort())).for("share");
  const closed = rows.find((r) => r.status !== "active");
  if (closed) throw new DomainError("state", `Location ${closed.code} is ${closed.status === "blocked" ? "blocked: no stock may move in or out" : "inactive"}.`, { locationCode: closed.code, status: closed.status });
}

/** Active warehouses and locations of the caller's sites for pickers. */
export async function locationFormOptions(ctx: AuthContext, siteId?: string) {
  ctx.require("masterdata.location.view");
  const siteIds = siteId && ctx.allowedSiteIds.includes(siteId) ? [siteId] : ctx.allowedSiteIds;
  if (!siteIds.length) return { warehouses: [], locations: [] };
  const ws = await db
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, siteId: warehouses.siteId, siteCode: sites.code })
    .from(warehouses)
    .innerJoin(sites, eq(sites.id, warehouses.siteId))
    .where(and(inArray(warehouses.siteId, siteIds), eq(warehouses.isActive, true)))
    .orderBy(asc(sites.code), asc(warehouses.code));
  const ls = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, warehouseId: locations.warehouseId, kind: locations.kind })
    .from(locations)
    .where(and(inArray(locations.siteId, siteIds), ne(locations.status, "inactive")))
    .orderBy(asc(locations.code));
  return { warehouses: ws, locations: ls };
}

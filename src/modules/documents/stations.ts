import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { printStations, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { printStationInput } from "./schemas";
import { isUuid } from "./templates";

/** Print stations per site (A-RPT-09). Configured by documents.print_station.admin. */

export async function listStations(ctx: AuthContext, opts: { siteId?: string; includeInactive?: boolean } = {}) {
  if (!ctx.can("inventory.label_job.view") && !ctx.can("documents.print_station.admin")) ctx.require("inventory.label_job.view");
  const siteIds = opts.siteId ? (ctx.allowedSiteIds.includes(opts.siteId) ? [opts.siteId] : []) : ctx.allowedSiteIds;
  if (siteIds.length === 0) return [];
  const conds = [eq(printStations.organizationId, ctx.organizationId), inArray(printStations.siteId, siteIds)];
  if (!opts.includeInactive) conds.push(eq(printStations.isActive, true));
  return db
    .select({ s: printStations, siteCode: sites.code })
    .from(printStations)
    .innerJoin(sites, eq(sites.id, printStations.siteId))
    .where(and(...conds))
    .orderBy(asc(sites.code), asc(printStations.code))
    .then((rows) => rows.map((r) => ({ ...r.s, siteCode: r.siteCode })));
}

export async function activeStationsAt(tx: DbOrTx, organizationId: string, siteId: string) {
  return tx
    .select()
    .from(printStations)
    .where(and(eq(printStations.organizationId, organizationId), eq(printStations.siteId, siteId), eq(printStations.isActive, true)))
    .orderBy(asc(printStations.code));
}

export async function getStation(ctx: AuthContext, id: string) {
  if (!ctx.can("inventory.label_job.view") && !ctx.can("documents.print_station.admin")) ctx.require("inventory.label_job.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Print station not found in your sites.");
  const [s] = await db
    .select({ s: printStations, siteCode: sites.code })
    .from(printStations)
    .innerJoin(sites, eq(sites.id, printStations.siteId))
    .where(and(eq(printStations.id, id), eq(printStations.organizationId, ctx.organizationId), inArray(printStations.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!s) throw new DomainError("not_found", "Print station not found in your sites.");
  return { ...s.s, siteCode: s.siteCode };
}

/** Creates a station at the user's current site. */
export async function createStation(ctx: AuthContext, raw: unknown) {
  ctx.require("documents.print_station.admin");
  ctx.requireSite(ctx.currentSiteId);
  const input = printStationInput.parse(raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: printStations.id }).from(printStations).where(and(eq(printStations.siteId, ctx.currentSiteId), eq(printStations.code, input.code))).limit(1);
    if (dup) throw new DomainError("conflict", `Station ${input.code} already exists at ${ctx.currentSite.code}.`, { field: "code" });
    const [s] = await tx
      .insert(printStations)
      .values({ organizationId: ctx.organizationId, siteId: ctx.currentSiteId, code: input.code, name: input.name, printerName: input.printerName, notes: input.notes ?? null, isActive: input.isActive, createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "documents.print_station.created", entityType: "print_station", entityId: s.id, entityNumber: s.code, siteId: s.siteId, after: input });
    return { id: s.id };
  });
}

export async function updateStation(ctx: AuthContext, id: string, raw: unknown) {
  ctx.require("documents.print_station.admin");
  const input = printStationInput.parse(raw);
  return db.transaction(async (tx) => {
    if (!isUuid(id)) throw new DomainError("not_found", "Print station not found in your sites.");
    const [s] = await tx.select().from(printStations).where(and(eq(printStations.id, id), eq(printStations.organizationId, ctx.organizationId))).limit(1).for("update");
    if (!s) throw new DomainError("not_found", "Print station not found in your sites.");
    ctx.requireSite(s.siteId);
    if (input.code !== s.code) throw new DomainError("validation", "The station code cannot change.", { field: "code" });
    await tx.update(printStations).set({ name: input.name, printerName: input.printerName, notes: input.notes ?? null, isActive: input.isActive, updatedAt: new Date() }).where(eq(printStations.id, s.id));
    await audit(tx, ctx, {
      action: "documents.print_station.updated",
      entityType: "print_station",
      entityId: s.id,
      entityNumber: s.code,
      siteId: s.siteId,
      before: { name: s.name, printerName: s.printerName, isActive: s.isActive },
      after: { name: input.name, printerName: input.printerName, isActive: input.isActive },
    });
  });
}

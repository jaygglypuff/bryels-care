import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

export const MATERIAL_KINDS = ["raw_material", "intermediate", "packaging"] as const;
export const BASE_UOMS = ["g", "mL", "pcs"] as const;

/** Materials of the organization with total on hand at the current site. */
export async function listMaterials(ctx: AuthContext) {
  ctx.require("masterdata.material.view");
  return db
    .select({
      id: materials.id,
      code: materials.code,
      name: materials.name,
      inciName: materials.inciName,
      materialKind: materials.materialKind,
      baseUom: materials.baseUom,
      shelfLifeDays: materials.shelfLifeDays,
      storageConditions: materials.storageConditions,
      onHand: sql<string>`coalesce((
        select sum(b.qty_base) from ${inventoryBalances} b
        join ${inventoryLots} l on l.id = b.lot_id
        where l.material_id = "materials"."id" and b.site_id = ${ctx.currentSiteId}
      ), 0)::text`,
    })
    .from(materials)
    .where(eq(materials.organizationId, ctx.organizationId))
    .orderBy(asc(materials.code));
}

export type NewMaterialInput = {
  code: string;
  name: string;
  inciName?: string | null;
  materialKind: (typeof MATERIAL_KINDS)[number];
  baseUom: (typeof BASE_UOMS)[number];
  shelfLifeDays?: number | null;
  storageConditions?: string | null;
};

export async function createMaterial(ctx: AuthContext, input: NewMaterialInput) {
  ctx.require("masterdata.material.create");
  return db.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.code, input.code)))
      .limit(1);
    if (dupe) throw new DomainError("conflict", `Material code ${input.code} is already in use.`);
    const [m] = await tx
      .insert(materials)
      .values({
        organizationId: ctx.organizationId,
        code: input.code,
        name: input.name,
        inciName: input.inciName || null,
        materialKind: input.materialKind,
        baseUom: input.baseUom,
        shelfLifeDays: input.shelfLifeDays ?? null,
        storageConditions: input.storageConditions || null,
      })
      .returning();
    await audit(tx, ctx, { action: "masterdata.material.created", entityType: "material", entityId: m.id, entityNumber: m.code, after: m });
    return m;
  });
}

/** Locations of the current site with warehouse and the number of lots currently stored there. */
export async function listLocations(ctx: AuthContext) {
  ctx.require("masterdata.location.view");
  ctx.requireSite(ctx.currentSiteId);
  return db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
      kind: locations.kind,
      isActive: locations.isActive,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      lotCount: sql<number>`(select count(distinct b.lot_id) from ${inventoryBalances} b where b.location_id = "locations"."id" and b.qty_base > 0)::int`,
    })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(eq(locations.siteId, ctx.currentSiteId))
    .orderBy(asc(warehouses.code), asc(locations.code));
}

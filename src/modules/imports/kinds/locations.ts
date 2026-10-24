import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { locations, sites, warehouses } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { LOCATION_KINDS, createLocation, type LocationKind } from "@/modules/masterdata";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * `locations` (docs/data-migration-plan.md §7.8): created through the location service (US-1-20) in a
 * warehouse of the import's site. Zone, rack and bin rows are storage locations; parents must be listed
 * before their children. Duplicate codes are skipped (codes are organization-unique scan payloads).
 */
type LocationValues = { warehouseCode: string; code: string; name: string; kind: LocationKind; parentCode: string | null; isPickable: boolean };

export const locationsKind: ImportKindHandler<LocationValues> = {
  kind: "locations",
  label: "Locations",
  description: "Zones, racks, bins and special locations of the warehouses at this site.",
  creates: "location",
  entityPermissions: ["masterdata.location.create"],
  availability: { available: true },
  columns: [
    { key: "warehouse_code", label: "Warehouse code", required: true, hint: "A warehouse of the import's site.", aliases: ["warehouse"] },
    { key: "code", label: "Location code", required: true, hint: "Scan grammar, e.g. NFD-RM-A-01.", aliases: ["location_code"] },
    { key: "label", label: "Name", hint: "Blank = the code.", aliases: ["name"] },
    { key: "kind", label: "Kind", required: true, hint: `${LOCATION_KINDS.join(", ")} (zone, rack and bin are storage).` },
    { key: "parent_code", label: "Parent location", hint: "Code of the zone or rack it belongs to (listed earlier in the file)." },
    { key: "is_pickable", label: "Pickable", hint: "yes (default) or no." },
  ],
  exampleRows: [
    { warehouse_code: "RM", code: "DEMO-RM-Z1", label: "Sample zone 1 (fictional)", kind: "zone", parent_code: "", is_pickable: "yes" },
    { warehouse_code: "RM", code: "DEMO-RM-Z1-B01", label: "Sample bin 01", kind: "bin", parent_code: "DEMO-RM-Z1", is_pickable: "yes" },
  ],
  normalize(r) {
    const warehouseCode = r.code("warehouse_code", { required: true });
    const code = r.code("code", { required: true, example: "A-03" });
    const kind = r.oneOf("kind", LOCATION_KINDS, { required: true, synonyms: { zone: "storage", rack: "storage", bin: "storage", shelf: "storage", production_staging: "staging", wip: "production" } });
    const v: LocationValues = {
      warehouseCode: warehouseCode ?? "",
      code: code ?? "",
      name: r.text("label", { max: 120 }) ?? code ?? "",
      kind: kind ?? "storage",
      parentCode: r.code("parent_code"),
      isPickable: r.bool("is_pickable", true) ?? true,
    };
    if (!warehouseCode || !code || !kind) return null;
    return { values: v, tier1Key: `code:${code}`, groupKey: `wh:${warehouseCode}` };
  },
  async findExisting(tx, ctx, _job, rows) {
    const codes = [...new Set(rows.map((r) => r.values.code))];
    const found = codes.length
      ? await tx
          .select({ id: locations.id, code: locations.code })
          .from(locations)
          .innerJoin(sites, eq(sites.id, locations.siteId))
          .where(and(eq(sites.organizationId, ctx.organizationId), inArray(locations.code, codes)))
      : [];
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const l = found.find((x) => x.code === values.code);
      if (l) out.set(rowNo, { tier: 1, entityType: "location", entityId: l.id, label: l.code, message: `Location ${l.code} already exists; the row is skipped (imports are create-only).` });
    }
    return out;
  },
  async create(k, v) {
    const { tx, job } = k;
    const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.siteId, job.siteId), eq(warehouses.code, v.warehouseCode))).limit(1);
    if (!w) throw new DomainError("validation", `Warehouse ${v.warehouseCode} is not a warehouse of this site.`, { field: "warehouse_code" });
    let parentLocationId: string | null = null;
    if (v.parentCode) {
      const [p] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.siteId, job.siteId), eq(locations.code, v.parentCode))).limit(1);
      if (!p) throw new DomainError("validation", `Parent location ${v.parentCode} was not found at this site. List parents before their children.`, { field: "parent_code" });
      parentLocationId = p.id;
    }
    const l = await createLocation(k.ctx, { warehouseId: w.id, code: v.code, name: v.name, kind: v.kind, parentLocationId, isPickable: v.isPickable }, { tx });
    return { entityType: "location", entityId: l.id, label: l.code };
  },
};

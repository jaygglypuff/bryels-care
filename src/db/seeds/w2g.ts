/**
 * Wave 2 W2G demo seed: master data administration (US-1-20..US-1-24). Fictional data only.
 *
 * Installs the reference data every organization needs (units g/kg/mg/mL/L/pcs, the SI
 * conversions as approved system versions, default reason codes) and adds demo organization
 * structure: departments, production lines (the W1D equipment of "Soap line 1" is linked to
 * SOAP-1), special-location designations (NFD WH1 deliberately leaves staging and recall
 * undesignated so the "still missing" list shows), and one SKU per demo product.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { installReferenceData } from "../../modules/masterdata/org-reference";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW2G(db: Db, organizationId: string) {
  const O = organizationId;
  await installReferenceData(db, O);

  const siteRows = await db.select().from(s.sites).where(eq(s.sites.organizationId, O));
  const site = (code: string) => siteRows.find((x) => x.code === code)!;
  const nfd = site("NFD");
  const rvs = site("RVS");
  await db.update(s.sites).set({ city: "Calamba (fictional)", province: "Laguna", country: "PH" }).where(eq(s.sites.id, nfd.id));
  await db.update(s.sites).set({ city: "Sta. Rosa (fictional)", province: "Laguna", country: "PH" }).where(eq(s.sites.id, rvs.id));

  const depts = await db
    .insert(s.departments)
    .values([
      { organizationId: O, siteId: nfd.id, code: "PROD", name: "Production" },
      { organizationId: O, siteId: nfd.id, code: "WH", name: "Warehouse" },
      { organizationId: O, siteId: nfd.id, code: "QA", name: "Quality Assurance" },
      { organizationId: O, siteId: rvs.id, code: "WH", name: "Warehouse" },
    ])
    .returning();
  const prod = depts.find((d) => d.siteId === nfd.id && d.code === "PROD")!;

  const lines = await db
    .insert(s.productionLines)
    .values([
      { organizationId: O, siteId: nfd.id, code: "SOAP-1", name: "Soap line 1", departmentId: prod.id },
      { organizationId: O, siteId: nfd.id, code: "LOTION-1", name: "Lotion line", departmentId: prod.id },
      { organizationId: O, siteId: nfd.id, code: "WEIGH-1", name: "Weighing room", departmentId: prod.id },
    ])
    .returning();
  for (const l of lines) {
    await db
      .update(s.equipment)
      .set({ productionLineId: l.id })
      .where(and(eq(s.equipment.siteId, nfd.id), eq(s.equipment.lineLabel, l.name)));
  }

  await db.update(s.warehouses).set({ warehouseKind: "general" }).where(inArray(s.warehouses.siteId, [nfd.id, rvs.id]));
  const whs = await db.select().from(s.warehouses).where(inArray(s.warehouses.siteId, [nfd.id, rvs.id]));
  const locs = await db.select().from(s.locations).where(inArray(s.locations.siteId, [nfd.id, rvs.id]));
  const designations: [string, string, string][] = [
    ["NFD", "receiving", "RCV"],
    ["NFD", "quarantine", "QUA-01"],
    ["NFD", "hold", "HLD-01"],
    ["NFD", "rejected", "REJ"],
    ["RVS", "receiving", "RCV"],
    ["RVS", "quarantine", "QUA-01"],
    ["RVS", "rejected", "REJ"],
  ];
  for (const [siteCode, role, locCode] of designations) {
    const st = site(siteCode);
    const w = whs.find((x) => x.siteId === st.id)!;
    const l = locs.find((x) => x.siteId === st.id && x.code === locCode);
    if (!l) continue;
    await db.insert(s.warehouseSpecialLocations).values({ organizationId: O, siteId: st.id, warehouseId: w.id, role, locationId: l.id });
  }

  // One SKU per demo product (same code, so BC:SKU scans keep resolving to the product).
  const [pcs] = await db.select().from(s.uoms).where(and(eq(s.uoms.organizationId, O), eq(s.uoms.code, "pcs")));
  const [g] = await db.select().from(s.uoms).where(and(eq(s.uoms.organizationId, O), eq(s.uoms.code, "g")));
  const [mL] = await db.select().from(s.uoms).where(and(eq(s.uoms.organizationId, O), eq(s.uoms.code, "mL")));
  const prods = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const variant: Record<string, { label: string; pack: string; qty: string; uom: string; pallet: number }> = {
    "ACS-135": { label: "135 g bar", pack: "Wrapped bar", qty: "135", uom: g.id, pallet: 40 },
    "GBS-135": { label: "135 g bar", pack: "Wrapped bar", qty: "135", uom: g.id, pallet: 40 },
    "AHL-250": { label: "250 mL bottle", pack: "Pump bottle", qty: "250", uom: mL.id, pallet: 30 },
  };
  for (const p of prods) {
    const v = variant[p.skuCode];
    if (!v) continue;
    await db.insert(s.skus).values({
      organizationId: O,
      productId: p.id,
      code: p.skuCode,
      name: p.name,
      variantLabel: v.label,
      packFormat: v.pack,
      netContentQty: v.qty,
      netContentUomId: v.uom,
      uomBaseId: pcs.id,
      unitsPerBox: p.unitsPerBox,
      boxesPerPallet: v.pallet,
      shelfLifeDays: p.shelfLifeDays,
      allocationRule: "fefo",
      status: "active",
    });
  }
  await db.update(s.materials).set({ commonName: "Lye solution" }).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, "MAT-0021")));
}

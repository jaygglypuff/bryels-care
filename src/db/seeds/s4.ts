/**
 * S4 / ADR-076 fictional demo data (runs inside the ALLOW_DEMO_SEED-guarded seed, after W4A):
 * - material categories, usual brands and standard pack sizes for the oils and a few other materials
 *   (brand names are invented for the demo);
 * - supplier × material brand and pack for the two oil suppliers (Laguna Oleo Supply: coconut oil,
 *   Mindanao Palm Co.: palm oil);
 * - the brand on the already received oil lots and their receipt lines, so the lot and receipt screens and
 *   the material label show it;
 * - supplier categories for the demo suppliers.
 * The editable lists themselves keep their shipped defaults (no lookup_values rows), so the Lists screen
 * shows the "write on first change" behaviour.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

const MATERIALS: Record<string, { category: string; brand?: string; pack?: [string, string] }> = {
  "MAT-0012": { category: "oils_fats", brand: "Isla Gold (fictional)", pack: ["18", "kg"] },
  "MAT-0013": { category: "oils_fats", brand: "Golden Frond (fictional)", pack: ["25", "kg"] },
  "MAT-0021": { category: "lye_chemicals" },
  "MAT-0043": { category: "colour_additives" },
  "MAT-0044": { category: "colour_additives" },
  "MAT-0051": { category: "colour_additives" },
  "MAT-0060": { category: "other", pack: ["20", "kg"] },
  "MAT-0061": { category: "lye_chemicals", brand: "ClearGly (fictional)", pack: ["25", "kg"] },
  "MAT-0062": { category: "butters_waxes", brand: "Visayan Waxworks (fictional)", pack: ["25", "kg"] },
  "PKG-0101": { category: "labels_boxes", pack: ["1000", "pcs"] },
  "PKG-0102": { category: "labels_boxes", pack: ["50", "pcs"] },
};

const PAIRS: [supplier: string, material: string, brand: string, packQty: string, packUom: string][] = [
  ["Laguna Oleo Supply", "MAT-0012", "Isla Gold (fictional)", "18", "kg"],
  ["Mindanao Palm Co.", "MAT-0013", "Golden Frond (fictional)", "25", "kg"],
  // Same material, another supplier and brand: the receipt records which one arrived.
  ["Laguna Oleo Supply", "MAT-0013", "Laguna Red Palm (fictional)", "18", "kg"],
];

const SUPPLIER_CATEGORIES: Record<string, string> = {
  "Laguna Oleo Supply": "oils_chemicals",
  "Mindanao Palm Co.": "oils_chemicals",
  "Cebu Chemicals": "oils_chemicals",
  "Laguna Botanicals": "other",
  "Manila Print & Pack": "packaging",
  "Bukidnon Aloe Farms": "other",
  "Visayas Essence Trading": "fragrance",
};

export async function seedS4(db: Db, O: string) {
  const mats = await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), inArray(s.materials.code, Object.keys(MATERIALS))));
  for (const m of mats) {
    const d = MATERIALS[m.code];
    await db
      .update(s.materials)
      .set({ category: d.category, brand: d.brand ?? null, standardPackQty: d.pack?.[0] ?? null, standardPackUom: d.pack?.[1] ?? null })
      .where(eq(s.materials.id, m.id));
  }
  const sups = await db.select().from(s.suppliers).where(eq(s.suppliers.organizationId, O));
  for (const sp of sups) {
    const c = SUPPLIER_CATEGORIES[sp.name];
    if (c) await db.update(s.suppliers).set({ category: c }).where(eq(s.suppliers.id, sp.id));
  }
  const matId = (code: string) => mats.find((m) => m.code === code)?.id;
  const supId = (name: string) => sups.find((x) => x.name === name)?.id;
  for (const [supplier, material, brand, packQty, packUom] of PAIRS) {
    const sid = supId(supplier);
    const mid = matId(material);
    if (!sid || !mid) continue;
    await db.update(s.supplierMaterials).set({ brand, packQty, packUom }).where(and(eq(s.supplierMaterials.supplierId, sid), eq(s.supplierMaterials.materialId, mid)));
  }
  // Brand on the received oil lots (as if recorded at receipt): by the supplier named on the lot.
  for (const [supplier, material, brand] of PAIRS) {
    const mid = matId(material);
    if (!mid) continue;
    const lots = await db
      .update(s.inventoryLots)
      .set({ brand })
      .where(and(eq(s.inventoryLots.organizationId, O), eq(s.inventoryLots.materialId, mid), eq(s.inventoryLots.supplierName, supplier)))
      .returning({ id: s.inventoryLots.id });
    if (lots.length) await db.update(s.goodsReceiptLines).set({ brand }).where(inArray(s.goodsReceiptLines.lotId, lots.map((l) => l.id)));
  }
}

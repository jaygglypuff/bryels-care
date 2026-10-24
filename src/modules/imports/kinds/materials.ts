import "server-only";
import { eq } from "drizzle-orm";
import { materialAliases, materials } from "@/db/schema";
import { MATERIAL_CLASSES, createMaterialMaster, materialWarnings, type MaterialClass } from "@/modules/masterdata";
import { nameMatches, nextLoaderCode } from "./common";
import type { ExistingMatch, ImportKindHandler } from "./types";
import { normalisedName } from "./values";

/**
 * `materials` (docs/data-migration-plan.md §7.1, §8): created through the material master service
 * (US-1-23), so codes, classes, base units and limits follow the Materials screen. Shelf life and retest
 * are loaded only when QA supplied them (P6); a missing INCI on an ingredient is a warning.
 */
type MaterialValues = {
  code: string | null;
  name: string;
  inciName: string | null;
  commonName: string | null;
  materialKind: MaterialClass;
  baseUom: string;
  shelfLifeDays: number | null;
  retestDays: number | null;
  storageConditions: string | null;
  allergenNotes: string | null;
  hazardNotes: string | null;
  requiresCoa: boolean;
  legacyNumber: string | null;
};

export const materialsKind: ImportKindHandler<MaterialValues> = {
  kind: "materials",
  label: "Materials",
  description: "Raw materials, intermediates, packaging and consumables (material master).",
  creates: "material",
  entityPermissions: ["masterdata.material.create"],
  availability: { available: true },
  columns: [
    { key: "code", label: "Code", hint: "Kept when it follows the scan grammar; blank = the loader assigns MAT-nnnn.", aliases: ["material_code", "item_code"] },
    { key: "name", label: "Name", required: true, hint: "Name staff use.", aliases: ["material_name", "description"] },
    { key: "inci_name", label: "INCI name", hint: "Expected for ingredients (warning when missing).", aliases: ["inci"] },
    { key: "common_name", label: "Common name", hint: "Optional." },
    { key: "material_class", label: "Material class", required: true, hint: "raw_material (raw), packaging, intermediate or consumable.", aliases: ["class", "material_kind"] },
    { key: "uom_base", label: "Base unit", required: true, hint: "A base unit of the unit list: g, mL or pcs.", aliases: ["base_uom", "uom"] },
    { key: "shelf_life_days", label: "Shelf life (days)", hint: "Only when QA supplied it." },
    { key: "retest_days", label: "Retest interval (days)", hint: "Only when QA supplied it." },
    { key: "storage_conditions", label: "Storage conditions", hint: "As on the supplier documents." },
    { key: "allergen_notes", label: "Allergen notes", hint: "Free text validated by QA." },
    { key: "hazard_notes", label: "Hazard notes", hint: "Free text validated by QA." },
    { key: "requires_coa", label: "Requires CoA", hint: "yes or no (blank = yes)." },
    { key: "legacy_number", label: "Legacy number", hint: "Old code or spreadsheet key (kept in the crosswalk)." },
  ],
  exampleRows: [
    {
      code: "MAT-9001",
      name: "Sample Coconut Oil (fictional)",
      inci_name: "Cocos Nucifera (Coconut) Oil",
      common_name: "Coconut oil",
      material_class: "raw_material",
      uom_base: "g",
      shelf_life_days: "730",
      retest_days: "",
      storage_conditions: "Below 30 °C, away from light",
      allergen_notes: "",
      hazard_notes: "",
      requires_coa: "yes",
      legacy_number: "OLD-COCO-01",
    },
  ],
  normalize(r) {
    const code = r.code("code", { example: "MAT-0070" });
    const name = r.text("name", { required: true, max: 200 });
    const materialKind = r.oneOf("material_class", MATERIAL_CLASSES, { required: true, synonyms: { raw: "raw_material", raw_materials: "raw_material", ingredient: "raw_material", pkg: "packaging" } });
    const baseUom = r.text("uom_base", { required: true, max: 16 });
    const v: MaterialValues = {
      code,
      name: name ?? "",
      inciName: r.text("inci_name", { max: 300 }),
      commonName: r.text("common_name", { max: 200 }),
      materialKind: materialKind ?? "raw_material",
      baseUom: baseUom ?? "",
      shelfLifeDays: r.int("shelf_life_days", { min: 1, max: 3650 }),
      retestDays: r.int("retest_days", { min: 1, max: 3650 }),
      storageConditions: r.text("storage_conditions", { max: 300 }),
      allergenNotes: r.text("allergen_notes", { max: 1000 }),
      hazardNotes: r.text("hazard_notes", { max: 1000 }),
      requiresCoa: r.bool("requires_coa", true) ?? true,
      legacyNumber: r.text("legacy_number", { max: 80 }),
    };
    if (materialKind) for (const w of materialWarnings({ materialKind, inciName: v.inciName })) r.warn(w);
    if (!name || !materialKind || !baseUom) return null;
    return { values: v, tier1Key: code ? `code:${code}` : null, matchName: name };
  },
  async findExisting(tx, ctx, _job, rows) {
    const existing = await tx.select({ id: materials.id, code: materials.code, name: materials.name, inci: materials.inciName }).from(materials).where(eq(materials.organizationId, ctx.organizationId));
    const aliases = await tx.select({ materialId: materialAliases.materialId, alias: materialAliases.alias }).from(materialAliases).where(eq(materialAliases.organizationId, ctx.organizationId));
    const byCode = new Map(existing.map((m) => [m.code, m]));
    const candidates = existing.map((m) => ({ id: m.id, label: `${m.code} ${m.name}`, names: [m.name, ...aliases.filter((a) => a.materialId === m.id).map((a) => a.alias)] }));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const same = values.code ? byCode.get(values.code) : undefined;
      if (same) {
        out.set(rowNo, { tier: 1, entityType: "material", entityId: same.id, label: `${same.code} ${same.name}`, message: `Material ${same.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      const inci = values.inciName ? existing.find((m) => m.inci && normalisedName(m.inci) === normalisedName(values.inciName!)) : undefined;
      if (inci) {
        out.set(rowNo, { tier: 2, entityType: "material", entityId: inci.id, label: `${inci.code} ${inci.name}`, message: `Possible duplicate: existing material ${inci.code} has the same INCI name. Decide "same as existing", "new record" or "reject".` });
        continue;
      }
      const m = nameMatches(values.name, candidates, "material", "material");
      if (m) out.set(rowNo, m);
    }
    return out;
  },
  async create(k, v) {
    const code = v.code ?? (await nextLoaderCode(k.tx, "materials", "code", k.ctx.organizationId, "MAT", k.state));
    const m = await createMaterialMaster(
      k.ctx,
      {
        code,
        name: v.name,
        inciName: v.inciName,
        commonName: v.commonName,
        materialKind: v.materialKind,
        baseUom: v.baseUom,
        shelfLifeDays: v.shelfLifeDays,
        retestDays: v.retestDays,
        storageConditions: v.storageConditions,
        allergenNotes: v.allergenNotes,
        hazardNotes: v.hazardNotes,
        requiresCoa: v.requiresCoa,
        status: "active",
      },
      { tx: k.tx },
    );
    return { entityType: "material", entityId: m.id, label: m.code, warnings: v.code ? [] : [`Code ${m.code} assigned by the loader.`] };
  },
  async linkToExisting(k, v, match) {
    // §8 survivor rule: the old spreadsheet name becomes an alias of the surviving material.
    const [m] = await k.tx.select({ name: materials.name }).from(materials).where(eq(materials.id, match.entityId)).limit(1);
    if (!m || m.name.trim().toLowerCase() === v.name.trim().toLowerCase()) return;
    await k.tx.insert(materialAliases).values({ organizationId: k.ctx.organizationId, materialId: match.entityId, alias: v.name, source: "import", importJobRowId: k.row.id, createdBy: k.ctx.userId }).onConflictDoNothing();
  },
};

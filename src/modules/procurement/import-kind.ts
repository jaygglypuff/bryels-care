import "server-only";
import { and, eq } from "drizzle-orm";
import { materials, supplierMaterials, suppliers } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { ImportKindHandler } from "@/modules/imports";
import { proposeSupplierMaterial, updateSupplierTerms } from "./asl";

/**
 * `supplier_materials` import kind (docs/data-migration-plan.md §9.2 "suppliers" sheet 2; registered in
 * src/modules/wiring.ts): one row per supplier × material with the supplier part number, lead time,
 * MOQ and price. An import never approves anything: each row becomes an approved-list *proposal* that
 * QA decides on the supplier screen (SoD, W04-11); price, MOQ and lead time are stored as the pair's
 * cost terms (`masterdata.supplier_price.edit`). Existing pairs are skipped (imports are create-only).
 */
type Values = {
  supplierCode: string;
  materialCode: string;
  supplierPartNumber: string | null;
  leadTimeDays: number | null;
  moqQty: string | null;
  moqUom: string | null;
  unitPrice: string | null;
  priceUom: string | null;
  currency: string | null;
  priceEffectiveFrom: string | null;
  note: string;
};

const CODE = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

export const supplierMaterialsKind: ImportKindHandler<Values> = {
  kind: "supplier_materials",
  label: "Supplier materials and prices",
  description: "Approved-list proposals (QA decides) with supplier part numbers, lead times, MOQ and prices.",
  creates: "supplier_material",
  entityPermissions: ["masterdata.supplier.edit", "masterdata.supplier_price.edit"],
  availability: { available: true },
  columns: [
    { key: "supplier_code", label: "Supplier code", required: true, hint: "An existing supplier, e.g. SUP-0001." },
    { key: "material_code", label: "Material code", required: true, hint: "An existing material, e.g. MAT-0012." },
    { key: "supplier_part_number", label: "Supplier part number", hint: "Optional." },
    { key: "lead_time_days", label: "Lead time (days)", hint: "Whole days from order to delivery." },
    { key: "moq_qty", label: "MOQ", hint: "Minimum order quantity (optional)." },
    { key: "moq_uom", label: "MOQ unit", hint: "e.g. kg; default the material's base unit." },
    { key: "unit_price", label: "Unit price", hint: "Price per price unit (sensitive)." },
    { key: "price_uom", label: "Price unit", hint: "e.g. kg; default the material's base unit." },
    { key: "currency", label: "Currency", hint: "ISO 4217, default PHP." },
    { key: "price_effective_from", label: "Price effective from", hint: "Date." },
    { key: "note", label: "Why this supplier (for QA)", required: true, hint: "Evidence or audit reference QA will check." },
  ],
  exampleRows: [{ supplier_code: "SUP-9001", material_code: "MAT-9001", supplier_part_number: "LO-CO-25", lead_time_days: "7", moq_qty: "100", moq_uom: "kg", unit_price: "180.00", price_uom: "kg", currency: "PHP", price_effective_from: "", note: "Fictional example: supplier audited, CoA template on file." }],
  normalize(r) {
    const supplierCode = r.code("supplier_code", { required: true, pattern: CODE, example: "SUP-0001" });
    const materialCode = r.code("material_code", { required: true, pattern: CODE, example: "MAT-0012" });
    const note = r.text("note", { required: true, max: 1000 });
    const v: Values = {
      supplierCode: supplierCode ?? "",
      materialCode: materialCode ?? "",
      supplierPartNumber: r.text("supplier_part_number", { max: 80 }),
      leadTimeDays: r.int("lead_time_days", { min: 0, max: 365 }),
      moqQty: r.decimal("moq_qty", { positive: true, dp: 6 }),
      moqUom: r.text("moq_uom", { max: 8 }),
      unitPrice: r.decimal("unit_price", { nonNegative: true, dp: 4 }),
      priceUom: r.text("price_uom", { max: 8 }),
      currency: r.text("currency", { max: 3 }),
      priceEffectiveFrom: r.date("price_effective_from"),
      note: note ?? "",
    };
    if (!supplierCode || !materialCode || !note || note.length < 5) {
      if (note && note.length < 5) r.error("note", "Give QA at least 5 characters of evidence.");
      return null;
    }
    return { values: v, tier1Key: `${supplierCode}|${materialCode}` };
  },
  async findExisting(tx, ctx, _job, rows) {
    const out: Awaited<ReturnType<NonNullable<ImportKindHandler<Values>["findExisting"]>>> = new Map();
    for (const { rowNo, values } of rows) {
      const [hit] = await tx
        .select({ id: supplierMaterials.id })
        .from(supplierMaterials)
        .innerJoin(suppliers, eq(suppliers.id, supplierMaterials.supplierId))
        .innerJoin(materials, eq(materials.id, supplierMaterials.materialId))
        .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.code, values.supplierCode), eq(materials.code, values.materialCode)))
        .limit(1);
      if (hit) out.set(rowNo, { tier: 1, entityType: "supplier_material", entityId: hit.id, label: `${values.supplierCode} × ${values.materialCode}`, message: "This supplier × material pair already exists; the row is skipped (change it on the supplier screen)." });
    }
    return out;
  },
  async create(k, v) {
    const [s] = await k.tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.organizationId, k.ctx.organizationId), eq(suppliers.code, v.supplierCode))).limit(1);
    if (!s) throw new DomainError("validation", `Supplier ${v.supplierCode} does not exist; import suppliers first.`, { field: "supplier_code" });
    const [m] = await k.tx.select({ id: materials.id }).from(materials).where(and(eq(materials.organizationId, k.ctx.organizationId), eq(materials.code, v.materialCode))).limit(1);
    if (!m) throw new DomainError("validation", `Material ${v.materialCode} does not exist; import materials first.`, { field: "material_code" });
    const r = await proposeSupplierMaterial(k.ctx, { supplierId: s.id, materialId: m.id, supplierPartNumber: v.supplierPartNumber, note: `Import: ${v.note}` }, { tx: k.tx });
    if (v.leadTimeDays !== null || v.moqQty || v.unitPrice) {
      await updateSupplierTerms(k.ctx, { supplierMaterialId: r.supplierMaterialId, supplierPartNumber: v.supplierPartNumber, leadTimeDays: v.leadTimeDays, moqQty: v.moqQty, moqUom: v.moqUom, unitPrice: v.unitPrice, priceUom: v.priceUom, currency: v.currency, priceEffectiveFrom: v.priceEffectiveFrom }, { tx: k.tx });
    }
    return { entityType: "supplier_material", entityId: r.supplierMaterialId, label: `${v.supplierCode} × ${v.materialCode}`, warnings: ["Waiting for QA approval on the supplier screen."] };
  },
};

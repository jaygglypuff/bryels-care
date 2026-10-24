import "server-only";
import { and, eq } from "drizzle-orm";
import { products, skus, uoms } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { createProduct, createSku } from "@/modules/masterdata";
import { nameMatches } from "./common";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * `skus` (docs/data-migration-plan.md §7.3): one row per SKU; the product is created on its first row
 * (or reused when it exists) through the product service (US-1-22), the SKU through the SKU service.
 * Products and SKUs start as `draft` exactly as on the screen; shelf life comes from QA (P6). The
 * product service needs the net mass per unit, so the template carries `unit_net_mass_g` (W3C addition).
 */
type SkuValues = {
  productCode: string;
  productName: string;
  family: string | null;
  unitNetMassG: string | null;
  unitsPerBox: number | null;
  shelfLifeDays: number | null;
  storageConditions: string | null;
  skuCode: string | null;
  skuName: string | null;
  variantLabel: string | null;
  packFormat: string | null;
  uomBase: string;
  allocationRule: "fefo" | "fifo";
  legacyNumber: string | null;
};

export const skusKind: ImportKindHandler<SkuValues> = {
  kind: "skus",
  label: "Products and SKUs",
  description: "Finished products and their sellable SKUs (product master).",
  creates: "sku",
  entityPermissions: ["masterdata.product.create", "masterdata.sku.create"],
  availability: { available: true },
  columns: [
    { key: "product_code", label: "Product code", required: true, hint: "Scan grammar, e.g. ACS-135.", aliases: ["product"] },
    { key: "product_name", label: "Product name", required: true, hint: "Name on the label." },
    { key: "product_family", label: "Product family", hint: "One of the configured families (Settings); needed for a new product.", aliases: ["family"] },
    { key: "unit_net_mass_g", label: "Net mass per unit (g)", hint: "Needed for a new product (converts batch mass to units)." },
    { key: "units_per_box", label: "Units per box", hint: "Whole number; needed for a new product." },
    { key: "shelf_life_days", label: "Shelf life (days)", hint: "From QA; needed for a new product." },
    { key: "storage_conditions", label: "Storage conditions", hint: "Optional." },
    { key: "sku_code", label: "SKU code", hint: "Blank = product only.", aliases: ["sku"] },
    { key: "sku_name", label: "SKU name", hint: "Blank = the product name." },
    { key: "variant_label", label: "Variant", hint: "e.g. 3-pack." },
    { key: "pack_format", label: "Pack format", hint: "e.g. Carton of 12." },
    { key: "uom_base", label: "Stock unit", hint: "Usually pcs (blank = pcs)." },
    { key: "allocation_rule", label: "Allocation rule", hint: "fefo (default) or fifo." },
    { key: "legacy_number", label: "Legacy number", hint: "Old code (crosswalk)." },
  ],
  exampleRows: [
    {
      product_code: "DEMO-150",
      product_name: "Sample Calamansi Soap 150 g (fictional)",
      product_family: "Soap",
      unit_net_mass_g: "150",
      units_per_box: "48",
      shelf_life_days: "730",
      storage_conditions: "Cool, dry place",
      sku_code: "DEMO-150-3P",
      sku_name: "Sample Calamansi Soap 3-pack",
      variant_label: "3-pack",
      pack_format: "Shrink pack of 3",
      uom_base: "pcs",
      allocation_rule: "fefo",
      legacy_number: "PL-2024-017",
    },
  ],
  normalize(r) {
    const productCode = r.code("product_code", { required: true, example: "ACS-135" });
    const productName = r.text("product_name", { required: true, max: 160 });
    const skuCode = r.code("sku_code", { example: "ACS-135-12" });
    const v: SkuValues = {
      productCode: productCode ?? "",
      productName: productName ?? "",
      family: r.text("product_family", { max: 40 }),
      unitNetMassG: r.decimal("unit_net_mass_g", { positive: true }),
      unitsPerBox: r.int("units_per_box", { min: 1, max: 100_000 }),
      shelfLifeDays: r.int("shelf_life_days", { min: 1, max: 3650 }),
      storageConditions: r.text("storage_conditions", { max: 300 }),
      skuCode,
      skuName: r.text("sku_name", { max: 160 }),
      variantLabel: r.text("variant_label", { max: 80 }),
      packFormat: r.text("pack_format", { max: 80 }),
      uomBase: r.text("uom_base", { max: 16 }) ?? "pcs",
      allocationRule: r.oneOf("allocation_rule", ["fefo", "fifo"] as const, { dflt: "fefo" }) ?? "fefo",
      legacyNumber: r.text("legacy_number", { max: 80 }),
    };
    if (!v.shelfLifeDays) r.warn("No shelf life: a new product needs the shelf life from QA before it can be created.");
    if (!productCode || !productName) return null;
    return { values: v, tier1Key: skuCode ? `sku:${skuCode}` : `product:${productCode}`, groupKey: `product:${productCode}`, matchName: skuCode ? null : productName };
  },
  async findExisting(tx, ctx, _job, rows) {
    const prods = await tx.select({ id: products.id, code: products.skuCode, name: products.name }).from(products).where(eq(products.organizationId, ctx.organizationId));
    const skuRows = await tx.select({ id: skus.id, code: skus.code }).from(skus).where(eq(skus.organizationId, ctx.organizationId));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      if (values.skuCode) {
        const s = skuRows.find((x) => x.code === values.skuCode);
        if (s) out.set(rowNo, { tier: 1, entityType: "sku", entityId: s.id, label: s.code, message: `SKU ${s.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      const p = prods.find((x) => x.code === values.productCode);
      if (p) {
        out.set(rowNo, { tier: 1, entityType: "product", entityId: p.id, label: p.code, message: `Product ${p.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      const m = nameMatches(values.productName, prods.map((x) => ({ id: x.id, label: `${x.code} ${x.name}`, names: [x.name] })), "product", "product");
      if (m) out.set(rowNo, m);
    }
    return out;
  },
  async create(k, v) {
    const { tx, ctx } = k;
    let [product] = await tx.select().from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.skuCode, v.productCode))).limit(1);
    const warnings: string[] = [];
    if (!product) {
      const created = await createProduct(
        ctx,
        { code: v.productCode, name: v.productName, family: v.family ?? "", unitNetMassG: v.unitNetMassG ?? "", unitsPerBox: v.unitsPerBox, shelfLifeDays: v.shelfLifeDays, storageConditions: v.storageConditions },
        { tx },
      );
      product = created;
      warnings.push(`Product ${v.productCode} created as draft; activate it in Products after review.`);
    } else if (product.name.toLowerCase() !== v.productName.toLowerCase()) {
      warnings.push(`Product ${v.productCode} exists as "${product.name}"; the file says "${v.productName}". The existing product is used.`);
    }
    if (!v.skuCode) return { entityType: "product", entityId: product.id, label: product.skuCode, warnings };
    const [unit] = await tx.select({ id: uoms.id }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), eq(uoms.code, v.uomBase))).limit(1);
    if (!unit) throw new DomainError("validation", `Stock unit ${v.uomBase} is not in the unit list.`, { field: "uom_base" });
    const s = await createSku(
      ctx,
      {
        productId: product.id,
        code: v.skuCode,
        name: v.skuName ?? v.productName,
        variantLabel: v.variantLabel,
        packFormat: v.packFormat,
        uomBaseId: unit.id,
        unitsPerBox: v.unitsPerBox,
        shelfLifeDays: v.shelfLifeDays,
        storageConditions: v.storageConditions,
        allocationRule: v.allocationRule,
      },
      { tx },
    );
    return { entityType: "sku", entityId: s.id, label: s.code, warnings };
  },
};

import "server-only";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { inventoryBalances, inventoryLots, products, skus, uoms } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { assertLookupValue, lookupOptions } from "./lookups";
import { assertTransition, assertUuid, diff, isReferenced, optInt, optText, optUuid, reqText, scanCode, uniqueConflict } from "./org-common";
import { PRODUCT_STATUSES, PRODUCT_TRANSITIONS, type ProductStatus, isValidGtin } from "./products-shelf-life";
import { parseInput } from "./schemas";
import { runInTx, type InTx } from "@/lib/tx";

/**
 * Products and SKUs, basic fields (US-1-22). Products are organization-wide master data. The MVP
 * products row is what batches make and orders sell (code column `sku_code`); `skus` holds the
 * sellable / packable variants. Lifecycle draft → active → discontinued (PRODUCT_TRANSITIONS).
 * BC:SKU scans resolve through the product code today, so an SKU code may equal only its own
 * product's code (never another product's).
 */

const dec = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0, `Enter ${label} as a positive number (at most 6 decimals).`);
const optDec = (label: string) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .refine((v) => v === "" || (/^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0), `Enter ${label} as a positive number (at most 6 decimals).`)
    .transform((v) => (v ? v : null));

const ProductInput = z
  .object({
    code: scanCode("Product code", "ACS-135"),
    name: reqText("the product name", 160),
    family: reqText("the product family", 40),
    unitNetMassG: dec("the net mass per unit in grams"),
    unitsPerBox: optInt("Units per box", 1, 100000).refine((v) => v !== null, "Enter the units per box."),
    shelfLifeDays: optInt("Shelf life", 1, 3650).refine((v) => v !== null, "Enter the shelf life in days."),
    storageConditions: optText(300),
  })
  .strict();
export type ProductInput = z.input<typeof ProductInput>;

const SkuInput = z
  .object({
    productId: z.string().uuid("Choose the product."),
    code: scanCode("SKU code", "ACS-135-12"),
    name: reqText("the SKU name", 160),
    variantLabel: optText(80),
    packFormat: optText(80),
    netContentQty: optDec("the net content"),
    netContentUomId: optUuid,
    uomBaseId: z.string().uuid("Choose the stock unit (usually pcs)."),
    unitsPerBox: optInt("Units per box", 1, 100000),
    boxesPerPallet: optInt("Boxes per pallet", 1, 10000),
    gtin: optText(14).refine((v) => v === null || isValidGtin(v), "Enter a valid GTIN (8, 12, 13 or 14 digits with a correct check digit) or leave it empty."),
    shelfLifeDays: optInt("Shelf life", 1, 3650),
    retestDays: optInt("Retest interval", 1, 3650),
    storageConditions: optText(300),
    allocationRule: z.enum(["fefo", "fifo"]).default("fefo"),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.netContentQty && !v.netContentUomId) c.addIssue({ code: "custom", path: ["netContentUomId"], message: "Choose the unit of the net content." });
  });
export type SkuInput = z.input<typeof SkuInput>;

const StatusInput = z.object({ id: z.string().uuid(), status: z.enum(PRODUCT_STATUSES), reason: optText(500) }).strict();

/* ------------------------------------------------------------------ products */

export type ProductFilter = { q?: string; status?: string; family?: string };

export async function listProducts(ctx: AuthContext, f: ProductFilter = {}, limit = 1000) {
  ctx.require("masterdata.product.view");
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  const siteIds = ctx.allowedSiteIds.length ? ctx.allowedSiteIds : ["00000000-0000-0000-0000-000000000000"];
  return db
    .select({
      id: products.id,
      code: products.skuCode,
      name: products.name,
      family: products.family,
      status: products.status,
      unitNetMassG: products.unitNetMassG,
      unitsPerBox: products.unitsPerBox,
      shelfLifeDays: products.shelfLifeDays,
      storageConditions: products.storageConditions,
      skuCount: sql<number>`(select count(*) from ${skus} s where s.product_id = "products"."id" and s.status <> 'discontinued')::int`,
      onHand: sql<string>`coalesce((select sum(b.qty_base) from ${inventoryBalances} b join ${inventoryLots} l on l.id = b.lot_id where l.product_id = "products"."id" and b.site_id in (${sql.join(
        siteIds.map((s) => sql`${s}::uuid`),
        sql`, `,
      )})), 0)::text`,
    })
    .from(products)
    .where(
      and(
        eq(products.organizationId, ctx.organizationId),
        f.status && (PRODUCT_STATUSES as readonly string[]).includes(f.status) ? eq(products.status, f.status) : undefined,
        f.family ? sql`lower(${products.family}) = lower(${f.family})` : undefined,
        like ? or(ilike(products.skuCode, like), ilike(products.name, like)) : undefined,
      ),
    )
    .orderBy(asc(products.skuCode))
    .limit(limit);
}

export async function getProduct(ctx: AuthContext, productId: string) {
  ctx.require("masterdata.product.view");
  assertUuid(productId, "Product");
  const [p] = await db.select().from(products).where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.");
  const skuRows = ctx.can("masterdata.sku.view") ? await listSkus(ctx, { productId: p.id }) : [];
  return { ...p, code: p.skuCode, skus: skuRows };
}

/** Product families a form offers (editable list `product_family`, Master data → Lists; ADR-076). */
export async function productFamilies(q: DbOrTx, organizationId: string, opts: { keep?: string | null } = {}) {
  return lookupOptions(q, organizationId, "product_family", opts);
}

/** The family code to store (code or name of an active option, any case); `keep` = the product's current family. */
async function normaliseFamily(q: DbOrTx, organizationId: string, family: string, keep?: string) {
  return (await assertLookupValue(q, organizationId, "product_family", family, { field: "family", required: true, keep }))!;
}

/** BC:SKU scans resolve product codes: a product code must not be another product's SKU code. */
async function assertProductCodeFree(q: DbOrTx, ctx: AuthContext, code: string, productId?: string) {
  const [s] = await q.select({ productId: skus.productId }).from(skus).where(and(eq(skus.organizationId, ctx.organizationId), eq(skus.code, code))).limit(1);
  if (s && s.productId !== productId) throw new DomainError("conflict", `${code} is already an SKU code of another product.`, { field: "code" });
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createProduct(ctx: AuthContext, raw: unknown, opts?: InTx) {
  ctx.require("masterdata.product.create");
  const v = parseInput(ProductInput, raw);
  return runInTx(opts, async (tx) => {
    const family = await normaliseFamily(tx, ctx.organizationId, v.family);
    await assertProductCodeFree(tx, ctx, v.code);
    const [p] = await tx
      .insert(products)
      .values({ organizationId: ctx.organizationId, skuCode: v.code, name: v.name, family, unitNetMassG: v.unitNetMassG, unitsPerBox: v.unitsPerBox!, shelfLifeDays: v.shelfLifeDays!, storageConditions: v.storageConditions, status: "draft" })
      .returning()
      .catch((e) => uniqueConflict(e, `Product code ${v.code} is already in use.`));
    await audit(tx, ctx, { action: "masterdata.product.created", entityType: "product", entityId: p.id, entityNumber: p.skuCode, siteId: null, after: { ...v, family, status: "draft" } });
    return { ...p, code: p.skuCode };
  });
}

export async function updateProduct(ctx: AuthContext, productId: string, raw: unknown) {
  ctx.require("masterdata.product.edit");
  assertUuid(productId, "Product");
  const v = parseInput(ProductInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Product not found.");
    if (before.status === "discontinued") throw new DomainError("state", "A discontinued product can no longer be edited.");
    const family = await normaliseFamily(tx, ctx.organizationId, v.family, before.family);
    if (v.code !== before.skuCode) {
      const ref = await isReferenced(tx, "products", before.id);
      if (ref.referenced) throw new DomainError("state", `Product ${before.skuCode} is in use (${ref.by.slice(0, 3).join(", ")}); its code can no longer change.`, { field: "code" });
      await assertProductCodeFree(tx, ctx, v.code, before.id);
    }
    const [after] = await tx
      .update(products)
      .set({ skuCode: v.code, name: v.name, family, unitNetMassG: v.unitNetMassG, unitsPerBox: v.unitsPerBox!, shelfLifeDays: v.shelfLifeDays!, storageConditions: v.storageConditions })
      .where(eq(products.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `Product code ${v.code} is already in use.`));
    const d = diff(before, after, ["skuCode", "name", "family", "unitNetMassG", "unitsPerBox", "shelfLifeDays", "storageConditions"]);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.product.updated", entityType: "product", entityId: after.id, entityNumber: after.skuCode, siteId: null, before: d.before, after: d.after });
    return { ...after, code: after.skuCode };
  });
}

/**
 * Product lifecycle (PRODUCT_TRANSITIONS). Discontinuing a product discontinues its remaining SKUs
 * in the same transaction (each audited); an SKU cannot be active under a non-active product.
 */
export async function changeProductStatus(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.product.edit");
  const v = parseInput(StatusInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.id, v.id), eq(products.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "Product not found.");
    if (before.status === v.status) return before;
    assertTransition(PRODUCT_TRANSITIONS, before.status as ProductStatus, v.status, `Product ${before.skuCode}`);
    if (v.status === "discontinued" && !v.reason) throw new DomainError("validation", "Give the reason for discontinuing.", { field: "reason" });
    const [after] = await tx.update(products).set({ status: v.status }).where(eq(products.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.product.updated", entityType: "product", entityId: after.id, entityNumber: after.skuCode, siteId: null, reason: v.reason, before: { status: before.status }, after: { status: after.status } });
    if (v.status === "discontinued") {
      const open = await tx.update(skus).set({ status: "discontinued", updatedAt: new Date(), updatedBy: ctx.userId }).where(and(eq(skus.productId, before.id), ne(skus.status, "discontinued"))).returning({ id: skus.id, code: skus.code });
      for (const s of open) {
        await audit(tx, ctx, { action: "masterdata.sku.updated", entityType: "sku", entityId: s.id, entityNumber: s.code, siteId: null, reason: `Product ${before.skuCode} discontinued: ${v.reason}`, after: { status: "discontinued" } });
      }
    }
    return after;
  });
}

/* ------------------------------------------------------------------ SKUs */

export async function listSkus(ctx: AuthContext, f: { productId?: string; q?: string; status?: string } = {}, limit = 2000) {
  ctx.require("masterdata.sku.view");
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%` : null;
  const base = uoms;
  return db
    .select({
      id: skus.id,
      productId: skus.productId,
      productCode: products.skuCode,
      productName: products.name,
      code: skus.code,
      name: skus.name,
      variantLabel: skus.variantLabel,
      packFormat: skus.packFormat,
      netContentQty: skus.netContentQty,
      netContentUomId: skus.netContentUomId,
      uomBaseId: skus.uomBaseId,
      uomBaseCode: base.code,
      unitsPerBox: skus.unitsPerBox,
      boxesPerPallet: skus.boxesPerPallet,
      gtin: skus.gtin,
      shelfLifeDays: skus.shelfLifeDays,
      retestDays: skus.retestDays,
      storageConditions: skus.storageConditions,
      allocationRule: skus.allocationRule,
      status: skus.status,
    })
    .from(skus)
    .innerJoin(products, eq(products.id, skus.productId))
    .innerJoin(base, eq(base.id, skus.uomBaseId))
    .where(
      and(
        eq(skus.organizationId, ctx.organizationId),
        f.productId ? eq(skus.productId, f.productId) : undefined,
        f.status && (PRODUCT_STATUSES as readonly string[]).includes(f.status) ? eq(skus.status, f.status) : undefined,
        like ? or(ilike(skus.code, like), ilike(skus.name, like), ilike(products.name, like)) : undefined,
      ),
    )
    .orderBy(asc(skus.code))
    .limit(limit);
}

export async function getSku(ctx: AuthContext, skuId: string) {
  ctx.require("masterdata.sku.view");
  assertUuid(skuId, "SKU");
  const [s] = await db.select().from(skus).where(and(eq(skus.id, skuId), eq(skus.organizationId, ctx.organizationId))).limit(1);
  if (!s) throw new DomainError("not_found", "SKU not found.");
  return s;
}

async function assertSkuRefs(q: DbOrTx, ctx: AuthContext, v: z.output<typeof SkuInput>, skuId?: string) {
  const [p] = await q.select().from(products).where(and(eq(products.id, v.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.", { field: "productId" });
  if (p.status === "discontinued") throw new DomainError("state", `Product ${p.skuCode} is discontinued.`, { field: "productId" });
  const ids = [v.uomBaseId, v.netContentUomId].filter((x): x is string => !!x);
  const units = await q.select().from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), inArray(uoms.id, ids)));
  const base = units.find((u) => u.id === v.uomBaseId);
  if (!base || !base.isActive) throw new DomainError("validation", "Choose an active stock unit.", { field: "uomBaseId" });
  if (!base.isBase) throw new DomainError("validation", `${base.code} is not a base unit; SKUs are stocked in a base unit (usually pcs).`, { field: "uomBaseId" });
  if (v.netContentUomId && !units.some((u) => u.id === v.netContentUomId && u.isActive)) throw new DomainError("validation", "Choose an active unit for the net content.", { field: "netContentUomId" });
  const [clash] = await q.select({ id: products.id }).from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.skuCode, v.code), ne(products.id, p.id))).limit(1);
  if (clash) throw new DomainError("conflict", `${v.code} is another product's code; choose a different SKU code.`, { field: "code" });
  void skuId;
  return p;
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createSku(ctx: AuthContext, raw: unknown, opts?: InTx) {
  ctx.require("masterdata.sku.create");
  const v = parseInput(SkuInput, raw);
  return runInTx(opts, async (tx) => {
    await assertSkuRefs(tx, ctx, v);
    const [s] = await tx
      .insert(skus)
      .values({ organizationId: ctx.organizationId, ...v, status: "draft", createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning()
      .catch((e) => uniqueConflict(e, `SKU code ${v.code} is already in use.`));
    await audit(tx, ctx, { action: "masterdata.sku.created", entityType: "sku", entityId: s.id, entityNumber: s.code, siteId: null, after: { ...v, status: "draft" } });
    return s;
  });
}

const SKU_FIELDS = ["code", "name", "variantLabel", "packFormat", "netContentQty", "netContentUomId", "uomBaseId", "unitsPerBox", "boxesPerPallet", "gtin", "shelfLifeDays", "retestDays", "storageConditions", "allocationRule"] as const;

export async function updateSku(ctx: AuthContext, skuId: string, raw: unknown) {
  ctx.require("masterdata.sku.edit");
  assertUuid(skuId, "SKU");
  const v = parseInput(SkuInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(skus).where(and(eq(skus.id, skuId), eq(skus.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "SKU not found.");
    if (before.status === "discontinued") throw new DomainError("state", "A discontinued SKU can no longer be edited.");
    if (v.productId !== before.productId) throw new DomainError("validation", "An SKU cannot move to another product; create a new SKU.", { field: "productId" });
    await assertSkuRefs(tx, ctx, v, before.id);
    const ref = v.code !== before.code || v.uomBaseId !== before.uomBaseId ? await isReferenced(tx, "skus", before.id) : { referenced: false, by: [] };
    if (ref.referenced) throw new DomainError("state", `SKU ${before.code} is in use; its code and stock unit can no longer change.`, { field: v.code !== before.code ? "code" : "uomBaseId" });
    const [after] = await tx
      .update(skus)
      .set({ ...v, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(skus.id, before.id))
      .returning()
      .catch((e) => uniqueConflict(e, `SKU code ${v.code} is already in use.`));
    const d = diff(before, after, SKU_FIELDS);
    if (d.changed.length) await audit(tx, ctx, { action: "masterdata.sku.updated", entityType: "sku", entityId: after.id, entityNumber: after.code, siteId: null, before: d.before, after: d.after });
    return after;
  });
}

export async function changeSkuStatus(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.sku.edit");
  const v = parseInput(StatusInput, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(skus).where(and(eq(skus.id, v.id), eq(skus.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!before) throw new DomainError("not_found", "SKU not found.");
    if (before.status === v.status) return before;
    assertTransition(PRODUCT_TRANSITIONS, before.status as ProductStatus, v.status, `SKU ${before.code}`);
    if (v.status === "active") {
      const [p] = await tx.select({ status: products.status, code: products.skuCode }).from(products).where(eq(products.id, before.productId));
      if (p.status !== "active") throw new DomainError("state", `Activate product ${p.code} first; an SKU can be active only under an active product.`);
    }
    if (v.status === "discontinued" && !v.reason) throw new DomainError("validation", "Give the reason for discontinuing.", { field: "reason" });
    const [after] = await tx.update(skus).set({ status: v.status, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(skus.id, before.id)).returning();
    await audit(tx, ctx, { action: "masterdata.sku.updated", entityType: "sku", entityId: after.id, entityNumber: after.code, siteId: null, reason: v.reason, before: { status: before.status }, after: { status: after.status } });
    return after;
  });
}

/* ------------------------------------------------------------------ exports (src/lib/export.ts) */

type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];
type SkuRow = Awaited<ReturnType<typeof listSkus>>[number];

/** Product list export (masterdata.product.export): same rows as the screen, formula-neutralised, audited. */
export const productsExport: ExportDefinition<ProductFilter & Record<string, unknown>, ProductRow> = {
  code: "masterdata.products",
  title: "Products",
  permission: "masterdata.product.export",
  sensitivity: "S",
  siteScope: () => [],
  fileName: () => "products",
  fetch: (ctx, f, limit) => listProducts(ctx, f, limit),
  columns: [
    { header: "Code", value: (r) => r.code },
    { header: "Name", value: (r) => r.name },
    { header: "Family", value: (r) => r.family },
    { header: "Status", value: (r) => r.status },
    { header: "Net mass per unit (g)", value: (r) => r.unitNetMassG, numeric: true },
    { header: "Units per box", value: (r) => r.unitsPerBox, numeric: true },
    { header: "Shelf life (days)", value: (r) => r.shelfLifeDays, numeric: true },
    { header: "Storage conditions", value: (r) => r.storageConditions },
    { header: "Active SKUs", value: (r) => r.skuCount, numeric: true },
  ],
};

export const skusExport: ExportDefinition<{ productId?: string; q?: string; status?: string } & Record<string, unknown>, SkuRow> = {
  code: "masterdata.skus",
  title: "SKUs",
  permission: "masterdata.sku.export",
  sensitivity: "S",
  siteScope: () => [],
  fileName: () => "skus",
  fetch: (ctx, f, limit) => listSkus(ctx, f, limit),
  columns: [
    { header: "SKU code", value: (r) => r.code },
    { header: "Name", value: (r) => r.name },
    { header: "Product", value: (r) => r.productCode },
    { header: "Variant", value: (r) => r.variantLabel },
    { header: "Pack format", value: (r) => r.packFormat },
    { header: "Stock unit", value: (r) => r.uomBaseCode },
    { header: "Units per box", value: (r) => r.unitsPerBox, numeric: true },
    { header: "Boxes per pallet", value: (r) => r.boxesPerPallet, numeric: true },
    { header: "GTIN", value: (r) => r.gtin },
    { header: "Shelf life (days)", value: (r) => r.shelfLifeDays, numeric: true },
    { header: "Retest (days)", value: (r) => r.retestDays, numeric: true },
    { header: "Allocation", value: (r) => r.allocationRule },
    { header: "Status", value: (r) => r.status },
  ],
};

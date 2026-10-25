import "server-only";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { customerPortalTenants, portalCatalogItems, priceListLines, priceLists, products } from "@/db/schema";
import { effectiveRequirements, itemCodeMap } from "@/modules/sales";
import type { PortalAuthContext } from "./context";
import { manilaDate } from "./support";

/**
 * The approved catalogue of a customer tenant (US-8-02 AC1; docs/permissions-matrix.md §7 "never
 * exposed: unapproved products"). A product is in the catalogue only when ALL hold on the day:
 *
 *   1. the product is active (W2G: draft and discontinued products are never sold);
 *   2. an approved, effective W3D price list prices it for this customer: the customer's own list, or
 *      (catalogue mode `all_priced` / `curated`) the general list where the customer's list does not
 *      price the product — the same rule `resolvePrice` applies to orders;
 *   3. in mode `curated`, Bryel's Care staff added it to the tenant's allow-list (portal_catalog_items).
 *
 * The approved customer requirements in force (MOQ, lead time) are shown with each item and applied
 * again at submission by the W3D order service. Stock quantities, locations, costs and supplier data
 * are never part of an item.
 */
export type PortalCatalogItem = {
  productId: string;
  sku: string;
  name: string;
  customerItemCode: string | null;
  uom: string;
  unitsPerBox: number;
  currency: string;
  /** Quantity breaks in force, lowest first: from `minQty` pieces the unit price is `unitAmount`. */
  priceBreaks: { minQty: string; unitAmount: string }[];
  moq: string | null;
  leadTimeDays: number | null;
};

type TenantRef = { organizationId: string; customerId: string; tenantId: string; catalogMode: string };

const money = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** Builds the catalogue (no permission check: callers are the portal context or a staff view with its own check). */
export async function catalogueFor(q: DbOrTx, t: TenantRef, on = manilaDate()): Promise<PortalCatalogItem[]> {
  const rows = await q
    .select({ kind: priceLists.partyKind, customerId: priceLists.customerId, currency: priceListLines.currency, minQty: priceListLines.minQtyUnits, amount: priceListLines.unitAmount, product: products })
    .from(priceLists)
    .innerJoin(priceListLines, eq(priceListLines.priceListId, priceLists.id))
    .innerJoin(products, eq(products.id, priceListLines.productId))
    .where(
      and(
        eq(priceLists.organizationId, t.organizationId),
        eq(priceLists.status, "approved"),
        lte(priceLists.effectiveFrom, on),
        or(isNull(priceLists.effectiveTo), gt(priceLists.effectiveTo, on)),
        or(eq(priceLists.customerId, t.customerId), eq(priceLists.partyKind, "general")),
        eq(products.status, "active"),
        eq(products.organizationId, t.organizationId),
      ),
    )
    .orderBy(asc(products.skuCode));
  const own = new Set(rows.filter((r) => r.kind === "customer" && r.customerId === t.customerId).map((r) => r.product.id));
  let curated: Set<string> | null = null;
  if (t.catalogMode === "curated") {
    curated = new Set((await q.select({ productId: portalCatalogItems.productId }).from(portalCatalogItems).where(eq(portalCatalogItems.tenantId, t.tenantId))).map((r) => r.productId));
  }
  const byProduct = new Map<string, { product: (typeof rows)[number]["product"]; currency: string; breaks: Map<string, string> }>();
  for (const r of rows) {
    const isOwn = r.kind === "customer";
    if (t.catalogMode === "customer_price_list" && !isOwn) continue;
    // The customer's own list replaces the general list for a product it prices (resolvePrice rule).
    if (!isOwn && own.has(r.product.id)) continue;
    if (curated && !curated.has(r.product.id)) continue;
    const e = byProduct.get(r.product.id) ?? { product: r.product, currency: r.currency, breaks: new Map<string, string>() };
    const key = new Decimal(r.minQty).toString();
    // Two approved overlapping versions cannot exist (W3D); keep the lowest amount defensively.
    const prev = e.breaks.get(key);
    if (!prev || new Decimal(r.amount).lt(prev)) e.breaks.set(key, money(r.amount));
    byProduct.set(r.product.id, e);
  }
  const ids = [...byProduct.keys()];
  const codes = ids.length ? await itemCodeMap(q, t.customerId, ids) : new Map<string, string>();
  const out: PortalCatalogItem[] = [];
  for (const [productId, e] of byProduct) {
    const req = await effectiveRequirements(q, t.organizationId, t.customerId, productId, on);
    out.push({
      productId,
      sku: e.product.skuCode,
      name: e.product.name,
      customerItemCode: codes.get(productId) ?? null,
      uom: e.product.baseUom,
      unitsPerBox: e.product.unitsPerBox,
      currency: e.currency,
      priceBreaks: [...e.breaks.entries()].map(([minQty, unitAmount]) => ({ minQty, unitAmount })).sort((a, b) => new Decimal(a.minQty).cmp(b.minQty)),
      moq: req.moq?.valueNumeric != null ? new Decimal(req.moq.valueNumeric).toString() : null,
      leadTimeDays: req.lead_time?.valueNumeric != null ? Number(req.lead_time.valueNumeric) : null,
    });
  }
  return out;
}

/** The unit price of a catalogue item for a quantity (highest break not above it). */
export function unitPriceFor(item: PortalCatalogItem, qty: Decimal.Value): string | null {
  const n = new Decimal(qty || 0);
  const hit = [...item.priceBreaks].reverse().find((b) => new Decimal(b.minQty).lte(n));
  return hit?.unitAmount ?? null;
}

async function tenantRef(ctx: PortalAuthContext): Promise<TenantRef> {
  const [t] = await db.select({ catalogMode: customerPortalTenants.catalogMode }).from(customerPortalTenants).where(eq(customerPortalTenants.id, ctx.tenantId)).limit(1);
  return { organizationId: ctx.organizationId, customerId: ctx.customerId, tenantId: ctx.tenantId, catalogMode: t?.catalogMode ?? "customer_price_list" };
}

/** The signed-in customer's catalogue (portal.catalog.view). */
export async function portalCatalogue(ctx: PortalAuthContext, on = manilaDate()): Promise<PortalCatalogItem[]> {
  ctx.require("portal.catalog.view");
  return catalogueFor(db, await tenantRef(ctx), on);
}

export async function portalCatalogueInTx(q: DbOrTx, ctx: PortalAuthContext, on = manilaDate()) {
  return catalogueFor(q, await tenantRef(ctx), on);
}

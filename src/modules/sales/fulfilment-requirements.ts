import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers } from "@/db/schema";
import { logger } from "@/lib/log";

/**
 * Customer requirements as read by boxing, allocation and pack verification (W3E). The
 * `customer_requirements` table (US-4-02) is built by stream W3D in parallel, so it is read through
 * this one function with a safe default. Contract (docs/data-model.md §3.1 `customer_requirements`,
 * docs/modules/sales-fulfilment.md):
 *
 * | Kind (`requirement_kind`)        | Column read              | Used by                                      |
 * |----------------------------------|--------------------------|----------------------------------------------|
 * | `min_remaining_shelf_life_days`  | `value_numeric`          | allocation (W09-05): skip lots below it      |
 * | `lot_age_max_days`               | `value_numeric`          | allocation: skip lots older than it          |
 * | `carton_count`                   | `value_numeric` (> 0)    | boxing / repack units per box (W08-01)       |
 * | `full_shipment_required`         | `value_text` true/false  | pack verification: partial → CX-SHIP         |
 * | `shipping_marks`                 | `value_text`             | box label and boxing note                    |
 *
 * Rows apply when they belong to the customer (`customer_id`), to the product (`product_id` or `sku_id`
 * equal, or null = all SKUs; a product row wins over an all-SKU row), are `status = 'approved'` when the
 * table has a status column, and are effective now when it has `effective_from` / `effective_to`.
 * When the table does not exist or lacks `customer_id` / `requirement_kind`, the defaults apply:
 * the customer's `min_shelf_life_days`, the SKU's units per box, partial shipments allowed
 * (A-PROC-15) and no shipping marks. The customer's own `min_shelf_life_days` is always a floor.
 */
export type FulfilmentRequirements = {
  /** customer_requirement when at least one approved row applied; customer_default otherwise. */
  source: "customer_requirement" | "customer_default";
  requirementIds: string[];
  minRemainingShelfLifeDays: number;
  maxLotAgeDays: number | null;
  /** Customer carton count; null = use the SKU default (`products.units_per_box`). */
  unitsPerBox: number | null;
  fullShipmentRequired: boolean;
  shippingMarks: string | null;
};

type Row = { id: string; kind: string; value_numeric: string | null; value_text: string | null; product_ref: string | null };

let warned = false;

async function columnsOf(q: DbOrTx): Promise<Set<string> | null> {
  const t = await q.execute<{ reg: string | null }>(sql`select to_regclass('public.customer_requirements')::text as reg`);
  if (!t[0]?.reg) return null;
  const cols = await q.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customer_requirements'`);
  return new Set(cols.map((c) => c.column_name));
}

const truthy = (v: string | null) => !!v && ["true", "yes", "1", "y"].includes(v.trim().toLowerCase());

export async function customerFulfilmentRequirements(q: DbOrTx, organizationId: string, customerId: string, productId: string | null): Promise<FulfilmentRequirements> {
  const [c] = await q.select({ minShelfLifeDays: customers.minShelfLifeDays }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const floor = c?.minShelfLifeDays ?? 0;
  const out: FulfilmentRequirements = { source: "customer_default", requirementIds: [], minRemainingShelfLifeDays: floor, maxLotAgeDays: null, unitsPerBox: null, fullShipmentRequired: false, shippingMarks: null };
  const cols = await columnsOf(q);
  if (!cols) return out;
  if (!cols.has("customer_id") || !cols.has("requirement_kind")) {
    if (!warned) logger.warn("customer_requirements has no customer_id/requirement_kind column; fulfilment uses the defaults", { component: "sales.fulfilment" });
    warned = true;
    return out;
  }
  const productCol = cols.has("product_id") ? "product_id" : cols.has("sku_id") ? "sku_id" : null;
  const conds = [sql`customer_id = ${customerId}`];
  if (cols.has("organization_id")) conds.push(sql`organization_id = ${organizationId}`);
  if (cols.has("status")) conds.push(sql`status = 'approved'`);
  if (cols.has("effective_from")) conds.push(sql`(effective_from is null or effective_from <= now())`);
  if (cols.has("effective_to")) conds.push(sql`(effective_to is null or effective_to > now())`);
  if (productCol) conds.push(productId ? sql`(${sql.raw(productCol)} is null or ${sql.raw(productCol)} = ${productId})` : sql`${sql.raw(productCol)} is null`);
  const select = sql`select id::text as id, requirement_kind as kind,
      ${cols.has("value_numeric") ? sql`value_numeric::text` : sql`null::text`} as value_numeric,
      ${cols.has("value_text") ? sql`value_text` : sql`null::text`} as value_text,
      ${productCol ? sql`${sql.raw(productCol)}::text` : sql`null::text`} as product_ref
    from customer_requirements where ${sql.join(conds, sql` and `)}`;
  const rows = [...(await q.execute<Row>(select))];
  // A product-specific row wins over an all-SKU row of the same kind.
  const byKind = new Map<string, Row>();
  for (const r of rows.sort((a, b) => (a.product_ref ? 1 : 0) - (b.product_ref ? 1 : 0))) byKind.set(r.kind, r);
  const num = (k: string) => {
    const v = byKind.get(k)?.value_numeric;
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const used = new Set<string>();
  const mark = (k: string) => {
    const r = byKind.get(k);
    if (r) used.add(r.id);
  };
  const shelf = num("min_remaining_shelf_life_days");
  if (shelf !== null && shelf >= 0) {
    out.minRemainingShelfLifeDays = Math.max(floor, Math.ceil(shelf));
    mark("min_remaining_shelf_life_days");
  }
  const age = num("lot_age_max_days");
  if (age !== null && age >= 0) {
    out.maxLotAgeDays = Math.floor(age);
    mark("lot_age_max_days");
  }
  const carton = num("carton_count");
  if (carton !== null && carton > 0 && Number.isInteger(carton)) {
    out.unitsPerBox = carton;
    mark("carton_count");
  }
  const full = byKind.get("full_shipment_required");
  if (full) {
    out.fullShipmentRequired = truthy(full.value_text) || full.value_numeric === "1" || Number(full.value_numeric) === 1;
    mark("full_shipment_required");
  }
  const marks = byKind.get("shipping_marks")?.value_text?.trim();
  if (marks) {
    out.shippingMarks = marks.slice(0, 300);
    mark("shipping_marks");
  }
  out.requirementIds = [...used];
  if (used.size) out.source = "customer_requirement";
  return out;
}

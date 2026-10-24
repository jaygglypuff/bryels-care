import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers } from "@/db/schema";
import { businessDate } from "./crm-support";
import { effectiveRequirements, type RequirementSnapshot } from "./requirements";

/**
 * Customer requirements as read by boxing, allocation and pack verification (W3E), resolved from
 * W3D's `customer_requirements` (docs/data-model.md §3.7.1 and §3.7a): the approved version in force
 * on the business date, a product-specific version winning over the all-products one
 * (`effectiveRequirements`, the same resolver order submission uses for its line snapshot).
 *
 * | Kind (`requirement_kind`)        | Value                    | Used by                                      |
 * |----------------------------------|--------------------------|----------------------------------------------|
 * | `min_remaining_shelf_life_days`  | `value_numeric`          | allocation (W09-05): skip lots below it      |
 * | `lot_age_max_days`               | `value_numeric`          | allocation: skip lots older than it          |
 * | `carton_count`                   | `value_numeric` (> 0)    | boxing / repack units per box (W08-01)       |
 * | `full_shipment_required`         | `value_text` "true"      | pack verification: partial → CX-SHIP         |
 * | `shipping_marks`                 | `value_text`             | box label and boxing note                    |
 *
 * Without an approved requirement the customer's `min_shelf_life_days` applies (as in W3D's
 * requirement snapshot: an approved requirement replaces the customer default), units per box come
 * from the SKU, partial shipments are allowed (A-PROC-15) and there are no shipping marks.
 * Allocation of a submitted order uses the order line's frozen snapshot instead
 * (`requirementsFromSnapshot`), so a requirement approved later never changes an accepted order.
 */
export type FulfilmentRequirements = {
  /** customer_requirement when at least one approved row applied; order_line_snapshot when read from the order line; customer_default otherwise. */
  source: "customer_requirement" | "order_line_snapshot" | "customer_default";
  requirementIds: string[];
  minRemainingShelfLifeDays: number;
  maxLotAgeDays: number | null;
  /** Customer carton count; null = use the SKU default (`products.units_per_box`). */
  unitsPerBox: number | null;
  fullShipmentRequired: boolean;
  shippingMarks: string | null;
};

const truthy = (v: string | null | undefined) => !!v && ["true", "yes", "1", "y"].includes(v.trim().toLowerCase());
const num = (v: string | null | undefined) => {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function customerFulfilmentRequirements(q: DbOrTx, organizationId: string, customerId: string, productId: string | null, on = businessDate()): Promise<FulfilmentRequirements> {
  const [c] = await q.select({ minShelfLifeDays: customers.minShelfLifeDays }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const out: FulfilmentRequirements = { source: "customer_default", requirementIds: [], minRemainingShelfLifeDays: c?.minShelfLifeDays ?? 0, maxLotAgeDays: null, unitsPerBox: null, fullShipmentRequired: false, shippingMarks: null };
  const eff = await effectiveRequirements(q, organizationId, customerId, productId, on);
  const used: string[] = [];
  const shelf = num(eff.min_remaining_shelf_life_days?.valueNumeric);
  if (shelf !== null && shelf >= 0) {
    out.minRemainingShelfLifeDays = Math.ceil(shelf);
    used.push(eff.min_remaining_shelf_life_days!.id);
  }
  const age = num(eff.lot_age_max_days?.valueNumeric);
  if (age !== null && age >= 0) {
    out.maxLotAgeDays = Math.floor(age);
    used.push(eff.lot_age_max_days!.id);
  }
  const carton = num(eff.carton_count?.valueNumeric);
  if (carton !== null && carton > 0 && Number.isInteger(carton)) {
    out.unitsPerBox = carton;
    used.push(eff.carton_count!.id);
  }
  if (eff.full_shipment_required) {
    out.fullShipmentRequired = truthy(eff.full_shipment_required.valueText) || num(eff.full_shipment_required.valueNumeric) === 1;
    used.push(eff.full_shipment_required.id);
  }
  const marks = eff.shipping_marks?.valueText?.trim();
  if (marks) {
    out.shippingMarks = marks.slice(0, 300);
    used.push(eff.shipping_marks!.id);
  }
  out.requirementIds = used;
  if (used.length) out.source = "customer_requirement";
  return out;
}

/**
 * The fulfilment rules frozen on an order line at submission (W3D `sales_order_lines.min_remaining_shelf_life_days`
 * and `requirement_snapshot`, schema requirement_snapshot/v1), or null for lines entered before Wave 3.
 */
export function requirementsFromSnapshot(line: { minRemainingShelfLifeDays: number | null; requirementSnapshot: unknown }): FulfilmentRequirements | null {
  if (line.minRemainingShelfLifeDays === null || line.minRemainingShelfLifeDays === undefined) return null;
  const snap = (line.requirementSnapshot ?? null) as Partial<RequirementSnapshot> | null;
  const carton = snap?.cartonCount ?? null;
  return {
    source: "order_line_snapshot",
    requirementIds: snap?.requirementIds ?? [],
    minRemainingShelfLifeDays: line.minRemainingShelfLifeDays,
    maxLotAgeDays: snap?.lotAgeMaxDays ?? null,
    unitsPerBox: carton && carton > 0 && Number.isInteger(carton) ? carton : null,
    fullShipmentRequired: snap?.fullShipmentRequired ?? false,
    shippingMarks: snap?.shippingMarks ?? null,
  };
}

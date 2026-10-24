import Decimal from "decimal.js";

/**
 * Pure unit-conversion arithmetic (ADR-010, US-1-21). No floating point: decimal.js with 40
 * significant digits. A conversion row says qty_to = qty_from × factor; it can be used in either
 * direction, but the reverse direction divides and is accepted only when the result is exact
 * (multiplying back gives the entered value), so a stored base quantity is never a rounded guess.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type ConversionStep = { factor: string; direction: "forward" | "reverse" };
export type Quantity = { qty: string; uom: string };

/** Converts qty with one step; null when a reverse step would not be exact. */
export function applyStep(qty: Decimal.Value, step: ConversionStep): Decimal | null {
  const q = new D(qty);
  const f = new D(step.factor);
  if (step.direction === "forward") return q.times(f);
  const r = q.dividedBy(f);
  return r.times(f).eq(q) && r.decimalPlaces() <= 12 ? r : null;
}

/** True when `entered` in its unit equals `base` in the base unit under the step (no division needed). */
export function enteredEqualsBase(entered: Decimal.Value, base: Decimal.Value, step: ConversionStep): boolean {
  const e = new D(entered);
  const b = new D(base);
  return step.direction === "forward" ? e.times(step.factor).eq(b) : b.times(step.factor).eq(e);
}

/** Entered and base quantity pair stored on every quantity-bearing row (ADR-010). */
export function toBasePair(entered: Quantity, baseUom: string, step: ConversionStep | null): { entered: Quantity; base: Quantity } | null {
  if (entered.uom === baseUom) return { entered: { qty: new D(entered.qty).toString(), uom: entered.uom }, base: { qty: new D(entered.qty).toString(), uom: baseUom } };
  if (!step) return null;
  const b = applyStep(entered.qty, step);
  if (!b) return null;
  return { entered: { qty: new D(entered.qty).toString(), uom: entered.uom }, base: { qty: b.toString(), uom: baseUom } };
}

/** Same-dimension SI defaults installed as approved reference conversions (physics, not business rules). */
export const METRIC_DEFAULT_CONVERSIONS: readonly { from: string; to: string; factor: string }[] = [
  { from: "kg", to: "g", factor: "1000" },
  { from: "mg", to: "g", factor: "0.001" },
  { from: "L", to: "mL", factor: "1000" },
];

/** Reference units (US-1-21: g, kg, mL, L, pcs; mg kept from the MVP ledger factors). */
export const DEFAULT_UOMS: readonly { code: string; name: string; dimension: "mass" | "volume" | "count" | "length"; isBase: boolean }[] = [
  { code: "g", name: "gram", dimension: "mass", isBase: true },
  { code: "kg", name: "kilogram", dimension: "mass", isBase: false },
  { code: "mg", name: "milligram", dimension: "mass", isBase: false },
  { code: "mL", name: "millilitre", dimension: "volume", isBase: true },
  { code: "L", name: "litre", dimension: "volume", isBase: false },
  { code: "pcs", name: "piece", dimension: "count", isBase: true },
];

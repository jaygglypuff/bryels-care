import Decimal from "decimal.js";

/**
 * The weighing window of one ingredient line, at the resolution weights are typed and stored in (3 decimals of the base
 * unit; the weigh service refuses more). Batches not at the recipe size (orders split evenly, ADR-104 §4) give targets
 * like 1,241.333333 g, so the screen and the server use the SAME rounded numbers (unit-tested in tests/unit/weigh-window.test.ts):
 *
 * - target: half-up to 3 decimals (what the operator aims for);
 * - min: rounded UP and max rounded DOWN to 3 decimals, so a typed weight inside the shown window is always inside the
 *   exact tolerance (never OK on screen and refused by the server);
 * - a band narrower than the resolution collapses to the target.
 *
 * Tolerances themselves are process-owner configuration (A-PROC-03): an absolute band (g) wins over the percentage.
 */
export const WEIGH_DECIMALS = 3;

export function weighTarget(theoreticalQtyG: Decimal.Value): Decimal {
  return new Decimal(theoreticalQtyG).toDecimalPlaces(WEIGH_DECIMALS, Decimal.ROUND_HALF_UP);
}

export function toleranceRange(theoreticalQtyG: Decimal.Value, tolerancePct: Decimal.Value, toleranceAbsG?: Decimal.Value | null) {
  const theo = new Decimal(theoreticalQtyG);
  const band = toleranceAbsG !== null && toleranceAbsG !== undefined ? new Decimal(toleranceAbsG) : theo.mul(tolerancePct).div(100);
  const target = weighTarget(theo);
  let min = theo.minus(band).toDecimalPlaces(WEIGH_DECIMALS, Decimal.ROUND_UP);
  let max = theo.plus(band).toDecimalPlaces(WEIGH_DECIMALS, Decimal.ROUND_DOWN);
  if (min.gt(max) || target.lt(min) || target.gt(max)) min = max = target;
  return { min, max, target };
}

/** The window shown with fewer decimals (e.g. 0.1 g): never wider than the exact one. */
export function shownRange(min: Decimal.Value, max: Decimal.Value, dp = 1) {
  const lo = new Decimal(min).toDecimalPlaces(dp, Decimal.ROUND_UP);
  const hi = new Decimal(max).toDecimalPlaces(dp, Decimal.ROUND_DOWN);
  return lo.gt(hi) ? { lo: new Decimal(min), hi: new Decimal(max) } : { lo, hi };
}

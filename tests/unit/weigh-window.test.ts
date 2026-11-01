/** Weigh targets and windows at the typed resolution (coordinator bug 2026-11-01: batches not at the recipe size). */
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { shownRange, toleranceRange, weighTarget } from "@/modules/production/weigh-window";

describe("weigh window", () => {
  it("rounds an odd target to 3 decimals and keeps the window inside the exact tolerance", () => {
    // 333.33 bars × 135 g ÷ 0.97 yield, coconut oil 30 % → 13,917.3814… g
    const theo = new Decimal("333.33").mul(135).div("0.97").mul("0.30");
    const w = toleranceRange(theo, "0.5");
    expect(w.target.decimalPlaces()).toBeLessThanOrEqual(3);
    expect(w.min.decimalPlaces()).toBeLessThanOrEqual(3);
    expect(w.max.decimalPlaces()).toBeLessThanOrEqual(3);
    const band = theo.mul("0.5").div(100);
    expect(w.min.gte(theo.minus(band))).toBe(true);
    expect(w.max.lte(theo.plus(band))).toBe(true);
    expect(w.target.gte(w.min) && w.target.lte(w.max)).toBe(true);
    expect(weighTarget("1241.3333333").toString()).toBe("1241.333");
  });

  it("a band narrower than the resolution collapses to the target", () => {
    const w = toleranceRange("10.00012", "0", "0.0001");
    expect(w.min.toString()).toBe("10");
    expect(w.max.toString()).toBe("10");
  });

  it("the shown window (0.1 g) is never wider than the exact one", () => {
    expect(shownRange("13847.795", "13986.967")).toEqual({ lo: new Decimal("13847.8"), hi: new Decimal("13986.9") });
    expect(shownRange("10.02", "10.04")).toEqual({ lo: new Decimal("10.02"), hi: new Decimal("10.04") });
  });
});

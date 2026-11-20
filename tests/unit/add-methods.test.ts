/**
 * ADR-137 "How is it added?": conversion, scaling, rounding and judging math (decimal.js only).
 */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ScaleError,
  amountText,
  entersUnits,
  judgeAsNeeded,
  judgeUnits,
  judgedInUnits,
  methodSentence,
  readSpec,
  readingWithin,
  roundedText,
  scaleLine,
  scaleLineOverBatches,
  stockToUnits,
  unitWindow,
  unitWord,
  unitsText,
  unitsToStock,
} from "@/modules/masterdata/add-methods";

const count = { quantityG: "125", scaling: "proportional_round", rounding: "up", addMethod: "count", methodQty: "5", methodUnitQty: "25" };

describe("conversions", () => {
  it("units to stock is exact for whole units and rounds half-up to 6 decimals otherwise", () => {
    expect(unitsToStock("5", "25").toString()).toBe("125");
    expect(unitsToStock("3", "25.0005").toString()).toBe("75.0015");
    // 250 mL at 0.9137 g/mL = 228.425 g
    expect(unitsToStock("250", "0.9137").toString()).toBe("228.425");
    expect(unitsToStock("0.3333", "0.1234567").toString()).toBe("0.041148");
    expect(stockToUnits("228.425", "0.9137").toString()).toBe("250");
    expect(stockToUnits("10", "0").toString()).toBe("0");
  });
});

describe("scaling", () => {
  it("fixed copies; proportional multiplies; never floating point", () => {
    expect(scaleLine({ ...count, scaling: "fixed", rounding: null }, "3").targetG.toString()).toBe("125");
    const p = scaleLine({ quantityG: "100.1", scaling: "proportional", rounding: null, addMethod: "weigh", methodQty: null, methodUnitQty: null }, "0.3");
    expect(p.targetG.toString()).toBe("30.03");
    expect(p.methodTarget).toBeNull();
  });

  it("proportional volume scales the mL and the stock amount follows the mL", () => {
    const v = scaleLine({ quantityG: "228.425", scaling: "proportional", rounding: null, addMethod: "volume", methodQty: "250", methodUnitQty: "0.9137" }, "1.5");
    expect(v.methodTarget!.toString()).toBe("375");
    expect(v.targetG.toString()).toBe("342.6375");
  });

  it("rounds whole units by the stated rule and keeps the exact number (never silent)", () => {
    const up = scaleLine(count, "1.5"); // 7.5 sachets
    expect(up.methodTarget!.toString()).toBe("8");
    expect(up.roundedFrom!.toString()).toBe("7.5");
    expect(up.targetG.toString()).toBe("200");
    expect(scaleLine({ ...count, rounding: "down" }, "1.5").methodTarget!.toString()).toBe("7");
    expect(scaleLine({ ...count, rounding: "nearest" }, "1.5").methodTarget!.toString()).toBe("8");
    expect(scaleLine({ ...count, rounding: "nearest" }, "1.42").methodTarget!.toString()).toBe("7");
    const exact = scaleLine(count, "2");
    expect(exact.methodTarget!.toString()).toBe("10");
    expect(exact.roundedFrom).toBeNull();
    expect(roundedText(up.roundedFrom, up.methodTarget, "sachet", "up")).toBe("Rounded up from 7.5 to 8 sachets (recipe rule).");
  });

  it("refuses a rounding to nothing", () => {
    expect(() => scaleLine({ ...count, rounding: "down" }, "0.1")).toThrow(ScaleError);
  });

  it("as-needed lines scale the estimate and the maximum", () => {
    const s = scaleLine({ quantityG: "40", maxQtyG: "80", scaling: "proportional", rounding: null, addMethod: "as_needed", methodQty: null, methodUnitQty: null }, "2.5");
    expect(s.targetG.toString()).toBe("100");
    expect(s.maxG!.toString()).toBe("200");
  });

  it("sums a line over batches of different sizes, each scaled on its own (rounding per batch)", () => {
    // 1.5 → 8 sachets, 0.5 → 3 sachets (2.5 up): 11 × 25 g
    expect(scaleLineOverBatches(count, "10000", ["15000", "5000"]).toString()).toBe("275");
  });
});

describe("judging", () => {
  const facts = { addMethod: "count", methodUnit: "sachet", methodUnitQty: "25", theoreticalQtyG: "125", tolerancePct: null, toleranceAbsG: "0", methodTargetQty: "5", methodToleranceUnits: "0", maxQtyG: null };
  it("count is exact by default and allows ± units", () => {
    const w = unitWindow(facts)!;
    expect(judgeUnits(w, "5").kind).toBe("ok");
    expect(judgeUnits(w, "4")).toMatchObject({ kind: "low" });
    expect(judgeUnits(unitWindow({ ...facts, methodToleranceUnits: "1" })!, "6").kind).toBe("ok");
    expect(judgeUnits(unitWindow({ ...facts, methodToleranceUnits: "1" })!, "7").kind).toBe("high");
  });
  it("a percentage applies to the units", () => {
    const w = unitWindow({ ...facts, addMethod: "volume", methodUnit: "mL", methodTargetQty: "250", methodToleranceUnits: null, tolerancePct: "2" })!;
    expect(w.min.toString()).toBe("245");
    expect(w.max.toString()).toBe("255");
  });
  it("whole containers are counted exactly", () => {
    const w = unitWindow({ ...facts, addMethod: "whole_container", methodUnit: "drum", methodTargetQty: "2", methodToleranceUnits: "1" })!;
    expect(w.min.toString()).toBe("2");
    expect(w.max.toString()).toBe("2");
  });
  it("weigh and not-measured custom lines are judged in the stock unit", () => {
    expect(judgedInUnits({ addMethod: "weigh", methodUnit: null, methodUnitQty: null })).toBe(false);
    expect(judgedInUnits({ addMethod: "custom", methodUnit: "scoop", methodUnitQty: null })).toBe(false);
    expect(judgedInUnits({ addMethod: "custom", methodUnit: "scoop", methodUnitQty: "12" })).toBe(true);
    expect(entersUnits({ addMethod: "as_needed", methodUnit: "mL", methodUnitQty: "1.02", methodSpec: { recordBy: "volume" } })).toBe(true);
    expect(judgedInUnits({ addMethod: "as_needed", methodUnit: "mL", methodUnitQty: "1.02", methodSpec: { recordBy: "volume" } })).toBe(false);
  });
  it("as needed: anything up to the maximum; the reading must be in its range", () => {
    expect(judgeAsNeeded("80", "80").kind).toBe("ok");
    expect(judgeAsNeeded("80", "80.001")).toMatchObject({ kind: "high" });
    const spec = readSpec({ recordBy: "weigh", reading: { name: "pH", unit: "", min: "5.0", max: "5.5" } });
    expect(readingWithin(spec, "5.2")).toBe(true);
    expect(readingWithin(spec, "5.6")).toBe(false);
    expect(readingWithin(spec, "abc")).toBeNull();
  });
});

describe("words", () => {
  it("plural units, amounts and sentences", () => {
    expect(unitWord("sachet", 5)).toBe("sachets");
    expect(unitWord("box", 2)).toBe("boxes");
    expect(unitWord("mL", 5)).toBe("mL");
    expect(unitsText("1", "drum")).toBe("1 drum");
    expect(amountText({ addMethod: "count", methodUnit: "sachet", methodUnitQty: "25", methodTargetQty: "5", theoreticalQtyG: "125" }, "g")).toBe("5 sachets (125 g)");
    expect(methodSentence({ addMethod: "as_needed", methodUnit: null, methodUnitQty: null, methodTargetQty: null, theoreticalQtyG: "40", maxQtyG: "80", methodSpec: { recordBy: "weigh", reading: { name: "pH", unit: "", min: "5.0", max: "5.5" } } }, "g")).toBe(
      "Add until pH 5.0–5.5 (about 40 g, at most 80 g)",
    );
    expect(methodSentence({ addMethod: "whole_container", methodUnit: "pail", methodUnitQty: "5000", methodTargetQty: "1", theoreticalQtyG: "5000" }, "g")).toBe("Add the whole pail");
    expect(methodSentence({ addMethod: "custom", methodUnit: "scoop", methodUnitQty: null, methodTargetQty: null, theoreticalQtyG: "36", methodSpec: { customName: "Scoop with spoon #3" } }, "g")).toBe("Scoop with spoon #3: about 36 g (write what you used)");
    expect(readSpec({ bogus: 1 })).toEqual({});
    expect(new Decimal(1).toString()).toBe("1");
  });
});

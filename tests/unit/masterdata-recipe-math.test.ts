/**
 * ADR-089: the guided recipe wizard's percent ↔ grams conversion is exact (decimal.js, never
 * floating point), totals say what is missing in plain words, and the step blocks map only to
 * existing routing step kinds.
 */
import { describe, expect, it } from "vitest";
import {
  RECIPE_BLOCKS,
  blockFor,
  fromBomLines,
  fromRoutingSteps,
  gramsFromPercent,
  gramsTotalText,
  kgToGrams,
  lineShown,
  minutesToWait,
  newStep,
  percentFromGrams,
  percentTotalText,
  readingText,
  recipeTotals,
  stepPreviewLine,
  toBomLineInputs,
  toStepInputs,
  waitToMinutes,
} from "@/modules/masterdata/recipe-blocks";
import { STEP_KINDS } from "@/modules/masterdata/schemas";

const line = (amount: string, src: "g" | "pct") => ({ amount, src });

describe("percent ↔ grams", () => {
  it("converts percent to grams exactly (no floating point drift)", () => {
    expect(kgToGrams("17.6")).toBe("17600");
    expect(gramsFromPercent("17600", "21.1545")).toBe("3723.192");
    expect(gramsFromPercent("1000", "0.1")).toBe("1");
    // 0.1 + 0.2 in floating point is 0.30000000000000004; here it stays 0.3
    expect(gramsFromPercent("100", "0.3")).toBe("0.3");
    expect(gramsFromPercent("17600", "33.3333")).toBe("5866.6608");
    expect(gramsFromPercent("999999999", "99.9999")).toBe("999998999.000001");
  });

  it("converts grams to percent rounded to 4 decimals for showing only", () => {
    expect(percentFromGrams("17600", "3723.2")).toBe("21.1545");
    expect(percentFromGrams("3", "1")).toBe("33.3333");
    expect(percentFromGrams("0", "1")).toBe("0");
  });

  it("switching the view back and forth never changes the typed number", () => {
    const l = line("21.1545", "pct" as const);
    const g = lineShown("17600", l, "g");
    expect(g).toBe("3723.192");
    expect(lineShown("17600", l, "pct")).toBe("21.1545");
    const typedGrams = line("1", "g" as const);
    expect(lineShown("3", typedGrams, "pct")).toBe("33.3333");
    expect(lineShown("3", typedGrams, "g")).toBe("1");
  });

  it("totals: exact 100 % only when the grams add up exactly; plain words for the gap", () => {
    const ok = recipeTotals("17600", [line("50", "pct"), line("25.5", "pct"), line("24.5", "pct")]);
    expect(ok.exact).toBe(true);
    expect(percentTotalText(ok)).toBe("Total 100% — good");
    const short = recipeTotals("17600", [line("50", "pct"), line("47.5", "pct")]);
    expect(short.exact).toBe(false);
    expect(percentTotalText(short)).toBe("Total 97.5% — add 2.5% more");
    const over = recipeTotals("1000", [line("60", "pct"), line("41", "pct")]);
    expect(percentTotalText(over)).toBe("Total 101% — take away 1%");
    const mixed = recipeTotals("3", [line("1", "g"), line("1", "g"), line("1", "g")]);
    expect(mixed.exact).toBe(true);
    const seeded = recipeTotals("17600", ["3723.2", "8687.4", "4964.2", "190.9", "34.4"].map((g) => line(g, "g")));
    expect(seeded.totalG).toBe("17600.1");
    expect(gramsTotalText(seeded)).toBe("Total 17,600.1 g of 17,600 g — 0.1 g too much");
  });

  it("builds the formula service input in grams per batch", () => {
    const lines = toBomLineInputs("17600", [
      { materialId: "m1", amount: "21.1545", src: "pct", diffKind: "pct", diff: "2", needsCheck: true, phaseCode: null, scaling: "proportional", isCritical: true },
      { materialId: "m2", amount: "34.4", src: "g", diffKind: "g", diff: "1.5", needsCheck: false, phaseCode: "B", scaling: "fixed", isCritical: false },
    ]);
    expect(lines).toEqual([
      { materialId: "m1", quantityG: "3723.192", tolerancePct: "2", toleranceAbsG: null, phaseCode: null, scaling: "proportional", isCritical: true, requiresChecker: true },
      { materialId: "m2", quantityG: "34.4", tolerancePct: null, toleranceAbsG: "1.5", phaseCode: "B", scaling: "fixed", isCritical: false, requiresChecker: false },
    ]);
    const back = fromBomLines([{ ...lines[1], quantityG: "34.400000", toleranceAbsG: "1.500000" }]);
    expect(back[0]).toMatchObject({ amount: "34.4", src: "g", diffKind: "g", diff: "1.5", phaseCode: "B", scaling: "fixed", needsCheck: false });
  });
});

describe("step blocks", () => {
  it("every block saves as an existing routing step kind", () => {
    for (const b of RECIPE_BLOCKS) expect(STEP_KINDS as readonly string[]).toContain(b.stepKind);
    expect(Object.fromEntries(RECIPE_BLOCKS.map((b) => [b.key, b.stepKind]))).toEqual({
      weigh: "dispensing",
      clean: "line_clearance",
      heat: "process",
      mix: "process",
      cool: "process",
      add: "process",
      pour: "process",
      wait: "curing",
      cut: "cutting",
      wrap: "packaging",
      fill: "filling",
      qc: "in_process_qc",
      move: "transfer",
      other: "process",
    });
  });

  it("finds the block of a stored step again", () => {
    expect(blockFor("process", "Heat the oils")).toBe("heat");
    expect(blockFor("process", "Mixing and pouring")).toBe("pour");
    expect(blockFor("process", "Add the scent")).toBe("add");
    expect(blockFor("process", "Mix to trace")).toBe("mix");
    expect(blockFor("hold", "Rest")).toBe("wait");
    expect(blockFor("reconciliation", "Count")).toBe("other");
  });

  it("wait times: hours, days and weeks become whole minutes", () => {
    expect(waitToMinutes("4", "weeks")).toBe(40320);
    expect(waitToMinutes("1.5", "hours")).toBe(90);
    expect(waitToMinutes("", "days")).toBeNull();
    expect(waitToMinutes("0.001", "hours")).toBeNaN();
    expect(minutesToWait(40320)).toEqual({ amount: "4", unit: "weeks" });
    expect(minutesToWait(2880)).toEqual({ amount: "2", unit: "days" });
    expect(minutesToWait(90)).toEqual({ amount: "1.5", unit: "hours" });
  });

  it("builds the routing service input and the operator preview line", () => {
    const mix = { ...newStep("heat"), name: "Heat the oils" };
    mix.readings[0] = { ...mix.readings[0], min: "60", max: "70" };
    const cure = { ...newStep("wait"), name: "Cure", waitAmount: "4", waitUnit: "weeks" as const };
    const steps = toStepInputs([mix, cure]);
    expect(steps[0]).toMatchObject({ name: "Heat the oils", stepKind: "process", requiresChecker: false, minDurationMinutes: null, parameters: [{ code: "temperature", name: "Temperature", valueKind: "numeric", uom: "°C", minValue: "60", maxValue: "70", isRequired: true }] });
    expect(steps[1]).toMatchObject({ stepKind: "curing", minDurationMinutes: 40320, parameters: [] });
    expect(stepPreviewLine(mix, 2, 7)).toBe("Step 3 of 7 · Heat the oils · Temperature 60–70 °C");
    expect(stepPreviewLine(cure, 5, 7)).toBe("Step 6 of 7 · Cure · Wait at least 4 weeks");
    expect(readingText({ name: "pH", kind: "number", unit: "", min: "", max: "9", })).toBe("pH at most 9");
    // round trip through the stored shape keeps every field
    const stored = steps.map((s) => ({ ...s, code: s.code ?? null, parameters: s.parameters, checklistItems: s.checklistItems }));
    const again = toStepInputs(fromRoutingSteps(stored));
    expect(again).toEqual(steps);
  });
});

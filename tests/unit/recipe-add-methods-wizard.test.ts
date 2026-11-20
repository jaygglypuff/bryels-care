/**
 * ADR-137 in the recipe wizard's pure part: lines in units in the totals, as-needed lines out of the 100 %, the method
 * fields to the formula service and back, new step blocks, choose-from-a-list fields and QA sign.
 */
import { describe, expect, it } from "vitest";
import { blockFor, fromBomLines, fromRoutingSteps, lineGrams, lineHowText, newStep, recipeTotals, stepPreviewLine, toBomLineInputs, toStepInputs, type RecipeLineDraft } from "@/modules/masterdata/recipe-blocks";

const base = { src: "g" as const, diffKind: "pct" as const, diff: "1", needsCheck: false, phaseCode: null, scaling: "proportional" as const, isCritical: true };
const sizes = { sachet: "25", ml: "1.26" };

describe("lines in units", () => {
  it("count and volume lines count their units in grams; as-needed lines stay out of the total", () => {
    const lines: RecipeLineDraft[] = [
      { ...base, materialId: "w", amount: "8388" },
      { ...base, materialId: "f", amount: "", method: "count", methodQty: "4", unitId: "sachet", diffKind: "units", diff: "0", scaling: "proportional_round", rounding: "up" },
      { ...base, materialId: "g", amount: "", method: "volume", methodQty: "1200", unitId: "ml" },
      { ...base, materialId: "c", amount: "20", method: "as_needed", recordBy: "weigh", readingName: "pH", readingMin: "5.0", readingMax: "5.5", maxAmount: "40" },
    ];
    expect(lineGrams("10000", lines[1], sizes)).toBe("100");
    expect(lineGrams("10000", lines[2], sizes)).toBe("1512");
    expect(recipeTotals("10000", lines, sizes)).toMatchObject({ totalG: "10000", exact: true });
    const inputs = toBomLineInputs("10000", lines, sizes);
    expect(inputs[1]).toMatchObject({ addMethod: "count", quantityG: "100", methodQty: "4", materialUnitId: "sachet", toleranceUnits: "0", tolerancePct: null, rounding: "up", scaling: "proportional_round" });
    expect(inputs[2]).toMatchObject({ addMethod: "volume", quantityG: "1512", methodQty: "1200", materialUnitId: "ml", tolerancePct: "1" });
    expect(inputs[3]).toMatchObject({ addMethod: "as_needed", quantityG: "20", maxQtyG: "40", methodSpec: { recordBy: "weigh", reading: { name: "pH", unit: "", min: "5.0", max: "5.5" } }, tolerancePct: null, toleranceAbsG: null });
    // An as-needed line counted in units: guess and maximum in units become grams.
    const counted = toBomLineInputs("10000", [{ ...lines[3], recordBy: "count", unitId: "sachet", methodQty: "1", maxAmount: "2" }], sizes)[0];
    expect(counted).toMatchObject({ quantityG: "25", maxQtyG: "50", methodQty: "1" });
  });

  it("reads stored lines back in the units they were typed in", () => {
    const back = fromBomLines([
      { materialId: "f", quantityG: "100.000000", tolerancePct: null, toleranceAbsG: "0.000000", toleranceUnits: "0.000000", phaseCode: null, scaling: "proportional_round", rounding: "up", isCritical: true, requiresChecker: true, addMethod: "count", methodQty: "4.000000", materialUnitId: "sachet", methodUnit: "sachet", methodUnitQty: "25.000000", operatorNote: "Squeeze it empty" },
      { materialId: "c", quantityG: "25.000000", tolerancePct: null, toleranceAbsG: "25.000000", phaseCode: null, scaling: "proportional", isCritical: true, requiresChecker: false, addMethod: "as_needed", maxQtyG: "50.000000", materialUnitId: "sachet", methodUnit: "sachet", methodUnitQty: "25.000000", methodSpec: { recordBy: "count", reading: { name: "pH", unit: "", min: "5", max: "5.5" } } },
      { materialId: "p", quantityG: "36.000000", tolerancePct: "5.000000", toleranceAbsG: null, phaseCode: null, scaling: "proportional", isCritical: true, requiresChecker: false, addMethod: "custom", methodUnit: "scoop", methodUnitQty: null, methodSpec: { customName: "Scoop with spoon #3" } },
    ]);
    expect(back[0]).toMatchObject({ method: "count", methodQty: "4", unitId: "sachet", diffKind: "units", diff: "0", scaling: "proportional_round", rounding: "up", note: "Squeeze it empty" });
    expect(back[1]).toMatchObject({ method: "as_needed", recordBy: "count", methodQty: "1", maxAmount: "2", readingName: "pH" });
    expect(back[2]).toMatchObject({ method: "custom", customName: "Scoop with spoon #3", customUnit: "scoop", customUnitQty: "", amount: "36", diffKind: "pct", diff: "5" });
    expect(lineHowText(back[0], { sachet: "sachet" })).toBe("Count 4 sachets (bigger or smaller batch: round up)");
    expect(lineHowText(back[1], { sachet: "sachet" })).toBe("Add until pH 5–5.5, at most 2 sachets");
    expect(lineHowText(back[2])).toBe("Scoop with spoon #3: write down what was used");
    expect(lineHowText({ ...base, materialId: "x", amount: "1" })).toBeNull();
  });
});

describe("steps", () => {
  it("new blocks start with their usual fields; a QA sample is QA-signed", () => {
    expect(newStep("homogenise").readings.map((r) => [r.name, r.unit])).toEqual([
      ["Speed", "rpm"],
      ["Time", "min"],
    ]);
    expect(newStep("photo").checklist).toEqual([{ text: "Photo taken", requiresPhoto: true, isBlocking: true }]);
    expect(newStep("sample")).toMatchObject({ qaSigns: true, needsCheck: true, stepKind: "in_process_qc" });
    expect(newStep("custom")).toMatchObject({ isCustom: true, name: "" });
    expect(blockFor("process", "Homogenise the cream")).toBe("homogenise");
    expect(blockFor("hold", "Keep warm at 70 °C")).toBe("keep_warm");
    expect(blockFor("checklist", "Take a photo of the colour")).toBe("photo");
    expect(blockFor("process", "Anything", true)).toBe("custom");
  });

  it("a custom step with a choice field and QA sign goes to the routing service and comes back", () => {
    const s = { ...newStep("custom"), name: "Check the colour", needsCheck: true, qaSigns: true };
    s.readings = [{ name: "Colour", kind: "choice", options: ["Light", " Dark ", ""], unit: "", min: "", max: "", target: "", code: "", required: true }];
    s.checklist = [{ text: "Photo of the colour", requiresPhoto: true, isBlocking: true }];
    const [input] = toStepInputs([s]);
    expect(input).toMatchObject({ name: "Check the colour", isCustom: true, qaSigns: true, requiresChecker: true, parameters: [{ code: "colour", valueKind: "choice", options: ["Light", "Dark"], uom: null }] });
    const [back] = fromRoutingSteps([{ ...input, code: null, area: null, instruction: null, workInstructionRevisionId: null, minDurationMinutes: null, parameters: input.parameters.map((p) => ({ ...p })) }]);
    expect(back).toMatchObject({ block: "custom", isCustom: true, qaSigns: true });
    expect(back.readings[0]).toMatchObject({ kind: "choice", options: ["Light", "Dark"] });
    expect(stepPreviewLine(back, 0, 1)).toBe("Step 1 of 1 · Check the colour · Colour (Light / Dark) · Photo: Photo of the colour · QA signs");
  });
});

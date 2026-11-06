/**
 * Live check 2026-11-06 finding 3: the printed batch record shows quantities with units and sensible decimals,
 * signed differences, ranges and tolerances in words, step and output kinds as words, place names not codes.
 */
import { describe, expect, it } from "vitest";
import { madeVsBoxedWords, num, outputKindWord, packagingToleranceWords, pct, pct2, placeNamesInText, qty, rangeWords, signedQty, stepKindWord, toleranceWords } from "@/modules/production/bmr-words";

describe("BMR words", () => {
  it("quantities: unit, grouping, no trailing zeros", () => {
    expect(qty("120.000000", "pcs", 0)).toBe("120 pcs");
    expect(qty("50.000000", "°C")).toBe("50 °C");
    expect(qty("16200.350000", "g")).toBe("16,200.35 g");
    expect(qty("16200.000000", "g")).toBe("16,200 g");
    expect(num("0.500000")).toBe("0.5");
  });
  it("differences carry a real minus or a plus, percentages two decimals", () => {
    expect(`${signedQty("-0.350000", "g")} (${pct2("0.000000")})`).toBe("−0.35 g (0.00 %)");
    expect(signedQty("2", "pcs")).toBe("+2 pcs");
    expect(signedQty("0", "pcs")).toBe("0 pcs");
    expect(pct2("-1.234")).toBe("−1.23 %");
    expect(pct("95.000")).toBe("95 %");
    expect(pct("100.000000", 2)).toBe("100 %");
  });
  it("ranges and tolerances in words", () => {
    expect(rangeWords("40.000000", null, "60.000000")).toBe("40 – 60");
    expect(rangeWords("40", "50", null)).toBe("at least 40, target 50");
    expect(rangeWords(null, null, null)).toBe("—");
    expect(toleranceWords("3579.148", "3651.452", "1.000", null)).toBe("3,579.1 to 3,651.5 g (± 1 %)");
    expect(toleranceWords("495", "505", null, "5.000")).toBe("495 to 505 g (± 5 g)");
    expect(packagingToleranceWords("0.000000", "pcs")).toBe("none allowed");
    expect(packagingToleranceWords("2", "pcs")).toBe("up to 2 pcs");
  });
  it("kinds in words, unknown keys never raw", () => {
    expect(stepKindWord("line_clearance")).toBe("Clean-area check");
    expect(stepKindWord("some_new_kind")).toBe("Some new kind");
    expect(outputKindWord("finished")).toBe("Finished product");
  });
  it("part 4 explains made vs boxed", () => {
    expect(madeVsBoxedWords("120", 118, 5, "2", "bars")).toBe("120 made = 118 in 5 boxes + 2 bars kept by QA as samples");
    expect(madeVsBoxedWords("96", 94, 4, "1", "pieces", 1)).toBe("96 made = 94 in 4 boxes + 1 piece kept by QA as samples + 1 not boxed");
  });
  it("place codes in recorded notes become names", () => {
    expect(placeNamesInText("Posted to QUA-01", new Map([["QUA-01", "QA waiting area"], ["QUA", "x"]]))).toBe("Posted to QA waiting area (QUA-01)");
    expect(placeNamesInText("No code here", new Map([["RM-01", "Oils rack"]]))).toBe("No code here");
  });
});

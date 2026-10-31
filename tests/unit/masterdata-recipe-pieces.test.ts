/**
 * ADR-088 §4 / ADR-092 in the recipe wizard: a batch typed in pieces becomes the formula's batch size
 * in grams (decimal.js, rounded up to whole grams), reads back as the same pieces, and packaging per
 * piece becomes recipe packaging lines that scale with the pieces.
 */
import { describe, expect, it } from "vitest";
import {
  detectPieces,
  draftPieces,
  fromPackagingLines,
  isPieceGText,
  isPiecesText,
  packagingKeep,
  packagingQty,
  packagingText,
  perPieceOf,
  pieceWord,
  piecesFromBatch,
  piecesToBatchG,
  piecesToBatchKg,
  recipeTotals,
  toPackagingLineInputs,
} from "@/modules/masterdata/recipe-blocks";

const pk = (perPiece: string, from: { qty: string; pieces: string } | null = null, scaling: "proportional" | "fixed" = "proportional") => ({ materialId: "m", perPiece, from, keep: { ...packagingKeep(), scaling } });

describe("pieces → batch size", () => {
  it("70 bars of 135 g at 95 % → 9,948 g (rounded up to whole grams) = 9.948 kg", () => {
    expect(piecesToBatchG("70", "135", "95")).toBe("9948");
    expect(piecesToBatchKg("70", "135", "95")).toBe("9.948");
  });

  it("is exact with decimal.js (no floating point) and rounds only up", () => {
    expect(piecesToBatchG("70", "135", "100")).toBe("9450");
    expect(piecesToBatchKg("70", "135", "100")).toBe("9.45");
    expect(piecesToBatchG("70", "135.5", "95")).toBe("9985"); // 9984.2105… → 9985
    expect(piecesToBatchG("3", "0.1", "100")).toBe("1"); // 0.3 g → 1 g (never 0)
    expect(piecesToBatchG("1000000", "999.999", "1")).toBe("99999900000");
  });

  it("the batch always makes at least the pieces asked for, and reads back as the same pieces", () => {
    for (const [n, g, y] of [
      ["70", "135", "95"],
      ["123", "135", "97.5"],
      ["1", "250", "90"],
      ["48", "99.9", "99.99"],
      ["500", "12.345", "80"],
    ]) {
      const batch = piecesToBatchG(n, g, y)!;
      expect(piecesFromBatch(batch, y, g)).toBe(n);
      expect(detectPieces(batch, y, g)).toBe(n);
    }
  });

  it("a batch typed in kilograms is not mistaken for pieces", () => {
    expect(piecesFromBatch("17600", "95", "135")).toBe("123");
    expect(detectPieces("17600", "95", "135")).toBeNull();
    expect(detectPieces("17600", "95", null)).toBeNull();
  });

  it("refuses what can't be converted (null), never guesses", () => {
    expect(piecesToBatchG("", "135", "95")).toBeNull();
    expect(piecesToBatchG("7.5", "135", "95")).toBeNull();
    expect(piecesToBatchG("0", "135", "95")).toBeNull();
    expect(piecesToBatchG("70", null, "95")).toBeNull();
    expect(piecesToBatchG("70", "0", "95")).toBeNull();
    expect(piecesToBatchG("70", "135", "0")).toBeNull();
    expect(piecesToBatchG("70", "135", "101")).toBeNull();
    expect(isPiecesText("1000000")).toBe(true);
    expect(isPiecesText("1000001")).toBe(false);
    expect(isPieceGText("135.123")).toBe(true);
    expect(isPieceGText("135.1234")).toBe(false);
    expect(piecesFromBatch("9948", "95", "0")).toBe("0");
  });

  it("pieces of a draft: typed when by pieces, else worked out from the kilograms", () => {
    expect(draftPieces({ batchBy: "pcs", pieces: "70", batchKg: "9.948", expectedPct: "95" }, "135")).toBe("70");
    expect(draftPieces({ batchBy: "kg", batchKg: "17.6", expectedPct: "95" }, "135")).toBe("123");
    expect(draftPieces({ batchBy: "kg", batchKg: "17.6", expectedPct: "95" }, null)).toBe("0");
    expect(pieceWord("Soap", 70)).toBe("bars");
    expect(pieceWord("Soap", 1)).toBe("bar");
    expect(pieceWord("Lotion", 2)).toBe("pieces");
  });
});

describe("packaging per piece → recipe packaging lines", () => {
  it("quantity = pieces × per piece (exact), in the item's unit", () => {
    expect(packagingQty("70", pk("1"))).toBe("70");
    expect(packagingQty("70", pk("2"))).toBe("140");
    expect(packagingQty("70", pk("0.0209"))).toBe("1.463");
    expect(packagingQty("70", pk("abc"))).toBe("0");
  });

  it("a stored line kept unchanged saves the same quantity; it scales when the pieces change (fixed lines never)", () => {
    expect(packagingQty("70", pk("0.0286", { qty: "2", pieces: "70" }))).toBe("2");
    expect(packagingQty("140", pk("0.0286", { qty: "2", pieces: "70" }))).toBe("4");
    expect(packagingQty("140", pk("0.0286", { qty: "2", pieces: "70" }, "fixed"))).toBe("2");
    expect(perPieceOf("2", "70")).toBe("0.0286");
    const rows = [{ materialId: "w", quantityG: "70.000000", tolerancePct: "0.000000", toleranceAbsG: null, phaseCode: null, scaling: "proportional", isCritical: false, requiresChecker: false }];
    const back = toPackagingLineInputs("70", fromPackagingLines(rows, "70"));
    expect(back).toEqual([{ materialId: "w", quantityG: "70", tolerancePct: "0", toleranceAbsG: null, phaseCode: null, scaling: "proportional", isCritical: false, requiresChecker: false }]);
  });

  it("new packaging lines are counted, not weighed: 0 % allowed difference, no second-person check, proportional", () => {
    const [l] = toPackagingLineInputs("70", [pk("1")]);
    expect(l).toMatchObject({ quantityG: "70", tolerancePct: "0", toleranceAbsG: null, scaling: "proportional", requiresChecker: false, isCritical: false });
  });

  it("packaging never enters the ingredient percent total", () => {
    // The ingredient total is computed from the ingredient lines only; packaging is a separate list.
    const t = recipeTotals("9948", [
      { amount: "60", src: "pct" },
      { amount: "40", src: "pct" },
    ]);
    expect(t.exact).toBe(true);
    expect(t.totalPct).toBe("100");
  });

  it("plain words for the recipe page", () => {
    expect(packagingText("1", "Soap wrapper 135 g", "Soap")).toBe("1 Soap wrapper 135 g per bar");
    expect(packagingText("0.0209", "Shipping box", "Lotion")).toBe("0.0209 Shipping box per piece");
  });
});

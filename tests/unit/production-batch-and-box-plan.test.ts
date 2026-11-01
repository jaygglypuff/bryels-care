/**
 * ADR-104 §2 and §4, the pure arithmetic of the floor decisions:
 *   - box labels: pieces packed ÷ pieces per box → full boxes and one part box, in words;
 *   - one batch or several: the proposal from the recipe's batch size and the largest batch, "make it one
 *     batch" only up to the largest, and "choose sizes" (> 0, ≤ largest, sum = the order).
 */
import { describe, expect, it } from "vitest";
import { batchPlanText, checkBatchSizes, evenSplit, gramsForPieces, maxPiecesFor, piecesForGrams, proposeBatches } from "@/modules/production/batch-plan";
import { boxPrintLabel, boxSplit, boxSplitText, parsePieces } from "@/modules/production/box-plan";

describe("box split (pieces packed → boxes)", () => {
  it("12 full boxes of 24 and 1 part box of 9", () => {
    const s = boxSplit(297, 24)!;
    expect(s).toMatchObject({ full: 12, part: 9, boxes: 13 });
    expect(s.sizes).toHaveLength(13);
    expect(s.sizes.at(-1)).toBe(9);
    expect(s.sizes.reduce((a, b) => a + b, 0)).toBe(297);
    expect(boxSplitText(s)).toBe("That makes 12 boxes of 24 and 1 box of 9");
    expect(boxPrintLabel(s.boxes)).toBe("Print 13 box labels");
  });

  it("exact boxes have no part box; fewer than one box is one part box", () => {
    expect(boxSplitText(boxSplit(48, 24)!)).toBe("That makes 2 boxes of 24");
    expect(boxSplit(48, 24)!.part).toBe(0);
    expect(boxSplitText(boxSplit(9, 24)!)).toBe("That makes 1 box of 9");
    expect(boxSplitText(boxSplit(24, 24)!)).toBe("That makes 1 box of 24");
    expect(boxPrintLabel(1)).toBe("Print 1 box label");
  });

  it("refuses numbers that are not whole pieces", () => {
    expect(boxSplit(0, 24)).toBeNull();
    expect(boxSplit(10, 0)).toBeNull();
    expect(boxSplit(1.5, 24)).toBeNull();
    expect(parsePieces("1,234")).toBe(1234);
    expect(parsePieces("0")).toBeNull();
    expect(parsePieces("12.5")).toBeNull();
    expect(parsePieces("abc")).toBeNull();
  });
});

describe("pieces and grams (ADR-094 rounding)", () => {
  it("grams for N pieces round up to a whole gram; pieces of a batch round down", () => {
    // 1,000 bars × 135 g × 100 ÷ 95 % = 142,105.26 g → 142,106 g
    expect(gramsForPieces(1000, "135", "95").toString()).toBe("142106");
    expect(piecesForGrams("142106", "95", "135")).toBe(1000);
    expect(piecesForGrams("17600", "95", "135")).toBe(123);
    expect(piecesForGrams("17600", "95", null)).toBe(0);
  });

  it("the most pieces that fit in the largest batch never need more grams than it", () => {
    const n = maxPiecesFor("40000", "135", "95");
    expect(gramsForPieces(n, "135", "95").lte(40000)).toBe(true);
    expect(gramsForPieces(n + 1, "135", "95").gt(40000)).toBe(true);
  });

  it("even split: sizes differ by at most one piece, bigger first", () => {
    expect(evenSplit(2000, 2)).toEqual([1000, 1000]);
    expect(evenSplit(2001, 2)).toEqual([1001, 1000]);
    expect(evenSplit(10, 3)).toEqual([4, 3, 3]);
  });

  it("plan text groups equal batches", () => {
    expect(batchPlanText([1000, 1000], "bars")).toBe("2 batches of 1,000 bars");
    expect(batchPlanText([1500, 500], "bars")).toBe("1 batch of 1,500 bars and 1 batch of 500 bars");
    expect(batchPlanText([1000], "pieces")).toBe("1 batch of 1,000 pieces");
  });
});

describe("one batch or several (proposal)", () => {
  // Recipe batch makes 1,000 bars; the mixer takes 1,800 bars' worth.
  const ref = gramsForPieces(1000, "135", "95").toString();
  const largest = gramsForPieces(1800, "135", "95").toString();

  it("2,000 bars → split into 2 batches of 1,000; one batch of 2,000 is over the largest and says why", () => {
    const p = proposeBatches({ pieces: 2000, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: largest, largestFrom: "Soap mixer 50 L", word: "bars" })!;
    expect(p.refPieces).toBe(1000);
    expect(p.maxPieces).toBe(1800);
    expect(p.split).toEqual({ count: 2, sizes: [1000, 1000] });
    expect(p.one.allowed).toBe(false);
    expect(p.one.reason).toContain("largest batch (1,800 bars, from Soap mixer 50 L)");
    expect(p.one.reason).toContain("Split it into 2 batches");
  });

  it("1,500 bars → 2 even batches of 750; one batch of 1,500 is allowed (≤ 1,800)", () => {
    const p = proposeBatches({ pieces: 1500, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: largest })!;
    expect(p.split.sizes).toEqual([750, 750]);
    expect(p.one).toEqual({ allowed: true, reason: null });
  });

  it("no capacity known: the recipe's batch size is the largest (A-FD-05)", () => {
    const p = proposeBatches({ pieces: 1200, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: null })!;
    expect(p.maxPieces).toBe(1000);
    expect(p.largestFrom).toBe("the recipe's batch size");
    expect(p.one.allowed).toBe(false);
    expect(p.split.count).toBe(2);
  });

  it("a mixer smaller than the recipe batch splits by the mixer", () => {
    const small = gramsForPieces(400, "135", "95").toString();
    const p = proposeBatches({ pieces: 1000, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: small })!;
    expect(p.split).toEqual({ count: 3, sizes: [334, 333, 333] });
  });

  it("cannot plan without a piece weight or with zero pieces", () => {
    expect(proposeBatches({ pieces: 100, refBatchG: ref, yieldPct: "95", pieceG: null, largestG: null })).toBeNull();
    expect(proposeBatches({ pieces: 0, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: null })).toBeNull();
  });
});

describe("choose sizes (validation)", () => {
  it("1,500 + 500 for 2,000 is fine", () => {
    expect(checkBatchSizes(["1,500", "500"], 2000, 1800)).toEqual({ ok: true, sizes: [1500, 500] });
    expect(checkBatchSizes(["1500", "500", ""], 2000, 1800)).toEqual({ ok: true, sizes: [1500, 500] });
  });

  it("refuses zero, words, over the largest and a wrong sum", () => {
    expect(checkBatchSizes(["0", "2000"], 2000, 1800)).toMatchObject({ ok: false, index: 0 });
    expect(checkBatchSizes(["abc"], 2000, 1800)).toMatchObject({ ok: false, index: 0 });
    const over = checkBatchSizes(["1900", "100"], 2000, 1800);
    expect(over).toMatchObject({ ok: false, index: 0 });
    expect(!over.ok && over.message).toContain("more than the largest batch");
    const sum = checkBatchSizes(["1000", "500"], 2000, 1800, "bars");
    expect(!sum.ok && sum.message).toBe("The batches add up to 1,500 bars, but the order is for 2,000. Add 500 more.");
    expect(checkBatchSizes([], 2000, 1800)).toMatchObject({ ok: false });
  });
});

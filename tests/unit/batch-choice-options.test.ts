import { describe, expect, it } from "vitest";
import { batchChoiceOptions, gramsForPieces, proposeBatches } from "@/modules/production/batch-plan";

/**
 * Round 5 B B7 / ADR-133 item 8: the production order form offered "Split into 1 batch · 1 batch of 100 bars" and
 * "Make it one batch · 1 batch of 100 bars", the same choice twice. One batch → one choice.
 */
const ref = gramsForPieces(1000, "135", "95").toString(); // the recipe batch makes 1,000 bars

describe("batchChoiceOptions", () => {
  it("100 bars fit one batch: one choice 'Make it one batch', plus Choose sizes", () => {
    const p = proposeBatches({ pieces: 100, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: null, word: "bars" })!;
    const o = batchChoiceOptions(p, "bars");
    expect(o.map((x) => [x.value, x.title, x.detail])).toEqual([
      ["split", "Make it one batch", "1 batch of 100 bars"],
      ["custom", "Choose sizes", "For example 1,500 + 500. Each one up to the largest batch."],
    ]);
    expect(new Set(o.map((x) => x.detail)).size).toBe(o.length);
  });

  it("2,000 bars: split, one batch (refused above the largest, with the reason) and choose sizes", () => {
    const p = proposeBatches({ pieces: 2000, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: null, word: "bars" })!;
    const o = batchChoiceOptions(p, "bars");
    expect(o.map((x) => x.value)).toEqual(["split", "one", "custom"]);
    expect(o[0]).toMatchObject({ title: "Split into 2 batches", detail: "2 batches of 1,000 bars" });
    expect(o[1].disabled).toBe(true);
    expect(o[1].detail).toMatch(/more than the largest batch/);
  });

  it("1,500 bars with a bigger mixer: splitting and one batch are different, both offered", () => {
    const p = proposeBatches({ pieces: 1500, refBatchG: ref, yieldPct: "95", pieceG: "135", largestG: gramsForPieces(1800, "135", "95").toString(), largestFrom: "Soap mixer", word: "bars" })!;
    const o = batchChoiceOptions(p, "bars");
    expect(o.map((x) => [x.value, x.detail])).toEqual([
      ["split", "2 batches of 750 bars"],
      ["one", "1 batch of 1,500 bars"],
      ["custom", "For example 1,500 + 500. Each one up to the largest batch."],
    ]);
    expect(o[1].disabled).toBe(false);
  });
});

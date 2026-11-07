/**
 * Owner 2026-11-07 (Finish screen): "We took 5 Shipping Box (holds 24). You wrapped 120 bars … 120 too many".
 * Packaging is used per its share of a piece: one wrapper per bar, one box per 24 bars.
 */
import { describe, expect, it } from "vitest";
import { packagingUsedFor, wrapperBalanceSentence, wrapperWord } from "@/modules/production/wrapper-words";

describe("packaging used for the pieces made", () => {
  it("one per piece (wrappers): used = pieces", () => {
    expect(packagingUsedFor(120, 1)).toBe(120);
    expect(packagingUsedFor(120, null)).toBe(120);
  });
  it("boxes of 24: used = whole boxes, a part box counts as one", () => {
    expect(packagingUsedFor(120, 5 / 120)).toBe(5);
    expect(packagingUsedFor(118, 5 / 120)).toBe(5);
    expect(packagingUsedFor(121, 1 / 24)).toBe(6);
  });
  it("5 boxes taken for 120 bars and none left over adds up", () => {
    const used = packagingUsedFor(120, 1 / 24);
    expect(wrapperBalanceSentence({ taken: 5, wrapped: used, damaged: 0, left: 0, word: wrapperWord("Shipping Box (holds 24)") })).toBe("5 taken = 5 used + 0 damaged + 0 left over ✓");
  });
  it("boxes are called boxes", () => {
    expect(wrapperWord("Shipping Box (holds 24)")).toBe("boxes");
    expect(wrapperWord("Soap wrapper 135 g")).toBe("wrappers");
  });
});

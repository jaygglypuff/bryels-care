import { describe, expect, it } from "vitest";
import { newStep } from "@/modules/masterdata/recipe-blocks";
import { changeSize, copiedWithAnswers, mentionsSize, planRecipeCopy, sizeQuestion, type RecipeCopySource } from "@/modules/masterdata/recipe-copy";

/**
 * Round 5 B B17 / ADR-133 item 9: "Copy from this recipe" switched "How do you count one batch?" from pieces to kg
 * without a word and kept the 135 g wrapper and the cutting text for a 100 g product.
 */
const step = (name: string, instruction = "") => ({ ...newStep("other"), name, instruction });
const src = (o: Partial<RecipeCopySource> = {}): RecipeCopySource => ({
  from: "Calamansi Soap 135 g (F-001)",
  batchBy: "pcs",
  pieces: "1000",
  batchKg: "142.105",
  expectedPct: "95",
  pieceG: "135",
  lines: [],
  steps: [step("Mix"), step("Cut", "Cut into 135 g bars with the wire."), step("Wrap", "One wrapper per bar.")],
  packaging: [
    { materialId: "w135", perPiece: "1", from: null, keep: { scaling: "proportional" } as never },
    { materialId: "box", perPiece: "0.0417", from: null, keep: { scaling: "proportional" } as never },
  ],
  packagingNames: { w135: "Soap wrapper 135g (fictional)", box: "Carton of 24 (fictional)" },
  ...o,
});

describe("words that name a piece size", () => {
  it("finds 135 g in its usual spellings, not 1350 g or 35 g", () => {
    for (const t of ["135 g", "135g", "135 grams", "135-g bar", "135 G"]) expect(mentionsSize(t, "135"), t).toBe(true);
    for (const t of ["1350 g", "35 g", "135 kg", "135 pieces"]) expect(mentionsSize(t, "135"), t).toBe(false);
    expect(changeSize("Cut into 135 g bars, 135g each", "135", "100")).toBe("Cut into 100 g bars, 100g each");
  });
});

describe("planRecipeCopy", () => {
  it("keeps counting by pieces (not kg) with the same number of pieces", () => {
    const p = planRecipeCopy(src(), "100");
    expect(p).toMatchObject({ batchBy: "pcs", pieces: "1000", expectedPct: "95" });
    const kg = planRecipeCopy(src({ batchBy: "kg", pieces: "" }), "100");
    expect(kg).toMatchObject({ batchBy: "kg", pieces: "", batchKg: "142.105" });
  });

  it("another piece size: the 135 g wrapper and the cutting step wait for an answer and are not copied until then", () => {
    const p = planRecipeCopy(src(), "100");
    expect(p.size).toEqual({ from: "135", to: "100" });
    expect(p.held.map((h) => [h.key, h.what])).toEqual([
      ["packaging:0", "Soap wrapper 135g (fictional)"],
      ["step:1", "Cut"],
    ]);
    const none = copiedWithAnswers(src(), p, {});
    expect(none.steps.map((s) => s.name)).toEqual(["Mix", "Wrap"]);
    expect(none.packaging.map((x) => x.materialId)).toEqual(["box"]);
    expect(sizeQuestion(p, src().from)).toBe("Calamansi Soap 135 g (F-001) is for 135 g pieces. This product is 100 g. 2 items name 135 g and were not copied yet. What should happen with each one?");
  });

  it("answers: change the step's words to 100 g and keep its place; copy the wrapper anyway or leave it out", () => {
    const p = planRecipeCopy(src(), "100");
    const a = copiedWithAnswers(src(), p, { "step:1": "change", "packaging:0": "drop" });
    expect(a.steps.map((s) => [s.name, s.instruction])).toEqual([
      ["Mix", ""],
      ["Cut", "Cut into 100 g bars with the wire."],
      ["Wrap", "One wrapper per bar."],
    ]);
    expect(a.packaging.map((x) => x.materialId)).toEqual(["box"]);
    const b = copiedWithAnswers(src(), p, { "step:1": "keep", "packaging:0": "keep" });
    expect(b.steps[1].instruction).toBe("Cut into 135 g bars with the wire.");
    expect(b.packaging.map((x) => x.materialId)).toEqual(["w135", "box"]);
  });

  it("the same piece size copies everything at once, with no question", () => {
    const p = planRecipeCopy(src(), "135");
    expect(p.size).toBeNull();
    expect(p.held).toEqual([]);
    expect(copiedWithAnswers(src(), p, {}).steps).toHaveLength(3);
  });

  it("this product has no size yet: the size items still wait (no 'change to' size is offered)", () => {
    const p = planRecipeCopy(src(), null);
    expect(p.size).toEqual({ from: "135", to: null });
    expect(p.held).toHaveLength(2);
    expect(sizeQuestion(p, "X")).toMatch(/This product has no piece size yet/);
    // "change" without a new size copies the words as they are.
    expect(copiedWithAnswers(src(), p, { "step:1": "change" }).steps[1].instruction).toBe("Cut into 135 g bars with the wire.");
  });
});

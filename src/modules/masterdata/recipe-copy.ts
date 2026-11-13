import type { BatchBy, RecipeLineDraft, RecipePackagingDraft, RecipeStepDraft } from "./recipe-blocks";

/**
 * Recipe wizard "Copy from this recipe" (round 5 B B17, ADR-133 item 9). Pure, so the screen and the tests share it.
 *
 * The bug: copying switched "How do you count one batch?" from pieces to kg without a word, and kept the 135 g wrapper
 * and the "cut into 135 g bars" step for a 100 g product. Now:
 *
 * 1. The counting mode of the source is kept: a recipe counted in pieces stays in pieces (the same number of pieces;
 *    the kilograms follow from this product's piece weight on screen 2).
 * 2. When the piece size differs (or this product has no size yet), packaging and steps whose words name the old size
 *    ("135 g") are not copied silently: they wait for an answer, one by one ("Leave it out", "Copy and change to
 *    100 g" for words, "Copy it anyway"). Until answered they are left out.
 */
export type RecipeCopySource = {
  from: string;
  batchBy: BatchBy;
  pieces: string;
  batchKg: string;
  expectedPct: string;
  /** Grams of one piece of the source product (null when it has none). */
  pieceG: string | null;
  lines: RecipeLineDraft[];
  steps: RecipeStepDraft[];
  packaging: RecipePackagingDraft[];
  /** Names of the packaging materials (for "135 g wrapper"). */
  packagingNames: Record<string, string>;
};

export type SizeItem = { key: string; kind: "packaging" | "step"; index: number; what: string; words: string };
export type SizeAnswer = "drop" | "keep" | "change";

export type RecipeCopyPlan = {
  batchBy: BatchBy;
  pieces: string;
  batchKg: string;
  expectedPct: string;
  lines: RecipeLineDraft[];
  /** The old and new piece size when they differ ("135", "100"; `to` null when this product has no size yet). */
  size: { from: string; to: string | null } | null;
  /** Items that name the old size and need an answer. */
  held: SizeItem[];
};

const num = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t && Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : null;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "135 g", "135g", "135 grams", "135-g", "135 gr" (whole word, any case). */
export function sizeWords(grams: string): RegExp {
  const n = String(num(grams) ?? grams);
  return new RegExp(`(?<![\\d.])${esc(n)}(\\s*-?\\s*)(grams?|gr|g)(?![a-z])`, "gi");
}

export const mentionsSize = (text: string | null | undefined, grams: string) => !!text && sizeWords(grams).test(text);

/** "Cut into 135 g bars" → "Cut into 100 g bars" (the unit word is kept). */
export function changeSize(text: string, from: string, to: string): string {
  return text.replace(sizeWords(from), (_m, sep: string, unit: string) => `${String(num(to) ?? to)}${sep}${unit}`);
}

function stepWords(s: RecipeStepDraft): string[] {
  return [s.name, s.instruction, ...s.checklist.map((c) => c.text), ...s.readings.map((r) => r.name)];
}

export function planRecipeCopy(src: RecipeCopySource, targetPieceG: string | null): RecipeCopyPlan {
  const from = num(src.pieceG);
  const to = num(targetPieceG);
  const differs = from !== null && from !== to;
  const held: SizeItem[] = [];
  if (differs) {
    const g = String(from);
    src.packaging.forEach((p, index) => {
      const name = src.packagingNames[p.materialId] ?? "";
      if (mentionsSize(name, g)) held.push({ key: `packaging:${index}`, kind: "packaging", index, what: name, words: name });
    });
    src.steps.forEach((s, index) => {
      const hit = stepWords(s).find((w) => mentionsSize(w, g));
      if (hit) held.push({ key: `step:${index}`, kind: "step", index, what: s.name, words: hit });
    });
  }
  return {
    batchBy: src.batchBy,
    pieces: src.batchBy === "pcs" ? src.pieces : "",
    batchKg: src.batchKg,
    expectedPct: src.expectedPct,
    lines: src.lines,
    size: differs ? { from: String(from), to: to === null ? null : String(to) } : null,
    held,
  };
}

/** The steps and packaging to copy with the answers so far (an item without an answer is left out). */
export function copiedWithAnswers(src: RecipeCopySource, plan: RecipeCopyPlan, answers: Record<string, SizeAnswer | undefined>): { steps: RecipeStepDraft[]; packaging: RecipePackagingDraft[] } {
  const heldBy = new Map(plan.held.map((h) => [h.key, h]));
  const answerOf = (key: string): SizeAnswer | "copy" => (heldBy.has(key) ? (answers[key] ?? "drop") : "copy");
  const steps: RecipeStepDraft[] = [];
  src.steps.forEach((s, i) => {
    const a = answerOf(`step:${i}`);
    if (a === "drop") return;
    if (a === "change" && plan.size?.to) {
      const c = (t: string) => changeSize(t, plan.size!.from, plan.size!.to!);
      steps.push({ ...s, name: c(s.name), instruction: c(s.instruction), checklist: s.checklist.map((x) => ({ ...x, text: c(x.text) })), readings: s.readings.map((r) => ({ ...r, name: c(r.name) })) });
      return;
    }
    steps.push(s);
  });
  const packaging = src.packaging.filter((_, i) => answerOf(`packaging:${i}`) !== "drop");
  return { steps, packaging };
}

/** The sentence over the questions: "The copied recipe is for 135 g pieces. This product is 100 g." */
export function sizeQuestion(plan: RecipeCopyPlan, from: string): string | null {
  if (!plan.size) return null;
  const n = plan.held.length;
  const head = `${from} is for ${plan.size.from} g pieces. ${plan.size.to ? `This product is ${plan.size.to} g.` : "This product has no piece size yet."}`;
  if (!n) return `${head} Check the packaging and the steps.`;
  return `${head} ${n === 1 ? "1 item names" : `${n} items name`} ${plan.size.from} g and ${n === 1 ? "was" : "were"} not copied yet. What should happen with ${n === 1 ? "it" : "each one"}?`;
}

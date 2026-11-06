/**
 * "Can this product be made?" in plain words (owner bug report 2026-11-06, ADR-116). Pure and client-safe: the server
 * part (`recipe-readiness.ts`) finds the state of the product's recipe (formula) and steps (routing) on a date and the
 * people who act next; these functions only phrase it. Unit-tested in tests/unit/recipe-readiness-words.test.ts.
 *
 * A product can be made on a date only when BOTH parts have an approved version in use on that date (V-REV): the
 * recipe gives the ingredients, the steps give the batch record. One sentence names what is missing and who acts:
 *   "This product's recipe is waiting for approval by Nina (QA) — it can be made after that."
 */

export type PartState =
  | { kind: "ready" }
  /** A version is waiting for approval; `by` = the people of the open step in words ("Nina (QA)", "you or Nina (QA)"). */
  | { kind: "waiting"; by: string }
  /** Only a draft: `who` must finish it and send it for approval. */
  | { kind: "draft"; who: string }
  /** Approved, but in use only from a later day (`from` = "9 Nov 2026"). */
  | { kind: "later"; from: string }
  /** Nothing usable: no version at all, or only rejected or retired ones. */
  | { kind: "none" };

export type Readiness = { ready: true; recipe: PartState; steps: PartState; sentence: null } | { ready: false; recipe: PartState; steps: PartState; sentence: string };

type Part = "recipe" | "steps";
const noun = (p: Part) => (p === "recipe" ? "recipe" : "steps");
const be = (p: Part) => (p === "recipe" ? "is" : "are");
const pron = (p: Part) => (p === "recipe" ? "it" : "them");

/** One clause with the subject "its …" / "it has …" (capitalised by the caller when first). */
function clause(p: Part, s: PartState): string | null {
  switch (s.kind) {
    case "ready":
      return null;
    case "waiting":
      return `its ${noun(p)} ${be(p)} waiting for approval by ${s.by}`;
    case "draft":
      return `its ${noun(p)} ${be(p)} still a draft: ${s.who} must finish ${pron(p)} and send ${pron(p)} for approval`;
    case "later":
      return `its ${noun(p)} can be used only from ${s.from}`;
    case "none":
      return p === "recipe" ? "it has no approved recipe yet" : "it has no approved steps yet";
  }
}

/** "its recipe …" → "This product's recipe …"; "it has …" → "This product has …". */
function lead(c: string, subject: string): string {
  if (c.startsWith("its ")) return `${subject}'s ${c.slice(4)}`;
  if (c.startsWith("it ")) return `${subject} ${c.slice(3)}`;
  return c;
}

/**
 * The one sentence. Both parts waiting for the same people read as one ("recipe and steps are waiting for approval
 * by …"). The ending says when it can be made: after the approval, or from the later day.
 */
export function readinessSentence(recipe: PartState, steps: PartState, subject = "This product"): string | null {
  if (recipe.kind === "ready" && steps.kind === "ready") return null;
  const onlyLater = [recipe, steps].every((s) => s.kind === "ready" || s.kind === "later");
  const end = onlyLater ? " — it can be made from that day." : " — it can be made after that.";
  if (recipe.kind === "waiting" && steps.kind === "waiting" && recipe.by === steps.by) return `${subject}'s recipe and steps are waiting for approval by ${recipe.by}${end}`;
  if (recipe.kind === "draft" && steps.kind === "draft" && recipe.who === steps.who) return `${subject}'s recipe and steps are still a draft: ${recipe.who} must finish them and send them for approval${end}`;
  if (recipe.kind === "none" && steps.kind === "none") return `${subject} has no approved recipe and steps yet: make its recipe and send it for approval${end}`;
  const parts = [clause("recipe", recipe), clause("steps", steps)].filter((c): c is string => !!c);
  return `${lead(parts[0], subject)}${parts[1] ? `, and ${parts[1]}` : ""}${end}`;
}

export function readiness(recipe: PartState, steps: PartState, subject?: string): Readiness {
  const sentence = readinessSentence(recipe, steps, subject);
  return sentence === null ? { ready: true, recipe, steps, sentence: null } : { ready: false, recipe, steps, sentence };
}

import { describe, expect, it } from "vitest";
import { type NextActors, nextActorsSentence, peopleWithOwnerAlone } from "@/lib/next-actors-words";
import { OWNER_ALONE_VIEWER_NOTE, ownerAloneApprovedSentence, ownerAloneApprover, ownerAloneButton, ownerAloneDecisionLine } from "@/lib/owner-alone-words";
import { readinessSentence } from "@/modules/masterdata/recipe-readiness-words";

/** ADR-117 (owner decision 2026-11-07): the owner approves recipes, steps and how-to sheets alone — the words. */
const p = (name: string, role: string) => ({ userId: name, name, role });
const recipe: NextActors = {
  kind: "recipe_revision",
  does: "approves the recipe",
  doBase: "approve the recipe",
  where: "in To approve",
  people: [p("Nina Quiambao", "QA"), p("Teresa Lim", "QA")],
  roleWords: "QA",
  viewer: { can: false, selfApproval: false, note: null },
  ownerAlone: [p("Ana Villanueva", "owner")],
  stepNo: 1,
  stepsTotal: 2,
};

describe("owner approves alone, in words", () => {
  it("the approval box and the record", () => {
    expect(OWNER_ALONE_VIEWER_NOTE).toBe("You can approve this alone because you are the owner (no separate QA review).");
    expect(ownerAloneApprover("Ana Villanueva ")).toBe("Ana Villanueva (owner) — no separate QA review");
    expect(ownerAloneApprovedSentence("Ana Villanueva")).toBe("Approved by Ana Villanueva (owner) — no separate QA review");
  });

  it("the green button and the decision line count the open steps", () => {
    expect(ownerAloneButton(1)).toBe("Approve alone");
    expect(ownerAloneButton(2)).toBe("Approve alone (all 2 steps)");
    const policy = [
      { step: 1, label: "QA approval" },
      { step: 2, label: "Site manager or owner approval" },
    ];
    expect(ownerAloneDecisionLine(policy, 1)).toBe("every open step (QA approval, Site manager or owner approval), as the owner");
    expect(ownerAloneDecisionLine(policy, 2)).toBe("Site manager or owner approval, as the owner");
  });

  it("names the step's people, then the owner alone", () => {
    expect(peopleWithOwnerAlone(recipe)).toBe("Nina (QA) or Teresa (QA) — or Ana (owner) alone");
    expect(peopleWithOwnerAlone({ people: [], ownerAlone: recipe.ownerAlone })).toBe("Ana (owner) alone");
    expect(peopleWithOwnerAlone({ people: recipe.people, ownerAlone: [] })).toBe("Nina (QA) or Teresa (QA)");
    expect(nextActorsSentence(recipe)).toBe("Next: Nina (QA) or Teresa (QA) approves the recipe (step 1 of 2) — they will see it in To approve. Or Ana (owner) approves the recipe alone.");
    expect(nextActorsSentence({ ...recipe, people: [] })).toBe("Next: Ana (owner) approves the recipe alone — they will see it in To approve.");
  });

  it("the owner reads their own note; others are still named", () => {
    const n = { ...recipe, ownerAlone: [], viewer: { can: true, selfApproval: false, ownerAlone: true, note: OWNER_ALONE_VIEWER_NOTE } };
    expect(nextActorsSentence(n)).toBe(`${OWNER_ALONE_VIEWER_NOTE} Nina (QA) or Teresa (QA) can do it too.`);
  });

  it("the recipe readiness sentence carries the owner alone", () => {
    const by = peopleWithOwnerAlone(recipe);
    expect(readinessSentence({ kind: "waiting", by }, { kind: "waiting", by })).toBe(
      "This product's recipe and steps are waiting for approval by Nina (QA) or Teresa (QA) — or Ana (owner) alone — it can be made after that.",
    );
  });
});

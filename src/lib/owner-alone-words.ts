/**
 * ADR-117 (owner decision 2026-11-07): the words for "the owner approved a recipe, its steps or a how-to sheet alone".
 * Pure and client-safe; unit-tested in tests/unit/owner-alone-words.test.ts. The rule itself lives in
 * src/modules/masterdata/versioning.ts (`ownerAloneApplies`, `decideAsOwnerAlone`); these functions only phrase it.
 */

/** The approval box, for the owner, while the setting is on. */
export const OWNER_ALONE_VIEWER_NOTE = "You can approve this alone because you are the owner (no separate QA review).";

/** What the record says after the owner approved alone (GMP risk shown, never hidden). */
export const OWNER_ALONE_SUFFIX = " (owner) — no separate QA review";

/** "Ana Villanueva (owner) — no separate QA review". */
export function ownerAloneApprover(name: string): string {
  return `${name.trim()}${OWNER_ALONE_SUFFIX}`;
}

/** "Approved by Ana Villanueva (owner) — no separate QA review". */
export function ownerAloneApprovedSentence(name: string): string {
  return `Approved by ${ownerAloneApprover(name)}`;
}

/** The label of the green button when one press approves every open step. */
export function ownerAloneButton(openSteps: number): string {
  return openSteps > 1 ? `Approve alone (all ${openSteps} steps)` : "Approve alone";
}

/** "every open step (QA approval, Site manager or owner approval), as the owner" — the decision line of the form. */
export function ownerAloneDecisionLine(policy: readonly { step: number; label: string }[], fromStep: number): string {
  const open = policy.filter((p) => p.step >= fromStep).map((p) => p.label);
  return open.length > 1 ? `every open step (${open.join(", ")}), as the owner` : `${open[0] ?? "this step"}, as the owner`;
}

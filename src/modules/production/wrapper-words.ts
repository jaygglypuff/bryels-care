/**
 * ADR-106 §4 "Wrappers count in plain words" — shared by the Finish screen and finishBatch's message (pure).
 *
 *   "123 taken = 120 wrapped + 2 damaged + 1 left over ✓"
 *   "3 wrappers are missing — count the left-over ones again, or write what happened."
 *   "2 wrappers too many — count the left-over and damaged ones again."
 */

/** "wrappers" when the material is a wrapper (or a label roll: "labels"), else its own name. */
export function wrapperWord(materialName: string): string {
  const n = materialName.toLowerCase();
  if (n.includes("wrapper")) return "wrappers";
  if (n.includes("label")) return "labels";
  if (n.includes("bottle")) return "bottles";
  if (n.includes("cap")) return "caps";
  if (n.includes("box") || n.includes("carton")) return "boxes";
  return materialName;
}

export function wrapperBalanceSentence(v: { taken: number; wrapped: number; damaged: number; left: number; word: string; pieceWord?: string }): string {
  const diff = v.taken - v.wrapped - v.damaged - v.left;
  const sum = `${v.taken} taken = ${v.wrapped} used + ${v.damaged} damaged + ${v.left} left over`;
  if (diff === 0) return `${sum} ✓`;
  if (diff > 0) return `${sum}. ${diff} ${diff === 1 ? v.word.replace(/s$/, "") + " is" : v.word + " are"} missing — count the left-over ones again, or write what happened.`;
  return `${sum}. ${-diff} ${diff === -1 ? v.word.replace(/s$/, "") : v.word} too many — count the left-over and damaged ones again.`;
}

/**
 * How many of a packaging item the pieces used up (owner 2026-11-07): `perPiece` is the item's share of one piece
 * from the batch's packaging line (1 for a wrapper or bottle, 1/24 for a box of 24); a part box counts as one.
 * Without a share (older batches), one per piece.
 */
export function packagingUsedFor(pieces: number, perPiece: number | null | undefined): number {
  if (!perPiece || perPiece <= 0) return pieces;
  return Math.ceil(pieces * perPiece - 1e-9);
}

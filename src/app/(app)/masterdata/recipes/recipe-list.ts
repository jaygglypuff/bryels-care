/**
 * One row of the plain recipe list (round 4, UX re-audit C #5): what the recipe's version status is in words, and
 * the one button on the row. Pure; unit tested (tests/unit/recipe-list.test.ts).
 */
type Rev = { revisionNo: number; status: string } | null;
export type RecipeListInput = { effective: Rev; open: Rev; scheduled: Rev };
export type RecipeRowCan = { edit: boolean; newVersion: boolean };

export function recipeStatusWords(r: RecipeListInput): string {
  const parts: string[] = [];
  if (r.effective) parts.push(`Version ${r.effective.revisionNo} in use`);
  if (r.open) parts.push(r.open.status === "pending_approval" ? `version ${r.open.revisionNo} waits for an OK` : `version ${r.open.revisionNo} is a draft`);
  else if (r.scheduled) parts.push(`version ${r.scheduled.revisionNo} starts later`);
  if (!parts.length) return "No version yet";
  const s = parts.join(" · ");
  return s[0].toUpperCase() + s.slice(1);
}

/** "Edit recipe" for a draft, "Make a new version" for a recipe in use with nothing open, else just "Open". */
export function recipeRowAction(r: RecipeListInput, can: RecipeRowCan, formulaId: string): { label: string; href: string; kind: "edit" | "new" | "open" } {
  const base = `/masterdata/recipes/${formulaId}`;
  if (r.open?.status === "draft" && can.edit) return { label: "Edit recipe", href: `${base}?edit=1`, kind: "edit" };
  if (!r.open && (r.effective || r.scheduled) && can.edit && can.newVersion) return { label: "Make a new version", href: `${base}?new=1`, kind: "new" };
  return { label: "Open", href: base, kind: "open" };
}

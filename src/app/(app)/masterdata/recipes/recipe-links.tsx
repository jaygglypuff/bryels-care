import Link from "next/link";
import { buttonClass, cx } from "@/ui/core";

/**
 * The plain action for one recipe on the formulas and routings lists (ADR-086): "Edit recipe" for a
 * draft, "Open recipe" while waiting for approval, "Make a new version" for an approved recipe.
 */
export function RecipeRowAction({ formulaId, openStatus, canChange, className }: { formulaId: string; openStatus: string | null | undefined; canChange: boolean; className?: string }) {
  const [href, label] =
    openStatus === "draft" && canChange
      ? [`/masterdata/recipes/${formulaId}?edit=1`, "Edit recipe"]
      : !openStatus && canChange
        ? [`/masterdata/recipes/${formulaId}?new=1`, "Make a new version"]
        : [`/masterdata/recipes/${formulaId}`, "Open recipe"];
  return (
    <Link href={href} className={cx(buttonClass("secondary", "sm"), "min-h-[44px] whitespace-nowrap", className)}>
      {label}
    </Link>
  );
}

import { redirect } from "next/navigation";

/** Recipes are listed on the formulas page (Management › Master data › Products). */
export default function RecipesIndex() {
  redirect("/masterdata/formulas");
}

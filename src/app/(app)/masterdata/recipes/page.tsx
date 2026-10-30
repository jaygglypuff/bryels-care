import { redirect } from "next/navigation";

/** Recipes are listed on the formulas page (Management → Production setup → Products and formulas). */
export default function RecipesIndex() {
  redirect("/masterdata/formulas");
}

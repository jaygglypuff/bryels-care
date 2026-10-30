import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { type RecipeDraft, recipeWizardOptions } from "@/modules/masterdata";
import { Forbidden } from "../../../forbidden";
import { RecipeWizard } from "../wizard";

export const metadata: Metadata = { title: "New recipe" };

/** Guided "New recipe" (ADR-089): five screens on top of the formula and routing services. */
export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.create") || !ctx.can("masterdata.routing.create")) return <Forbidden what="making new recipes" />;
  const sp = await searchParams;
  const options = await recipeWizardOptions(ctx);
  const pre = options.products.find((p) => p.id === sp.product && !p.formulaId);
  const initial: RecipeDraft = {
    productId: pre?.id ?? "",
    formulaId: null,
    routingId: null,
    batchKg: "",
    expectedPct: "100",
    view: "pct",
    lines: [],
    steps: [],
    changeSummary: "",
    useFrom: "",
    formulaNotes: "",
    routingNotes: "",
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between gap-2 text-[13px]">
        <Link href="/masterdata/formulas" className="text-primary-text hover:underline">
          ← All recipes
        </Link>
        <Link href="/masterdata/formulas/new" className="text-muted hover:underline">
          Advanced editing instead
        </Link>
      </div>
      <RecipeWizard options={options} initial={initial} start={{ kind: "new", ingredientsLabel: "Version 1 (new draft)", stepsLabel: "Version 1 (new draft)", formulaNo: 1, routingNo: 1, locks: { ingredients: false, steps: false } }} />
    </div>
  );
}

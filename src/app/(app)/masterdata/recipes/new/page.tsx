import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { type RecipeDraft, recipeWizardOptions } from "@/modules/masterdata";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { RecipeWizard } from "../wizard";

export const metadata: Metadata = { title: "New recipe" };

/** Guided "New recipe" (ADR-089): five screens on top of the formula and routing services. */
export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.create") || !ctx.can("masterdata.routing.create")) return <Forbidden what="making new recipes" permission="masterdata.formula.create" />;
  const sp = await searchParams;
  const options = await recipeWizardOptions(ctx);
  const pre = options.products.find((p) => p.id === sp.product && !p.formulaId);
  const initial: RecipeDraft = {
    productId: pre?.id ?? "",
    formulaId: null,
    routingId: null,
    // ADR-088 §4: new recipes start "by pieces" (the owner counts batches in pieces); by weight is one tap away.
    batchBy: "pcs",
    pieces: "",
    pieceG: "",
    packaging: [],
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
        <Link href="/masterdata/formulas" className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">
          ← All recipes
        </Link>
      </div>
      <div className="mx-auto w-full max-w-3xl">
        <PageIntro>This screen is for making the recipe of one product in five short screens: which product, how much one batch makes, the ingredients, the steps, then check and send it for approval.</PageIntro>
      </div>
      <RecipeWizard options={options} initial={initial} start={{ kind: "new", ingredientsLabel: "Version 1 (new draft)", stepsLabel: "Version 1 (new draft)", formulaNo: 1, routingNo: 1, locks: { ingredients: false, steps: false } }} />
    </div>
  );
}

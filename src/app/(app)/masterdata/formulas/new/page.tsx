import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { formulaFormOptions } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NEXT_WRAP } from "../../_eng/plain";
import { Forbidden } from "../../../forbidden";
import { createFormulaAction } from "../../_eng/actions";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";

export const metadata: Metadata = { title: "New recipe (advanced)" };

/** New recipe header (advanced editing, ADR-089): three questions; the system gives the number (F-nnnn, ADR-093). */
export default async function NewFormulaPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.create")) return <Forbidden what="making recipes" />;
  const { products } = await formulaFormOptions(ctx);
  const canWizard = ctx.can("masterdata.routing.create");
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New recipe (advanced)" />
      <PageIntro>This screen is for starting a recipe by hand. Most people use New recipe (step by step). These screens are for advanced changes.</PageIntro>
      {canWizard && <NextStep className={NEXT_WRAP} text="Easier: the step-by-step recipe asks one thing at a time and adds the steps too." action={{ label: "New recipe (step by step)", href: "/masterdata/recipes/new" }} />}
      {products.length === 0 ? (
        <EmptyState title="No products yet" action={<LinkButton href="/masterdata/products?new=1#new-product" variant="secondary">Add a product</LinkButton>}>
          A recipe belongs to a product. Add the product first, or use New recipe (step by step), which can make it for you.
        </EmptyState>
      ) : (
        <Card>
          <ActionForm action={createFormulaAction} submitLabel="Start the recipe (draft)" pendingText="Starting…" variant="primary" cancelHref="/masterdata/formulas">
            <SelectField name="productId" label="Which product is it for?" options={products.map((p) => ({ value: p.id, label: p.name }))} />
            <Grid>
              <TextField name="referenceBatchSizeG" label="How much does one batch weigh? (grams)" inputMode="decimal" placeholder="e.g. 17600" hint="The ingredient amounts are typed for this batch weight." />
              <TextField name="theoreticalYieldPct" label="Expected amount made (%)" inputMode="decimal" placeholder="e.g. 95" hint="How much of the batch weight ends up as product. The process owner confirms it." />
            </Grid>
            <p className="text-[13px] text-muted">You add the ingredients on the next screen. The system gives the recipe a number.</p>
            <MoreDetails>
              <Grid>
                <TextField name="name" label="Recipe name (optional)" placeholder="The product's name" />
                <TextField name="changeSummary" label="Why is this recipe needed? (optional)" />
                <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. F-0001" mono hint="The batch paper shows it as the recipe number." />
              </Grid>
            </MoreDetails>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { routingFormOptions } from "@/modules/masterdata";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NEXT_WRAP } from "../../_eng/plain";
import { Forbidden } from "../../../forbidden";
import { createRoutingAction } from "../../_eng/actions";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";

export const metadata: Metadata = { title: "New steps (advanced)" };

/** New steps for a product (advanced editing): one question; the system gives the number (R-nnnn, ADR-093) and the name. */
export default async function NewRoutingPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.create")) return <Forbidden what="making steps" />;
  const products = await routingFormOptions(ctx);
  const canWizard = ctx.can("masterdata.formula.create");
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New steps (advanced)" />
      <PageIntro>This screen is for starting the steps of a product by hand. Most people use New recipe (step by step). These screens are for advanced changes.</PageIntro>
      {canWizard && <NextStep className={NEXT_WRAP} text="Easier: the step-by-step recipe lets you pick the steps from pictures." action={{ label: "New recipe (step by step)", href: "/masterdata/recipes/new" }} />}
      {products.length === 0 ? (
        <EmptyState title="No products yet" action={<LinkButton href="/masterdata/products?new=1#new-product" variant="secondary">Add a product</LinkButton>}>
          Steps belong to a product. Add the product first.
        </EmptyState>
      ) : (
        <Card>
          <ActionForm action={createRoutingAction} submitLabel="Start the steps (draft)" pendingText="Starting…" variant="primary" cancelHref="/masterdata/routings">
            <SelectField name="productId" label="Which product are the steps for?" options={products.map((p) => ({ value: p.id, label: p.name }))} />
            <p className="text-[13px] text-muted">You add the steps on the next screen. The system gives them a number and the name &quot;Steps for …&quot;.</p>
            <MoreDetails>
              <Grid>
                <TextField name="name" label="Name (optional)" placeholder="Steps for the product" />
                <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. R-0001" mono />
              </Grid>
            </MoreDetails>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

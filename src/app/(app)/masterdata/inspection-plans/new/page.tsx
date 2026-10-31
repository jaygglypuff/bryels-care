import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { inspectionPlanFormOptions } from "@/modules/masterdata";
import { Card, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { createInspectionPlanAction } from "../../_eng/actions";
import { ActionForm, SelectField, TextField } from "../../_org/form";

export const metadata: Metadata = { title: "Quality checks for an item" };

/** Quality checks for one item (ADR-088): which item and when; the name and number QCP-nnnn have defaults. */
export default async function NewInspectionPlanPage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection_plan.create")) return <Forbidden what="adding quality checks" />;
  const { products, materials } = await inspectionPlanFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Quality checks for an item" />
      <PageIntro>Pick the material or product and when QA checks it. On the next page you add each check and its limits; a second QA person approves them.</PageIntro>
      <Card>
        <ActionForm action={createInspectionPlanAction} submitLabel="Next: add the checks" pendingText="Creating…" variant="cta" cancelHref="/masterdata/inspection-plans">
          <SelectField
            name="item"
            label="Which item?"
            emptyLabel="Choose…"
            options={[...materials.map((m) => ({ value: `m:${m.id}`, label: `Material: ${m.name}` })), ...products.map((p) => ({ value: `p:${p.id}`, label: `Product: ${p.name}` }))]}
          />
          <SelectField
            name="planKind"
            label="When does QA check a product?"
            defaultValue="finished_product"
            options={[
              { value: "finished_product", label: "When the batch is finished" },
              { value: "in_process", label: "While the batch is being made" },
            ]}
            hint="Materials are always checked when a delivery arrives."
          />
          <MoreDetails>
            <TextField name="name" label="Name (optional)" placeholder="The system names it after the item" />
            <TextField name="code" label="Your own code (optional)" placeholder="The system gives one, e.g. QCP-0001" mono />
          </MoreDetails>
        </ActionForm>
      </Card>
    </div>
  );
}

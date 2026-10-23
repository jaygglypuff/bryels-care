import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { formulaFormOptions } from "@/modules/masterdata";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { createFormulaAction } from "../../_eng/actions";
import { CreateForm } from "../../_eng/forms";

export const metadata: Metadata = { title: "New formula" };

export default async function NewFormulaPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.formula.create")) return <Forbidden what="creating formulas" />;
  const { products } = await formulaFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New formula" subtitle="Creates the formula header and a draft revision 1. Add ingredient lines on the next page." />
      {products.length === 0 ? (
        <EmptyState title="No products yet" action={<LinkButton href="/masterdata/products" variant="secondary">Products</LinkButton>}>
          A formula belongs to a product. Create the product first.
        </EmptyState>
      ) : (
        <Card>
          <CreateForm action={createFormulaAction} submitLabel="Create draft formula" cancelHref="/masterdata/formulas">
            <Field label="Product" htmlFor="productId">
              <Select id="productId" name="productId" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Formula code" htmlFor="code" hint='"Batch Formula No." on the BMR, e.g. F-ACS-02.'>
                <Input id="code" name="code" required autoComplete="off" className="font-mono uppercase" placeholder="F-XXX-01" />
              </Field>
              <Field label="Name" htmlFor="name">
                <Input id="name" name="name" required placeholder="Acapulco Soap" />
              </Field>
              <Field label="Reference batch size (g)" htmlFor="referenceBatchSizeG" hint="Line quantities are entered per this size.">
                <Input id="referenceBatchSizeG" name="referenceBatchSizeG" inputMode="decimal" required placeholder="17600" />
              </Field>
              <Field label="Theoretical yield (%)" htmlFor="theoreticalYieldPct" hint="Process-owner value; verify before production use.">
                <Input id="theoreticalYieldPct" name="theoreticalYieldPct" inputMode="decimal" required placeholder="95" />
              </Field>
            </div>
            <Field label="Why is this formula needed? (optional)" htmlFor="changeSummary">
              <Input id="changeSummary" name="changeSummary" />
            </Field>
          </CreateForm>
        </Card>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { routingFormOptions } from "@/modules/masterdata";
import { Card, EmptyState, Field, Input, PageHeader, Select } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { createRoutingAction } from "../../_eng/actions";
import { CreateForm } from "../../_eng/forms";

export const metadata: Metadata = { title: "New routing" };

export default async function NewRoutingPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.create")) return <Forbidden what="creating routings" />;
  const products = await routingFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New routing" subtitle="Creates the routing and a draft revision 1. Add the steps on the next page." />
      {products.length === 0 ? (
        <EmptyState title="No products yet">A routing belongs to a product. Create the product first.</EmptyState>
      ) : (
        <Card>
          <CreateForm action={createRoutingAction} submitLabel="Create draft routing" cancelHref="/masterdata/routings">
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
              <Field label="Routing code" htmlFor="code">
                <Input id="code" name="code" required autoComplete="off" className="font-mono uppercase" placeholder="R-XXX-01" />
              </Field>
              <Field label="Name" htmlFor="name">
                <Input id="name" name="name" required placeholder="Lotion route" />
              </Field>
            </div>
          </CreateForm>
        </Card>
      )}
    </div>
  );
}

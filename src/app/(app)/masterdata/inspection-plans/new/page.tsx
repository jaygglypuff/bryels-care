import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { inspectionPlanFormOptions } from "@/modules/masterdata";
import { Card, Field, Input, PageHeader, Select } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { createInspectionPlanAction } from "../../_eng/actions";
import { CreateForm } from "../../_eng/forms";

export const metadata: Metadata = { title: "New inspection plan" };

export default async function NewInspectionPlanPage() {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection_plan.create")) return <Forbidden what="creating inspection plans" />;
  const { products, materials } = await inspectionPlanFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New inspection plan" subtitle="Creates draft revision 1. Add tests on the next page; a second QA user approves." />
      <Card>
        <CreateForm action={createInspectionPlanAction} submitLabel="Create draft plan" cancelHref="/masterdata/inspection-plans">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="code">
              <Input id="code" name="code" required className="font-mono uppercase" placeholder="IP-AHL-FP" />
            </Field>
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required />
            </Field>
          </div>
          <Field label="Kind" htmlFor="planKind" hint="Incoming plans apply to a material; in-process and finished-product plans to a product.">
            <Select id="planKind" name="planKind" defaultValue="finished_product">
              <option value="finished_product">Finished product</option>
              <option value="in_process">In-process</option>
              <option value="incoming">Incoming (material)</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product (in-process / finished)" htmlFor="productId">
              <Select id="productId" name="productId" defaultValue="">
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.skuCode})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Material (incoming)" htmlFor="materialId">
              <Select id="materialId" name="materialId" defaultValue="">
                <option value="">—</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CreateForm>
      </Card>
    </div>
  );
}

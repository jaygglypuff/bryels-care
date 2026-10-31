import { requireContext } from "@/lib/auth/context";
import { MATERIAL_KIND_DEFAULTS, materialFormOptions, supplierOptions } from "@/modules/masterdata";
import { Card, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { ActionForm } from "../../_org/form";
import { createMaterialAction } from "../../_org/actions";
import { MaterialFields } from "../material-fields";

export const metadata = { title: "New material" };

/** New material in three questions (ADR-088); the system gives the code. */
export default async function NewMaterialPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.create")) return <Forbidden what="adding materials" />;
  const options = await materialFormOptions(ctx);
  const suppliers = ctx.can("masterdata.supplier.edit") && ctx.can("masterdata.supplier.view") ? (await supplierOptions(ctx)).map((s) => ({ id: s.id, name: s.name })) : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New material" />
      <PageIntro>Add something you buy: an ingredient, packaging or supplies. Answer three questions; the system gives it a number.</PageIntro>
      <Card>
        <ActionForm action={createMaterialAction} submitLabel="Add material" pendingText="Adding…" variant="cta" cancelHref="/masterdata/materials">
          <MaterialFields options={{ ...options, kindDefaults: MATERIAL_KIND_DEFAULTS, suppliers }} creating />
        </ActionForm>
      </Card>
    </div>
  );
}

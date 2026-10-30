import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { materialFormOptions, uomOptions } from "@/modules/masterdata";
import { Card, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { ActionForm, SelectField } from "../../_org/form";
import { saveMaterialAction } from "../../_org/actions";
import { MaterialFields } from "../material-fields";

export const metadata = { title: "New material" };

export default async function NewMaterialPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.create")) return <Forbidden what="creating materials" />;
  const baseUnits = await uomOptions(db, ctx.organizationId, { baseOnly: true });
  const options = await materialFormOptions(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New material" subtitle="Add a raw material, packaging item, intermediate or consumable" />
      <Card>
        <ActionForm action={saveMaterialAction} submitLabel="Create material" pendingText="Creating…" variant="cta" cancelHref="/masterdata/materials">
          <MaterialFields baseUnits={baseUnits} options={options} />
          <SelectField name="status" label="Start as" defaultValue="active" options={[{ value: "active", label: "Active (can be received and used)" }, { value: "draft", label: "Draft (still being set up)" }]} />
        </ActionForm>
      </Card>
    </div>
  );
}

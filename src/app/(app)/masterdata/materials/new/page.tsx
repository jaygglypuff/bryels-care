import { requireContext } from "@/lib/auth/context";
import { Card, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { MaterialForm } from "./material-form";

export const metadata = { title: "New material" };

export default async function NewMaterialPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.material.create")) return <Forbidden what="creating materials" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New material" subtitle="Add a raw material, intermediate or packaging item" />
      <Card>
        <MaterialForm />
      </Card>
    </div>
  );
}

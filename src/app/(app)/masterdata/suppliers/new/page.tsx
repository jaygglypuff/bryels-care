import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { lookupOptions } from "@/modules/masterdata";
import { PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.create")) return <Forbidden what="creating suppliers" />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New supplier" />
      <PageIntro>Add a company you buy from. Only the name is needed; the system gives it a number.</PageIntro>
      <SupplierForm categories={await lookupOptions(db, ctx.organizationId, "supplier_category")} />
    </div>
  );
}

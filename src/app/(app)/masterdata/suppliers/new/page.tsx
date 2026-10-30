import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { lookupOptions } from "@/modules/masterdata";
import { PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.create")) return <Forbidden what="creating suppliers" />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New supplier" subtitle="Contacts, terms, lead time and quality status. The approved-material list arrives with purchasing (Phase 6)." />
      <SupplierForm categories={await lookupOptions(db, ctx.organizationId, "supplier_category")} />
    </div>
  );
}

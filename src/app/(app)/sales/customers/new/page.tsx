import { requireContext } from "@/lib/auth/context";
import { suggestCustomerCode } from "@/modules/sales";
import { PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.create")) return <Forbidden what="creating customers" />;
  return (
    <>
      <PageHeader title="New customer" subtitle="Fictional demo data only in development." />
      <CustomerForm suggestedCode={await suggestCustomerCode(ctx)} />
    </>
  );
}

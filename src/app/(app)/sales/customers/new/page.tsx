import { requireContext } from "@/lib/auth/context";
import { customerSegmentOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.create")) return <Forbidden what="adding customers" />;
  return (
    <>
      <PageHeader title="New customer" actions={<LinkButton href="/sales/customers" variant="ghost">Back to customers</LinkButton>} />
      <PageIntro>This screen is for adding someone we sell to. Type the name, phone and address; the system gives the customer number.</PageIntro>
      <CustomerForm segments={await customerSegmentOptions(ctx)} canSetTerms={ctx.can("finance.credit_terms.approve")} />
    </>
  );
}

import { requireContext } from "@/lib/auth/context";
import { complaintFormContext } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { LogComplaintForm } from "../forms";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

/** Log a complaint (W07-06): customer, the label's lot or box, what is reported. */
export default async function NewComplaintPage({ searchParams }: { searchParams: Promise<{ customerId?: string; code?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.complaint.create")) return <Forbidden what="logging complaints" />;
  const sp = await searchParams;
  const f = await complaintFormContext(ctx);
  if (!f.customers.length) {
    return (
      <EmptyState title="No customers yet" action={<LinkButton href="/sales/customers" variant="secondary">Customers</LinkButton>}>
        A complaint belongs to a customer. Add the customer first, or ask sales to.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader title="Write down a complaint" actions={<><Help screen="quality.complaint" /></>} />
      <PageIntro>This screen is for sales and QA: write down what the customer says. QA is told at once.</PageIntro>
      <Card className="max-w-3xl">
        <CardTitle>What does the customer say?</CardTitle>
        <LogComplaintForm customers={f.customers} products={f.products} categories={f.categories} channels={f.channels} defaultCustomerId={sp.customerId} defaultCode={sp.code} />
      </Card>
    </>
  );
}

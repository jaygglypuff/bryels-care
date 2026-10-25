import { requireContext } from "@/lib/auth/context";
import { complaintFormContext } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
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
        A complaint belongs to a customer. Add the customer first.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader title="Log complaint" subtitle="Scan or type the lot or box from the customer's label so QA can start the trace from a verified record." actions={<><Help screen="quality.complaint" /></>} />
      <Card className="max-w-3xl">
        <CardTitle>Complaint</CardTitle>
        <LogComplaintForm customers={f.customers} products={f.products} categories={f.categories} channels={f.channels} defaultCustomerId={sp.customerId} defaultCode={sp.code} />
      </Card>
    </>
  );
}

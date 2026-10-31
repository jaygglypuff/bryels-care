import { requireContext } from "@/lib/auth/context";
import { PAYMENT_METHOD_LABEL, paymentFormOptions, paymentPrefillFor } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Record a payment" };

/** Record a payment (US-6-12): who, how much, when, how; the payment number is made by the server. The system never moves money. */
export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ counterparty?: string; invoice?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.payment_record.create")) return <Forbidden what="recording payments" />;
  const { counterparty, invoice } = await searchParams;
  const opts = await paymentFormOptions(ctx);
  const parties = [
    ...opts.customers.map((c) => ({ value: `customer:${c.id}`, label: `${c.name} (customer – money in)` })),
    ...opts.suppliers.map((s) => ({ value: `supplier:${s.id}`, label: `${s.name} (supplier – money out)` })),
    ...opts.claimants.map((u) => ({ value: `claimant:${u.id}`, label: `${u.name} (paid back for expenses – money out)` })),
  ];
  // Opened from an invoice: that invoice and its open amount are preselected (else "Oldest due first").
  const prefill = paymentPrefillFor(opts.open ?? {}, parties.map((p) => p.value), invoice);
  const initial = prefill?.counterparty ?? (counterparty && parties.some((p) => p.value === counterparty) ? counterparty : parties[0]?.value);
  return (
    <>
      <PageHeader title="Record a payment" actions={<LinkButton href="/finance/payments" variant="secondary">All payments</LinkButton>} />
      <PageIntro>This screen is for writing down money that already moved (bank, cash, cheque, e-wallet). The system does not send money. A second person approves, then finance saves it to the books.</PageIntro>
      {parties.length === 0 ? (
        <EmptyState title="Nothing to pay or collect" action={<LinkButton href="/finance" variant="secondary">Money home</LinkButton>}>
          Customers with unpaid invoices, suppliers with bills to pay and people with expense claims to pay back show here.
        </EmptyState>
      ) : (
        <PaymentForm parties={parties} open={opts.open ?? {}} methods={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} today={opts.today ?? ""} initial={initial!} prefill={prefill} />
      )}
    </>
  );
}

import { requireContext } from "@/lib/auth/context";
import { PAYMENT_METHOD_LABEL, paymentFormOptions, paymentPrefillFor } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Record a payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ counterparty?: string; invoice?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.payment_record.create")) return <Forbidden what="recording payments" />;
  const { counterparty, invoice } = await searchParams;
  const opts = await paymentFormOptions(ctx);
  const parties = [
    ...opts.customers.map((c) => ({ value: `customer:${c.id}`, label: `${c.name} (customer, money in)` })),
    ...opts.suppliers.map((s) => ({ value: `supplier:${s.id}`, label: `${s.name} (supplier, money out)` })),
    ...opts.claimants.map((u) => ({ value: `claimant:${u.id}`, label: `${u.name} (expense claims, money out)` })),
  ];
  // Opened from an invoice: that invoice and its open amount are preselected (else "Oldest due first").
  const prefill = paymentPrefillFor(opts.open ?? {}, parties.map((p) => p.value), invoice);
  const initial = prefill?.counterparty ?? (counterparty && parties.some((p) => p.value === counterparty) ? counterparty : parties[0]?.value);
  return (
    <>
      <PageHeader title="Record a payment" subtitle="Enter the money that moved (bank, cash, cheque, e-wallet). The record goes to approval, then finance records it and the applications post." actions={<LinkButton href="/finance/payments" variant="secondary">Back</LinkButton>} />
      {parties.length === 0 ? (
        <EmptyState title="Nothing open to pay or collect">Issued invoices, posted supplier bills and posted expense claims appear here as counterparties.</EmptyState>
      ) : (
        <PaymentForm parties={parties} open={opts.open ?? {}} methods={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} today={opts.today ?? ""} initial={initial!} prefill={prefill} />
      )}
    </>
  );
}

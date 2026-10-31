import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { billFormOptions, financeBusinessDate } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { BillForm } from "./bill-form";

export const metadata = { title: "Enter a supplier bill" };

/** Supplier bill entry (US-6-11): our bill number is made by the server; the supplier's own number is copied from their paper. */
export default async function NewBillPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.create")) return <Forbidden what="entering supplier bills" />;
  const o = await billFormOptions(ctx);
  return (
    <>
      <PageHeader title="Enter a supplier bill" actions={<LinkButton href="/finance/bills" variant="secondary">All supplier bills</LinkButton>} />
      <PageIntro>This screen is for typing in a bill a supplier sent us: pick the supplier and the delivery, copy their bill number and date, and type the prices. Our own number is made for you.</PageIntro>
      {o.suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet">Suppliers are added under Master data → Suppliers. Ask purchasing or the administrator.</EmptyState>
      ) : (
        <BillForm
          suppliers={o.suppliers}
          receipts={o.receipts.map((r) => ({ id: r.id, supplierId: r.supplierId, label: `Delivery of ${fmtDate(r.receivedAt)} (${r.receiptNumber})`, lines: r.lines }))}
          categories={o.categories}
          taxCodes={o.taxCodes}
          defaultTaxCode={o.defaultTaxCode}
          creditable={o.creditable}
          today={financeBusinessDate()}
          poConnected={o.poConnected}
        />
      )}
    </>
  );
}

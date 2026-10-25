import { requireContext } from "@/lib/auth/context";
import { billFormOptions, financeBusinessDate } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { BillForm } from "./bill-form";

export const metadata = { title: "Enter a supplier bill" };

export default async function NewBillPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.create")) return <Forbidden what="entering supplier bills" />;
  const o = await billFormOptions(ctx);
  return (
    <>
      <PageHeader title="Enter a supplier bill" subtitle="Copy the supplier's bill number and date. Bills without a receipt are only for non-stock categories." actions={<LinkButton href="/finance/bills" variant="secondary">Back</LinkButton>} />
      {o.suppliers.length === 0 ? (
        <EmptyState title="No active suppliers">Add the supplier in master data first.</EmptyState>
      ) : (
        <BillForm
          suppliers={o.suppliers}
          receipts={o.receipts.map((r) => ({ id: r.id, supplierId: r.supplierId, label: `${r.receiptNumber} · ${r.supplierName}`, lines: r.lines }))}
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
